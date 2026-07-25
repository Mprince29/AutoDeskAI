import os
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import httpx
from loguru import logger

router = APIRouter()

_DISCORD_API = "https://discord.com/api/v10"
_TIMEOUT = httpx.Timeout(10.0)

# ── Token resolution ──────────────────────────────────────────────────────────
# Discord REST API requires a BOT token for channel messaging — user OAuth tokens cannot.
# The server-side DISCORD_BOT_TOKEN env var is the app's own bot (shared across users).

def _get_bot_token(user_email: str = "", db=None) -> str:
    """Return the server-side Discord bot token from the environment.

    Discord messaging requires a real Bot token (xoxb-style from the Developer Portal).
    The per-user OAuth flow stores a USER access token (Bearer), not a bot token — it
    cannot be used with 'Bot {token}' auth and will get 401 from every channel endpoint.
    Only DISCORD_BOT_TOKEN (set in .env from the Discord Developer Portal) is valid here.
    """
    return os.getenv("DISCORD_BOT_TOKEN", "")


def _get_user_guild_id(user_email: str, db) -> str:
    """Return the guild_id stored when the user authorized the Discord OAuth flow."""
    from services.vault_service import vault
    cred = vault.resolve_credential(user_email, "discord", db)
    if cred:
        return cred.get("guild_id") or cred.get("metadata", {}).get("guild_id") or ""
    return ""


# ── Channel name resolver ─────────────────────────────────────────────────────

async def resolve_discord_channel_id(channel_name_or_id: str, bot_token: str, guild_id: str = "") -> str:
    """Convert a channel name like 'general' or '#general' to a Snowflake ID.
    Uses the server-side bot token to list channels in the user's authorized guild."""
    if not channel_name_or_id:
        return channel_name_or_id

    clean = channel_name_or_id.strip().lstrip('#')

    # Already looks like a Snowflake ID (numeric, 17-20 digits)
    if clean.isdigit() and 17 <= len(clean) <= 20:
        return clean

    # Resolve guild_id: user metadata first, then env var fallback
    resolved_guild = guild_id or os.getenv("DISCORD_GUILD_ID", "")
    if not resolved_guild or not bot_token:
        return clean

    headers = {"Authorization": f"Bot {bot_token}", "Content-Type": "application/json"}
    url = f"{_DISCORD_API}/guilds/{resolved_guild}/channels"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code == 200:
            channels = resp.json()
            for ch in channels:
                if ch.get("name", "").lower() == clean.lower():
                    logger.info(f"[discord] Resolved '{clean}' → {ch['id']} in guild {resolved_guild}")
                    return ch["id"]
            logger.warning(f"[discord] Channel '{clean}' not found in guild {resolved_guild}. Available: {[c.get('name') for c in channels]}")
        else:
            logger.warning(f"[discord] Guild channels lookup failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"[discord] resolve_discord_channel_id error: {e}")

    return clean

# ── Request Schemas ──────────────────────────────────────────────────────────

class DiscordMessageRequest(BaseModel):
    channel_id: str
    content: str
    email: Optional[str] = None

class DiscordHistoryRequest(BaseModel):
    channel_id: str
    limit: int = 10
    email: Optional[str] = None

# ── Endpoints / Tool Handlers ─────────────────────────────────────────────────

@router.post("/send_discord_message")
async def send_discord_message(req: DiscordMessageRequest, db=None) -> dict:
    bot_token = _get_bot_token(req.email or "", db)
    if not bot_token:
        raise HTTPException(status_code=401, detail="Discord bot not configured. Set DISCORD_BOT_TOKEN in your .env file (get it from the Discord Developer Portal → Your App → Bot → Token).")
    guild_id = _get_user_guild_id(req.email or "", db) if req.email and db else ""
    channel_id = await resolve_discord_channel_id(req.channel_id, bot_token, guild_id)
    url = f"{_DISCORD_API}/channels/{channel_id}/messages"
    headers = {"Authorization": f"Bot {bot_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, json={"content": req.content})
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=f"Discord API error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return {"id": data.get("id", ""), "channel_id": data.get("channel_id", channel_id), "content": data.get("content", req.content)}


@router.get("/get_discord_history")
async def get_discord_history(
    channel_id: str = Query(..., description="Snowflake ID or name of the Discord channel"),
    limit: int = Query(10, ge=1, le=100, description="Number of messages to fetch"),
    email: Optional[str] = Query(None),
    db=None,
) -> dict:
    bot_token = _get_bot_token(email or "", db)
    if not bot_token:
        raise HTTPException(status_code=401, detail="Discord bot not configured.")
    guild_id = _get_user_guild_id(email or "", db) if email and db else ""
    resolved_id = await resolve_discord_channel_id(channel_id, bot_token, guild_id)
    url = f"{_DISCORD_API}/channels/{resolved_id}/messages?limit={min(limit, 100)}"
    headers = {"Authorization": f"Bot {bot_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Discord API error {resp.status_code}: {resp.text[:300]}")
    return {"messages": resp.json()}


# ── MCP Tool registrations ────────────────────────────────────────────────────

from mcp_servers.core.mcp_tools import mcp_tool


@mcp_tool(
    name="send_discord_message",
    description=(
        "Send a message to a Discord channel. "
        "Accepts channel name (e.g. 'general') or Snowflake ID. "
        "The bot must be in the server first (done via Settings → Connected Platforms → Discord)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "channel_id": {"type": "string", "description": "Discord channel name (e.g. 'general') or Snowflake ID"},
            "content":    {"type": "string", "description": "Message text to send (max 2000 chars)"},
        },
        "required": ["channel_id", "content"],
    },
    provider="all",
    category="messaging",
)
async def tool_send_discord_message(user_email: str, db, channel_id: str, content: str) -> dict:
    bot_token = _get_bot_token(user_email, db)
    if not bot_token:
        return {"error": "Discord not configured. Set DISCORD_BOT_TOKEN in your .env file (Discord Developer Portal → Your App → Bot → Token). Connecting Discord in Settings only authorizes which server the bot joins."}
    guild_id = _get_user_guild_id(user_email, db)
    resolved_id = await resolve_discord_channel_id(channel_id, bot_token, guild_id)
    url = f"{_DISCORD_API}/channels/{resolved_id}/messages"
    headers = {"Authorization": f"Bot {bot_token}", "Content-Type": "application/json"}
    # Discord message limit is 2000 chars
    payload = {"content": content[:2000]}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, json=payload)
    if resp.status_code not in (200, 201):
        error_json = {}
        try:
            error_json = resp.json()
        except Exception:
            pass
        return {"error": f"Discord API error {resp.status_code}: {error_json.get('message', resp.text[:200])}"}
    data = resp.json()
    return {"id": data.get("id", ""), "channel_id": data.get("channel_id", resolved_id), "content": content}


@mcp_tool(
    name="get_discord_history",
    description="Fetch recent messages from a Discord channel.",
    parameters={
        "type": "object",
        "properties": {
            "channel_id": {"type": "string", "description": "Discord channel name or Snowflake ID"},
            "limit":      {"type": "integer", "description": "Number of messages (1-50, default 10)", "default": 10},
        },
        "required": ["channel_id"],
    },
    provider="all",
    category="messaging",
)
async def tool_get_discord_history(user_email: str, db, channel_id: str, limit: int = 10) -> dict:
    bot_token = _get_bot_token(user_email, db)
    if not bot_token:
        return {"error": "Discord not configured. Set DISCORD_BOT_TOKEN in your .env file."}
    guild_id = _get_user_guild_id(user_email, db)
    resolved_id = await resolve_discord_channel_id(channel_id, bot_token, guild_id)
    clamped = max(1, min(limit, 50))
    url = f"{_DISCORD_API}/channels/{resolved_id}/messages?limit={clamped}"
    headers = {"Authorization": f"Bot {bot_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        return {"error": f"Discord API error {resp.status_code}: {resp.text[:200]}"}
    messages = resp.json()
    return {
        "messages": [
            {
                "id": m.get("id"),
                "author": m.get("author", {}).get("username"),
                "content": m.get("content"),
                "timestamp": m.get("timestamp"),
            }
            for m in messages
        ]
    }


@mcp_tool(
    name="list_discord_servers",
    description="List all Discord servers (guilds) the bot is in. Useful for finding server names and IDs.",
    parameters={"type": "object", "properties": {}, "required": []},
    provider="all",
    category="messaging",
)
async def tool_list_discord_servers(user_email: str, db) -> dict:
    bot_token = _get_bot_token(user_email, db)
    if not bot_token:
        return {"error": "Discord not configured. Set DISCORD_BOT_TOKEN in your .env file."}
    url = f"{_DISCORD_API}/users/@me/guilds"
    headers = {"Authorization": f"Bot {bot_token}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        return {"error": f"Discord API error {resp.status_code}: {resp.text[:200]}"}
    guilds = resp.json()
    return {"servers": [{"id": g.get("id"), "name": g.get("name")} for g in guilds]}


@mcp_tool(
    name="list_discord_channels",
    description="List all channels in a Discord server. Provide server_id or leave blank to use the user's connected server.",
    parameters={
        "type": "object",
        "properties": {
            "server_id": {"type": "string", "description": "Discord Server (Guild) Snowflake ID (optional — uses connected server if omitted)"},
        },
    },
    provider="all",
    category="messaging",
)
async def tool_list_discord_channels(user_email: str, db, server_id: str = "") -> dict:
    bot_token = _get_bot_token(user_email, db)
    if not bot_token:
        return {"error": "Discord not configured. Set DISCORD_BOT_TOKEN in your .env file."}
    guild_id = server_id or _get_user_guild_id(user_email, db) or os.getenv("DISCORD_GUILD_ID", "")
    if not guild_id:
        return {"error": "No server ID provided and no connected server found. Use list_discord_servers first."}
    url = f"{_DISCORD_API}/guilds/{guild_id}/channels"
    headers = {"Authorization": f"Bot {bot_token}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        return {"error": f"Discord API error {resp.status_code}: {resp.text[:200]}"}
    channels = resp.json()
    # Channel types: 0=text, 2=voice, 4=category, 5=announcement, 15=forum
    text_channels = [c for c in channels if c.get("type") in (0, 5, 15)]
    return {
        "channels": [{"id": c.get("id"), "name": c.get("name"), "type": c.get("type")} for c in text_channels]
    }
