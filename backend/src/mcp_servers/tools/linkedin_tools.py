import os
import httpx
from loguru import logger
from mcp_servers.core.mcp_tools import mcp_tool

_LI_API = "https://api.linkedin.com"
_LI_TIMEOUT = httpx.Timeout(15.0)


def _resolve_linkedin_token(user_email: str, db) -> str | None:
    """Return a valid LinkedIn access token, auto-refreshing if within 5 min of expiry."""
    from services.vault_service import vault
    from auth.models import UserIntegration, User
    from datetime import datetime, timezone

    cred = vault.resolve_credential(user_email, "linkedin", db)
    if not cred:
        return None

    access_token = cred.get("access_token") or cred.get("token")
    if not access_token:
        return None

    # Look up the DB row to check token_expiry
    user = db.query(User).filter(User.email == user_email).first()
    if user:
        row = db.query(UserIntegration).filter(
            UserIntegration.user_id == user.id,
            UserIntegration.platform == "linkedin",
        ).first()
        if row and row.token_expiry:
            now = datetime.now(timezone.utc)
            # Refresh 5 minutes before expiry
            if (row.token_expiry.replace(tzinfo=timezone.utc) - now).total_seconds() < 300:
                refresh_token = cred.get("refresh_token", "")
                refreshed = _refresh_linkedin_token(refresh_token, user_email, db)
                if refreshed:
                    return refreshed

    return access_token


def _refresh_linkedin_token(refresh_token: str, user_email: str, db) -> str | None:
    """Exchange refresh_token for a new access_token and persist it."""
    if not refresh_token:
        return None
    client_id = os.getenv("LINKEDIN_CLIENT_ID", "")
    client_secret = os.getenv("LINKEDIN_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return None
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                "https://www.linkedin.com/oauth/v2/accessToken",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code == 200:
            data = resp.json()
            from services.vault_service import vault
            from auth.models import User
            user = db.query(User).filter(User.email == user_email).first()
            if user:
                vault.store_oauth(user.id, "linkedin", data, db)
                logger.info(f"linkedin: token refreshed for {user_email}")
                return data.get("access_token")
    except Exception as e:
        logger.warning(f"linkedin: token refresh failed for {user_email}: {e}")
    return None


def _get_person_urn(access_token: str) -> str | None:
    """Fetch the authenticated member's person URN from LinkedIn userinfo."""
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{_LI_API}/v2/userinfo",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "LinkedIn-Version": "202305",
                },
            )
            if resp.status_code == 200:
                return resp.json().get("sub")
            logger.warning(f"linkedin: userinfo returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"linkedin: failed to get person URN: {e}")
    return None


@mcp_tool(
    name="post_to_linkedin",
    description=(
        "Post a text update or share an article/URL to the user's LinkedIn feed. "
        "Use this when the user asks to post, share, or publish something on LinkedIn. "
        "For a plain text post leave article_url empty. "
        "For sharing a link provide article_url and optionally article_title and article_description."
    ),
    parameters={
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "The post text / commentary to publish on LinkedIn",
            },
            "article_url": {
                "type": "string",
                "description": "Optional URL to attach as an article share",
            },
            "article_title": {
                "type": "string",
                "description": "Optional title override for the shared article",
            },
            "article_description": {
                "type": "string",
                "description": "Optional short description for the shared article",
            },
            "visibility": {
                "type": "string",
                "enum": ["PUBLIC", "CONNECTIONS"],
                "description": "Who can see the post. Defaults to PUBLIC.",
            },
        },
        "required": ["text"],
    },
)
async def tool_post_to_linkedin(
    user_email: str,
    db,
    text: str,
    article_url: str = "",
    article_title: str = "",
    article_description: str = "",
    visibility: str = "PUBLIC",
) -> dict:
    token = _resolve_linkedin_token(user_email, db)
    if not token:
        return {"error": "LinkedIn is not connected. Go to Settings → Integrations and connect your LinkedIn account."}

    person_urn = _get_person_urn(token)
    if not person_urn:
        return {"error": "Could not retrieve your LinkedIn profile. Your token may have expired — please reconnect LinkedIn in Settings."}

    author = f"urn:li:person:{person_urn}"

    # LinkedIn REST Posts API (replaces deprecated ugcPosts, version 202305+)
    _LI_VERSION = "202305"
    _headers = {
        "Authorization": f"Bearer {token}",
        "LinkedIn-Version": _LI_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }

    payload: dict = {
        "author": author,
        "commentary": text,
        "visibility": visibility,
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    if article_url:
        payload["content"] = {
            "article": {
                "source": article_url,
                **({"title": article_title} if article_title else {}),
                **({"description": article_description} if article_description else {}),
            }
        }

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                "https://api.linkedin.com/rest/posts",
                json=payload,
                headers=_headers,
            )

        if resp.status_code == 201:
            post_urn = resp.headers.get("x-restli-id") or resp.headers.get("X-RestLi-Id", "")
            logger.info(f"linkedin: posted for {user_email}, urn={post_urn}")
            return {
                "success": True,
                "post_urn": post_urn,
                "message": f"Successfully posted to LinkedIn (visibility: {visibility}).",
                "post_url": f"https://www.linkedin.com/feed/update/{post_urn}" if post_urn else None,
            }

        logger.error(f"linkedin post failed for {user_email}: {resp.status_code} {resp.text}")
        return {"error": f"LinkedIn API returned {resp.status_code}: {resp.text}"}

    except Exception as e:
        logger.error(f"linkedin post exception for {user_email}: {e}")
        return {"error": f"Failed to post to LinkedIn: {str(e)}"}


@mcp_tool(
    name="get_linkedin_profile",
    description="Get the authenticated user's LinkedIn profile info (name, email, profile picture).",
    parameters={"type": "object", "properties": {}, "required": []},
)
async def tool_get_linkedin_profile(user_email: str, db) -> dict:
    token = _resolve_linkedin_token(user_email, db)
    if not token:
        return {"error": "LinkedIn is not connected. Go to Settings → Integrations to connect."}
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{_LI_API}/v2/userinfo",
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "name": data.get("name"),
                "given_name": data.get("given_name"),
                "family_name": data.get("family_name"),
                "email": data.get("email"),
                "picture": data.get("picture"),
                "locale": data.get("locale"),
            }
        return {"error": f"LinkedIn API returned {resp.status_code}"}
    except Exception as e:
        return {"error": f"Failed to fetch LinkedIn profile: {str(e)}"}


@mcp_tool(
    name="linkedin_comment_on_post",
    description="Add a comment on a LinkedIn post by its URN or URL.",
    parameters={
        "type": "object",
        "properties": {
            "post_urn": {
                "type": "string",
                "description": "The LinkedIn post URN (e.g. 'urn:li:ugcPost:7123456789') or the post URL",
            },
            "comment_text": {
                "type": "string",
                "description": "The comment text to post",
            },
        },
        "required": ["post_urn", "comment_text"],
    },
)
async def tool_linkedin_comment_on_post(user_email: str, db, post_urn: str, comment_text: str) -> dict:
    token = _resolve_linkedin_token(user_email, db)
    if not token:
        return {"error": "LinkedIn not connected. Go to Settings → Integrations."}
    person_urn = _get_person_urn(token)
    if not person_urn:
        return {"error": "Could not retrieve your LinkedIn profile. Token may have expired — reconnect LinkedIn."}

    # Normalise post URN: extract from URL if needed
    if post_urn.startswith("http"):
        import re
        match = re.search(r"(urn:li:[^/&?]+)", post_urn)
        if match:
            post_urn = match.group(1)

    _LI_VERSION = "202305"
    _headers = {
        "Authorization": f"Bearer {token}",
        "LinkedIn-Version": _LI_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }
    payload = {
        "actor": f"urn:li:person:{person_urn}",
        "message": {"text": comment_text},
        "object": post_urn,
    }
    try:
        with httpx.Client(timeout=_LI_TIMEOUT) as client:
            resp = client.post(
                f"{_LI_API}/rest/socialActions/{post_urn}/comments",
                json=payload,
                headers=_headers,
            )
        if resp.status_code in (200, 201):
            return {"success": True, "message": "Comment posted successfully."}
        return {"error": f"LinkedIn API returned {resp.status_code}: {resp.text[:300]}"}
    except Exception as e:
        return {"error": f"Failed to comment: {str(e)}"}


@mcp_tool(
    name="linkedin_like_post",
    description="Like a LinkedIn post by its URN.",
    parameters={
        "type": "object",
        "properties": {
            "post_urn": {
                "type": "string",
                "description": "The LinkedIn post URN (e.g. 'urn:li:ugcPost:7123456789')",
            },
        },
        "required": ["post_urn"],
    },
)
async def tool_linkedin_like_post(user_email: str, db, post_urn: str) -> dict:
    token = _resolve_linkedin_token(user_email, db)
    if not token:
        return {"error": "LinkedIn not connected."}
    person_urn = _get_person_urn(token)
    if not person_urn:
        return {"error": "Could not retrieve your LinkedIn profile."}
    _LI_VERSION = "202305"
    _headers = {
        "Authorization": f"Bearer {token}",
        "LinkedIn-Version": _LI_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }
    payload = {
        "actor": f"urn:li:person:{person_urn}",
        "object": post_urn,
    }
    try:
        with httpx.Client(timeout=_LI_TIMEOUT) as client:
            resp = client.post(
                f"{_LI_API}/rest/socialActions/{post_urn}/likes",
                json=payload,
                headers=_headers,
            )
        if resp.status_code in (200, 201):
            return {"success": True, "message": "Post liked successfully."}
        return {"error": f"LinkedIn API returned {resp.status_code}: {resp.text[:300]}"}
    except Exception as e:
        return {"error": f"Failed to like post: {str(e)}"}
