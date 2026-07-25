"""
Escalation Service — auto-escalate high-intent contacts to human reps.

When a contact's intent_score crosses ESCALATION_THRESHOLD:
  1. Mark contact.escalated = True
  2. Pause all active sequence enrollments
  3. Create EscalationEvent record
  4. Send email notification (via Gmail or SMTP fallback)
  5. Post to Slack webhook (if SLACK_WEBHOOK_URL is configured)
"""
import asyncio
import json
import logging
import os
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ESCALATION_THRESHOLD = int(os.getenv("ESCALATION_THRESHOLD", "85"))
ESCALATION_EMAIL = os.getenv("ESCALATION_NOTIFY_EMAIL", "")
SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")


def build_context_brief(contact, signals: list) -> str:
    """Build a rich text brief for human review."""
    dossier = contact.dossier or {}
    pain_points = dossier.get("pain_points") or []
    icebreakers = dossier.get("icebreakers") or []
    recent_signals = signals[-5:] if signals else []

    signal_lines = "\n".join(
        f"  - [{s.get('type', 'signal')}] {s.get('title', s.get('metadata', {}).get('title', 'Signal'))}"
        for s in recent_signals
    )

    brief_lines = [
        f"HIGH-INTENT CONTACT ESCALATION",
        f"{'='*50}",
        f"Contact:      {contact.contact_name}",
        f"Company:      {contact.company}",
        f"Role:         {contact.role or 'N/A'}",
        f"Email:        {contact.contact_email or 'N/A'}",
        f"Intent Score: {contact.intent_score} / 100",
        f"Industry:     {contact.company_industry or 'N/A'}",
        f"Size:         {contact.company_size or 'N/A'}",
        f"Location:     {contact.company_location or 'N/A'}",
        f"",
        f"Recent Signals:",
        signal_lines or "  (none recorded)",
        f"",
    ]

    if pain_points:
        brief_lines += [
            "Pain Points:",
            "\n".join(f"  - {p}" for p in pain_points[:3]),
            "",
        ]

    if icebreakers:
        brief_lines += [
            "Suggested Icebreakers:",
            "\n".join(f"  - {ic}" for ic in icebreakers[:2]),
            "",
        ]

    brief_lines += [
        "Recommended Action:",
        "  This contact has shown strong buying intent. Recommend a personal outreach",
        "  call or direct email from a senior rep within 24 hours.",
        f"{'='*50}",
    ]

    return "\n".join(brief_lines)


async def _send_email_notification(
    user_email: str, contact_name: str, context_brief: str
) -> bool:
    """Send escalation notification email via Gmail OAuth or SMTP fallback."""
    if not ESCALATION_EMAIL:
        return False
    try:
        from mcp_servers.core.google_auth import GoogleAuthManager
        from services.bulk_mailer import send_one_tracked

        subject = f"[ESCALATION] High-intent contact: {contact_name}"
        html_body = (
            f"<pre style='font-family:monospace;font-size:13px;'>"
            f"{context_brief}"
            f"</pre>"
        )

        send_result = await send_one_tracked(
            user_email=user_email,
            to_email=ESCALATION_EMAIL,
            subject=subject,
            html_body=html_body,
        )
        return send_result["ok"]
    except Exception as e:
        logger.warning(f"Escalation email notification failed: {e}")
        return False


def _post_slack(context_brief: str, contact_name: str) -> bool:
    """Post escalation notification to Slack webhook."""
    if not SLACK_WEBHOOK_URL:
        return False
    try:
        payload = json.dumps({
            "text": f":rotating_light: *High-intent contact escalation: {contact_name}*",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            f":rotating_light: *High-intent contact escalation*\n"
                            f"*{contact_name}* has reached intent score threshold.\n"
                            f"```{context_brief[:1500]}```"
                        ),
                    },
                }
            ],
        }).encode()
        req = urllib.request.Request(
            SLACK_WEBHOOK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        logger.warning(f"Slack escalation notification failed: {e}")
        return False


async def check_and_escalate(contact, db: Session, user_email: str) -> bool:
    """
    Called whenever intent_score is updated.
    If score >= threshold and not already escalated:
      1. Set contact.escalated = True, escalated_at = now()
      2. Pause all active sequence enrollments for this contact
      3. Create EscalationEvent record
      4. Send email + Slack notifications
      5. Return True if newly escalated
    """
    if not contact or contact.escalated:
        return False

    if contact.intent_score < ESCALATION_THRESHOLD:
        return False

    try:
        from auth.models import SequenceEnrollment, EscalationEvent, SignalEvent

        now = datetime.now(timezone.utc)
        contact.escalated = True
        contact.escalated_at = now

        # Gather recent signals for the brief
        signals = [
            {
                "type": s.signal_type,
                "title": (s.signal_metadata or {}).get("title", ""),
                "metadata": s.signal_metadata or {},
            }
            for s in db.query(SignalEvent)
            .filter_by(contact_id=contact.id)
            .order_by(SignalEvent.created_at.desc())
            .limit(10)
            .all()
        ]

        context_brief = build_context_brief(contact, signals)

        # Pause all active enrollments
        active_enrollments = db.query(SequenceEnrollment).filter_by(
            user_email=user_email,
            status="active",
        ).filter(
            SequenceEnrollment.recipient_email == contact.contact_email
        ).all()

        for enrollment in active_enrollments:
            enrollment.status = "paused"
            enrollment.pause_reason = "escalation"

        # Create escalation event record
        event = EscalationEvent(
            contact_id=contact.id,
            user_email=user_email,
            intent_score_at_escalation=contact.intent_score,
            context_brief=context_brief,
            notified_email=False,
            notified_slack=False,
            human_took_over=False,
        )
        db.add(event)
        db.flush()  # get event.id before notifications

        # Send notifications
        email_sent = await _send_email_notification(user_email, contact.contact_name, context_brief)
        slack_sent = await asyncio.to_thread(_post_slack, context_brief, contact.contact_name)

        event.notified_email = email_sent
        event.notified_slack = slack_sent

        db.commit()
        logger.info(
            f"Escalated contact {contact.id} ({contact.contact_name}) "
            f"score={contact.intent_score} | email={email_sent} | slack={slack_sent}"
        )
        return True

    except Exception as e:
        logger.error(f"check_and_escalate failed for contact {contact.id}: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return False
