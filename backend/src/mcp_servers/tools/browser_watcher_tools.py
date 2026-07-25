"""
Browser Watcher Tools - Phase 3
Fetch webpage content, diff against snapshots, and register URLs for change monitoring.
State is stored in-process (same pattern as AUDIT_TRACKER) - no DB table required.
All tools are self-contained - no external credentials required.
"""

import asyncio
import difflib
import hashlib
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup
from loguru import logger

from mcp_servers.core.mcp_tools import mcp_tool

# ── In-process watch registry ─────────────────────────────────────────────────
# Structure: { watch_id: { url, user_email, label, last_content_hash,
#                          last_content_text, last_checked, history: [...] } }
_URL_WATCH_REGISTRY: Dict[str, Dict] = {}

_MAX_TEXT_CHARS = 8000


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _fetch_clean_text(url: str, timeout: int = 15) -> str:
    """Fetch a URL and return stripped plain text, truncated to _MAX_TEXT_CHARS."""
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (AgentHub Browser Watcher)"})
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "head", "noscript"]):
            tag.decompose()
        text = " ".join(soup.get_text(separator=" ").split())
        return text[:_MAX_TEXT_CHARS]


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp_tool(
    name="fetch_webpage_text",
    description=(
        "Fetch a webpage and return clean plain text (HTML tags stripped). "
        "Useful for reading articles, docs, and competitor pages. Max 8000 chars."
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "Full URL to fetch (must include https://)."},
            "timeout_seconds": {"type": "integer", "description": "Request timeout in seconds (default 15)."},
        },
        "required": ["url"],
    },
    provider="all",
    category="browser_watcher",
    approval_required=False,
    credentials_required=False,
)
async def tool_fetch_webpage_text(
    user_email: str, db, url: str, timeout_seconds: int = 15
) -> dict:
    try:
        text = await _fetch_clean_text(url, timeout=timeout_seconds)
        return {
            "url": url,
            "text": text,
            "char_count": len(text),
            "truncated": len(text) >= _MAX_TEXT_CHARS,
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"HTTP {e.response.status_code} for {url}"}
    except Exception as e:
        return {"error": f"Failed to fetch {url}: {e}"}


@mcp_tool(
    name="diff_webpage",
    description=(
        "Compare current webpage content against the last stored snapshot for a watch_id. "
        "Returns whether the page changed and a line-by-line diff."
    ),
    parameters={
        "type": "object",
        "properties": {
            "watch_id": {"type": "string", "description": "Watch ID returned by register_url_watch."},
        },
        "required": ["watch_id"],
    },
    provider="all",
    category="browser_watcher",
    approval_required=False,
    credentials_required=False,
)
async def tool_diff_webpage(user_email: str, db, watch_id: str) -> dict:
    entry = _URL_WATCH_REGISTRY.get(watch_id)
    if not entry:
        return {"error": f"Watch ID '{watch_id}' not found. Use register_url_watch first."}
    if entry.get("user_email") != user_email:
        return {"error": "Not authorized to access this watch."}

    try:
        new_text = await _fetch_clean_text(entry["url"])
    except Exception as e:
        return {"error": f"Failed to fetch {entry['url']}: {e}"}

    new_hash = _sha256(new_text)
    old_hash = entry.get("last_content_hash", "")
    changed = new_hash != old_hash
    checked_at = datetime.utcnow().isoformat()

    diff_lines = []
    if changed:
        old_text = entry.get("last_content_text", "")
        diff_lines = list(difflib.unified_diff(
            old_text.splitlines(),
            new_text.splitlines(),
            fromfile="previous",
            tofile="current",
            lineterm="",
        ))[:100]  # cap diff output

        # Update snapshot
        entry["last_content_hash"] = new_hash
        entry["last_content_text"] = new_text
        entry["last_checked"] = checked_at
        entry.setdefault("history", []).append({
            "timestamp": checked_at,
            "diff_summary": f"{len(diff_lines)} lines changed",
        })

    return {
        "watch_id": watch_id,
        "url": entry["url"],
        "changed": changed,
        "diff_lines": diff_lines,
        "new_hash": new_hash,
        "previous_hash": old_hash,
        "checked_at": checked_at,
    }


@mcp_tool(
    name="register_url_watch",
    description=(
        "Register a URL for content-change monitoring. "
        "Takes an initial snapshot. Use diff_webpage to check for changes later."
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "URL to watch."},
            "label": {"type": "string", "description": "Human-readable label, e.g. 'Competitor Pricing Page'."},
        },
        "required": ["url"],
    },
    provider="all",
    category="browser_watcher",
    approval_required=False,
    credentials_required=False,
)
async def tool_register_url_watch(
    user_email: str, db, url: str, label: str = ""
) -> dict:
    try:
        initial_text = await _fetch_clean_text(url)
    except Exception as e:
        return {"error": f"Failed to fetch initial snapshot of {url}: {e}"}

    watch_id = uuid.uuid4().hex[:12]
    registered_at = datetime.utcnow().isoformat()
    _URL_WATCH_REGISTRY[watch_id] = {
        "url": url,
        "user_email": user_email,
        "label": label or url,
        "last_content_hash": _sha256(initial_text),
        "last_content_text": initial_text,
        "last_checked": registered_at,
        "history": [],
        "registered_at": registered_at,
    }
    logger.info(f"URL watch registered: {watch_id} → {url} (user={user_email})")
    return {
        "watch_id": watch_id,
        "url": url,
        "label": label or url,
        "initial_hash": _sha256(initial_text),
        "registered_at": registered_at,
        "message": f"Watching '{url}'. Use diff_webpage with watch_id='{watch_id}' to check for changes.",
    }


@mcp_tool(
    name="list_watched_urls",
    description="List all URLs currently registered for content-change monitoring by this user.",
    parameters={"type": "object", "properties": {}, "required": []},
    provider="all",
    category="browser_watcher",
    approval_required=False,
    credentials_required=False,
)
async def tool_list_watched_urls(user_email: str, db) -> dict:
    watches = [
        {
            "watch_id": wid,
            "url": entry["url"],
            "label": entry.get("label", ""),
            "last_checked": entry.get("last_checked"),
            "registered_at": entry.get("registered_at"),
            "change_count": len(entry.get("history", [])),
        }
        for wid, entry in _URL_WATCH_REGISTRY.items()
        if entry.get("user_email") == user_email
    ]
    return {"watches": watches, "total": len(watches)}


@mcp_tool(
    name="remove_url_watch",
    description="Remove a URL from the watch registry.",
    parameters={
        "type": "object",
        "properties": {
            "watch_id": {"type": "string", "description": "Watch ID to remove."},
        },
        "required": ["watch_id"],
    },
    provider="all",
    category="browser_watcher",
    approval_required=False,
    credentials_required=False,
)
async def tool_remove_url_watch(user_email: str, db, watch_id: str) -> dict:
    entry = _URL_WATCH_REGISTRY.get(watch_id)
    if not entry:
        return {"error": f"Watch ID '{watch_id}' not found."}
    if entry.get("user_email") != user_email:
        return {"error": "Not authorized to remove this watch."}
    del _URL_WATCH_REGISTRY[watch_id]
    return {"removed": True, "watch_id": watch_id}


@mcp_tool(
    name="get_url_change_history",
    description="Retrieve the change history (timestamps and diff summaries) for a watched URL.",
    parameters={
        "type": "object",
        "properties": {
            "watch_id": {"type": "string", "description": "Watch ID from register_url_watch."},
            "limit": {"type": "integer", "description": "Max history entries to return (default 20)."},
        },
        "required": ["watch_id"],
    },
    provider="all",
    category="browser_watcher",
    approval_required=False,
    credentials_required=False,
)
async def tool_get_url_change_history(
    user_email: str, db, watch_id: str, limit: int = 20
) -> dict:
    entry = _URL_WATCH_REGISTRY.get(watch_id)
    if not entry:
        return {"error": f"Watch ID '{watch_id}' not found."}
    if entry.get("user_email") != user_email:
        return {"error": "Not authorized to view this watch."}
    history = entry.get("history", [])[-limit:]
    return {
        "watch_id": watch_id,
        "url": entry["url"],
        "label": entry.get("label", ""),
        "history": history,
        "total_changes": len(entry.get("history", [])),
    }
