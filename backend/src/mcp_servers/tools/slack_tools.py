import os
import re
import asyncio
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from loguru import logger

router = APIRouter()

# ── Simple in-process channel ID cache ───────────────────────────────────────
# Keyed by (token, channel_name) → (channel_id, expires_at)
# Avoids a conversations_list API call on every tool invocation.
_CHANNEL_CACHE: Dict[tuple, tuple] = {}
_CHANNEL_CACHE_TTL = 300  # 5 minutes

# ── Request Schemas ──────────────────────────────────────────────────────────

class SlackMessageRequest(BaseModel):
    channel: str
    text: str
    email: Optional[str] = None
    thread_ts: Optional[str] = None

class SlackHistoryRequest(BaseModel):
    channel: str
    limit: int = 10
    email: Optional[str] = None

class SlackReactionRequest(BaseModel):
    channel: str
    timestamp: str
    reaction: str
    email: Optional[str] = None

async def resolve_channel_id(channel_name_or_id: str, token: str = "") -> str:
    """Convert a name like '#general' or 'general' into a Slack ID (e.g. 'C12345').
    Results are cached for 5 minutes to avoid repeated API calls."""
    if not channel_name_or_id:
        return ""

    clean = channel_name_or_id.strip()
    mention_match = re.fullmatch(r"<@([UW][A-Z0-9]+)>", clean)
    if mention_match:
        clean = mention_match.group(1)
    clean = clean.lstrip('#')

    # Already looks like a Slack ID (C/D/G/W prefix, ≥9 chars)
    if channel_name_or_id[0] in ('C', 'D', 'G', 'W') and len(channel_name_or_id) >= 9:
        return channel_name_or_id

    if not token:
        return channel_name_or_id

    cache_key = (token[:20], clean)  # use token prefix as cache key (avoid storing full token)
    cached = _CHANNEL_CACHE.get(cache_key)
    if cached and cached[1] > time.time():
        return cached[0]

    def _resolve_with_slack():
        client = WebClient(token=token)

        # DMs (im channels) do not have a stable "name" in conversations.list.
        # Resolve user IDs, @mentions, or emails by opening/finding the IM channel.
        dm_user_id = None
        if re.fullmatch(r"[UW][A-Z0-9]{8,}", clean):
            dm_user_id = clean
        elif "@" in clean and not clean.startswith("@"):
            user_resp = client.users_lookupByEmail(email=clean)
            dm_user_id = user_resp["user"]["id"]

        if dm_user_id:
            dm_resp = client.conversations_open(users=dm_user_id)
            return dm_resp["channel"]["id"]

        # Fetch all channel types in one call; limit=1000 reduces pagination needs
        resp = client.conversations_list(
            types="public_channel,private_channel,mpim,im", limit=1000
        )
        for ch in resp.get("channels", []):
            if ch.get("name") == clean:
                return ch["id"]
        return None

    try:
        channel_id = await asyncio.to_thread(_resolve_with_slack)
        if channel_id:
            _CHANNEL_CACHE[cache_key] = (channel_id, time.time() + _CHANNEL_CACHE_TTL)
            return channel_id
    except Exception as e:
        logger.warning(f"Failed to resolve Slack channel name '{channel_name_or_id}': {e}")

    return channel_name_or_id

# ── Endpoints / Tool Handlers ─────────────────────────────────────────────────

@router.post("/send_slack_message")
async def send_slack_message(req: SlackMessageRequest, db=None) -> dict:
    token = _resolve_slack_token_for_request(req.email, db)
    if not token:
        raise HTTPException(status_code=401, detail="Slack not connected. Add your Slack token in Settings.")
    channel_id = await resolve_channel_id(req.channel, token=token)
    def _send():
        client = WebClient(token=token)
        response = client.chat_postMessage(
            channel=channel_id, 
            text=req.text, 
            thread_ts=req.thread_ts
        )
        return {"channel": response["channel"], "ts": response["ts"], "message": response["message"]["text"]}
    try:
        return await asyncio.to_thread(_send)
    except SlackApiError as e:
        raise HTTPException(status_code=400, detail=f"Slack API Error: {e.response.get('error', str(e))}")

@router.post("/get_slack_history")
async def get_slack_history(req: SlackHistoryRequest, db=None) -> dict:
    token = _resolve_slack_token_for_request(req.email, db)
    if not token:
        raise HTTPException(status_code=401, detail="Slack not connected.")
    channel_id = await resolve_channel_id(req.channel, token=token)
    def _history():
        client = WebClient(token=token)
        response = client.conversations_history(channel=channel_id, limit=req.limit)
        return {"messages": response["messages"]}
    try:
        return await asyncio.to_thread(_history)
    except SlackApiError as e:
        raise HTTPException(status_code=400, detail=f"Slack API Error: {e.response.get('error', str(e))}")

@router.post("/add_slack_reaction")
async def add_slack_reaction(req: SlackReactionRequest, db=None) -> dict:
    token = _resolve_slack_token_for_request(req.email, db)
    if not token:
        raise HTTPException(status_code=401, detail="Slack not connected.")
    channel_id = await resolve_channel_id(req.channel, token=token)
    def _react():
        client = WebClient(token=token)
        response = client.reactions_add(channel=channel_id, name=req.reaction, timestamp=req.timestamp)
        return {"success": True}
    try:
        return await asyncio.to_thread(_react)
    except SlackApiError as e:
        raise HTTPException(status_code=400, detail=f"Slack API Error: {e.response.get('error', str(e))}")
# ── Vault-aware credential resolution ────────────────────────────────────────

def _resolve_slack_token(user_email: str, db) -> str:
    """Return the bot token (xoxb-) for sending messages."""
    from services.vault_service import vault
    cred = vault.resolve_credential(user_email, "slack", db)
    return (cred.get("access_token") or cred.get("bot_token") or "") if cred else ""


def _resolve_slack_user_token(user_email: str, db) -> str:
    """Return the user token (xoxp-) stored from authed_user during OAuth — needed for search:read."""
    from services.vault_service import vault
    cred = vault.resolve_credential(user_email, "slack", db)
    if not cred:
        return ""
    # user_token stored in metadata during OAuth callback
    meta = cred.get("metadata", {}) or {}
    return meta.get("user_token") or ""


def _resolve_slack_token_for_request(email: Optional[str], db) -> str:
    if not email or not db:
        return ""
    return _resolve_slack_token(email, db)


# ── MCP Tool registrations ────────────────────────────────────────────────────

from mcp_servers.core.mcp_tools import mcp_tool


@mcp_tool(
    name="send_slack_message",
    description="Send a message to a Slack channel or DM. Provide channel name (e.g. 'general') or Slack channel ID.",
    parameters={
        "type": "object",
        "properties": {
            "channel": {"type": "string", "description": "Channel name (e.g. 'general') or Slack channel ID"},
            "text":    {"type": "string", "description": "Message text to send"},
            "thread_ts": {"type": "string", "description": "Optional thread timestamp to reply in a specific thread"},
        },
        "required": ["channel", "text"],
    },
    provider="all",
    category="messaging",
)
async def tool_send_slack_message(user_email: str, db, channel: str, text: str, thread_ts: str = None) -> dict:
    token = _resolve_slack_token(user_email, db)
    if not token:
        return {"error": "Slack not connected. Go to Settings → Connected Platforms to add your Slack workspace."}
    channel_id = await resolve_channel_id(channel, token=token)
    def _send():
        client = WebClient(token=token)
        resp = client.chat_postMessage(channel=channel_id, text=text, thread_ts=thread_ts)
        return {"channel": resp["channel"], "ts": resp["ts"], "text": resp["message"]["text"]}
    try:
        return await asyncio.to_thread(_send)
    except SlackApiError as e:
        return {"error": f"Slack error: {e.response.get('error', str(e))}"}


@mcp_tool(
    name="get_slack_history",
    description="Fetch recent messages from a Slack channel.",
    parameters={
        "type": "object",
        "properties": {
            "channel": {"type": "string", "description": "Channel name or Slack channel ID"},
            "limit":   {"type": "integer", "description": "Number of messages to fetch (default 10)", "default": 10},
        },
        "required": ["channel"],
    },
    provider="all",
    category="messaging",
)
async def tool_get_slack_history(user_email: str, db, channel: str, limit: int = 10) -> dict:
    token = _resolve_slack_token(user_email, db)
    if not token:
        return {"error": "Slack not connected."}
    channel_id = await resolve_channel_id(channel, token=token)
    def _history():
        client = WebClient(token=token)
        resp = client.conversations_history(channel=channel_id, limit=min(limit, 50))
        return {"messages": resp["messages"]}
    try:
        return await asyncio.to_thread(_history)
    except SlackApiError as e:
        return {"error": f"Slack error: {e.response.get('error', str(e))}"}


@mcp_tool(
    name="slack_invite_to_workspace",
    description=(
        "Invite a person to your Slack workspace by email address. "
        "Optionally add them to specific channels after they join. "
        "Requires a Slack user token with admin scope (not a bot token)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "invitee_email": {
                "type": "string",
                "description": "Email address of the person to invite to Slack",
            },
            "channels": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of channel names to add the person to (e.g. ['general', 'eng-team'])",
            },
            "welcome_message": {
                "type": "string",
                "description": "Optional welcome message to post in #general after the invite is sent",
            },
        },
        "required": ["invitee_email"],
    },
    provider="all",
    category="messaging",
    approval_required=True,
)
async def tool_slack_invite_to_workspace(
    user_email: str,
    db,
    invitee_email: str,
    channels: list = None,
    welcome_message: str = None,
) -> dict:
    token = _resolve_slack_token(user_email, db)
    if not token:
        return {"error": "Slack not connected. Go to Settings → Connected Platforms."}

    results: dict = {}

    def _invite():
        client = WebClient(token=token)
        # admin.users.invite requires a Slack Enterprise Grid plan.
        # For standard workspaces use the legacy users.admin.invite (undocumented but works).
        # We attempt the standard invite API; if it fails (non-admin token) we fall back
        # to sending a channel invite link via a DM.
        try:
            resp = client.admin_users_invite(
                team_id=_get_team_id(client),
                email=invitee_email,
                channel_ids=_resolve_channel_ids(client, channels or []),
            )
            return {"method": "admin_users_invite", "ok": resp.get("ok", False)}
        except SlackApiError as admin_err:
            # Fallback: post an invite-link message to the requester via DM
            error_code = admin_err.response.get("error", "")
            if error_code in ("not_allowed", "ratelimited", "missing_scope"):
                # Post a DM to the requester with the workspace invite link
                me_resp = client.auth_test()
                workspace_url = me_resp.get("url", "your Slack workspace")
                dm = client.conversations_open(users=me_resp["user_id"])
                dm_channel = dm["channel"]["id"]
                client.chat_postMessage(
                    channel=dm_channel,
                    text=(
                        f"⚠️ I don't have admin permissions to invite *{invitee_email}* directly.\n"
                        f"Please forward this invite link manually: {workspace_url}\n"
                        f"Or grant your Slack bot the `admin.users:write` scope."
                    ),
                )
                return {
                    "method": "dm_fallback",
                    "ok": False,
                    "note": f"Admin invite not available ({error_code}). DM sent to you with workspace URL.",
                    "workspace_url": workspace_url,
                }
            raise

    def _get_team_id(client: WebClient) -> str:
        resp = client.auth_test()
        return resp["team_id"]

    def _resolve_channel_ids(client: WebClient, channel_names: list) -> list:
        if not channel_names:
            return []
        resp = client.conversations_list(types="public_channel,private_channel", limit=200)
        name_to_id = {c["name"]: c["id"] for c in resp.get("channels", [])}
        return [name_to_id.get(n.lstrip("#"), n) for n in channel_names]

    def _add_to_channels(channel_names: list, member_email: str):
        """Invite an existing Slack member to additional channels by email→user lookup.

        NOTE: runs inside asyncio.to_thread - must be fully synchronous.
        Channel name→ID is resolved via a direct SDK call, not the async helper.
        """
        client = WebClient(token=token)
        # Look up the user by email
        try:
            user_resp = client.users_lookupByEmail(email=member_email)
            slack_user_id = user_resp["user"]["id"]
        except SlackApiError:
            return {"channel_join": "user_not_found_yet"}

        # Build a channel name→ID map synchronously (no async here)
        def _resolve_sync(name: str) -> str:
            clean = name.strip().lstrip("#")
            if name.startswith(("C", "D", "G")) and len(name) >= 9:
                return name  # already an ID
            try:
                resp = client.conversations_list(types="public_channel,private_channel", limit=200)
                for ch in resp.get("channels", []):
                    if ch["name"] == clean:
                        return ch["id"]
            except SlackApiError:
                pass
            return name  # fallback to original

        channel_results = {}
        for ch in channel_names:
            ch_id = _resolve_sync(ch)
            try:
                client.conversations_invite(channel=ch_id, users=slack_user_id)
                channel_results[ch] = "invited"
            except SlackApiError as e:
                channel_results[ch] = e.response.get("error", str(e))
        return channel_results

    try:
        invite_result = await asyncio.to_thread(_invite)
        results["invite"] = invite_result

        # If invite succeeded and channels specified, add them to each channel
        if invite_result.get("ok") and channels:
            ch_results = await asyncio.to_thread(_add_to_channels, channels, invitee_email)
            results["channels"] = ch_results

        # Post a welcome message to #general (resolved to ID) if requested
        if welcome_message:
            general_id = await resolve_channel_id("general", token=token)
            def _post_welcome():
                client = WebClient(token=token)
                client.chat_postMessage(channel=general_id, text=welcome_message)
            try:
                await asyncio.to_thread(_post_welcome)
                results["welcome_message"] = "posted"
            except Exception as e:
                err = e.response.get("error", str(e)) if hasattr(e, "response") else str(e)
                results["welcome_message"] = f"failed: {err}"

        results["invitee_email"] = invitee_email
        return results

    except SlackApiError as e:
        return {"error": f"Slack error: {e.response.get('error', str(e))}"}


@mcp_tool(
    name="slack_search_messages",
    description="Search for messages across all Slack channels the bot has access to.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The search query (e.g. 'project blue')"},
            "count": {"type": "integer", "description": "Number of results to return (default 5)", "default": 5},
        },
        "required": ["query"],
    },
    provider="all",
    category="messaging",
)
async def tool_slack_search_messages(user_email: str, db, query: str, count: int = 5) -> dict:
    # search.messages requires a USER token (xoxp-) with search:read scope — not a bot token.
    # We stored the user token (authed_user.access_token) in metadata during OAuth.
    user_token = _resolve_slack_user_token(user_email, db)
    if not user_token:
        bot_token = _resolve_slack_token(user_email, db)
        if not bot_token:
            return {"error": "Slack not connected."}
        return {
            "error": (
                "Slack search requires a user token with search:read scope. "
                "Please reconnect Slack in Settings → Connected Platforms to grant search access."
            )
        }
    def _search():
        client = WebClient(token=user_token)
        resp = client.search_messages(query=query, count=min(count, 20))
        matches = resp.get("messages", {}).get("matches", [])
        return {
            "matches": [
                {
                    "text": m.get("text", ""),
                    "channel": m.get("channel", {}).get("name", ""),
                    "username": m.get("username", ""),
                    "ts": m.get("ts", ""),
                    "permalink": m.get("permalink", ""),
                }
                for m in matches
            ]
        }
    try:
        return await asyncio.to_thread(_search)
    except SlackApiError as e:
        error_code = e.response.get("error", str(e))
        if error_code == "missing_scope":
            return {"error": "Missing search:read scope. Reconnect Slack in Settings to grant search access."}
        return {"error": f"Slack error: {error_code}"}


@mcp_tool(
    name="slack_list_channels",
    description="List all public channels in the Slack workspace.",
    parameters={
        "type": "object",
        "properties": {
            "types": {"type": "string", "description": "Comma-separated list of channel types (default 'public_channel')", "default": "public_channel"},
            "limit": {"type": "integer", "description": "Max channels to return (default 100)", "default": 100},
        },
    },
    provider="all",
    category="messaging",
)
async def tool_slack_list_channels(user_email: str, db, types: str = "public_channel", limit: int = 100) -> dict:
    token = _resolve_slack_token(user_email, db)
    if not token:
        return {"error": "Slack not connected."}
    def _list():
        client = WebClient(token=token)
        resp = client.conversations_list(types=types, limit=limit)
        return {"channels": [{"id": c["id"], "name": c["name"]} for c in resp.get("channels", [])]}
    try:
        return await asyncio.to_thread(_list)
    except SlackApiError as e:
        return {"error": f"Slack error: {e.response.get('error', str(e))}"}


@mcp_tool(
    name="slack_upload_file",
    description="Upload a local file or some text content as a snippet to a Slack channel.",
    parameters={
        "type": "object",
        "properties": {
            "channel": {"type": "string", "description": "Channel name or ID to upload to"},
            "content": {"type": "string", "description": "Plain text content to upload as a snippet"},
            "title":   {"type": "string", "description": "Title for the file"},
            "initial_comment": {"type": "string", "description": "Initial comment to post with the file"},
            "thread_ts": {"type": "string", "description": "Optional thread timestamp to upload into"},
        },
        "required": ["channel", "content"],
    },
    provider="all",
    category="messaging",
)
async def tool_slack_upload_file(
    user_email: str, 
    db, 
    channel: str, 
    content: str, 
    title: str = "Agent Result", 
    initial_comment: str = None,
    thread_ts: str = None
) -> dict:
    token = _resolve_slack_token(user_email, db)
    if not token:
        return {"error": "Slack not connected."}
    channel_id = await resolve_channel_id(channel, token=token)
    def _upload():
        client = WebClient(token=token)
        # Using files_upload_v2 as recommended by Slack
        resp = client.files_upload_v2(
            channel=channel_id,
            content=content,
            title=title,
            initial_comment=initial_comment,
            thread_ts=thread_ts
        )
        return {"file_id": resp["file"]["id"], "url": resp["file"]["permalink"]}
    try:
        return await asyncio.to_thread(_upload)
    except SlackApiError as e:
        return {"error": f"Slack error: {e.response.get('error', str(e))}"}
