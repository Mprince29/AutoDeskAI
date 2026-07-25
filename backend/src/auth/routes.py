from fastapi import APIRouter, HTTPException, status, Depends, Request, Query
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from .database import get_db
from .models import User, LoginLog
from datetime import datetime, timedelta, timezone
from utils.activity_logger import record_activity
import os
from urllib.parse import urlencode
import httpx
from typing import Optional, Tuple
import bcrypt
import time
import threading

router = APIRouter()

# ── User cache ────────────────────────────────────────────────────────────────
# Avoids a DB round-trip on every request for get_current_user.
# With a remote Supabase DB each uncached lookup costs 150-300ms of network latency.
# TTL of 60s is safe: user settings rarely change and stale data only affects
# non-critical fields (timezone, llm_provider). Auth is still validated via email match.
_USER_CACHE: dict[str, Tuple[User, float]] = {}
_USER_CACHE_TTL = 60.0  # seconds
_USER_CACHE_LOCK = threading.Lock()

# Password handling replaced with direct bcrypt for better compatibility
def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        pwd_bytes = plain_password.encode('utf-8')[:72]
        return bcrypt.checkpw(pwd_bytes, hashed_password.encode('utf-8'))
    except Exception:
        return False

def _cache_invalidate(email: str):
    """Call this after any write that mutates user fields (settings, tokens, etc.)."""
    with _USER_CACHE_LOCK:
        _USER_CACHE.pop(email, None)


def get_current_user(email: str = Query(...), db: Session = Depends(get_db)) -> User:
    """Get current user from email query parameter, with a 60s in-process cache."""
    now = time.monotonic()
    with _USER_CACHE_LOCK:
        entry = _USER_CACHE.get(email)
        if entry and (now - entry[1]) < _USER_CACHE_TTL:
            # Re-attach the detached cached user to the current session.
            # load=False avoids an unnecessary SELECT if the object is already in the identity map.
            return db.merge(entry[0], load=False)

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Before caching, we detach the object from the current session.
    # This prevents the session from marking it as "expired" when it closes,
    # ensuring the cached copy remains readable in future requests.
    db.expunge(user)

    with _USER_CACHE_LOCK:
        _USER_CACHE[email] = (user, now)
    
    # Return a bound instance for the current request.
    return db.merge(user, load=False)

def record_login_log(db: Session, email: str, status: str, method: str, request: Request, user_id: Optional[int] = None):
    """Helper to record a login attempt in the database.

    LoginLog keeps auth-specific history, while ActivityLog is the unified
    user activity timeline used by the rest of the app.
    """
    try:
        log = LoginLog(
            user_id=user_id,
            email=email,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            status=status,
            method=method
        )
        db.add(log)
        db.commit()

        record_activity(
            db,
            user_email=email,
            action="auth_login",
            entity_type="user",
            entity_id=user_id,
            status=status,
            level="INFO" if status == "success" else "WARNING",
            details={"method": method},
            request=request,
            user_id=user_id,
        )
    except Exception as e:
        print(f"[ERROR] Failed to record login log: {e}")
        db.rollback()

# --- Gmail OAuth Login Route ---
@router.get("/auth/login")
def gmail_oauth_login(email: str = Query(...)):
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
    REDIRECT_URI = os.environ.get("REDIRECT_URI")
    if not GOOGLE_CLIENT_ID or not REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Google OAuth environment variables not set.")
    from mcp_servers.core.google_auth import _SCOPES
    scope = " ".join(_SCOPES)
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": email  # Pass user email as state
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(url)

# --- Gmail OAuth Callback Route ---
@router.get("/auth/callback")
def gmail_oauth_callback(request: Request, db: Session = Depends(get_db)):
    code = request.query_params.get("code")
    email = request.query_params.get("state")  # User email passed as state if linking
    google_error = request.query_params.get("error")
    print(f"[DEBUG] OAuth callback received. Code: {bool(code)}, State/Email: {email}, Error: {google_error}")

    if google_error:
        _msgs = {
            "redirect_uri_mismatch": (
                "OAuth redirect URI mismatch — the REDIRECT_URI in your .env does not match "
                "what is registered in Google Cloud Console. "
                f"Current value: {os.environ.get('REDIRECT_URI', 'not set')}. "
                "Add this exact URL as an Authorized Redirect URI in your Google Cloud project."
            ),
            "access_denied": "Google login was cancelled or access was denied by the user.",
        }
        detail = _msgs.get(google_error, f"Google OAuth error: {google_error}")
        raise HTTPException(status_code=400, detail=detail)

    if not code:
        raise HTTPException(status_code=400, detail="Missing code in callback.")
        
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
    REDIRECT_URI = os.environ.get("REDIRECT_URI")
    
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET or not REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Google OAuth environment variables not set.")
        
    # 1. Exchange code for tokens
    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code"
    }
    
    with httpx.Client() as client:
        resp = client.post(token_url, data=token_data)
        if resp.status_code != 200:
            print(f"[DEBUG] Token exchange failed: {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        tokens = resp.json()
        access_token = tokens.get("access_token")

    # 2. Identify the user
    # If email was not in state (SSO flow), fetch it from Google
    if not email:
        print("[DEBUG] No state found. Performing SSO identity lookup...")
        with httpx.Client() as client:
            userinfo_resp = client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if userinfo_resp.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to fetch user info from Google")
            userinfo = userinfo_resp.json()
            email = userinfo.get("email")
            name = userinfo.get("name", email.split("@")[0])
            print(f"[DEBUG] SSO identity found: {email}")

    if not email:
        raise HTTPException(status_code=400, detail="Could not resolve user email from Google.")

    # 3. Find or Create User
    user = db.query(User).filter(User.email == email).first()
    is_new_user = False
    
    if not user:
        print(f"[DEBUG] SSO: Creating new user for {email}")
        import random
        import string
        # Create user with a long random password since they use SSO
        random_pass = "".join(random.choices(string.ascii_letters + string.digits, k=32))
        from .routes import hash_password
        user = User(
            email=email,
            name=name if 'name' in locals() else email.split("@")[0],
            hashed_password=hash_password(random_pass),
            onboarding_completed=False
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        is_new_user = True

    # 4. Store/Update tokens
    from utils.token_encryption import token_encryption
    from datetime import datetime, timedelta, timezone
    
    user.gmail_access_token = token_encryption.encrypt_token(access_token)
    user.gmail_token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
    user.calendar_access_token = user.gmail_access_token
    user.calendar_token_expires_at = user.gmail_token_expires_at
    
    if tokens.get("refresh_token"):
        encrypted_refresh = token_encryption.encrypt_token(tokens["refresh_token"])
        user.gmail_refresh_token = encrypted_refresh
        user.calendar_refresh_token = encrypted_refresh
    
    user.last_login = datetime.now(timezone.utc)
    db.commit()

    # 5. Handle Redirects
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    
    # If state was present, it's the "Linking" flow (usually from Settings)
    if request.query_params.get("state"):
        html_content = f"""
        <html>
            <body>
                <script>
                    if (window.opener) {{
                        window.opener.postMessage("oauth_success", "*");
                        window.close();
                    }} else {{
                        window.location.href = "{frontend_url}/settings/integrations";
                    }}
                </script>
            </body>
        </html>
        """
        return HTMLResponse(content=html_content)
    
    # If state was missing, it's the "SSO Login" flow
    # Pass a simple mock JWT and user info in the URL for the frontend to consume
    import json
    from urllib.parse import quote
    user_json = json.dumps({"email": user.email, "name": user.name})
    # In a real app, use create_access_token() here
    sso_token = "google-sso-token-" + user.email 
    
    redirect_target = f"{frontend_url}/auth/callback?token={sso_token}&user={quote(user_json)}"
    return RedirectResponse(url=redirect_target)

@router.post("/auth/disconnect-gmail")
def disconnect_gmail(email: str = Query(...), db: Session = Depends(get_db)):
    """Disconnect Gmail by clearing user's Gmail tokens"""
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Clear Gmail tokens
        user.gmail_access_token = None
        user.gmail_refresh_token = None
        user.gmail_token_expires_at = None
        
        db.commit()
        
        record_activity(
            db, email, "security_audit:gmail_disconnected",
            entity_type="integration", entity_id=user.id,
            level="WARNING"
        )
        
        return JSONResponse({"message": "Gmail disconnected successfully"})
    except Exception as e:
        print(f"[DEBUG] Error disconnecting Gmail: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to disconnect Gmail: {str(e)}")

@router.post("/auth/disconnect-calendar")
def disconnect_calendar(email: str = Query(...), db: Session = Depends(get_db)):
    """Disconnect Calendar by clearing user's Calendar tokens"""
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Clear Calendar tokens
        user.calendar_access_token = None
        user.calendar_refresh_token = None
        user.calendar_token_expires_at = None
        
        db.commit()
        
        record_activity(
            db, email, "security_audit:calendar_disconnected",
            entity_type="integration", entity_id=user.id,
            level="WARNING"
        )
        
        return JSONResponse({"message": "Calendar disconnected successfully"})
    except Exception as e:
        print(f"[DEBUG] Error disconnecting Calendar: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to disconnect Calendar: {str(e)}")

@router.post("/auth/clear-all-google-tokens")
def clear_all_google_tokens(email: str = Query(...), db: Session = Depends(get_db)):
    """Clear all Google OAuth tokens for a user (Gmail, Calendar, and any future Google services)"""
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Clear all Google OAuth tokens
        user.gmail_access_token = None
        user.gmail_refresh_token = None
        user.gmail_token_expires_at = None
        user.calendar_access_token = None
        user.calendar_refresh_token = None
        user.calendar_token_expires_at = None
        
        db.commit()
        
        record_activity(
            db, email, "security_audit:all_google_tokens_cleared",
            entity_type="integration", entity_id=user.id,
            level="WARNING"
        )
        
        print(f"[DEBUG] All Google tokens cleared for user: {email}")
        return JSONResponse({"message": "All Google tokens cleared successfully"})
        
    except Exception as e:
        print(f"[DEBUG] Error clearing all Google tokens: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear all Google tokens: {str(e)}")

@router.get("/auth/google/validate")
def validate_google_connection(email: str = Query(...), db: Session = Depends(get_db)):
    """
    Proactively verify that the stored Google token can actually be used.
    Makes a lightweight call to the Google tokeninfo endpoint.
    Returns {valid: bool, error?: str} — used by the frontend to detect silently-expired tokens.
    """
    import httpx as _httpx
    from utils.token_encryption import token_encryption as _enc

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.gmail_access_token:
        return {"valid": False, "error": "Google account not connected"}

    try:
        access_token = _enc.decrypt_token(user.gmail_access_token)
        resp = _httpx.get(
            "https://www.googleapis.com/oauth2/v3/tokeninfo",
            params={"access_token": access_token},
            timeout=8,
        )
        if resp.status_code == 200:
            return {"valid": True}

        # Token is expired/revoked — attempt a refresh if refresh token is present
        if not user.gmail_refresh_token:
            return {"valid": False, "error": "Token expired and no refresh token stored. Please reconnect."}

        refresh_token = _enc.decrypt_token(user.gmail_refresh_token)
        token_resp = _httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": os.environ.get("GOOGLE_CLIENT_ID"),
                "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET"),
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        if token_resp.status_code != 200:
            return {"valid": False, "error": "Token expired and refresh failed. Please reconnect."}

        new_tokens = token_resp.json()
        new_access = new_tokens.get("access_token")
        if new_access:
            from datetime import timedelta, timezone as _tz
            encrypted = _enc.encrypt_token(new_access)
            new_expiry = datetime.now(_tz.utc) + timedelta(seconds=new_tokens.get("expires_in", 3600))
            user.gmail_access_token = encrypted
            user.gmail_token_expires_at = new_expiry
            user.calendar_access_token = encrypted
            user.calendar_token_expires_at = new_expiry
            db.commit()
            _cache_invalidate(email)
            return {"valid": True, "refreshed": True}

        return {"valid": False, "error": "Unexpected error during token refresh."}
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class CheckEmailRequest(BaseModel):
    email: EmailStr

@router.post("/auth/check-email")
def check_email(data: CheckEmailRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    return {"exists": user is not None}

@router.post("/auth/signup", response_model=LoginResponse)
def signup(request: Request, data: SignupRequest, db: Session = Depends(get_db)):
    # Check if user exists
    user = db.query(User).filter(User.email == data.email).first()
    if user:
        raise HTTPException(status_code=400, detail="User already exists")
    # Truncate password to 72 bytes (bcrypt limit) to prevent ValueError
    hashed_password = hash_password(data.password)
    new_user = User(email=data.email, hashed_password=hashed_password, name=data.name)
    
    # Set initial last_login
    new_user.last_login = datetime.now(timezone.utc)
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Security audit log for new user creation
    record_activity(
        db, new_user.email, "security_audit:account_created",
        entity_type="user", entity_id=new_user.id,
        level="INFO",
        request=request
    )
    
    # Record the signup/initial login event
    record_login_log(db, new_user.email, "success", "password", request, user_id=new_user.id)
    
    return {
        "access_token": "mock-jwt-token",
        "token_type": "bearer",
        "user": {
            "email": new_user.email,
            "name": new_user.name
        }
    }

@router.post("/auth/login", response_model=LoginResponse)
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    
    if not user or not verify_password(data.password, user.hashed_password):
        # Record failed attempt
        record_login_log(db, data.email, "failed", "password", request, user_id=user.id if user else None)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    
    # Update last login
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    
    # Record successful login
    record_login_log(db, user.email, "success", "password", request, user_id=user.id)
    

    return {
        "access_token": "mock-jwt-token",
        "token_type": "bearer",
        "user": {
            "email": user.email,
            "name": user.name
        }
    }

# --- Password Recovery Routes ---

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

@router.post("/auth/forgot-password")
async def forgot_password(data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        # For security, don't reveal if user exists or not
        return {"message": "If an account exists with this email, an OTP has been sent."}
    
    import random
    import string
    otp = "".join(random.choices(string.digits, k=6))
    user.reset_otp = otp
    user.reset_otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.commit()
    
    from utils.mail_utils import send_otp_email
    send_otp_email(user.email, otp)
    
    return {"message": "OTP sent successfully."}

@router.post("/auth/reset-password")
async def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not user.reset_otp or user.reset_otp != data.otp:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    
    if datetime.now(timezone.utc) > user.reset_otp_expires_at:
        raise HTTPException(status_code=400, detail="OTP has expired")
    
    # Update password
    user.hashed_password = hash_password(data.new_password)
    user.reset_otp = None
    user.reset_otp_expires_at = None
    db.commit()
    
    return {"message": "Password reset successful. You can now log in."}

# --- Standard Google SSO Entry ---

@router.get("/auth/google")
def google_sso_login():
    """Generic Google Login entry point that doesn't require a pre-entered email."""
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
    REDIRECT_URI = os.environ.get("REDIRECT_URI")
    if not GOOGLE_CLIENT_ID or not REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Google OAuth environment variables not set.")
    
    # Basic scopes for identity + all required MCP scopes for Gmail, Calendar, etc.
    from mcp_servers.core.google_auth import _SCOPES
    scope = " ".join(list(set(["openid", "email", "profile"] + _SCOPES)))
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "prompt": "consent", # force consent screen so Google always issues a refresh_token
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(url)

@router.get("/gmail/emails")
def get_gmail_emails(email: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.gmail_access_token:
        raise HTTPException(status_code=404, detail="User or Gmail access token not found.")
    access_token = user.gmail_access_token
    headers = {"Authorization": f"Bearer {access_token}"}
    # Step 1: List messages
    list_url = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    params = {"maxResults": 10}
    with httpx.Client() as client:
        list_resp = client.get(list_url, headers=headers, params=params)
        if list_resp.status_code != 200:
            raise HTTPException(status_code=list_resp.status_code, detail=list_resp.text)
        messages = list_resp.json().get("messages", [])
        emails = []
        # Step 2: For each message, get details
        for msg in messages:
            msg_id = msg["id"]
            msg_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
            msg_resp = client.get(msg_url, headers=headers, params={"format": "metadata", "metadataHeaders": ["Subject", "From"]})
            if msg_resp.status_code != 200:
                continue
            msg_data = msg_resp.json()
            headers_list = msg_data.get("payload", {}).get("headers", [])
            subject = next((h["value"] for h in headers_list if h["name"] == "Subject"), "(No Subject)")
            sender = next((h["value"] for h in headers_list if h["name"] == "From"), "(Unknown)")
            snippet = msg_data.get("snippet", "")
            emails.append({
                "id": msg_id,
                "subject": subject,
                "from": sender,
                "snippet": snippet
            })
    return {"emails": emails}

@router.get("/gmail/email")
def get_gmail_email(email: str, id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.gmail_access_token:
        raise HTTPException(status_code=404, detail="User or Gmail access token not found.")
    access_token = user.gmail_access_token
    headers = {"Authorization": f"Bearer {access_token}"}
    msg_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
    params = {"format": "full"}
    with httpx.Client() as client:
        msg_resp = client.get(msg_url, headers=headers, params=params)
        if msg_resp.status_code != 200:
            raise HTTPException(status_code=msg_resp.status_code, detail=msg_resp.text)
        msg_data = msg_resp.json()
        headers_list = msg_data.get("payload", {}).get("headers", [])
        subject = next((h["value"] for h in headers_list if h["name"] == "Subject"), "(No Subject)")
        sender = next((h["value"] for h in headers_list if h["name"] == "From"), "(Unknown)")
        to = next((h["value"] for h in headers_list if h["name"] == "To"), "(Unknown)")
        date = next((h["value"] for h in headers_list if h["name"] == "Date"), "(Unknown)")
        # Try to get plain text body, else HTML
        def get_body(payload):
            if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
                import base64
                return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="ignore")
            if "parts" in payload:
                for part in payload["parts"]:
                    body = get_body(part)
                    if body:
                        return body
            return None
        body = get_body(msg_data.get("payload", {}))
        if not body:
            # Try HTML
            def get_html(payload):
                if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data"):
                    import base64
                    return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="ignore")
                if "parts" in payload:
                    for part in payload["parts"]:
                        html = get_html(part)
                        if html:
                            return html
                return None
            body = get_html(msg_data.get("payload", {}))
        return {
            "id": id,
            "subject": subject,
            "from": sender,
            "to": to,
            "date": date,
            "body": body or "(No content)"
        }

# --- Missing User Preferences API ---
@router.get("/user/preferences")
def get_user_preferences(email: str = Query(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Return user preferences. Uses cached user object to avoid extra DB round-trip."""
    
    COMPANY_DOMAIN = "example.com"
    is_company_user = user.email.endswith(f"@{COMPANY_DOMAIN}")
    # Default is False (personal keys) when not yet set - new users start isolated
    use_company_keys = user.use_company_keys if user.use_company_keys is not None else False

    return {
        "auto_classify_emails": user.auto_classify_emails,
        "auto_schedule_meetings": user.auto_schedule_meetings,
        "timezone": user.timezone or "UTC",
        "gmail_connected": bool(user.gmail_access_token),
        "calendar_connected": bool(user.calendar_access_token),
        "microsoft_connected": False,
        "llm_provider": user.llm_provider or None,
        "preferred_model": user.preferred_model,
        "is_monitoring": user.is_monitoring,
        # Company key management - only relevant for company-managed accounts
        "is_company_user": is_company_user,
        "use_company_keys": use_company_keys if is_company_user else None,
        "communication_profile": user.communication_profile,
        "last_visited_path": user.last_visited_path
    }

class UpdatePreferencesRequest(BaseModel):
    auto_classify_emails: Optional[bool] = None
    auto_schedule_meetings: Optional[bool] = None
    timezone: Optional[str] = None
    llm_provider: Optional[str] = None
    preferred_model: Optional[str] = None
    is_monitoring: Optional[bool] = None
    communication_profile: Optional[str] = None
    last_visited_path: Optional[str] = None

@router.put("/user/preferences")
def update_user_preferences(
    data: UpdatePreferencesRequest,
    email: str = Query(...), 
    db: Session = Depends(get_db)
):
    """Endpoint to update user preferences in the database."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if data.auto_classify_emails is not None:
        user.auto_classify_emails = data.auto_classify_emails
    if data.auto_schedule_meetings is not None:
        user.auto_schedule_meetings = data.auto_schedule_meetings
    if data.timezone is not None:
        user.timezone = data.timezone
    if data.llm_provider is not None:
        user.llm_provider = data.llm_provider
    if data.preferred_model is not None:
        user.preferred_model = data.preferred_model
    if data.is_monitoring is not None:
        user.is_monitoring = data.is_monitoring
    if data.communication_profile is not None:
        user.communication_profile = data.communication_profile
    if data.last_visited_path is not None:
        user.last_visited_path = data.last_visited_path
        
    db.commit()
    db.refresh(user)
    _cache_invalidate(email)  # flush stale cached user object

    # Record the activity
    record_activity(
        db, user.email, "update_preferences",
        entity_type="user", entity_id=user.id,
        details=data.model_dump(exclude_unset=True)
    )

    COMPANY_DOMAIN = "example.com"
    is_company_user = user.email.endswith(f"@{COMPANY_DOMAIN}")

    return {
        "message": "Preferences updated successfully",
        "auto_classify_emails": user.auto_classify_emails,
        "auto_schedule_meetings": user.auto_schedule_meetings,
        "timezone": user.timezone,
        "gmail_connected": bool(user.gmail_access_token),
        "calendar_connected": bool(user.calendar_access_token),
        "llm_provider": user.llm_provider,
        "preferred_model": user.preferred_model,
        "is_monitoring": user.is_monitoring,
        "is_company_user": is_company_user,
        "use_company_keys": user.use_company_keys,
        "communication_profile": user.communication_profile,
        "last_visited_path": user.last_visited_path
    }


class LLMControlsRequest(BaseModel):
    llm_controls: dict  # {creativity: 1-5, length: 1-5, focus: 1-5}


@router.put("/user/llm-controls")
def update_llm_controls(
    body: LLMControlsRequest,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """Persist the user's LLM response control preferences."""
    prefs = getattr(_current_user, "user_preferences", None) or {}
    prefs["llm_controls"] = body.llm_controls
    _current_user.user_preferences = prefs
    db.commit()
    _cache_invalidate(_current_user.email)
    return {"ok": True}


class KeyModeRequest(BaseModel):
    use_company_keys: bool


@router.post("/user/key-mode")
def set_key_mode(
    body: KeyModeRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Toggle between company-managed API keys and personal API keys.
    Only meaningful for company accounts - ignored otherwise.
    """
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    COMPANY_DOMAIN = "example.com"
    if not email.endswith(f"@{COMPANY_DOMAIN}"):
        raise HTTPException(status_code=403, detail="This setting is only available to company accounts")

    user.use_company_keys = body.use_company_keys
    db.commit()
    _cache_invalidate(email)

    record_activity(
        db, user.email, "toggle_key_mode",
        entity_type="user", entity_id=user.id,
        details={"use_company_keys": body.use_company_keys}
    )

    return {
        "use_company_keys": user.use_company_keys,
        "message": "Using company API keys" if body.use_company_keys else "Using your personal API keys",
    }


class OnboardingRequest(BaseModel):
    onboarding_completed: bool


@router.put("/user/onboarding")
def update_onboarding_status(
    body: OnboardingRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Update the onboarding completion status for a user."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.onboarding_completed = body.onboarding_completed
    db.commit()
    db.refresh(user)
    
    record_activity(
        db, user.email, "complete_onboarding",
        entity_type="user", entity_id=user.id
    )

    return {
        "message": "Onboarding status updated successfully",
        "onboarding_completed": user.onboarding_completed
    }


@router.get("/user/onboarding-status")
def get_onboarding_status(email: str = Query(...), db: Session = Depends(get_db)):
    """Get the onboarding completion status for a user."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "onboarding_completed": user.onboarding_completed
    }
