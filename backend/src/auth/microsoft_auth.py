from fastapi import APIRouter, HTTPException, Depends, Request, Query
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session
import os
import msal
from typing import Optional
from datetime import datetime, timedelta

from .database import get_db
from .models import User
from loguru import logger

# Try to import token decryption/encryption, fallback gracefully if not found
try:
    from utils.token_encryption import token_encryption
    is_encryption_available = True
except ImportError:
    logger.warning("Token encryption module not found. Tokens will be stored in plain text.")
    is_encryption_available = False

router = APIRouter()

# Microsoft Authentication settings
def get_msal_app():
    CLIENT_ID = os.environ.get("AZURE_CLIENT_ID")
    CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET")
    TENANT_ID = os.environ.get("AZURE_TENANT_ID", "common") # "common" allows personal + work accounts
    
    if not CLIENT_ID or not CLIENT_SECRET:
        return None
        
    AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
    
    return msal.ConfidentialClientApplication(
        CLIENT_ID, authority=AUTHORITY,
        client_credential=CLIENT_SECRET,
    )

# Required scopes for Email, Calendar, and basic profile
MS_SCOPES = [
    "User.Read",
    "Mail.ReadWrite",
    "Mail.Send",
    "Calendars.ReadWrite",
    "offline_access" # Critical for getting a refresh token
]

@router.get("/auth/microsoft/login")
def microsoft_oauth_login(email: str = Query(...)):
    """Initiates the Microsoft OAuth login flow."""
    app = get_msal_app()
    REDIRECT_URI = os.environ.get("AZURE_REDIRECT_URI")
    
    if not app or not REDIRECT_URI:
        raise HTTPException(
            status_code=500, 
            detail="Microsoft OAuth is not configured. Missing environment variables."
        )
        
    # We pass the user's email in the state parameter to link the account later
    auth_url = app.get_authorization_request_url(
        MS_SCOPES,
        state=email,
        redirect_uri=REDIRECT_URI
    )
    
    return RedirectResponse(auth_url)

@router.get("/auth/microsoft/callback")
def microsoft_oauth_callback(
    request: Request, 
    code: Optional[str] = None, 
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Handles the callback from Microsoft OAuth."""
    if error:
        logger.error(f"Microsoft OAuth Error: {error} - {error_description}")
        return HTMLResponse(
            content=f"<html><body><h1>Authentication Error</h1><p>{error_description}</p></body></html>",
            status_code=400
        )
        
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state parameter.")
        
    user_email = state # We passed the user email in the state param
    
    app = get_msal_app()
    REDIRECT_URI = os.environ.get("AZURE_REDIRECT_URI")
    
    if not app or not REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Microsoft OAuth configuration error.")
    
    # Exchange the authorization code for an access token
    result = app.acquire_token_by_authorization_code(
        code,
        scopes=MS_SCOPES,
        redirect_uri=REDIRECT_URI
    )
    
    if "error" in result:
        logger.error(f"Token exchange failed: {result.get('error_description')}")
        raise HTTPException(
            status_code=400, 
            detail=f"Token exchange failed: {result.get('error_description', 'Unknown error')}"
        )
        
    access_token = result.get("access_token")
    refresh_token = result.get("refresh_token") # Can be null if offline_access is missing or already granted
    expires_in = result.get("expires_in", 3600)
    
    # Store the tokens in the database
    user = db.query(User).filter(User.email == user_email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    # Encrypt if available, otherwise store clear (be mindful in production!)
    if is_encryption_available:
        user.microsoft_access_token = token_encryption.encrypt_token(access_token)
        if refresh_token:
            user.microsoft_refresh_token = token_encryption.encrypt_token(refresh_token)
    else:
        user.microsoft_access_token = access_token
        if refresh_token:
            user.microsoft_refresh_token = refresh_token
            
    user.microsoft_token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    
    db.commit()
    logger.info(f"Successfully linked Microsoft account for user: {user_email}")
    
    # Return HTML that closes the popup (matching existing Google flow)
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    html_content = f"""
    <html>
        <body>
            <script>
                if (window.opener) {{
                    window.opener.postMessage("oauth_success", "*");
                    window.close();
                }} else {{
                    window.location.href = "{frontend_url}/settings?tab=integrations&connected=microsoft";
                }}
            </script>
            <p>Microsoft authentication successful! Returning to settings...</p>
        </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@router.post("/auth/microsoft/disconnect")
def disconnect_microsoft(email: str = Query(...), db: Session = Depends(get_db)):
    """Disconnects the Microsoft account by clearing tokens."""
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        user.microsoft_access_token = None
        user.microsoft_refresh_token = None
        user.microsoft_token_expires_at = None
        
        db.commit()
        return {"message": "Microsoft account disconnected successfully."}
        
    except Exception as e:
        logger.error(f"Error disconnecting Microsoft account: {e}")
        raise HTTPException(status_code=500, detail=str(e))
