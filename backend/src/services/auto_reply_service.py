"""
Auto-Reply Service

Handles the lifecycle of pending auto-replies:
  - Draft generation via LLM when a new email arrives
  - Persisting the PendingAutoReply row
  - Sending the reply on deadline (called by the scheduler pulse)
  - Cancellation by the user within the 2-minute window

The feature is OFF by default.  Users must explicitly enable it via
PUT /api/proactive/auto-reply/settings { "enabled": true } - which
surfaces a danger modal on the frontend before the API call is made.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger
from sqlalchemy.orm import Session


# ── Draft generation ──────────────────────────────────────────────────────────

async def generate_auto_reply_draft(
    original_subject: str,
    sender_email: str,
    snippet: str,
) -> str:
    """Generate a concise, professional auto-reply draft using the LLM."""
    import litellm
    import os

    model = os.getenv("AUTO_REPLY_MODEL", "gemini/gemini-2.0-flash")
    prompt = (
        f"You received an email from {sender_email} with subject: '{original_subject}'.\n"
        f"Snippet: {snippet[:400]}\n\n"
        "Write a short, professional auto-reply (2-3 sentences) acknowledging receipt "
        "and letting them know you will respond shortly. Do NOT promise a specific time. "
        "Return only the email body - no subject, no greeting label, no sign-off instructions."
    )
    try:
        resp = await litellm.acompletion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=120,
            temperature=0.4,
        )
        return resp.choices[0].message.content.strip()
    except Exception as exc:
        logger.error(f"auto_reply draft generation failed: {exc}")
        return "Thank you for your email. I have received your message and will get back to you shortly."


# ── Persist pending reply ─────────────────────────────────────────────────────

def create_pending_auto_reply(
    user_email: str,
    thread_id: Optional[str],
    sender_email: str,
    subject: str,
    draft_body: str,
    db: Session,
    window_seconds: int = 120,
):
    """Persist a PendingAutoReply row with a send_deadline 2 minutes from now."""
    from auth.models import PendingAutoReply

    deadline = datetime.now(timezone.utc) + timedelta(seconds=window_seconds)
    row = PendingAutoReply(
        user_email=user_email,
        thread_id=thread_id,
        sender_email=sender_email,
        subject=subject,
        draft_body=draft_body,
        send_deadline=deadline,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ── Send the reply ────────────────────────────────────────────────────────────

async def send_auto_reply(reply_id: int, db: Session) -> bool:
    """Send the auto-reply email and mark the row as sent. Returns True on success."""
    from auth.models import PendingAutoReply
    from mcp_servers.core.mcp_tools import execute_tool
    from services.security import GLOBAL_SIGNER

    row = db.query(PendingAutoReply).filter(PendingAutoReply.id == reply_id).first()
    if not row or row.status != "pending":
        return False

    sig = GLOBAL_SIGNER.generate_token("agent_chat", {}, row.user_email)
    result = await execute_tool(
        "send_email",
        {
            "user_email": row.user_email,
            "to": row.sender_email,
            "subject": f"Re: {row.subject}",
            "body": row.draft_body,
            "_security_signature": sig,
        },
        row.user_email,
        db,
    )
    if result.get("error"):
        logger.error(f"auto-reply send failed for id={reply_id}: {result['error']}")
        return False

    row.status = "sent"
    row.sent_at = datetime.now(timezone.utc)
    db.commit()
    logger.info(f"Auto-reply sent: id={reply_id} → {row.sender_email}")
    return True


