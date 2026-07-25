"""
Universal Integrations Router
One route pair handles ALL platforms - driven by integration_registry.py.

Routes:
  GET  /integrations/status                → per-user connection status (DB-backed)
  GET  /integrations/{platform}/connect    → start OAuth2 flow OR return field config for API-key platforms
  GET  /integrations/callback              → universal OAuth2 callback (all platforms)
  POST /integrations/{platform}/api_key    → save API key / bot token
  POST /integrations/{platform}/verify     → test an existing credential
  DELETE /integrations/{platform}          → revoke credential

Legacy (kept for backwards compat):
  POST /integrations/telegram/config       → original Telegram connect route
"""
import os
import json
import secrets
from urllib.parse import urlencode
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.database import get_db
from auth.models import User
from auth.routes import get_current_user
from utils.company import is_company_user
from loguru import logger

router = APIRouter()

# ── Helpers ────────────────────────────────────────────────────────────────────

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL  = os.getenv("BACKEND_URL",  "http://localhost:8000")


def _get_user_by_email(email: str, db: Session) -> User:
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── Status ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def integrations_status(
    email: str = Query(None),
    db: Session = Depends(get_db),
):
    """
    Return per-user connection status + server-side availability for all platforms.

    Response shape: { platform: { connected: bool, available: bool } }
      - connected: user has an active credential stored in the vault
      - available: for oauth2 platforms, the server has the OAuth app credentials
                   configured (client_id env var present); always True for api_key platforms
    """
    from services.integration_registry import INTEGRATION_REGISTRY
    from services.vault_service import vault

    # Build availability map - platforms that need server-side app credentials
    availability: Dict[str, bool] = {}
    for platform, cfg in INTEGRATION_REGISTRY.items():
        if cfg["auth_type"] in ("oauth2", "trello_oauth"):
            availability[platform] = bool(os.getenv(cfg["client_id_env"], ""))
        else:
            availability[platform] = True  # api_key / bot_token - always available

    # LLM providers whose env vars count as "system-level connected" for any user.
    # These are keys the platform operator sets in .env for everyone to benefit from.
    LLM_PLATFORMS = {"openai", "anthropic", "gemini", "groq", "mistral", "deepseek", "ollama"}

    connected_map: Dict[str, bool] = {}
    if email:
        user = db.query(User).filter(User.email == email).first()
        if user:
            is_company = is_company_user(email)
            use_company = is_company and (
                user.use_company_keys if user.use_company_keys is not None else False
            )

            from auth.models import UserIntegration
            # Single query - fetch all integration rows for this user at once
            user_rows = db.query(UserIntegration).filter(
                UserIntegration.user_id == user.id
            ).all()
            row_map: Dict[str, str] = {r.platform: r.status for r in user_rows}

            for platform in INTEGRATION_REGISTRY:
                status = row_map.get(platform)

                # Explicit opt-out row
                if status == "disconnected":
                    connected_map[platform] = False
                    continue

                # Company users: env vars count for all platforms
                if use_company:
                    env_cred = vault._get_env_creds(platform)
                    if env_cred:
                        connected_map[platform] = True
                        continue

                # Personal vault row is connected
                if status == "connected":
                    connected_map[platform] = True
                    continue

                connected_map[platform] = False
        else:
            connected_map = {p: False for p in INTEGRATION_REGISTRY}
    else:
        connected_map = {p: False for p in INTEGRATION_REGISTRY}

    return {
        platform: {
            "connected": connected_map.get(platform, False),
            "available": availability.get(platform, True),
        }
        for platform in INTEGRATION_REGISTRY
    }


# ── OAuth2 flow ────────────────────────────────────────────────────────────────

@router.get("/{platform}/connect")
async def connect_platform(
    platform: str,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    For OAuth2 platforms: redirect to the platform's authorization URL.
    For API-key platforms: return the field config so the frontend can show the form.
    """
    from services.integration_registry import get_platform

    config = get_platform(platform)
    if not config:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform}")

    if config["auth_type"] == "oauth2":
        user = _get_user_by_email(email, db)
        client_id = os.getenv(config["client_id_env"], "")
        if not client_id:
            raise HTTPException(
                status_code=503,
                detail=f"{platform} OAuth not configured on this server (missing {config['client_id_env']})"
            )

        # state = email:platform:nonce  (colon-separated, base64-safe chars only)
        nonce = secrets.token_urlsafe(12)
        state = f"{email}:{platform}:{nonce}"

        scopes = config.get("scopes", [])
        params: Dict[str, Any] = {
            "client_id": client_id,
            "redirect_uri": f"{BACKEND_URL}/api/integrations/callback",
            "response_type": "code",
            "state": state,
        }
        if scopes:
            params["scope"] = " ".join(scopes)
        # Slack: add user_scope param separately (bot scopes go in scope, user scopes in user_scope)
        if config.get("user_scopes"):
            params["user_scope"] = " ".join(config["user_scopes"])
        # Platform-specific extra params (e.g. Discord bot permissions+scope override)
        extra = config.get("extra_params", {})
        params.update(extra)

        url = f"{config['oauth_authorize_url']}?{urlencode(params)}"
        return RedirectResponse(url)

    if config["auth_type"] == "trello_oauth":
        # Return help config for Trello (not immediate redirect)
        # This allows frontend to show instructions before OAuth flow
        return {
            "platform": "trello",
            "auth_type": "trello_oauth",
            "help_url": config.get("help_url", "https://trello.com/app-key"),
            "instructions": config.get("instructions", "Get your Trello API key and token from https://trello.com/app-key"),
            "message": "Trello requires your API Key. Visit the link below to generate it, then come back to authorize."
        }

    # API-key / bot-token - return field definitions for the frontend form
    return {
        "platform": platform,
        "auth_type": config["auth_type"],
        "fields": config.get("ui_fields", []),
        "instructions": config.get("instructions", ""),
        "ui_flow": config.get("ui_flow", []),
        "help_url": config.get("help_url", ""),
    }


@router.get("/authorize/{platform}")
async def authorize_platform(
    platform: str,
    user: User = Depends(get_current_user),
):
    """
    Trigger OAuth authorization for specific platforms.
    For Trello: redirects to Trello with OAuth parameters.
    For other platforms: redirects to /connect endpoint.
    """
    from services.integration_registry import get_platform

    config = get_platform(platform)
    if not config:
        raise HTTPException(status_code=400, detail=f"Platform {platform} not configured")

    email = user.email

    # Trello special handling
    if config["auth_type"] == "trello_oauth":
        api_key = os.getenv("TRELLO_API_KEY", "")
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="Trello not configured on this server (missing TRELLO_API_KEY)"
            )
        nonce = secrets.token_urlsafe(12)
        state = f"{email}:trello:{nonce}"
        callback_url = f"{BACKEND_URL}/api/integrations/callback?state={state}"
        params = {
            "key": api_key,
            "name": "AgentHub",
            "scope": "read,write",
            "expiration": "never",
            "response_type": "token",
            "callback_method": "fragment",
            "return_url": callback_url,
        }
        url = f"https://trello.com/1/authorize?{urlencode(params)}"
        return RedirectResponse(url)

    # For other platforms, just redirect to /connect
    return RedirectResponse(f"/api/integrations/{platform}/connect")


@router.get("/callback")
async def oauth_callback(
    request: Request,
    db: Session = Depends(get_db),
):
    """Universal OAuth2 callback - handles all platforms."""
    import httpx
    from services.integration_registry import get_platform
    from services.vault_service import vault

    code  = request.query_params.get("code")
    state = request.query_params.get("state", "")
    error = request.query_params.get("error")

    if error:
        # Parse platform from state so postMessage reaches the right listener
        _parts = state.split(":")
        _platform = _parts[1] if len(_parts) >= 2 else ""
        error_desc = request.query_params.get("error_description", "Authorization denied")
        return HTMLResponse(_oauth_result_html(False, error_desc, _platform))

    if not code or not state:
        return HTMLResponse(_oauth_result_html(False, "Missing code or state", ""))

    parts = state.split(":")
    if len(parts) < 2:
        return HTMLResponse(_oauth_result_html(False, "Invalid state", ""))

    email, platform = parts[0], parts[1]

    config = get_platform(platform)
    if not config or config["auth_type"] != "oauth2":
        return HTMLResponse(_oauth_result_html(False, f"Unknown platform: {platform}", ""))

    user = db.query(User).filter(User.email == email).first()
    if not user:
        return HTMLResponse(_oauth_result_html(False, "User not found", ""))

    client_id     = os.getenv(config["client_id_env"], "")
    client_secret = os.getenv(config["client_secret_env"], "")

    token_data_raw: dict = {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            headers = {"Accept": "application/json"}

            if config.get("token_exchange_auth") == "basic":
                # Notion and some others require Basic auth + JSON body (no creds in body)
                import base64
                credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
                headers["Authorization"] = f"Basic {credentials}"
                resp = await client.post(
                    config["oauth_token_url"],
                    json={
                        "code": code,
                        "redirect_uri": f"{BACKEND_URL}/api/integrations/callback",
                        "grant_type": "authorization_code",
                    },
                    headers=headers,
                )
            else:
                # Standard OAuth2: credentials in request body (GitHub, Slack)
                resp = await client.post(
                    config["oauth_token_url"],
                    data={
                        "code": code,
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "redirect_uri": f"{BACKEND_URL}/api/integrations/callback",
                        "grant_type": "authorization_code",
                    },
                    headers=headers,
                )
            if resp.status_code != 200:
                logger.error(f"oauth callback token exchange failed for {platform}: {resp.text}")
                return HTMLResponse(_oauth_result_html(False, f"Token exchange failed: {resp.status_code}", platform))

            content_type = resp.headers.get("content-type", "")
            if "json" in content_type:
                token_data_raw = resp.json()
            else:
                # form-encoded (GitHub)
                from urllib.parse import parse_qs
                parsed = parse_qs(resp.text)
                token_data_raw = {k: v[0] for k, v in parsed.items()}
    except Exception as e:
        logger.error(f"oauth callback error for {platform}: {e}")
        return HTMLResponse(_oauth_result_html(False, str(e), platform))

    # Fetch extra metadata (team name, user info, etc.)
    metadata = {}
    access_token = token_data_raw.get(config.get("token_path", "access_token"), "")
    test_url = config.get("test_endpoint")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if test_url:
                # Discord REST API requires "Bot {token}" auth — user OAuth tokens use "Bearer"
                auth_header = f"Bearer {access_token}"
                extra_test_headers = config.get("test_headers", {})
                me = await client.get(test_url, headers={"Authorization": auth_header, **extra_test_headers})
                if me.status_code == 200:
                    me_data = me.json()
                    team = me_data.get("team")
                    metadata = {
                        "user_id":    me_data.get("id") or me_data.get("sub") or me_data.get("account_id"),
                        "user_name":  me_data.get("name") or me_data.get("login") or me_data.get("display_name") or me_data.get("username"),
                        "user_email": me_data.get("email"),
                        "team_name":  team.get("name") if isinstance(team, dict) else (team if isinstance(team, str) else None),
                    }

            # ── Slack-specific: store team_id (needed for webhook event routing) ──────
            # and user token (needed for search:read which requires xoxp- user token)
            if platform == "slack":
                # auth.test response contains team_id at the root level — not in the me_data dict
                # Re-use the me call we already made (test_url == auth.test)
                if me.status_code == 200:
                    metadata["team_id"] = me_data.get("team_id")
                    metadata["team_name"] = me_data.get("team")  # string, not dict
                    metadata["bot_id"] = me_data.get("bot_id")
                    metadata["workspace_url"] = me_data.get("url")
                # Store user token (xoxp-) from authed_user for search operations
                authed_user = token_data_raw.get("authed_user", {})
                if authed_user.get("access_token"):
                    metadata["user_token"] = authed_user["access_token"]
                    metadata["user_id"] = authed_user.get("id", metadata.get("user_id"))

            # ── Discord-specific: store guild_id from the OAuth "guild" object ─────────
            # When bot scope is used, token_data_raw contains a "guild" object
            if platform == "discord":
                guild = token_data_raw.get("guild") or {}
                if guild.get("id"):
                    metadata["guild_id"] = guild["id"]
                    metadata["guild_name"] = guild.get("name")
                    logger.info(f"discord: authorized for guild {guild.get('name')} ({guild['id']}) by {email}")

            # Jira integration disabled - accessible-resources cloudId lookup removed
    except Exception as meta_err:
        logger.warning(f"oauth metadata fetch failed for {platform}: {meta_err}")

    vault.store_oauth(user.id, platform, token_data_raw, db, metadata=metadata)
    logger.info(f"oauth: connected {platform} for user {email}")

    return HTMLResponse(_oauth_result_html(True, "", platform))


@router.get("/trello/callback")
async def trello_fragment_callback(
    state: str = Query(""),
):
    """
    Trello redirects here after the user clicks Allow.
    The token arrives in the URL *fragment* (#token=...) which isn't sent to the server,
    so we serve a tiny HTML page that reads it client-side and POSTs it to /trello/save-token.
    """
    return HTMLResponse(f"""<!DOCTYPE html>
<html><head><title>Connecting Trello…</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <p id="msg">Connecting your Trello account…</p>
  <script>
    const hash = window.location.hash;
    const match = hash.match(/[#&]token=([^&]+)/);
    const token = match ? match[1] : null;
    if (!token) {{
      document.getElementById('msg').textContent = 'Error: no token received from Trello.';
      if (window.opener) {{
        window.opener.postMessage({{type:'integration_error', platform:'trello', error:'No token returned by Trello'}}, '*');
        setTimeout(() => window.close(), 2000);
      }}
    }} else {{
      fetch('{BACKEND_URL}/api/integrations/trello/save-token?state={{}}&token=' + encodeURIComponent(token), {{
        method: 'GET',
      }}).then(r => r.json()).then(() => {{
        if (window.opener) {{
          window.opener.postMessage({{type:'integration_connected', platform:'trello'}}, '*');
          window.close();
        }} else {{
          window.location.href = '{FRONTEND_URL}/settings?connected=trello';
        }}
      }}).catch(err => {{
        if (window.opener) {{
          window.opener.postMessage({{type:'integration_error', platform:'trello', error:err.toString()}}, '*');
          window.close();
        }}
      }});
    }}
  </script>
</body></html>""".replace("{}", state))


@router.get("/trello/save-token")
async def trello_save_token(
    state: str = Query(...),
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Called client-side from the Trello callback page to persist the user token."""
    from services.vault_service import vault

    parts = state.split(":")
    if len(parts) < 1:
        raise HTTPException(status_code=400, detail="Invalid state")

    email = parts[0]
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    api_key = os.getenv("TRELLO_API_KEY", "")
    # Store both the app's api_key and the user-specific token so tools can use them
    vault.store_api_key(user.id, "trello", {"api_key": api_key, "token": token}, db, auth_type="api_key")
    logger.info(f"trello: connected for user {email}")
    return {"success": True}


def _oauth_result_html(success: bool, error_msg: str, platform: str) -> str:
    if success:
        return f"""<html><body><script>
if (window.opener) {{
    window.opener.postMessage({{type:"integration_connected", platform:"{platform}"}}, "*");
    window.close();
}} else {{
    window.location.href = "{FRONTEND_URL}/settings?connected={platform}";
}}
</script><p>Connected! Closing…</p></body></html>"""
    return f"""<html><body><script>
if (window.opener) {{
    window.opener.postMessage({{type:"integration_error", platform:"{platform}", error:"{error_msg}"}}, "*");
    window.close();
}} else {{
    window.location.href = "{FRONTEND_URL}/settings?error={error_msg}";
}}
</script><p>Error: {error_msg}</p></body></html>"""


# ── API Key save ───────────────────────────────────────────────────────────────

class ApiKeyRequest(BaseModel):
    fields: Dict[str, str]


@router.post("/{platform}/api_key")
async def save_api_key(
    platform: str,
    body: ApiKeyRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Save an API key / bot token credential for a platform."""
    from services.integration_registry import get_platform
    from services.vault_service import vault

    config = get_platform(platform)
    if not config:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform}")

    if config["auth_type"] not in ("api_key", "bot_token"):
        raise HTTPException(status_code=400, detail="Use the OAuth connect flow for this platform")

    user = _get_user_by_email(email, db)

    vault.store_api_key(user.id, platform, body.fields, db, auth_type=config["auth_type"])

    # Auto-verify if a test endpoint exists
    verify_result = await vault.test_connection(user.id, platform, db)

    if not verify_result["ok"]:
        # Roll back - don't store an invalid credential
        vault.revoke(user.id, platform, db)
        raise HTTPException(status_code=400, detail=f"Credential verification failed: {verify_result['detail']}")

    # Special handling: register Telegram webhook after bot token is saved
    if platform == "telegram":
        try:
            from auth.models import User as UserModel
            from services.telegram_service import TelegramService
            bot_token = body.fields.get("bot_token", "")
            full_user = db.query(UserModel).filter(UserModel.email == email).first()
            if full_user and bot_token:
                await TelegramService.register_webhook(db, full_user, bot_token)
        except Exception as e:
            logger.warning(f"Telegram webhook registration failed: {e}")

    # If this is an LLM provider key, update user.llm_provider so the LLM router
    # looks up the vault under the correct provider name next time.
    # Without this, saving a Gemini key leaves llm_provider='openai' (the DB default)
    # and the vault lookup finds nothing, causing a silent fallback to company env keys.
    _LLM_PROVIDERS = {"openai", "anthropic", "gemini", "groq", "mistral", "deepseek", "local_llm", "ollama"}
    if platform in _LLM_PROVIDERS:
        from auth.models import User as _UserModel
        db_user = db.query(_UserModel).filter(_UserModel.email == email).first()
        if db_user and db_user.llm_provider != platform:
            db_user.llm_provider = platform
            db.commit()
            logger.info(f"Updated llm_provider={platform!r} for user {email}")

    return {"success": True, "platform": platform, "status": "connected"}


# ── Verify ─────────────────────────────────────────────────────────────────────

@router.post("/{platform}/verify")
async def verify_platform(
    platform: str,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Test that the stored credential for a platform is still valid."""
    from services.vault_service import vault

    user = _get_user_by_email(email, db)
    result = await vault.test_connection(user.id, platform, db)
    return result


# ── Revoke ─────────────────────────────────────────────────────────────────────

@router.delete("/{platform}")
async def revoke_platform(
    platform: str,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disconnect / revoke a platform credential."""
    from services.vault_service import vault

    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    ok = vault.revoke(current_user.id, platform, db)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No personal credential found for {platform}")

    return {"success": True, "platform": platform, "status": "disconnected"}


# ── Legacy: Telegram config (kept for backward compat) ────────────────────────

class TelegramLegacyConfig(BaseModel):
    bot_token: str
    chat_id: Optional[str] = None


@router.post("/telegram/config")
async def save_telegram_config_legacy(
    config: TelegramLegacyConfig,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy endpoint - delegates to the new API key flow."""
    from services.vault_service import vault
    from services.telegram_service import TelegramService

    vault.store_api_key(
        current_user.id, "telegram",
        {"bot_token": config.bot_token},
        db, auth_type="bot_token"
    )

    if config.chat_id:
        current_user.telegram_chat_id = config.chat_id
        db.commit()

    success = await TelegramService.register_webhook(db, current_user, config.bot_token)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to register Telegram webhook.")

    return {"status": "success", "message": "Telegram integration configured."}
