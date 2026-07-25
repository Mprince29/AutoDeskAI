"""
HR / Org workflow tools.

Design principle - the tool is a COMMIT, not a DECISION-MAKER.
All content (offer letter body, NDA text, meeting time) must be gathered by the agent
through conversation and knowledge-base lookup BEFORE this tool is called.
The tool only persists the already-confirmed values into a WorkflowInstance.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from loguru import logger
from mcp_servers.core.mcp_tools import mcp_tool


def _parse_meeting_time(meeting_time: str, duration_minutes: int = 30) -> tuple[str, str]:
    """Parse a user-confirmed date/time string into RFC3339 (start, end) UTC strings.

    Accepts:
      - ISO 8601 with TZ:  '2026-04-20T15:00:00Z'  /  '2026-04-20T15:00:00+05:30'
      - ISO 8601 no TZ:    '2026-04-20T15:00:00'   →  appends 'Z'
      - Date-only:         '2026-04-20'             →  that date at 10:00 UTC
    Raises ValueError if the string cannot be parsed so the agent can re-ask the user.
    """
    s = meeting_time.strip()
    if len(s) == 10 and s[4] == "-":           # date-only
        s += "T10:00:00Z"
    elif "T" in s and "+" not in s[10:] and not s.endswith("Z"):
        s += "Z"
    start = datetime.fromisoformat(s.replace("Z", "+00:00"))
    end = start + timedelta(minutes=duration_minutes)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return start.strftime(fmt), end.strftime(fmt)


@mcp_tool(
    name="register_new_hire",
    description=(
        "HR tool: creates a governed hiring WorkflowInstance with 6 steps - "
        "create offer letter document, create NDA document, "
        "send offer letter email with PDF attachment, send NDA email with PDF attachment, "
        "invite to Slack, schedule intro call. "
        "Each step requires human approval before execution. "
        "IMPORTANT: the agent MUST gather all parameters conversationally and via knowledge-base "
        "lookup BEFORE calling this tool. Never call it with invented or placeholder content."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Full name of the candidate.",
            },
            "email": {
                "type": "string",
                "description": "Candidate's email address (confirmed by user).",
            },
            "role": {
                "type": "string",
                "description": "Job title / role being offered.",
            },
            "ctc": {
                "type": "string",
                "description": "Compensation package confirmed by user, e.g. '$120,000/yr'.",
            },
            "meeting_time": {
                "type": "string",
                "description": (
                    "Date and time for the intro call confirmed by the user. "
                    "ISO 8601 preferred ('2026-04-20T15:00:00Z'). "
                    "Date-only also accepted ('2026-04-20' → 10:00 UTC)."
                ),
            },
            "offer_letter_content": {
                "type": "string",
                "description": (
                    "Full offer letter document content (will be saved as a Google Doc and "
                    "attached as a PDF to the email). Include all formal offer details: "
                    "role, CTC, start date, benefits, joining instructions. "
                    "Must come from the company's knowledge-base template or user-confirmed content. "
                    "Never invent this - it is a legal document."
                ),
            },
            "nda_content": {
                "type": "string",
                "description": (
                    "Full NDA document text (will be saved as a Google Doc and "
                    "attached as a PDF to a separate email). "
                    "Must come from the company's knowledge-base template or user-confirmed content. "
                    "Never invent this - it is a legal document."
                ),
            },
            "meeting_duration_minutes": {
                "type": "integer",
                "description": "Duration of the intro call in minutes (default 30).",
                "default": 30,
            },
        },
        "required": [
            "name", "email", "role", "ctc",
            "meeting_time", "offer_letter_content", "nda_content",
        ],
    },
    provider="all",
    category="hr",
    approval_required=True,
)
async def tool_register_new_hire(
    user_email: str,
    db: Any,
    name: str,
    email: str,
    role: str,
    ctc: str,
    meeting_time: str,
    offer_letter_content: str,
    nda_content: str,
    meeting_duration_minutes: int = 30,
) -> Dict[str, Any]:
    logger.info(f"Creating hiring workflow for {name} ({role})")

    try:
        start_iso, end_iso = _parse_meeting_time(meeting_time, meeting_duration_minutes)
    except Exception as exc:
        return {
            "error": (
                f"Could not parse meeting_time '{meeting_time}': {exc}. "
                "Ask the user to provide the date and time again in a clear format, "
                "e.g. 'April 20 at 3 PM' or '2026-04-20T15:00:00Z'."
            )
        }

    channel = f"team-{role.lower().replace(' ', '-')}"

    # Steps are ordered: create docs first, then send emails with attachments.
    # __OFFER_LETTER_DOC_ID__ and __NDA_DOC_ID__ are placeholder tokens that
    # workflow_routes._execute_step_in_background resolves at execution time using
    # the file_id returned by the completed create_document steps.
    steps = [
        {
            "id": "offer_letter_doc",
            "description": f"📄 Create Offer Letter document for {name}",
            "action": "create_document",
            "tool_input": {
                "title": f"Offer Letter – {name} ({role})",
                "content": offer_letter_content,
            },
        },
        {
            "id": "nda_doc",
            "description": f"🛡️ Create NDA document for {name}",
            "action": "create_document",
            "tool_input": {
                "title": f"Mutual NDA – {name}",
                "content": nda_content,
            },
        },
        {
            "id": "offer_email",
            "description": f"📧 Send Offer Letter to {name} (PDF attached)",
            "action": "send_email",
            "tool_input": {
                "to": email,
                "subject": f"Offer Letter – {role} position",
                "body": (
                    f"Dear {name},\n\n"
                    f"We are delighted to extend this offer of employment for the role of {role} "
                    f"with a CTC of {ctc}.\n\n"
                    f"Please find the formal offer letter attached as a PDF."
                    f"__OFFER_LETTER_LINK_LINE__"
                    f"Kindly review and revert within 7 days of receipt.\n\n"
                    f"We look forward to welcoming you to the team!\n\n"
                    f"Warm regards"
                ),
                # Resolved at execution time from the completed create_document step above
                "attachment_doc_ids": ["__OFFER_LETTER_DOC_ID__"],
            },
        },
        {
            "id": "nda_email",
            "description": f"📧 Send NDA to {name} (PDF attached)",
            "action": "send_email",
            "tool_input": {
                "to": email,
                "subject": f"Non-Disclosure Agreement – {role}",
                "body": (
                    f"Dear {name},\n\n"
                    f"Please find attached the Non-Disclosure Agreement required before your joining."
                    f"__NDA_LINK_LINE__"
                    f"Kindly review, sign, and return a copy at your earliest convenience.\n\n"
                    f"Best regards"
                ),
                # Resolved at execution time from the completed create_document step above
                "attachment_doc_ids": ["__NDA_DOC_ID__"],
            },
        },
        {
            "id": "slack_onboarding",
            "description": f"💬 Invite {name} to #{channel} on Slack",
            "action": "slack_invite_to_workspace",
            "tool_input": {
                "invitee_email": email,
                "channels": [channel],
                "welcome_message": f"Please welcome {name} who is joining us as {role}! 🎉",
            },
        },
        {
            "id": "intro_call",
            "description": f"📅 Schedule Intro Call with {name}",
            "action": "create_calendar_event",
            "tool_input": {
                "summary": f"Intro Call with {name}",
                "description": f"Welcome call for {name} joining as {role}.",
                "start_time": start_iso,
                "end_time": end_iso,
                "attendees": [email],
            },
        },
    ]

    plan = {
        "candidate": {"name": name, "email": email, "role": role, "ctc": ctc},
        "steps": steps,
        "status": "awaiting_review",
        "requires_human": True,
    }

    from auth.models import User
    from models import WorkflowInstance, WorkflowStep

    user = db.query(User).filter(User.email == user_email).first()
    if not user:
        return {"error": "User not found"}

    wf = WorkflowInstance(
        user_id=user.id,
        goal=f"Onboard {name} as {role}",
        status="awaiting_review",
        plan_json=plan,
    )
    db.add(wf)
    db.flush()

    for i, step in enumerate(steps):
        db.add(WorkflowStep(
            workflow_id=wf.id,
            step_number=i + 1,
            description=step["description"],
            tool_name=step["action"],        # exact MCP registry name
            tool_input=step["tool_input"],   # fully populated, no placeholders
            status="pending",
            requires_approval=True,
        ))

    db.commit()

    return {
        "message": (
            f"Hiring workflow created for {name}. "
            "Review and authorize each step in the chat."
        ),
        "workflow_id": wf.id,
        "steps": len(steps),
    }
