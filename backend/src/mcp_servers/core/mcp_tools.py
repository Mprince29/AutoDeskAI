import json
import asyncio
import time as _time
from typing import Dict, Any, List, Callable, Optional
from loguru import logger
from services.security import GLOBAL_SIGNER

# ── Phase 10: Sensitive Tools Gating ────────────────────────────────────────
# Tools in this list REQUIRE an HMAC signature to execute.
# This ensures the 'Draft-Only' boundary is enforced at the cryptographic level.
SENSITIVE_TOOLS = [
    "send_email",
    "delete_email",
    "delete_event",
    "delete_draft",
    "send_draft",
    # Phase 4: System Mechanic tools - every call requires explicit HMAC approval
    "run_shell_command",
    "read_system_log",
    "list_directory",
    "read_file_raw",
    "write_file_raw",
    "get_disk_usage",
    "find_files",
    # Phase Command Center Tools
    "github_create_issue",
    # "jira_create_ticket",  -- Jira integration disabled
    # "jira_add_comment",    -- Jira integration disabled
    "trello_create_card",
    "trello_move_card",
    # External broadcast - can spam real channels without confirmation
    "slack_send_message",
    "slack_add_reaction",
    "discord_send_message",
    "telegram_send_message",
]

# ── Registry ────────────────────────────────────────────────────────────────
_TOOL_REGISTRY: Dict[str, Dict] = {}
# Structure: {"tool_name": {"provider": "google|microsoft|all", "handler": async_fn,
#              "description": str, "parameters": dict, "category": str,
#              "approval_required": bool, "credentials_required": bool}}


def mcp_tool(
    name: str,
    description: str,
    parameters: dict,
    provider: str = "google",
    category: str = "general",
    approval_required: bool = False,
    credentials_required: bool = False,
):
    """Decorator that registers an async function as an MCP tool.

    The decorated function MUST be async and accept (user_email, db) as the
    first two keyword arguments, followed by the tool-specific parameters.

    Args:
        provider: Token/env requirement - "google", "microsoft", or "all".
        category: Logical grouping for agent builder UI (e.g. "gmail", "data_science").
        approval_required: If True, tool is in SENSITIVE_TOOLS and needs HMAC gate.
        credentials_required: If True, tool needs external credentials beyond Google OAuth.
    """
    def decorator(fn: Callable) -> Callable:
        _TOOL_REGISTRY[name] = {
            "handler": fn,
            "description": description,
            "parameters": parameters,
            "provider": provider,
            "category": category,
            "approval_required": approval_required,
            "credentials_required": credentials_required,
        }
        return fn
    return decorator


async def _log_tool_call(
    tool_name: str,
    user_email: str,
    tool_input: dict,
    result: dict,
    was_blocked: bool,
    duration_ms: float,
) -> None:
    """Background task: write one AgentToolCallLog row. Never raises."""
    try:
        from auth.database import SessionLocal
        from models import AgentToolCallLog

        input_summary = json.dumps(tool_input, default=str)[:500]
        result_summary = json.dumps(result, default=str)[:500]
        error_msg = result.get("error") if isinstance(result, dict) else None

        db = SessionLocal()
        try:
            entry = AgentToolCallLog(
                user_email=user_email,
                tool_name=tool_name,
                input_summary=input_summary,
                result_summary=result_summary,
                was_blocked=was_blocked,
                error_message=error_msg,
                duration_ms=round(duration_ms, 2),
            )
            db.add(entry)
            db.commit()
        finally:
            db.close()
    except Exception as _log_exc:
        logger.debug(f"[audit-log] Failed to write AgentToolCallLog: {_log_exc}")


def _fire_log(tool_name: str, user_email: str, tool_input: dict, result: dict,
              was_blocked: bool, duration_ms: float) -> None:
    """Schedule _log_tool_call as a background asyncio task (non-blocking)."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_log_tool_call(tool_name, user_email, tool_input, result, was_blocked, duration_ms))
    except RuntimeError:
        pass  # No running event loop (e.g. sync test context) - skip logging


async def execute_tool(
    tool_name: str, tool_input: dict, user_email: str, db_session
) -> dict:
    """Dispatch a tool call to its registered handler.

    Never raises - all errors are returned as {"error": "..."} so the agentic
    loop can feed them back to the LLM instead of crashing.
    Every call (success, error, and blocked) is logged asynchronously to AgentToolCallLog.
    """
    _call_start = _time.monotonic()

    entry = _TOOL_REGISTRY.get(tool_name)
    if not entry:
        return {"error": f"Unknown tool: {tool_name}"}

    # Phase 10: Cryptographic Scoping Check
    if tool_name in SENSITIVE_TOOLS:
        signature = tool_input.pop("_security_signature", None)
        authorized = (
            GLOBAL_SIGNER.verify_token(signature, tool_name, {}, user_email) or
            GLOBAL_SIGNER.verify_token(signature, "agent_chat", {}, user_email)
        )
        if not authorized:
            logger.warning(f"Security Block: Agent attempted to execute sensitive tool '{tool_name}' without a valid HMAC signature.")
            # Build a draft-display hint from the attempted args so the LLM shows it to the user
            _draft_hint = ""
            if tool_name == "send_email":
                _to = tool_input.get("to", "")
                _subj = tool_input.get("subject", "")
                _body = tool_input.get("body", "")
                if _to or _subj or _body:
                    _draft_hint = (
                        f"\n\nDraft email you composed:\n"
                        f"**To:** {_to}\n**Subject:** {_subj}\n\n{_body}\n\n"
                        f"---\n **Send this email?** Reply 'yes', 'confirm', or 'send it' to proceed."
                    )
            blocked_result = {
                "error": (
                    f"Security Block: The tool '{tool_name}' requires explicit user confirmation before it can run. "
                    f"Show the complete email draft to the user (To / Subject / Body) and ask ' Send this email?'. "
                    f"Do NOT say 'I was unable to send'. Instead, display the draft and await confirmation.{_draft_hint}"
                )
            }
            _fire_log(tool_name, user_email, tool_input, blocked_result,
                      was_blocked=True, duration_ms=(_time.monotonic() - _call_start) * 1000)
            return blocked_result

    try:
        # Strip all meta-keys that are never real tool arguments:
        # • user_email / db  - passed explicitly as separate args
        # • _security_signature - consumed by the SENSITIVE_TOOLS gate above;
        #   non-sensitive tools never declare it, so it must always be removed.
        _META_KEYS = {"user_email", "db", "_security_signature"}
        clean_input = {k: v for k, v in tool_input.items() if k not in _META_KEYS}
        result = await entry["handler"](
            user_email=user_email, db=db_session, **clean_input
        )
        _fire_log(tool_name, user_email, tool_input, result,
                  was_blocked=False, duration_ms=(_time.monotonic() - _call_start) * 1000)
        return result
    except Exception as e:
        from fastapi import HTTPException
        error_msg = str(e)

        if isinstance(e, HTTPException):
            error_msg = str(e.detail)
        elif e.__class__.__name__ == "HttpError":
            try:
                if hasattr(e, "content"):
                    err_data = json.loads(e.content.decode("utf-8"))
                    if "error" in err_data and "message" in err_data["error"]:
                        error_msg = err_data["error"]["message"]
            except Exception:
                pass

        logger.error(f"Tool '{tool_name}' raised: {error_msg}")
        err_result = {"error": f"Tool '{tool_name}' failed: {error_msg}"}
        _fire_log(tool_name, user_email, tool_input, err_result,
                  was_blocked=False, duration_ms=(_time.monotonic() - _call_start) * 1000)
        return err_result


def get_tools_for_user(user_email: str, db_session) -> List[Dict]:
    """Auto-generate OpenAI-compatible function schemas from the registry based on connected providers."""
    from auth.models import User
    import os
    
    user = db_session.query(User).filter(User.email == user_email).first()
    has_google = bool(user and user.gmail_access_token)
    # has_microsoft = bool(user and getattr(user, 'microsoft_access_token', None) and os.environ.get("AZURE_CLIENT_ID"))  # MICROSOFT DISABLED

    # Defaults if no accounts are connected (for robustness, we might just return all or nothing)
    # usually the agent will prompt the user to connect an account
    available_tools = []

    for name, entry in _TOOL_REGISTRY.items():
        provider = entry.get("provider", "google")

        # Determine if this tool should be "loaded" into the LLM context
        # 1. If provider is "all" or None, always include
        # 2. If provider is "google", include if Google connected
        # (Microsoft provider disabled)

        include = False
        if provider == "all":
            include = True
        elif provider == "google" and has_google:
            include = True
        # elif provider == "microsoft" and has_microsoft:  # MICROSOFT DISABLED
        #     include = True

        if include:
            available_tools.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": entry["description"],
                    "parameters": entry["parameters"],
                },
            })
            
    return available_tools

def get_all_tool_schemas() -> List[Dict]:
    """Legacy method - gets all tools regardless of provider."""
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": entry["description"],
                "parameters": entry["parameters"],
            },
        }
        for name, entry in _TOOL_REGISTRY.items()
    ]


def get_tool_catalog() -> List[Dict]:
    """Return lightweight metadata for every registered tool.

    Used by the dynamic agent creator so the LLM can pick tools from the
    full live catalog instead of a hardcoded list.  NOT for execution -
    no handlers are exposed.
    """
    catalog = []
    for name, entry in _TOOL_REGISTRY.items():
        catalog.append({
            "name": name,
            "description": entry["description"],
            "category": entry.get("category", "general"),
            "approval_required": entry.get("approval_required", False),
            "credentials_required": entry.get("credentials_required", False),
            "provider": entry.get("provider", "google"),
        })
    return catalog


def get_tools_for_agent(
    user_email: str,
    db_session,
    tool_names: Optional[List[str]] = None,
) -> List[Dict]:
    """Return OpenAI-compatible schemas for a specific named subset of tools.

    If `tool_names` is None or empty the function falls back to the full
    provider-filtered set (same as get_tools_for_user) so legacy agents
    with an empty tools list continue to work without any changes.
    """
    if not tool_names:
        # Backward-compat: legacy agents have tools=[] in agent_config
        return get_tools_for_user(user_email, db_session)

    tool_name_set = set(tool_names)
    available_tools = []
    for name, entry in _TOOL_REGISTRY.items():
        if name not in tool_name_set:
            continue
        available_tools.append({
            "type": "function",
            "function": {
                "name": name,
                "description": entry["description"],
                "parameters": entry["parameters"],
            },
        })
    return available_tools


# ── Tool Registrations ───────────────────────────────────────────────────────

@mcp_tool(
    name="read_uploaded_document",
    category="file",
    description=(
        "Reads the contents of a user-uploaded document (PDF, DOCX, CSV, TXT) "
        "stored on the server. Does not support reading arbitrary local files."
    ),
    parameters={
        "type": "object",
        "properties": {
            "doc_id": {
                "type": "string",
                "description": "The unique ID of the document to read."
            }
        },
        "required": ["doc_id"],
    },
)
async def tool_read_uploaded_document(
    user_email: str, db, doc_id: str
) -> dict:
    from mcp_servers.tools.local_file_tools import read_uploaded_document
    # run synchronously as the file IO is fast enough for these small files
    return read_uploaded_document(doc_id)

@mcp_tool(
    name="create_document",
    category="google_docs",
    description=(
        "Creates a new Google Doc (text document). Use ONLY for narrative/prose content: "
        "reports, letters, meeting minutes, notes, essays. "
        "⚠️ Do NOT use for spreadsheets, financial data, analytics, tables, or row/column data - "
        "use create_spreadsheet instead. Returns the document URL and ID."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Document title"},
            "content": {
                "type": "string",
                "description": "Document body content (plain text or Markdown)",
            },
            "folder_id": {
                "type": "string",
                "description": "Optional Drive folder ID. Defaults to the agent output folder.",
            },
        },
        "required": ["title", "content"],
    },
)
async def tool_create_document(
    user_email: str, db, title: str, content: str, folder_id: str = None
) -> dict:
    from services.google_workspace_service import GoogleWorkspaceService
    svc = GoogleWorkspaceService(user_email, db)
    return await svc.create_document(title, content, folder_id)


@mcp_tool(
    name="create_folder",
    category="google_drive",
    description="Creates a Google Drive folder. Returns the folder ID and URL.",
    parameters={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Folder name"},
            "parent_folder_id": {
                "type": "string",
                "description": "Optional parent folder ID. Defaults to Drive root.",
            },
        },
        "required": ["name"],
    },
)
async def tool_create_folder(
    user_email: str, db, name: str, parent_folder_id: str = None
) -> dict:
    from services.google_workspace_service import GoogleWorkspaceService
    svc = GoogleWorkspaceService(user_email, db)
    return await svc.create_folder(name, parent_folder_id)


@mcp_tool(
    name="share_file",
    category="google_drive",
    description="Shares a Google Drive file or folder with a specific email address.",
    parameters={
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "Drive file or folder ID to share"},
            "recipient_email": {
                "type": "string",
                "description": "Email address of the person to share with",
            },
            "permission": {
                "type": "string",
                "enum": ["reader", "commenter", "writer"],
                "description": "Permission level to grant. Defaults to 'reader'.",
            },
        },
        "required": ["file_id", "recipient_email"],
    },
)
async def tool_share_file(
    user_email: str, db, file_id: str, recipient_email: str, permission: str = "reader"
) -> dict:
    from services.google_workspace_service import GoogleWorkspaceService
    svc = GoogleWorkspaceService(user_email, db)
    return await svc.share_file(file_id, recipient_email, permission)


@mcp_tool(
    name="get_file_info",
    category="google_drive",
    description="Retrieves metadata about a Google Drive file (name, size, URL, dates).",
    parameters={
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "Drive file ID to inspect"},
        },
        "required": ["file_id"],
    },
)
async def tool_get_file_info(user_email: str, db, file_id: str) -> dict:
    from services.google_workspace_service import GoogleWorkspaceService
    svc = GoogleWorkspaceService(user_email, db)
    return await svc.get_file_info(file_id)


@mcp_tool(
    name="search_drive_files",
    category="google_drive",
    description=(
        "Search Google Drive files by name (partial, case-insensitive). "
        "Use this to find a file's ID before duplicating, sharing, or editing it by name."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name_query": {"type": "string", "description": "File name or partial name to search for"},
            "max_results": {"type": "integer", "description": "Max files to return (default 10)", "default": 10},
        },
        "required": ["name_query"],
    },
)
async def tool_search_drive_files(user_email: str, db, name_query: str, max_results: int = 10) -> dict:
    from services.google_workspace_service import GoogleWorkspaceService
    svc = GoogleWorkspaceService(user_email, db)
    return await svc.search_drive_files(name_query, max_results)


@mcp_tool(
    name="duplicate_file",
    category="google_drive",
    description=(
        "Creates a copy of a Google Drive file (Doc, Sheet, Slide, or any other file). "
        "Accepts either file_id (exact) or file_name (searches Drive by name — use this when "
        "the user provides a file name instead of an ID). Returns the new file's ID and link."
    ),
    parameters={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "ID of the file to duplicate. Use this if you already have the ID.",
            },
            "file_name": {
                "type": "string",
                "description": "Name (or partial name) of the file to find and duplicate. Use this when the user provides a file name.",
            },
            "new_name": {
                "type": "string",
                "description": "Optional name for the copy. Defaults to original name + ' (Copy)'.",
            },
            "folder_id": {
                "type": "string",
                "description": "Optional folder ID to place the copy in. Defaults to the original file's folder.",
            },
        },
        "required": [],
    },
)
async def tool_duplicate_file(
    user_email: str, db,
    file_id: str = None, file_name: str = None,
    new_name: str = None, folder_id: str = None,
) -> dict:
    from services.google_workspace_service import GoogleWorkspaceService
    svc = GoogleWorkspaceService(user_email, db)
    return await svc.duplicate_file(file_id=file_id, file_name=file_name, new_name=new_name, folder_id=folder_id)


@mcp_tool(
    name="send_email",
    category="gmail",
    description=(
        "Sends an email via Gmail on behalf of the user. "
        "Supports attaching Google Docs or Drive files as PDFs via attachment_doc_ids."
    ),
    parameters={
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "Recipient email address(es), comma-separated"},
            "subject": {"type": "string", "description": "Email subject line"},
            "body": {"type": "string", "description": "Email body text"},
            "thread_id": {
                "type": "string",
                "description": "Optional Gmail thread ID to reply within",
            },
            "attachment_doc_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional list of Google Doc or Drive file IDs to attach as PDFs. "
                    "Use the file ID returned by create_document or get_file_info."
                ),
            },
        },
        "required": ["to", "subject", "body"],
    },
)
async def tool_send_email(
    user_email: str,
    db,
    to: str,
    subject: str,
    body: str,
    thread_id: str = None,
    attachment_doc_ids: list = None,
) -> dict:
    from mcp_servers.tools.gmail_tools import send_email, SendEmailRequest
    req = SendEmailRequest(
        user_email=user_email,
        to=to,
        subject=subject,
        body=body,
        thread_id=thread_id,
        attachment_doc_ids=attachment_doc_ids,
    )
    return await send_email(req)


@mcp_tool(
    name="create_calendar_event",
    category="calendar",
    description=(
        "Creates a new event on the user's Google Calendar. "
        "Automatically generates a Google Meet link if attendees are provided."
    ),
    parameters={
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Event title"},
            "start_time": {
                "type": "string",
                "description": "Start time in ISO 8601 format (e.g. '2025-10-15T09:00:00Z')",
            },
            "end_time": {
                "type": "string",
                "description": "End time in ISO 8601 format (e.g. '2025-10-15T10:00:00Z')",
            },
            "description": {"type": "string", "description": "Optional event description"},
            "attendees": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of attendee email addresses",
            },
            "location": {"type": "string", "description": "Optional event location"},
        },
        "required": ["summary", "start_time", "end_time"],
    },
)
async def tool_create_calendar_event(
    user_email: str,
    db,
    summary: str,
    start_time: str,
    end_time: str,
    description: str = "",
    attendees: list = None,
    location: str = None,
) -> dict:
    from mcp_servers.tools.calendar_tools import create_event, CreateEventRequest
    req = CreateEventRequest(
        user_email=user_email,
        summary=summary,
        description=description or "",
        start_time=start_time,
        end_time=end_time,
        attendees=attendees,
        location=location,
    )
    return await create_event(req)


# ── Gmail Tools ──────────────────────────────────────────────────────────────

@mcp_tool(
    name="list_emails",
    category="gmail",
    description=(
        "Fetch recent emails from the user's mailbox. Supports filtering by label "
        "(e.g. INBOX, SENT, SPAM) and Gmail search queries (e.g. 'is:unread from:boss@co.com'). "
        "Returns subject, sender, date, snippet, and label IDs for each email."
    ),
    parameters={
        "type": "object",
        "properties": {
            "max_results": {
                "type": "integer",
                "description": "Number of emails to return (default 10, max 50)",
                "default": 10,
            },
            "label_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Filter by Gmail label IDs, e.g. ['INBOX'], ['SENT'], ['SPAM']",
            },
            "query": {
                "type": "string",
                "description": "Gmail search query, e.g. 'is:unread', 'from:alice@example.com', 'subject:invoice'",
            },
        },
        "required": [],
    },
)
async def tool_list_emails(
    user_email: str, db, max_results: int = 10, label_ids: list = None, query: str = None
) -> dict:
    from mcp_servers.tools.gmail_tools import list_emails, ListEmailRequest
    req = ListEmailRequest(user_email=user_email, max_results=max_results, label_ids=label_ids, query=query)
    return await list_emails(req)


@mcp_tool(
    name="get_email",
    category="gmail",
    description=(
        "Retrieve the full content of a specific email by its ID, including the complete body text. "
        "Use list_emails first to get email IDs."
    ),
    parameters={
        "type": "object",
        "properties": {
            "message_id": {"type": "string", "description": "Gmail message ID to retrieve"},
        },
        "required": ["message_id"],
    },
)
async def tool_get_email(user_email: str, db, message_id: str) -> dict:
    from mcp_servers.tools.gmail_tools import get_email, EmailRequest
    req = EmailRequest(user_email=user_email, message_id=message_id)
    return await get_email(req)


@mcp_tool(
    name="delete_email",
    category="gmail",
    description="Move an email to the Trash. Use list_emails to find the message ID first.",
    parameters={
        "type": "object",
        "properties": {
            "message_id": {"type": "string", "description": "Gmail message ID to delete"},
        },
        "required": ["message_id"],
    },
)
async def tool_delete_email(user_email: str, db, message_id: str) -> dict:
    from mcp_servers.tools.gmail_tools import delete_email, EmailRequest
    req = EmailRequest(user_email=user_email, message_id=message_id)
    return await delete_email(req)


@mcp_tool(
    name="modify_labels",
    category="gmail",
    description=(
        "Add or remove Gmail labels on a message. Use this to mark emails as read/unread, "
        "star them, archive them (remove INBOX label), or apply custom labels."
    ),
    parameters={
        "type": "object",
        "properties": {
            "message_id": {"type": "string", "description": "Gmail message ID to modify"},
            "add_labels": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Label IDs to add, e.g. ['STARRED'], ['IMPORTANT'], ['UNREAD']",
            },
            "remove_labels": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Label IDs to remove, e.g. ['UNREAD'] to mark as read, ['INBOX'] to archive",
            },
        },
        "required": ["message_id"],
    },
)
async def tool_modify_labels(
    user_email: str, db, message_id: str, add_labels: list = None, remove_labels: list = None
) -> dict:
    from mcp_servers.tools.gmail_tools import modify_labels, ModifyLabelsRequest
    req = ModifyLabelsRequest(
        user_email=user_email, message_id=message_id,
        add_labels=add_labels, remove_labels=remove_labels,
    )
    return await modify_labels(req)


@mcp_tool(
    name="create_draft",
    category="gmail",
    description="Save an email as a draft in Gmail without sending it.",
    parameters={
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "Recipient email address"},
            "subject": {"type": "string", "description": "Email subject line"},
            "body": {"type": "string", "description": "Email body text"},
        },
        "required": ["to", "subject", "body"],
    },
)
async def tool_create_draft(user_email: str, db, to: str, subject: str, body: str) -> dict:
    from mcp_servers.tools.gmail_tools import create_draft, SendEmailRequest
    req = SendEmailRequest(user_email=user_email, to=to, subject=subject, body=body)
    return await create_draft(req)


@mcp_tool(
    name="get_drafts",
    category="gmail",
    description="List saved email drafts in the user's Gmail account.",
    parameters={
        "type": "object",
        "properties": {
            "max_results": {
                "type": "integer",
                "description": "Maximum number of drafts to return (default 20)",
                "default": 20,
            },
        },
        "required": [],
    },
)
async def tool_get_drafts(user_email: str, db, max_results: int = 20) -> dict:
    from mcp_servers.tools.gmail_tools import get_drafts, DraftRequest
    req = DraftRequest(user_email=user_email, max_results=max_results)
    return await get_drafts(req)


@mcp_tool(
    name="send_draft",
    category="gmail",
    description="Send a previously saved Gmail draft by its draft ID. Use get_drafts to find draft IDs.",
    parameters={
        "type": "object",
        "properties": {
            "draft_id": {"type": "string", "description": "Gmail draft ID to send"},
        },
        "required": ["draft_id"],
    },
)
async def tool_send_draft(user_email: str, db, draft_id: str) -> dict:
    from mcp_servers.tools.gmail_tools import send_draft, DraftIdRequest
    req = DraftIdRequest(user_email=user_email, draft_id=draft_id)
    return await send_draft(req)


@mcp_tool(
    name="delete_draft",
    category="gmail",
    description="Permanently delete a Gmail draft by its draft ID. Use get_drafts to find draft IDs.",
    parameters={
        "type": "object",
        "properties": {
            "draft_id": {"type": "string", "description": "Gmail draft ID to delete"},
        },
        "required": ["draft_id"],
    },
)
async def tool_delete_draft(user_email: str, db, draft_id: str) -> dict:
    from mcp_servers.tools.gmail_tools import delete_draft, DraftIdRequest
    req = DraftIdRequest(user_email=user_email, draft_id=draft_id)
    return await delete_draft(req)



# ── Microsoft Exchange Tools - DISABLED ──────────────────────────────────────

# @mcp_tool(
#     name="list_emails",
#     description=(
#         "Fetch recent emails from the user's Microsoft Outlook mailbox. Supports filtering "
#         "by common folders (INBOX, SENT, SPAM, DRAFT, TRASH) and simple search queries. "
#         "Returns subject, sender, date, snippet, and read status for each email."
#     ),
#     parameters={
#         "type": "object",
#         "properties": {
#             "max_results": {
#                 "type": "integer",
#                 "description": "Number of emails to return (default 10, max 50)",
#                 "default": 10,
#             },
#             "label_ids": {
#                 "type": "array",
#                 "items": {"type": "string"},
#                 "description": "Filter by folder/label IDs, e.g. ['INBOX'], ['SENT'], ['SPAM']",
#             },
#             "query": {
#                 "type": "string",
#                 "description": "Search query, e.g. 'is:unread'",
#             },
#         },
#         "required": [],
#     },
#     provider="microsoft"
# )
# async def tool_ms_list_emails(
#     user_email: str, db, max_results: int = 10, label_ids: list = None, query: str = None
# ) -> dict:
#     from mcp_servers.tools.outlook_tools import ms_list_emails
#     return await ms_list_emails(user_email=user_email, db=db, max_results=max_results, label_ids=label_ids, query=query)
#
# @mcp_tool(
#     name="get_email",
#     description=(
#         "Retrieve the full content of a specific email by its ID from Microsoft Outlook. "
#         "Use list_emails first to get email IDs."
#     ),
#     parameters={
#         "type": "object",
#         "properties": {
#             "message_id": {"type": "string", "description": "Microsoft Outlook message ID to retrieve"},
#         },
#         "required": ["message_id"],
#     },
#     provider="microsoft"
# )
# async def tool_ms_get_email(user_email: str, db, message_id: str) -> dict:
#     from mcp_servers.tools.outlook_tools import ms_get_email
#     return await ms_get_email(user_email=user_email, db=db, message_id=message_id)
#
# @mcp_tool(
#     name="send_email",
#     description="Sends an email via Microsoft Outlook on behalf of the user.",
#     parameters={
#         "type": "object",
#         "properties": {
#             "to": {"type": "string", "description": "Recipient email address"},
#             "subject": {"type": "string", "description": "Email subject line"},
#             "body": {"type": "string", "description": "Email body text"},
#             "thread_id": {
#                 "type": "string",
#                 "description": "Optional message ID to reply within",
#             },
#         },
#         "required": ["to", "subject", "body"],
#     },
#     provider="microsoft"
# )
# async def tool_ms_send_email(
#     user_email: str, db, to: str, subject: str, body: str, thread_id: str = None
# ) -> dict:
#     from mcp_servers.tools.outlook_tools import ms_send_email
#     return await ms_send_email(user_email=user_email, db=db, to=to, subject=subject, body=body, thread_id=thread_id)
#
# @mcp_tool(
#     name="delete_email",
#     description="Move an email to the Deleted Items folder in Microsoft Outlook.",
#     parameters={
#         "type": "object",
#         "properties": {
#             "message_id": {"type": "string", "description": "Microsoft Outlook message ID to delete"},
#         },
#         "required": ["message_id"],
#     },
#     provider="microsoft"
# )
# async def tool_ms_delete_email(user_email: str, db, message_id: str) -> dict:
#     from mcp_servers.tools.outlook_tools import ms_delete_email
#     return await ms_delete_email(user_email=user_email, db=db, message_id=message_id)


# ── Calendar Tools ───────────────────────────────────────────────────────────

@mcp_tool(
    name="list_events",
    category="calendar",
    description=(
        "List events on the user's Google Calendar. "
        "IMPORTANT: NEVER ask the user for a time range - always compute it yourself from the current date. "
        "Examples: 'today' → time_min=TODAY 00:00:00Z, time_max=TODAY 23:59:59Z; "
        "'this week' → time_min=MONDAY 00:00:00Z, time_max=SUNDAY 23:59:59Z; "
        "'tomorrow' → time_min=TOMORROW 00:00:00Z, time_max=TOMORROW 23:59:59Z. "
        "Use YYYY-MM-DD format for dates - the system auto-converts to RFC3339. "
        "Returns event titles, times, attendees, Google Meet links."
    ),
    parameters={
        "type": "object",
        "properties": {
            "time_min": {
                "type": "string",
                "description": (
                    "Start of the time range. Use YYYY-MM-DD (e.g. '2026-04-14') or "
                    "full ISO datetime (e.g. '2026-04-14T00:00:00Z'). "
                    "For 'today' use today's date. NEVER omit this for date-specific queries."
                ),
            },
            "time_max": {
                "type": "string",
                "description": (
                    "End of the time range. Use YYYY-MM-DD (e.g. '2026-04-14') or full ISO datetime. "
                    "For 'today' use today's date (end of day). For open-ended queries omit this."
                ),
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of events to return (default 10)",
                "default": 10,
            },
        },
        "required": [],
    },
)
async def tool_list_events(
    user_email: str, db, time_min: str = None, time_max: str = None, max_results: int = 10
) -> dict:
    from mcp_servers.tools.calendar_tools import list_events, EventListRequest
    req = EventListRequest(user_email=user_email, time_min=time_min, time_max=time_max, max_results=max_results)
    return await list_events(req)


@mcp_tool(
    name="check_availability",
    category="calendar",
    description=(
        "Check whether the user's calendar is free or busy during a given time window. "
        "Returns busy periods if any exist."
    ),
    parameters={
        "type": "object",
        "properties": {
            "start_time": {
                "type": "string",
                "description": "Start of the window to check in ISO 8601 format",
            },
            "end_time": {
                "type": "string",
                "description": "End of the window to check in ISO 8601 format",
            },
        },
        "required": ["start_time", "end_time"],
    },
)
async def tool_check_availability(user_email: str, db, start_time: str, end_time: str) -> dict:
    from mcp_servers.tools.calendar_tools import check_availability, AvailabilityRequest
    req = AvailabilityRequest(user_email=user_email, start_time=start_time, end_time=end_time)
    return await check_availability(req)


@mcp_tool(
    name="update_event",
    category="calendar",
    description="Update a Google Calendar event by its event ID.",
    parameters={
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "Google Calendar event ID to update"},
            "summary": {"type": "string", "description": "New event title"},
            "start_time": {"type": "string", "description": "New start time in ISO 8601"},
            "end_time": {"type": "string", "description": "New end time in ISO 8601"},
        },
        "required": ["event_id"],
    },
)
async def tool_update_event(user_email: str, db, event_id: str, summary: str = None, start_time: str = None, end_time: str = None) -> dict:
    from mcp_servers.tools.calendar_tools import update_event, UpdateEventRequest
    req = UpdateEventRequest(user_email=user_email, event_id=event_id, summary=summary, start_time=start_time, end_time=end_time)
    return await update_event(req)


@mcp_tool(
    name="delete_event",
    category="calendar",
    description="Delete a Google Calendar event by its event ID. Use list_events to find event IDs.",
    parameters={
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "Google Calendar event ID to delete"},
        },
        "required": ["event_id"],
    },
)
async def tool_delete_event(user_email: str, db, event_id: str) -> dict:
    from mcp_servers.tools.calendar_tools import delete_event, DeleteEventRequest
    req = DeleteEventRequest(user_email=user_email, event_id=event_id)
    return await delete_event(req)


@mcp_tool(
    name="suggest_times",
    category="calendar",
    description=(
        "Find available meeting time slots on the user's calendar within a given date range. "
        "Suggests free windows during business hours (11am–6pm) that don't conflict with existing events."
    ),
    parameters={
        "type": "object",
        "properties": {
            "start_date": {
                "type": "string",
                "description": "Start of the search window in ISO 8601 format",
            },
            "end_date": {
                "type": "string",
                "description": "End of the search window in ISO 8601 format",
            },
            "duration_minutes": {
                "type": "integer",
                "description": "Desired meeting length in minutes (default 60)",
                "default": 60,
            },
            "max_suggestions": {
                "type": "integer",
                "description": "Maximum number of time slots to return (default 5)",
                "default": 5,
            },
        },
        "required": ["start_date", "end_date"],
    },
)
async def tool_suggest_times(
    user_email: str, db,
    start_date: str,
    end_date: str,
    duration_minutes: int = 60,
    max_suggestions: int = 5,
) -> dict:
    from mcp_servers.tools.calendar_tools import suggest_times, SuggestTimesRequest
    req = SuggestTimesRequest(
        user_email=user_email,
        start_date=start_date,
        end_date=end_date,
        duration_minutes=duration_minutes,
        max_suggestions=max_suggestions,
    )
    return await suggest_times(req)


# ── Microsoft Exchange Calendar Tools - DISABLED ──────────────────────────────

# @mcp_tool(
#     name="list_events",
#     description=(
#         "List upcoming events on the user's Microsoft Outlook Calendar. "
#         "Optionally filter by time range. Returns event titles, times, attendees, and Teams links."
#     ),
#     parameters={
#         "type": "object",
#         "properties": {
#             "time_min": {
#                 "type": "string",
#                 "description": "Start of the time range in ISO 8601 format",
#             },
#             "time_max": {
#                 "type": "string",
#                 "description": "End of the time range in ISO 8601 format (optional)",
#             },
#             "max_results": {
#                 "type": "integer",
#                 "description": "Maximum number of events to return (default 10)",
#                 "default": 10,
#             },
#         },
#         "required": [],
#     },
#     provider="microsoft"
# )
# async def tool_ms_list_events(
#     user_email: str, db, time_min: str = None, time_max: str = None, max_results: int = 10
# ) -> dict:
#     from mcp_servers.tools.ms_calendar_tools import ms_list_events
#     return await ms_list_events(user_email=user_email, db=db, time_min=time_min, time_max=time_max, max_results=max_results)
#
# @mcp_tool(
#     name="create_calendar_event",
#     description=(
#         "Creates a new event on the user's Microsoft Outlook Calendar. "
#         "Automatically generates a Teams meeting link if attendees are provided."
#     ),
#     parameters={
#         "type": "object",
#         "properties": {
#             "summary": {"type": "string", "description": "Event title"},
#             "start_time": {
#                 "type": "string",
#                 "description": "Start time in ISO 8601 format",
#             },
#             "end_time": {
#                 "type": "string",
#                 "description": "End time in ISO 8601 format",
#             },
#             "description": {"type": "string", "description": "Optional event description"},
#             "attendees": {
#                 "type": "array",
#                 "items": {"type": "string"},
#                 "description": "Optional list of attendee email addresses",
#             },
#             "location": {"type": "string", "description": "Optional event location"},
#         },
#         "required": ["summary", "start_time", "end_time"],
#     },
#     provider="microsoft"
# )
# async def tool_ms_create_calendar_event(
#     user_email: str, db, summary: str, start_time: str, end_time: str,
#     description: str = "", attendees: list = None, location: str = None
# ) -> dict:
#     from mcp_servers.tools.ms_calendar_tools import ms_create_event
#     return await ms_create_event(
#         user_email=user_email, db=db, summary=summary, start_time=start_time,
#         end_time=end_time, description=description, attendees=attendees, location=location
#     )
#
# @mcp_tool(
#     name="delete_event",
#     description="Delete a Microsoft Outlook Calendar event by its event ID.",
#     parameters={
#         "type": "object",
#         "properties": {
#             "event_id": {"type": "string", "description": "Microsoft Outlook event ID to delete"},
#         },
#         "required": ["event_id"],
#     },
#     provider="microsoft"
# )
# async def tool_ms_delete_event(user_email: str, db, event_id: str) -> dict:
#     from mcp_servers.tools.ms_calendar_tools import ms_delete_event
#     return await ms_delete_event(user_email=user_email, db=db, event_id=event_id)


# ── Sheets Tools ─────────────────────────────────────────────────────────────

@mcp_tool(
    name="create_spreadsheet",
    category="google_sheets",
    description=(
        "Creates a new Google Sheet (spreadsheet). Use for ALL tabular data: financial analysis, "
        "tracking, analytics, data tables, budgets, reports with numbers, CSV-like data, "
        "or any row/column structure. Returns spreadsheet_id for write_sheet_data. "
        "Prefer this over create_document whenever the output is structured/numerical data."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Spreadsheet title"},
            "sheet_name": {"type": "string", "description": "Name for the default sheet", "default": "Sheet1"},
            "initial_data": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "string"}},
                "description": "Optional 2D array of rows and columns data"
            },
        },
        "required": ["title"],
    },
)
async def tool_create_spreadsheet(
    user_email: str, db, title: str, sheet_name: str = "Sheet1", initial_data: list = None
) -> dict:
    from mcp_servers.tools.sheets_tools import create_spreadsheet, CreateSpreadsheetRequest
    req = CreateSpreadsheetRequest(user_email=user_email, title=title, sheet_name=sheet_name, initial_data=initial_data)
    return await create_spreadsheet(req)


@mcp_tool(
    name="get_sheet_data",
    description="Read data from a specific range in a Google Spreadsheet.",
    parameters={
        "type": "object",
        "properties": {
            "spreadsheet_id": {"type": "string", "description": "The Google Spreadsheet ID"},
            "range": {"type": "string", "description": "The A1 notation range, e.g. 'Sheet1!A1:D10'"},
        },
        "required": ["spreadsheet_id", "range"],
    },
)
async def tool_get_sheet_data(user_email: str, db, spreadsheet_id: str, range: str) -> dict:
    from mcp_servers.tools.sheets_tools import get_sheet_data, SheetDataRequest
    req = SheetDataRequest(user_email=user_email, spreadsheet_id=spreadsheet_id, range=range)
    return await get_sheet_data(req)


@mcp_tool(
    name="write_sheet_data",
    description="Write/overwrite data to a specific range in a Google Spreadsheet.",
    parameters={
        "type": "object",
        "properties": {
            "spreadsheet_id": {"type": "string", "description": "The Google Spreadsheet ID"},
            "range": {"type": "string", "description": "The A1 notation range, e.g. 'Sheet1!A1:D10'"},
            "values": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "string"}},
                "description": "2D array of rows and columns to write"
            },
        },
        "required": ["spreadsheet_id", "range", "values"],
    },
)
async def tool_write_sheet_data(user_email: str, db, spreadsheet_id: str, range: str, values: list) -> dict:
    from mcp_servers.tools.sheets_tools import write_sheet_data, WriteSheetRequest
    req = WriteSheetRequest(user_email=user_email, spreadsheet_id=spreadsheet_id, range=range, values=values)
    return await write_sheet_data(req)


@mcp_tool(
    name="append_rows",
    category="google_sheets",
    description="Append rows of data strictly after the last existing data row in a specific Google Spreadsheet.",
    parameters={
        "type": "object",
        "properties": {
            "spreadsheet_id": {"type": "string", "description": "The Google Spreadsheet ID"},
            "range": {"type": "string", "description": "The A1 notation range determining the table context, e.g. 'Sheet1'"},
            "values": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "string"}},
                "description": "2D array of rows to append"
            },
        },
        "required": ["spreadsheet_id", "range", "values"],
    },
)
async def tool_append_rows(user_email: str, db, spreadsheet_id: str, range: str, values: list) -> dict:
    from mcp_servers.tools.sheets_tools import append_rows, AppendRowsRequest
    req = AppendRowsRequest(user_email=user_email, spreadsheet_id=spreadsheet_id, range=range, values=values)
    return await append_rows(req)


# ── Forms Tools ──────────────────────────────────────────────────────────────

@mcp_tool(
    name="create_form",
    category="google_forms",
    description="Create a new Google Form with an optional list of questions.",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Form title"},
            "description": {"type": "string", "description": "Optional Form description"},
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "type": {"type": "string", "enum": ["text", "paragraph", "multiple_choice", "checkbox", "dropdown", "scale"]},
                        "required": {"type": "boolean", "default": False},
                        "options": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["title", "type"]
                }
            }
        },
        "required": ["title"],
    }
)
async def tool_create_form(user_email: str, db, title: str, description: str = "", questions: list = None) -> dict:
    from mcp_servers.tools.forms_tools import create_form, CreateFormRequest, FormQuestion
    
    parsed_qs = None
    if questions:
        parsed_qs = [
            FormQuestion(
                title=q["title"], 
                type=q["type"], 
                required=q.get("required", False), 
                options=q.get("options")
            ) 
            for q in questions
        ]
        
    req = CreateFormRequest(user_email=user_email, title=title, description=description, questions=parsed_qs)
    return await create_form(req)


@mcp_tool(
    name="get_form_responses",
    category="google_forms",
    description="Retrieve submissions and responses from a Google Form.",
    parameters={
        "type": "object",
        "properties": {
            "form_id": {"type": "string", "description": "Google Form ID"},
            "max_results": {"type": "integer", "description": "Maximum number of responses to fetch", "default": 100}
        },
        "required": ["form_id"]
    }
)
async def tool_get_form_responses(user_email: str, db, form_id: str, max_results: int = 100) -> dict:
    from mcp_servers.tools.forms_tools import get_form_responses, FormResponsesRequest
    req = FormResponsesRequest(user_email=user_email, form_id=form_id, max_results=max_results)
    return await get_form_responses(req)


# ── Slides Tools ─────────────────────────────────────────────────────────────

@mcp_tool(
    name="create_presentation",
    category="google_slides",
    description=(
        "Create a professional Google Slides presentation with text, images, and speaker notes. "
        "Each slide supports an image_query (auto-fetches a relevant stock photo) and speaker_notes. "
        "Use TITLE layout for the cover slide, SECTION_HEADER for section dividers, and "
        "TITLE_AND_BODY for all content slides. Returns the presentation URL."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Presentation title"},
            "slides": {
                "type": "array",
                "description": "Ordered list of slides to create",
                "items": {
                    "type": "object",
                    "properties": {
                        "layout": {
                            "type": "string",
                            "enum": ["TITLE_AND_BODY", "TITLE", "TITLE_ONLY", "SECTION_HEADER", "BLANK"],
                            "description": "Slide layout. TITLE for cover, SECTION_HEADER for section dividers, TITLE_AND_BODY for content.",
                            "default": "TITLE_AND_BODY",
                        },
                        "title_text": {
                            "type": "string",
                            "description": "Slide title text (keep under 10 words for readability)",
                        },
                        "body_text": {
                            "type": "string",
                            "description": (
                                "Body content as newline-separated lines - DO NOT add '•' prefix, "
                                "bullets are applied automatically. Keep each line under 10 words. "
                                "Max 5-6 lines per slide."
                            ),
                        },
                        "image_query": {
                            "type": "string",
                            "description": (
                                "Vivid Imagen 3 prompt for an AI-generated image to display on the right side "
                                "of this slide. Write it as a detailed visual description, e.g.: "
                                "'A glowing neural network with deep-blue interconnected nodes, futuristic aesthetic, photorealistic', "
                                "'Diverse team in a modern glass office brainstorming, natural daylight, cinematic'. "
                                "Omit for cover/title/section-header slides."
                            ),
                        },
                        "speaker_notes": {
                            "type": "string",
                            "description": "Talking points for this slide (2-4 sentences). Shown in presenter view.",
                        },
                    },
                },
            },
        },
        "required": ["title"],
    },
)
async def tool_create_presentation(user_email: str, db, title: str, slides: list = None) -> dict:
    from mcp_servers.tools.slides_tools import create_presentation, CreatePresentationRequest, SlideContent

    parsed_slides = None
    if slides:
        parsed_slides = [
            SlideContent(
                layout=s.get("layout", "TITLE_AND_BODY"),
                title_text=s.get("title_text"),
                body_text=s.get("body_text"),
                image_query=s.get("image_query"),
                speaker_notes=s.get("speaker_notes"),
            )
            for s in slides
        ]

    req = CreatePresentationRequest(user_email=user_email, title=title, slides=parsed_slides)
    return await create_presentation(req)


@mcp_tool(
    name="get_presentation",
    category="google_slides",
    description="Retrieve the structure and text contents from a Google Slides presentation.",
    parameters={
        "type": "object",
        "properties": {
            "presentation_id": {"type": "string", "description": "Google Slides presentation ID"}
        },
        "required": ["presentation_id"]
    }
)
async def tool_get_presentation(user_email: str, db, presentation_id: str) -> dict:
    from mcp_servers.tools.slides_tools import get_presentation, PresentationRequest
    req = PresentationRequest(user_email=user_email, presentation_id=presentation_id)
    return await get_presentation(req)


# ── Image Generation Tool ─────────────────────────────────────────────────────

@mcp_tool(
    name="generate_image",
    category="media",
    description=(
        "Generate a professional, high-quality image using Gemini Imagen 4 AI and save it to the user's "
        "Google Drive. Use for logos, illustrations, mockups, artwork, icons, banners, or any custom visual. "
        "Accepts a detailed visual prompt. For logos and merch-ready graphics use aspect_ratio='1:1'. "
        "For banners/wallpapers use aspect_ratio='16:9'. Returns the Google Drive link. "
        "IMPORTANT: When the user provided a website URL, pass the raw text from fetch_webpage as brand_context "
        "- this triggers automatic brand-analysis that produces far more accurate, on-brand results."
    ),
    parameters={
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": (
                    "Vivid, detailed Imagen 4 visual prompt. Include: subject, style, colors, composition, "
                    "background, mood, intended use. E.g.: 'A modern minimalist fintech startup logo, "
                    "golden ratio hexagon icon, deep navy and electric gold gradient, white background, "
                    "clean vector illustration, suitable for printing on merchandise'."
                ),
            },
            "filename": {
                "type": "string",
                "description": "Desired filename for the saved image (without extension). E.g. 'company_logo'.",
            },
            "aspect_ratio": {
                "type": "string",
                "enum": ["1:1", "16:9", "4:3", "9:16", "3:4"],
                "description": (
                    "Image aspect ratio. '1:1' for logos/icons/merch (default), "
                    "'16:9' for banners/presentations/wallpapers, '9:16' for portrait/mobile."
                ),
                "default": "1:1",
            },
            "brand_context": {
                "type": "string",
                "description": (
                    "Raw webpage text returned by fetch_webpage for the brand's website. "
                    "When provided, a dedicated brand-analysis step automatically extracts brand colors, "
                    "visual style, and personality to produce a far more accurate, on-brand image. "
                    "ALWAYS pass this when the user gave you a URL - do not write the prompt yourself, "
                    "let the brand-analysis step do it."
                ),
            },
        },
        "required": ["prompt"],
    },
)
async def tool_generate_image(
    user_email: str,
    db,
    prompt: str,
    filename: str = None,
    aspect_ratio: str = "1:1",
    brand_context: str = None,
) -> dict:
    from mcp_servers.tools.imagen_utils import generate_and_save_image
    return await generate_and_save_image(
        prompt=prompt,
        user_email=user_email,
        filename=filename,
        aspect_ratio=aspect_ratio,
        brand_context=brand_context,
    )


# ── Web Fetch Tool ─────────────────────────────────────────────────────────────

@mcp_tool(
    name="fetch_webpage",
    category="search",
    description=(
        "Fetch and read the visible text content of any public webpage (company website, article, "
        "documentation page, portfolio, product page). Use this to understand a brand, read context, "
        "or gather information from a URL before creating content or images. Returns cleaned text."
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The full URL of the webpage to fetch (must start with https:// or http://).",
            },
            "max_chars": {
                "type": "integer",
                "description": "Maximum characters of text to return (default 6000, max 15000).",
                "default": 6000,
            },
        },
        "required": ["url"],
    },
)
async def tool_fetch_webpage(
    user_email: str,
    db,
    url: str,
    max_chars: int = 6000,
) -> dict:
    import html as _html
    import re
    from html.parser import HTMLParser

    import httpx

    class _TextExtractor(HTMLParser):
        """Minimal HTML → plain-text stripper (skips scripts, styles, nav, footer)."""
        _SKIP = {"script", "style", "head", "noscript", "nav", "footer", "header", "aside"}

        def __init__(self):
            super().__init__()
            self._skip_depth = 0
            self.parts: list[str] = []

        def handle_starttag(self, tag, attrs):
            if tag in self._SKIP:
                self._skip_depth += 1

        def handle_endtag(self, tag):
            if tag in self._SKIP and self._skip_depth:
                self._skip_depth -= 1

        def handle_data(self, data):
            if not self._skip_depth:
                text = data.strip()
                if text:
                    self.parts.append(text)

    max_chars = min(max_chars or 6000, 15_000)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AIAgent/1.0; +https://github.com/anthropics)",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=8.0, read=15.0, write=5.0, pool=5.0),
            headers=headers,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            # Limit body to 512 KB before parsing
            html_text = resp.text[:524_288]

        parser = _TextExtractor()
        parser.feed(html_text)
        text = " ".join(parser.parts)
        text = _html.unescape(text)
        text = re.sub(r"\s{2,}", " ", text).strip()
        text = text[:max_chars]
        return {"success": True, "url": str(resp.url), "text": text, "chars": len(text)}

    except httpx.HTTPStatusError as e:
        return {"success": False, "error": f"HTTP {e.response.status_code} from '{url}'"}
    except httpx.TimeoutException:
        return {"success": False, "error": f"Timed out fetching '{url}' (>15s)"}
    except httpx.RequestError as e:
        return {"success": False, "error": f"Could not reach '{url}': {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ── Search Tools ──────────────────────────────────────────────────────────────

from typing import Optional

@mcp_tool(
    name="resolve_contact",
    category="contacts",
    description=(
        "Look up a contact's email address by their name or nickname. "
        "Use this BEFORE sending emails, scheduling meetings, or sharing documents "
        "when the user provides a person's name instead of an email."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The name or nickname of the person to lookup (e.g., 'Arjun', 'John', 'boss')."
            }
        },
        "required": ["name"],
    },
)
async def tool_resolve_contact(user_email: str, db, name: str) -> dict:
    from models import Contact
    from auth.models import User

    # Get user_id for the current user_email
    user = db.query(User).filter(User.email == user_email).first()
    if not user:
        return {"error": f"User '{user_email}' not found."}

    search_pattern = f"%{name.strip()}%"
    contacts = db.query(Contact).filter(
        Contact.user_id == user.id
    ).filter(
        Contact.name.ilike(search_pattern)
        | Contact.nickname.ilike(search_pattern)
        | Contact.email.ilike(search_pattern)
    ).all()

    if not contacts:
        return {"error": f"No contact found matching '{name}'. Please ask the user for their email address."}

    if len(contacts) > 1:
        matches = [{"name": c.name, "email": c.email, "nickname": c.nickname} for c in contacts]
        return {
            "error": f"Multiple contacts found for '{name}'. Please ask the user for clarification.",
            "matches": matches
        }

    match = contacts[0]
    return {
        "success": True,
        "name": match.name,
        "email": match.email,
        "nickname": match.nickname
    }


@mcp_tool(
    name="web_search",
    category="search",
    description=(
        "Performs a high-speed web search using various engines (Google, Scholar, News) "
        "to retrieve factual information, recent events, or academic papers."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query (e.g., 'latest AI news', 'Nvidia Q3 earnings').",
            },
            "engine": {
                "type": "string",
                "enum": ["google", "google_scholar", "google_news"],
                "description": (
                    "The search engine to use. "
                    "'google' for general web search, "
                    "'google_scholar' for academic papers, "
                    "'google_news' for recent news articles. "
                    "Defaults to 'google'."
                ),
                "default": "google",
            },
            "num_results": {
                "type": "integer",
                "description": "Number of results to return (default 10, max 100)",
                "default": 10,
            },
            "time_period": {
                "type": "string",
                "enum": ["d", "w", "m", "y"],
                "description": (
                    "Filter results by recency: "
                    "'d' = last day, 'w' = last week, 'm' = last month, 'y' = last year. "
                    "Omit for all-time results."
                ),
            },
        },
        "required": ["query"],
    },
)
async def tool_web_search(
    user_email: str,
    db,
    query: str,
    engine: str = "google",
    num_results: int = 10,
    time_period: Optional[str] = None,
) -> dict:
    from mcp_servers.tools.search_tools import web_search, WebSearchRequest
    req = WebSearchRequest(
        query=query,
        engine=engine,
        num_results=num_results,
        time_period=time_period,
    )
    return await web_search(req)

# Load Corporate Command Center Extensions late to register inside _TOOL_REGISTRY
import mcp_servers.core.command_center_wrappers
# ── Business & HR Tools ──────────────────────────────────────────────────────

@mcp_tool(
    name="create_hiring_workflow",
    category="hr",
    description=(
        "Decomposes a hiring request into a governed multi-step workflow. "
        "Use this when the user says they want to hire someone. "
        "Each step (Research, Offer, NDA, etc.) will appear in the user's Workflows tab for individual approval."
    ),
    provider="all",
    parameters={
        "type": "object",
        "properties": {
            "candidate_name": {"type": "string", "description": "Full name of the candidate"},
            "candidate_email": {"type": "string", "description": "Email of the candidate"},
            "role": {"type": "string", "description": "Job title/role"},
            "ctc": {"type": "string", "description": "Cost to Company / Salary details"},
        },
        "required": ["candidate_name", "candidate_email", "role", "ctc"],
    },
)
async def tool_create_hiring_workflow(
    user_email: str, db, candidate_name: str, candidate_email: str, role: str, ctc: str
) -> dict:
    from services.org_tools import create_hiring_workflow
    return await create_hiring_workflow(user_email, db, candidate_name, candidate_email, role, ctc)


@mcp_tool(
    name="add_contact",
    category="contacts",
    description="Add a person to the user's contacts book with their name, email, and optional role/nickname.",
    parameters={
        "type": "object",
        "properties": {
            "name":     {"type": "string", "description": "Full name of the contact"},
            "email":    {"type": "string", "description": "Email address of the contact"},
            "nickname": {"type": "string", "description": "Optional role, team, or nickname (e.g. 'Backend Engineer')"},
        },
        "required": ["name", "email"],
    },
    provider="all",
)
async def tool_add_contact(user_email: str, db, name: str, email: str, nickname: str = None) -> dict:
    from auth.models import User as UserModel
    from models import Contact, ContactCreate
    from sqlalchemy.exc import IntegrityError

    user = db.query(UserModel).filter(UserModel.email == user_email).first()
    if not user:
        return {"error": "User not found"}

    try:
        contact = Contact(
            user_id=user.id,
            name=name,
            email=email,
            nickname=nickname,
        )
        db.add(contact)
        db.commit()
        db.refresh(contact)
        return {"success": True, "contact_id": contact.id, "name": contact.name, "email": contact.email}
    except IntegrityError:
        db.rollback()
        return {"success": False, "note": f"Contact {email} already exists in your contacts."}
    except Exception as e:
        db.rollback()
        return {"error": str(e)}


@mcp_tool(
    name="create_sales_proposal_workflow",
    category="sales",
    description="Decomposes a Sales Proposal request into a governed multi-step workflow (Research, Deck, Pricing, Draft, Demo).",
    provider="all",
    parameters={
        "type": "object",
        "properties": {
            "client_name": {"type": "string", "description": "Name of the prospective client"},
            "product_name": {"type": "string", "description": "Product or service being pitched"},
            "deal_value": {"type": "string", "description": "Estimated deal size/value"},
        },
        "required": ["client_name", "product_name", "deal_value"],
    },
)
async def tool_create_sales_proposal_workflow(user_email: str, db, client_name: str, product_name: str, deal_value: str) -> dict:
    from services.org_tools import create_sales_proposal_workflow
    return await create_sales_proposal_workflow(user_email, db, client_name, product_name, deal_value)

@mcp_tool(
    name="create_content_campaign_workflow",
    category="content",
    description="Decomposes a Content Campaign request into a governed multi-step workflow (SEO, Blog, Social, Image).",
    provider="all",
    parameters={
        "type": "object",
        "properties": {
            "topic": {"type": "string", "description": "Main topic or theme of the campaign"},
            "channels": {"type": "array", "items": {"type": "string"}, "description": "Target platforms (e.g., LinkedIn, Twitter)"},
        },
        "required": ["topic", "channels"],
    },
)
async def tool_create_content_campaign_workflow(user_email: str, db, topic: str, channels: list) -> dict:
    from services.org_tools import create_content_campaign_workflow
    return await create_content_campaign_workflow(user_email, db, topic, channels)

@mcp_tool(
    name="create_product_listing_workflow",
    category="ecommerce",
    description="Decomposes a Product Listing request into a governed multi-step workflow (Competitors, Tags, Desc, CSV).",
    provider="all",
    parameters={
        "type": "object",
        "properties": {
            "product_name": {"type": "string", "description": "Name of the product"},
            "store_type": {"type": "string", "description": "Platform (e.g., Shopify, Amazon)"},
        },
        "required": ["product_name", "store_type"],
    },
)
async def tool_create_product_listing_workflow(user_email: str, db, product_name: str, store_type: str) -> dict:
    from services.org_tools import create_product_listing_workflow
    return await create_product_listing_workflow(user_email, db, product_name, store_type)

@mcp_tool(
    name="create_qbr_report_workflow",
    category="ops",
    description="Decomposes a QBR Report request into a governed multi-step workflow (KPIs, Stats, Summary, Deck, Invite).",
    provider="all",
    parameters={
        "type": "object",
        "properties": {
            "quarter": {"type": "string", "description": "Target quarter (e.g., Q3 2024)"},
            "department": {"type": "string", "description": "Department name"},
        },
        "required": ["quarter", "department"],
    },
)
async def tool_create_qbr_report_workflow(user_email: str, db, quarter: str, department: str) -> dict:
    from services.org_tools import create_qbr_report_workflow
    return await create_qbr_report_workflow(user_email, db, quarter, department)

# ── LinkedIn Tools ───────────────────────────────────────────────────────────
import mcp_servers.tools.linkedin_tools  # registers get_linkedin_profile, post_to_linkedin, linkedin_comment_on_post, linkedin_like_post

# ── Browser / Computer Use Tools ─────────────────────────────────────────────
import mcp_servers.tools.playwright_tools  # registers browser_navigate, browser_click, browser_type, browser_extract, browser_screenshot, browser_close
