"""
Draft-before-save tools — document, spreadsheet, and presentation.

Flow:
  1. Agent calls draft_document / draft_spreadsheet / draft_presentation
     → content stored in content_drafts table (status=pending)
     → returns [DRAFT:<uuid>] marker; frontend renders inline preview card

  2. User asks for edits → agent calls update_draft with revised content
     → draft updated in DB; frontend preview card refreshes automatically

  3. User says "save it" → agent calls save_draft
     → actual Google Doc / Sheet / Slides created
     → draft status set to "saved"; Drive URL returned
"""

import json
import uuid as _uuid

from loguru import logger
from mcp_servers.core.mcp_tools import mcp_tool


# ── helpers ───────────────────────────────────────────────────────────────────

def _get_draft(db, draft_id: str):
    from auth.models import ContentDraft
    return db.query(ContentDraft).filter(ContentDraft.id == draft_id).first()


def _draft_marker(draft_id: str, draft_type: str, title: str) -> str:
    return f"[DRAFT:{draft_id}:{draft_type}:{title}]"


# ── draft_document ────────────────────────────────────────────────────────────

@mcp_tool(
    name="draft_document",
    category="content_drafts",
    description=(
        "Create an in-chat draft document for the user to review before saving. "
        "Use instead of create_document so the user can read, request edits, and "
        "only save when satisfied. Returns a DRAFT marker that renders as a preview card. "
        "Supported formats: pdf, docx, txt (default docx)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Document title"},
            "content": {
                "type": "string",
                "description": "Full document content in Markdown (min 1000 words for reports)",
            },
            "format": {
                "type": "string",
                "enum": ["docx", "pdf", "txt"],
                "description": "Target file format when the user saves. Defaults to docx.",
            },
        },
        "required": ["title", "content"],
    },
    provider="all",
    credentials_required=False,
)
async def tool_draft_document(
    user_email: str, db, title: str, content: str, format: str = "docx"
) -> dict:
    from auth.models import ContentDraft
    draft_id = str(_uuid.uuid4())
    draft = ContentDraft(
        id=draft_id,
        user_email=user_email,
        draft_type="document",
        title=title,
        content=content,
        fmt=format,
        status="pending",
    )
    db.add(draft)
    db.commit()
    marker = _draft_marker(draft_id, "document", title)
    return {
        "draft_id": draft_id,
        "marker": marker,
        "message": (
            f"{marker}\n\n"
            "I've prepared your document above. Take a look — let me know if you'd like "
            "any changes, or say **'save it'** and I'll upload it to Google Drive."
        ),
    }


# ── draft_spreadsheet ─────────────────────────────────────────────────────────

@mcp_tool(
    name="draft_spreadsheet",
    category="content_drafts",
    description=(
        "Create an in-chat draft spreadsheet for the user to review before saving. "
        "Use instead of create_spreadsheet so the user can check the data and request "
        "changes before it is saved to Google Sheets. "
        "content must be CSV-formatted rows (first row = headers)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Spreadsheet title"},
            "content": {
                "type": "string",
                "description": "CSV-formatted data: first line = column headers, each subsequent line = one row",
            },
        },
        "required": ["title", "content"],
    },
    provider="all",
    credentials_required=False,
)
async def tool_draft_spreadsheet(
    user_email: str, db, title: str, content: str
) -> dict:
    from auth.models import ContentDraft
    draft_id = str(_uuid.uuid4())
    draft = ContentDraft(
        id=draft_id,
        user_email=user_email,
        draft_type="spreadsheet",
        title=title,
        content=content,
        fmt="xlsx",
        status="pending",
    )
    db.add(draft)
    db.commit()
    marker = _draft_marker(draft_id, "spreadsheet", title)
    return {
        "draft_id": draft_id,
        "marker": marker,
        "message": (
            f"{marker}\n\n"
            "Here's your spreadsheet draft. Review the data — tell me what to change, "
            "or say **'save it'** to upload to Google Sheets."
        ),
    }


# ── draft_presentation ────────────────────────────────────────────────────────

@mcp_tool(
    name="draft_presentation",
    category="content_drafts",
    description=(
        "Create an in-chat draft presentation for the user to review before saving. "
        "Use instead of create_presentation so the user can check every slide and request "
        "edits before it is created in Google Slides. "
        "slides must be a JSON array of slide objects, each with: "
        "layout, title_text, body_text (newline-separated bullets), image_query, speaker_notes."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Presentation title"},
            "slides": {
                "type": "array",
                "description": "Array of slide objects",
                "items": {
                    "type": "object",
                    "properties": {
                        "layout": {"type": "string"},
                        "title_text": {"type": "string"},
                        "body_text": {"type": "string"},
                        "image_query": {"type": "string"},
                        "speaker_notes": {"type": "string"},
                    },
                },
            },
        },
        "required": ["title", "slides"],
    },
    provider="all",
    credentials_required=False,
)
async def tool_draft_presentation(
    user_email: str, db, title: str, slides: list
) -> dict:
    from auth.models import ContentDraft
    draft_id = str(_uuid.uuid4())
    draft = ContentDraft(
        id=draft_id,
        user_email=user_email,
        draft_type="presentation",
        title=title,
        content=json.dumps(slides, ensure_ascii=False),
        fmt=None,
        status="pending",
    )
    db.add(draft)
    db.commit()
    marker = _draft_marker(draft_id, "presentation", title)
    return {
        "draft_id": draft_id,
        "marker": marker,
        "message": (
            f"{marker}\n\n"
            f"Here's your **{len(slides)}-slide** presentation draft. Review each slide — "
            "ask me to change any content, or say **'save it'** to create it in Google Slides."
        ),
    }


# ── update_draft ──────────────────────────────────────────────────────────────

@mcp_tool(
    name="update_draft",
    category="content_drafts",
    description=(
        "Update the content of an existing in-chat draft after the user requests changes. "
        "Call this whenever the user asks to edit, modify, or revise a draft_document, "
        "draft_spreadsheet, or draft_presentation. "
        "Returns an updated DRAFT marker so the frontend preview refreshes."
    ),
    parameters={
        "type": "object",
        "properties": {
            "draft_id": {"type": "string", "description": "The UUID of the draft to update"},
            "content": {
                "type": "string",
                "description": "The full updated content (markdown / CSV / JSON slides array as string)",
            },
            "title": {
                "type": "string",
                "description": "Optional updated title",
            },
        },
        "required": ["draft_id", "content"],
    },
    provider="all",
    credentials_required=False,
)
async def tool_update_draft(
    user_email: str, db, draft_id: str, content: str, title: str = None
) -> dict:
    from sqlalchemy.orm.attributes import flag_modified
    draft = _get_draft(db, draft_id)
    if not draft:
        return {"error": f"Draft {draft_id} not found."}
    if draft.user_email != user_email:
        return {"error": "Not authorised to edit this draft."}
    if draft.status == "saved":
        return {"error": "This draft has already been saved. Create a new draft to make changes."}

    draft.content = content
    if title:
        draft.title = title
    flag_modified(draft, "content")
    db.commit()

    marker = _draft_marker(draft_id, draft.draft_type, draft.title)
    return {
        "draft_id": draft_id,
        "marker": marker,
        "message": (
            f"{marker}\n\n"
            "Done — I've updated the draft above. Review it and let me know if "
            "you'd like more changes, or say **'save it'** when you're happy."
        ),
    }


# ── save_draft ────────────────────────────────────────────────────────────────

@mcp_tool(
    name="save_draft",
    category="content_drafts",
    description=(
        "Save a reviewed draft to its final destination. "
        "Call this ONLY when the user explicitly says 'save it', 'looks good', "
        "'go ahead and save', 'upload it', or equivalent confirmation. "
        "For documents → saves to Google Drive (DOCX/PDF/TXT download link). "
        "For spreadsheets → creates a Google Sheet. "
        "For presentations → creates a Google Slides deck. "
        "Returns the final file URL."
    ),
    parameters={
        "type": "object",
        "properties": {
            "draft_id": {"type": "string", "description": "The UUID of the draft to save"},
        },
        "required": ["draft_id"],
    },
    provider="google",
    credentials_required=True,
)
async def tool_save_draft(user_email: str, db, draft_id: str) -> dict:
    draft = _get_draft(db, draft_id)
    if not draft:
        return {"error": f"Draft {draft_id} not found."}
    if draft.user_email != user_email:
        return {"error": "Not authorised to save this draft."}
    if draft.status == "saved":
        return {"error": "This draft has already been saved."}

    try:
        result = await _persist_draft(draft, user_email, db)
        draft.status = "saved"
        draft.saved_url = result.get("url")
        db.commit()
        return result
    except Exception as exc:
        logger.error(f"save_draft failed for {draft_id}: {exc}")
        return {"error": f"Failed to save: {exc}"}


async def _persist_draft(draft, user_email: str, db) -> dict:
    """Route to the right backend based on draft_type."""
    if draft.draft_type == "document":
        from services.google_workspace_service import GoogleWorkspaceService
        svc = GoogleWorkspaceService(user_email, db)
        result = await svc.create_document(draft.title, draft.content)
        return {
            "success": True,
            "draft_type": "document",
            "title": draft.title,
            "url": result.get("url") or result.get("document_url") or result.get("web_view_link"),
            "message": f" Your document **{draft.title}** has been saved to Google Drive.",
        }

    elif draft.draft_type == "spreadsheet":
        from mcp_servers.tools.sheets_tools import create_spreadsheet, CreateSpreadsheetRequest
        lines = [ln for ln in draft.content.splitlines() if ln.strip()]
        rows = []
        for line in lines:
            if "\t" in line:
                rows.append(line.split("\t"))
            else:
                rows.append([c.strip() for c in line.split(",")])
        req = CreateSpreadsheetRequest(user_email=user_email, title=draft.title, initial_data=rows)
        result = await create_spreadsheet(req)
        return {
            "success": True,
            "draft_type": "spreadsheet",
            "title": draft.title,
            "url": result.get("url") or result.get("spreadsheet_url") or result.get("webViewLink"),
            "message": f" Your spreadsheet **{draft.title}** has been saved to Google Sheets.",
        }

    elif draft.draft_type == "presentation":
        from mcp_servers.tools.slides_tools import create_presentation, CreatePresentationRequest, SlideContent
        slides_data = json.loads(draft.content)
        slides = [SlideContent(**s) for s in slides_data]
        req = CreatePresentationRequest(user_email=user_email, title=draft.title, slides=slides)
        result = await create_presentation(req)
        return {
            "success": True,
            "draft_type": "presentation",
            "title": draft.title,
            "url": result.get("url"),
            "slide_count": result.get("slide_count"),
            "message": (
                f" Your presentation **{draft.title}** ({result.get('slide_count')} slides) "
                "has been created in Google Slides."
            ),
        }
    else:
        raise ValueError(f"Unknown draft_type: {draft.draft_type}")
