"""
Re-engagement Service — 30/60/90 day queue with outreach memory to prevent repeated angles.

Called when a sequence enrollment completes without a reply.
Schedules ReengagementEntry rows at now+30d, now+60d, now+90d.
Each re-engagement pulse picks due entries, avoids used angles,
drafts a fresh email, and records the angle in OutreachMemory.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

REENGAGEMENT_INTERVALS = [30, 60, 90]  # days after sequence completion

HOOK_THEMES = [
    "industry_news",
    "new_case_study",
    "product_update",
    "competitor_move",
]


async def schedule_reengagement(contact_id: int, user_email: str, db: Session) -> None:
    """
    Called after a full sequence completes with no reply.
    Creates ReengagementEntry rows at now+30d, now+60d, now+90d.
    Each entry gets a different hook_theme to prevent repetition.
    """
    from auth.models import ReengagementEntry

    now = datetime.now(timezone.utc)
    try:
        for i, days in enumerate(REENGAGEMENT_INTERVALS):
            theme = HOOK_THEMES[i % len(HOOK_THEMES)]
            entry = ReengagementEntry(
                contact_id=contact_id,
                user_email=user_email,
                scheduled_at=now + timedelta(days=days),
                hook_theme=theme,
                status="pending",
            )
            db.add(entry)
        db.commit()
        logger.info(
            f"Scheduled re-engagement for contact_id={contact_id} at "
            f"+30d, +60d, +90d"
        )
    except Exception as e:
        logger.error(f"schedule_reengagement failed for contact {contact_id}: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def record_outreach_memory(
    contact_id: int,
    user_email: str,
    angle: str,
    message_summary: str,
    db: Session,
    channel: str = "email",
) -> None:
    """Append to OutreachMemory so future outreach avoids this angle."""
    from auth.models import OutreachMemory
    try:
        db.add(OutreachMemory(
            contact_id=contact_id,
            user_email=user_email,
            angle=angle[:200],
            message_summary=message_summary,
            channel=channel,
        ))
        db.commit()
    except Exception as e:
        logger.warning(f"record_outreach_memory failed for contact {contact_id}: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def get_used_angles(contact_id: int, user_email: str, db: Session) -> list[str]:
    """Return all angles/themes ever used for this contact."""
    from auth.models import OutreachMemory
    try:
        rows = (
            db.query(OutreachMemory)
            .filter_by(contact_id=contact_id, user_email=user_email)
            .order_by(OutreachMemory.used_at.desc())
            .all()
        )
        return [r.angle for r in rows]
    except Exception as e:
        logger.warning(f"get_used_angles failed: {e}")
        return []


async def _draft_reengagement_email(
    contact_name: str,
    company: str,
    role: Optional[str],
    hook_theme: str,
    used_angles: list[str],
    dossier: Optional[dict],
) -> tuple[str, str, str]:
    """
    LLM-draft a re-engagement email.
    Returns (subject, body, angle_used).
    """
    from utils.llm_router import agenerate, get_text

    dossier = dossier or {}
    pain_points = dossier.get("pain_points") or []
    recent_signals = dossier.get("signals") or dossier.get("recent_signals") or []

    used_str = (
        "Previously used angles (DO NOT repeat these):\n" +
        "\n".join(f"  - {a}" for a in used_angles[:10])
        if used_angles
        else "No previous outreach recorded."
    )

    theme_guidance = {
        "industry_news": (
            "Use a recent industry trend or news item relevant to their sector as the hook. "
            "Open with an insight about their industry, not about our product."
        ),
        "new_case_study": (
            "Reference a recent customer success story or case study from a company "
            "similar to theirs — same industry, size, or problem space."
        ),
        "product_update": (
            "Lead with a new capability, integration, or improvement that directly addresses "
            "a known pain point for this type of company."
        ),
        "competitor_move": (
            "Open with a relevant competitive landscape observation — something changing "
            "in their market that creates urgency or a new opportunity for them."
        ),
    }.get(hook_theme, "Open with a genuinely relevant insight about their business or market.")

    context = "\n".join(filter(None, [
        f"Contact: {contact_name}",
        f"Company: {company}",
        f"Role: {role}" if role else None,
        f"Pain points: {'; '.join(pain_points[:3])}" if pain_points else None,
        f"Recent signals: {'; '.join(str(s) for s in recent_signals[:3])}" if recent_signals else None,
    ]))

    prompt = f"""Write a short re-engagement email (3-4 sentences max) for a contact who went cold.

Contact context:
{context}

Hook theme: {hook_theme}
{theme_guidance}

{used_str}

Requirements:
- First sentence is the unique hook (industry insight, case study ref, or competitive signal)
- Do NOT pitch the product upfront — build curiosity first
- End with a single low-friction CTA (15-min call, quick question, etc.)
- Natural, human tone — not corporate or salesy

Respond with JSON only:
{{"subject": "...", "body": "...", "angle": "one-sentence description of the unique angle used"}}"""

    try:
        resp = await agenerate(
            role="drafter",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=600,
        )
        import re
        import json as _json
        raw = get_text(resp).strip()
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end > start:
            raw = raw[start:end + 1]
        data = _json.loads(raw)
        return (
            data.get("subject", f"Re-connecting with {company}"),
            data.get("body", ""),
            data.get("angle", hook_theme),
        )
    except Exception as e:
        logger.warning(f"Re-engagement draft failed: {e}")
        subject = f"Quick thought about {company}"
        body = (
            f"Hi {contact_name.split()[0] if contact_name else 'there'},\n\n"
            f"I wanted to reconnect — we've had a few developments since we last spoke "
            f"that might be relevant to what you're working on at {company}.\n\n"
            f"Would you be open to a quick 15-minute call to catch up?\n\nBest,"
        )
        return subject, body, hook_theme


async def reengagement_pulse(db: Session) -> None:
    """
    APScheduler job — runs every hour.
    Finds ReengagementEntry rows where scheduled_at <= now and status='pending'.
    For each:
      1. Check OutreachMemory — get all angles/themes already used
      2. Generate a fresh hook that DOES NOT repeat any used angle
      3. Draft a re-engagement email
      4. Send directly via bulk_mailer
      5. Mark ReengagementEntry status='sent'
      6. Append used angle to OutreachMemory
    """
    from auth.models import ReengagementEntry, SalesContact

    now = datetime.now(timezone.utc)
    try:
        due_entries = (
            db.query(ReengagementEntry)
            .filter(
                ReengagementEntry.status == "pending",
                ReengagementEntry.scheduled_at <= now,
            )
            .limit(50)
            .all()
        )

        if not due_entries:
            return

        logger.info(f"Re-engagement pulse: {len(due_entries)} due entries")

        for entry in due_entries:
            try:
                contact = db.query(SalesContact).filter_by(
                    id=entry.contact_id, user_email=entry.user_email
                ).first()
                if not contact:
                    entry.status = "cancelled"
                    db.commit()
                    continue

                # Skip if contact has no email
                if not contact.contact_email:
                    entry.status = "cancelled"
                    db.commit()
                    logger.info(f"Re-engagement entry {entry.id}: no email, cancelled")
                    continue

                used_angles = get_used_angles(entry.contact_id, entry.user_email, db)

                subject, body, angle_used = await _draft_reengagement_email(
                    contact_name=contact.contact_name,
                    company=contact.company,
                    role=contact.role,
                    hook_theme=entry.hook_theme or "industry_news",
                    used_angles=used_angles,
                    dossier=contact.dossier,
                )

                # Send email
                from services.bulk_mailer import send_one_tracked
                base_url = os.getenv("BASE_URL", "http://localhost:8000")
                html_body = body.replace("\n", "<br>")

                send_result = await send_one_tracked(
                    user_email=entry.user_email,
                    to_email=contact.contact_email,
                    subject=subject,
                    html_body=html_body,
                )

                if send_result["ok"]:
                    entry.status = "sent"
                    entry.draft_subject = subject
                    entry.draft_body = body
                    record_outreach_memory(
                        contact_id=entry.contact_id,
                        user_email=entry.user_email,
                        angle=angle_used,
                        message_summary=f"Re-engagement ({entry.hook_theme}): {subject}",
                        db=db,
                        channel="reengagement_email",
                    )
                    logger.info(
                        f"Re-engagement sent to {contact.contact_email} "
                        f"(contact_id={entry.contact_id}, theme={entry.hook_theme})"
                    )
                else:
                    logger.warning(
                        f"Re-engagement send failed for entry {entry.id} "
                        f"contact_id={entry.contact_id}"
                    )

                db.commit()

            except Exception as e:
                logger.error(f"Re-engagement pulse error entry {entry.id}: {e}")
                try:
                    db.rollback()
                except Exception:
                    pass

    except Exception as e:
        logger.error(f"reengagement_pulse failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
