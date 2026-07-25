"""
Sequence Routes — multi-step drip email sequences.

Endpoints:
  POST   /api/sequences                          — create sequence + steps
  GET    /api/sequences                          — list sequences
  GET    /api/sequences/{id}                     — get sequence + steps + stats
  PUT    /api/sequences/{id}                     — update name / status
  DELETE /api/sequences/{id}                     — delete sequence
  POST   /api/sequences/{id}/steps               — add a step
  PUT    /api/sequences/{id}/steps/{step_id}     — update a step
  DELETE /api/sequences/{id}/steps/{step_id}     — remove a step
  POST   /api/sequences/{id}/enroll              — enroll recipients
  GET    /api/sequences/{id}/enrollments         — list enrollments + progress
  POST   /api/sequences/{id}/pause               — pause sequence (stops scheduler)
  POST   /api/sequences/{id}/resume              — resume sequence
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.database import get_db
from auth.models import (
    EmailSequence, SequenceStep, SequenceEnrollment, SuppressedEmail,
    CampaignRecipient, SalesCampaign,
)
from services.bulk_mailer import send_one_tracked, personalise, personalise_with_opening, inject_tracking, _inject_unsubscribe, _plain_to_html
from mcp_servers.core.google_auth import GoogleAuthManager

router = APIRouter(tags=["sequences"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class StepIn(BaseModel):
    step_number: int
    delay_days: int = 0
    subject_template: str
    html_template: str
    text_template: Optional[str] = None
    stop_on: str = "reply"   # "reply" | "open" | "click" | "none"


class SequenceCreate(BaseModel):
    name: str
    steps: list[StepIn]


class SequenceUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class RecipientEnroll(BaseModel):
    email: str
    name: Optional[str] = None
    variables: Optional[dict] = None
    timezone: Optional[str] = None    # e.g. "America/New_York" — for 9am local scheduling


class EnrollRequest(BaseModel):
    recipients: list[RecipientEnroll]
    send_hour: int = 9    # local hour to send (24h, default 9am)


# ── Helpers ───────────────────────────────────────────────────────────────────

_TZ_OFFSETS: dict[str, int] = {
    # Common timezone → UTC offset (hours). Approximate — good enough for scheduling.
    "America/New_York": -5, "America/Chicago": -6, "America/Denver": -7,
    "America/Los_Angeles": -8, "America/Phoenix": -7,
    "Europe/London": 0, "Europe/Paris": 1, "Europe/Berlin": 1,
    "Europe/Moscow": 3, "Asia/Kolkata": 5, "Asia/Dubai": 4,
    "Asia/Singapore": 8, "Asia/Tokyo": 9, "Australia/Sydney": 10,
    "Pacific/Auckland": 12,
}


def _next_send_utc(tz_name: Optional[str], send_hour: int, delay_days: int) -> datetime:
    """Calculate UTC datetime for 'send_hour' in the recipient's local timezone, delay_days from now."""
    offset_h = _TZ_OFFSETS.get(tz_name or "", 0)
    now_utc = datetime.now(timezone.utc)
    target = now_utc + timedelta(days=delay_days)
    # Set target to send_hour local time = (send_hour - offset) UTC
    target_utc_hour = (send_hour - offset_h) % 24
    target = target.replace(hour=target_utc_hour, minute=0, second=0, microsecond=0)
    # If that time already passed today, push to tomorrow
    if target <= now_utc and delay_days == 0:
        target += timedelta(days=1)
    return target


def _seq_or_404(db: Session, seq_id: int, user_email: str) -> EmailSequence:
    seq = db.query(EmailSequence).filter_by(id=seq_id, user_email=user_email).first()
    if not seq:
        raise HTTPException(404, "Sequence not found")
    return seq


def _seq_dict(seq: EmailSequence, db: Session) -> dict:
    steps = sorted(seq.steps, key=lambda s: s.step_number)
    active = db.query(SequenceEnrollment).filter_by(sequence_id=seq.id, status="active").count()
    completed = db.query(SequenceEnrollment).filter_by(sequence_id=seq.id, status="completed").count()
    stopped = db.query(SequenceEnrollment).filter_by(sequence_id=seq.id, status="stopped").count()
    return {
        "id": seq.id,
        "name": seq.name,
        "status": seq.status,
        "created_at": seq.created_at.isoformat() if seq.created_at else None,
        "steps": [_step_dict(s) for s in steps],
        "stats": {"active": active, "completed": completed, "stopped": stopped},
    }


def _step_dict(s: SequenceStep) -> dict:
    return {
        "id": s.id,
        "step_number": s.step_number,
        "delay_days": s.delay_days,
        "subject_template": s.subject_template,
        "html_template": s.html_template,
        "text_template": s.text_template,
        "stop_on": s.stop_on,
    }


def _enrollment_dict(e: SequenceEnrollment) -> dict:
    return {
        "id": e.id,
        "recipient_email": e.recipient_email,
        "recipient_name": e.recipient_name,
        "current_step": e.current_step,
        "status": e.status,
        "next_send_at": e.next_send_at.isoformat() if e.next_send_at else None,
        "replied": e.replied,
        "opened": e.opened,
        "clicked": e.clicked,
        "open_count": getattr(e, "open_count", 0),
        "early_triggered": getattr(e, "early_triggered", False),
        "pause_reason": getattr(e, "pause_reason", None),
        "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
        "last_sent_at": e.last_sent_at.isoformat() if e.last_sent_at else None,
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_sequence(body: SequenceCreate, email: str = Query(...), db: Session = Depends(get_db)):
    seq = EmailSequence(user_email=email, name=body.name)
    db.add(seq)
    db.flush()
    for s in body.steps:
        db.add(SequenceStep(
            sequence_id=seq.id,
            step_number=s.step_number,
            delay_days=s.delay_days,
            subject_template=s.subject_template,
            html_template=s.html_template,
            text_template=s.text_template,
            stop_on=s.stop_on,
        ))
    db.commit()
    db.refresh(seq)
    return _seq_dict(seq, db)


@router.get("")
async def list_sequences(email: str = Query(...), db: Session = Depends(get_db)):
    seqs = db.query(EmailSequence).filter_by(user_email=email).order_by(EmailSequence.created_at.desc()).all()
    return [_seq_dict(s, db) for s in seqs]


@router.get("/{seq_id}")
async def get_sequence(seq_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    return _seq_dict(_seq_or_404(db, seq_id, email), db)


@router.put("/{seq_id}")
async def update_sequence(seq_id: int, body: SequenceUpdate, email: str = Query(...), db: Session = Depends(get_db)):
    seq = _seq_or_404(db, seq_id, email)
    if body.name is not None:
        seq.name = body.name
    if body.status is not None:
        if body.status not in ("active", "paused", "archived"):
            raise HTTPException(422, "status must be active | paused | archived")
        seq.status = body.status
    db.commit()
    return _seq_dict(seq, db)


@router.delete("/{seq_id}", status_code=204)
async def delete_sequence(seq_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    seq = _seq_or_404(db, seq_id, email)
    db.delete(seq)
    db.commit()


# ── Step management ───────────────────────────────────────────────────────────

@router.post("/{seq_id}/steps", status_code=201)
async def add_step(seq_id: int, body: StepIn, email: str = Query(...), db: Session = Depends(get_db)):
    seq = _seq_or_404(db, seq_id, email)
    step = SequenceStep(sequence_id=seq.id, **body.model_dump())
    db.add(step)
    db.commit()
    db.refresh(step)
    return _step_dict(step)


@router.put("/{seq_id}/steps/{step_id}")
async def update_step(seq_id: int, step_id: int, body: StepIn, email: str = Query(...), db: Session = Depends(get_db)):
    _seq_or_404(db, seq_id, email)
    step = db.query(SequenceStep).filter_by(id=step_id, sequence_id=seq_id).first()
    if not step:
        raise HTTPException(404, "Step not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(step, k, v)
    db.commit()
    return _step_dict(step)


@router.delete("/{seq_id}/steps/{step_id}", status_code=204)
async def delete_step(seq_id: int, step_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    _seq_or_404(db, seq_id, email)
    step = db.query(SequenceStep).filter_by(id=step_id, sequence_id=seq_id).first()
    if not step:
        raise HTTPException(404, "Step not found")
    db.delete(step)
    db.commit()


# ── Enroll recipients ─────────────────────────────────────────────────────────

@router.post("/{seq_id}/enroll")
async def enroll_recipients(
    seq_id: int,
    body: EnrollRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    seq = _seq_or_404(db, seq_id, email)
    if not seq.steps:
        raise HTTPException(422, "Sequence has no steps — add at least one step before enrolling.")

    # Verify Gmail creds
    try:
        GoogleAuthManager.get_user_tokens(email, api_type="gmail")
    except HTTPException as exc:
        raise HTTPException(exc.status_code, f"Cannot enroll: {exc.detail}. Please reconnect Gmail.")

    first_step = min(seq.steps, key=lambda s: s.step_number)

    # Sender's timezone from settings is the scheduling reference
    from auth.models import User
    sender = db.query(User).filter(User.email == email).first()
    sender_tz = (sender.timezone if sender and sender.timezone else "UTC")

    enrolled, skipped = 0, 0

    for r in body.recipients:
        r_email = r.email.strip().lower()
        if not r_email or "@" not in r_email:
            skipped += 1
            continue

        # Skip suppressed emails
        suppressed = db.query(SuppressedEmail).filter_by(user_email=email, suppressed_email=r_email).first()
        if suppressed:
            skipped += 1
            continue

        # Skip already-active enrollments
        existing = db.query(SequenceEnrollment).filter_by(
            sequence_id=seq_id, recipient_email=r_email, status="active"
        ).first()
        if existing:
            skipped += 1
            continue

        # Use per-recipient timezone if given, else fall back to sender's settings timezone
        tz = r.timezone or sender_tz
        next_send = _next_send_utc(tz, body.send_hour, first_step.delay_days)
        db.add(SequenceEnrollment(
            sequence_id=seq_id,
            user_email=email,
            recipient_email=r_email,
            recipient_name=r.name,
            variables=r.variables or {},
            current_step=first_step.step_number,
            status="active",
            next_send_at=next_send,
        ))
        enrolled += 1

    db.commit()
    return {"enrolled": enrolled, "skipped": skipped}


@router.get("/{seq_id}/enrollments")
async def list_enrollments(
    seq_id: int,
    email: str = Query(...),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    _seq_or_404(db, seq_id, email)
    q = db.query(SequenceEnrollment).filter_by(sequence_id=seq_id, user_email=email)
    if status:
        q = q.filter_by(status=status)
    enrollments = q.order_by(SequenceEnrollment.enrolled_at.desc()).limit(200).all()
    return [_enrollment_dict(e) for e in enrollments]


@router.post("/{seq_id}/pause")
async def pause_sequence(seq_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    seq = _seq_or_404(db, seq_id, email)
    seq.status = "paused"
    db.commit()
    return {"status": "paused"}


@router.post("/{seq_id}/resume")
async def resume_sequence(seq_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    seq = _seq_or_404(db, seq_id, email)
    seq.status = "active"
    db.commit()
    return {"status": "active"}


# ── Scheduler pulse (called by APScheduler every 2 min) ───────────────────────

async def sequence_pulse():
    """
    Advances enrollments whose next_send_at <= now.
    Checks stop_on conditions, sends the step email, and schedules the next step.
    Also runs secondary count-based trigger scan: 3+ opens on step 1 → early advance.
    """
    from auth.database import SessionLocal
    from auth.models import SalesContact, SignalEvent
    from services.escalation_service import check_and_escalate
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due = (
            db.query(SequenceEnrollment)
            .join(EmailSequence, SequenceEnrollment.sequence_id == EmailSequence.id)
            .filter(
                SequenceEnrollment.status == "active",
                EmailSequence.status == "active",
                SequenceEnrollment.next_send_at <= now,
                # Outreach follow-ups (those with a gmail_thread_id) are handled
                # by check_replies_pulse every 6 hours — it verifies reply state
                # first. Skip them here so they're never sent without that check.
                SequenceEnrollment.gmail_thread_id.is_(None),
            )
            .limit(100)
            .all()
        )

        for enrollment in due:
            try:
                await _advance_enrollment(enrollment, db)
            except Exception as exc:
                logger.error(f"Sequence pulse error enrollment={enrollment.id}: {exc}")

        if due:
            db.commit()

        # ── Secondary scan: count-based trigger (3+ opens on step 1 → advance early) ──
        try:
            early_candidates = (
                db.query(SequenceEnrollment)
                .join(EmailSequence, SequenceEnrollment.sequence_id == EmailSequence.id)
                .filter(
                    SequenceEnrollment.status == "active",
                    SequenceEnrollment.replied == False,
                    SequenceEnrollment.open_count >= 3,
                    SequenceEnrollment.early_triggered == False,
                    SequenceEnrollment.current_step == 1,
                    EmailSequence.status == "active",
                )
                .limit(50)
                .all()
            )

            for enrollment in early_candidates:
                try:
                    seq = db.query(EmailSequence).filter_by(id=enrollment.sequence_id).first()
                    if not seq:
                        continue
                    steps = sorted(seq.steps, key=lambda s: s.step_number)
                    next_steps = [s for s in steps if s.step_number > enrollment.current_step]
                    if not next_steps:
                        continue

                    nxt = next_steps[0]
                    enrollment.current_step = nxt.step_number
                    enrollment.next_send_at = now  # send immediately on next pulse
                    enrollment.early_triggered = True

                    # Log a signal event on the linked contact
                    contact = db.query(SalesContact).filter_by(
                        user_email=enrollment.user_email,
                        contact_email=enrollment.recipient_email,
                    ).first()
                    if contact:
                        db.add(SignalEvent(
                            contact_id=contact.id,
                            user_email=enrollment.user_email,
                            signal_type="multiple_opens_trigger",
                            signal_metadata={
                                "enrollment_id": enrollment.id,
                                "open_count": enrollment.open_count,
                                "advanced_to_step": nxt.step_number,
                            },
                        ))
                        contact.last_signal_at = now
                        # Recompute intent score and check escalation
                        all_signals = db.query(SignalEvent).filter_by(contact_id=contact.id).all()
                        email_open_count = sum(1 for s in all_signals if s.signal_type == "email_open")
                        from services.sales_intelligence import compute_intent_score
                        signal_dicts = [{"type": s.signal_type, "metadata": s.signal_metadata or {}} for s in all_signals]
                        new_score = compute_intent_score(signal_dicts, email_open_count)
                        if new_score != contact.intent_score:
                            contact.intent_score = new_score
                            await check_and_escalate(contact, db, enrollment.user_email)

                    logger.info(
                        f"Early trigger: enrollment {enrollment.id} advanced to step {nxt.step_number} "
                        f"(open_count={enrollment.open_count})"
                    )
                except Exception as exc:
                    logger.error(f"Early trigger error enrollment={enrollment.id}: {exc}")

            if early_candidates:
                db.commit()

        except Exception as exc:
            logger.error(f"sequence_pulse early trigger scan failed: {exc}")

    except Exception as exc:
        logger.error(f"sequence_pulse failed: {exc}")
        db.rollback()
    finally:
        db.close()


async def _advance_enrollment(enrollment: SequenceEnrollment, db: Session):
    from auth.models import SalesContact
    seq = db.query(EmailSequence).filter_by(id=enrollment.sequence_id).first()
    if not seq or seq.status != "active":
        return

    steps = sorted(seq.steps, key=lambda s: s.step_number)
    # Find the current step
    current = next((s for s in steps if s.step_number == enrollment.current_step), None)
    if not current:
        enrollment.status = "completed"
        # Schedule re-engagement if no reply
        if not enrollment.replied:
            try:
                contact = db.query(SalesContact).filter_by(
                    user_email=enrollment.user_email,
                    contact_email=enrollment.recipient_email,
                ).first()
                if contact:
                    from services.reengagement_service import schedule_reengagement
                    await schedule_reengagement(contact.id, enrollment.user_email, db)
            except Exception as re_exc:
                logger.warning(f"Re-engagement scheduling failed: {re_exc}")
        return

    # Check stop_on condition
    should_stop = (
        (current.stop_on == "reply" and enrollment.replied) or
        (current.stop_on == "open" and enrollment.opened) or
        (current.stop_on == "click" and enrollment.clicked)
    )
    if should_stop:
        enrollment.status = "stopped"
        return

    # Check suppression
    suppressed = db.query(SuppressedEmail).filter_by(
        user_email=enrollment.user_email,
        suppressed_email=enrollment.recipient_email,
    ).first()
    if suppressed:
        enrollment.status = "unsubscribed"
        return

    base_url = os.getenv("BASE_URL", "http://localhost:8000")
    variables = dict(enrollment.variables or {})
    first = enrollment.recipient_name.split()[0] if enrollment.recipient_name else ""
    variables.setdefault("first_name", first)
    variables.setdefault("FirstName", first)
    variables.setdefault("name", enrollment.recipient_name or "")
    variables.setdefault("Name", enrollment.recipient_name or "")

    # Fetch dossier for personalized opening generation
    contact = db.query(SalesContact).filter_by(
        user_email=enrollment.user_email,
        contact_email=enrollment.recipient_email,
    ).first()
    dossier = contact.dossier if contact else None
    company = contact.company if contact else (variables.get("company") or "")
    role = contact.role if contact else (variables.get("role") or "")

    # Use async personalise with personalized opening support
    subject = personalise(current.subject_template, variables)
    raw_html = await personalise_with_opening(
        current.html_template,
        variables,
        dossier=dossier,
        recipient_name=enrollment.recipient_name or "",
        company=company,
        role=role,
    )
    html_body = _plain_to_html(raw_html)
    text_body = personalise(current.text_template, variables) if current.text_template else None

    # Record outreach memory for this send
    if contact:
        try:
            from services.reengagement_service import record_outreach_memory
            record_outreach_memory(
                contact_id=contact.id,
                user_email=enrollment.user_email,
                angle=f"sequence_step_{current.step_number}",
                message_summary=f"Sequence step {current.step_number}: {subject}",
                db=db,
                channel=f"sequence_step_{current.step_number}",
            )
        except Exception as mem_exc:
            logger.debug(f"Outreach memory record failed: {mem_exc}")

    # Inject tracking + unsubscribe — use enrollment id as pseudo-token
    token = f"seq_{enrollment.id}_{current.step_number}"
    html_body = inject_tracking(html_body, token, base_url)
    html_body = _inject_unsubscribe(html_body, token, base_url)

    send_result = await send_one_tracked(
        user_email=enrollment.user_email,
        to_email=enrollment.recipient_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
        thread_id=enrollment.gmail_thread_id,   # send follow-ups in same thread
    )

    if not send_result["ok"]:
        logger.warning(f"Sequence step send failed enrollment={enrollment.id} step={current.step_number}")
        # Don't advance — will retry on next pulse
        return

    enrollment.last_sent_at = datetime.now(timezone.utc)
    # Store thread_id on first send so follow-ups thread correctly
    if send_result.get("thread_id") and not enrollment.gmail_thread_id:
        enrollment.gmail_thread_id = send_result["thread_id"]

    # Find next step
    next_steps = [s for s in steps if s.step_number > current.step_number]
    if next_steps:
        nxt = next_steps[0]
        enrollment.current_step = nxt.step_number
        enrollment.next_send_at = datetime.now(timezone.utc) + timedelta(days=max(nxt.delay_days, 1))
    else:
        enrollment.status = "completed"
        enrollment.next_send_at = None
        # Schedule re-engagement if sequence completed with no reply
        if not enrollment.replied and contact:
            try:
                from services.reengagement_service import schedule_reengagement
                await schedule_reengagement(contact.id, enrollment.user_email, db)
            except Exception as re_exc:
                logger.warning(f"Re-engagement scheduling failed: {re_exc}")


# ── Reply detection pulse ─────────────────────────────────────────────────────

async def check_replies_pulse():
    """
    Runs every 6 hours. Does two things in order:

    1. REPLY CHECK — scan Gmail threads for all active enrollments.
       If the recipient has responded (any message NOT from the sender),
       mark enrollment.replied = True immediately.

    2. FOLLOW-UP SEND — after the reply state is fresh, advance any
       enrollments whose next_send_at <= now AND replied == False.
       This guarantees we never fire a follow-up to someone who already replied.

    The combined approach means the 6-hour window also acts as the minimum
    cadence: follow-ups can be scheduled for "2 days later" or "1 day later"
    and this job will pick them up on the next 6-hour tick after they become due.
    """
    from auth.database import SessionLocal
    from auth.models import SequenceEnrollment, CampaignRecipient
    from mcp_servers.core.google_auth import GoogleAuthManager

    db = SessionLocal()
    try:
        # Only check active enrollments that have a thread_id and haven't replied yet
        enrollments = (
            db.query(SequenceEnrollment)
            .filter(
                SequenceEnrollment.status == "active",
                SequenceEnrollment.replied == False,
                SequenceEnrollment.gmail_thread_id.isnot(None),
            )
            .limit(200)
            .all()
        )

        if not enrollments:
            return

        logger.info(f"check_replies_pulse: checking {len(enrollments)} active enrollments for replies")

        # Group by sender (user_email) to reuse the same Gmail service per user
        from collections import defaultdict
        by_sender: dict[str, list[SequenceEnrollment]] = defaultdict(list)
        for e in enrollments:
            by_sender[e.user_email].append(e)

        for sender_email, sender_enrollments in by_sender.items():
            try:
                service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", sender_email)
            except Exception as auth_exc:
                logger.warning(f"check_replies_pulse: Gmail auth failed for {sender_email}: {auth_exc}")
                continue

            for enrollment in sender_enrollments:
                try:
                    thread_data = await asyncio.to_thread(
                        lambda tid=enrollment.gmail_thread_id: (
                            service.users().threads().get(
                                userId="me", id=tid, format="metadata",
                                metadataHeaders=["From"],
                            ).execute()
                        )
                    )
                    messages = thread_data.get("messages", [])
                    # A reply exists if any message is NOT from the sender
                    for msg in messages:
                        headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
                        from_header = headers.get("from", "").lower()
                        if sender_email.lower() not in from_header:
                            # Recipient replied
                            enrollment.replied = True
                            logger.info(
                                f"check_replies_pulse: reply detected for enrollment {enrollment.id} "
                                f"(recipient={enrollment.recipient_email})"
                            )
                            break
                except Exception as exc:
                    logger.debug(f"check_replies_pulse: thread check failed enrollment={enrollment.id}: {exc}")

        # Also check CampaignRecipient threads (campaign-level reply detection)
        campaign_rows = (
            db.query(CampaignRecipient)
            .filter(
                CampaignRecipient.replied == False,
                CampaignRecipient.gmail_thread_id.isnot(None),
                CampaignRecipient.send_status == "sent",
            )
            .limit(200)
            .all()
        )

        cr_by_sender: dict[str, list[CampaignRecipient]] = defaultdict(list)
        for cr in campaign_rows:
            cr_by_sender[cr.user_email].append(cr)

        for sender_email, rows in cr_by_sender.items():
            try:
                service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", sender_email)
            except Exception:
                continue

            for cr in rows:
                try:
                    thread_data = await asyncio.to_thread(
                        lambda tid=cr.gmail_thread_id: (
                            service.users().threads().get(
                                userId="me", id=tid, format="metadata",
                                metadataHeaders=["From"],
                            ).execute()
                        )
                    )
                    messages = thread_data.get("messages", [])
                    for msg in messages:
                        headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
                        from_header = headers.get("from", "").lower()
                        if sender_email.lower() not in from_header:
                            cr.replied = True
                            # Also stop any active sequence enrollment for this recipient
                            db.query(SequenceEnrollment).filter_by(
                                user_email=sender_email,
                                recipient_email=cr.recipient_email,
                                status="active",
                            ).update({"replied": True})
                            break
                except Exception:
                    pass

        db.commit()
        logger.info("check_replies_pulse: reply scan done")

        # ── Step 2: Send due follow-ups (only to non-replied enrollments) ──────
        # Re-query with fresh replied state so we never advance a replied enrollment.
        now = datetime.now(timezone.utc)
        due = (
            db.query(SequenceEnrollment)
            .join(EmailSequence, SequenceEnrollment.sequence_id == EmailSequence.id)
            .filter(
                SequenceEnrollment.status == "active",
                SequenceEnrollment.replied == False,
                EmailSequence.status == "active",
                SequenceEnrollment.next_send_at <= now,
            )
            .limit(200)
            .all()
        )

        hours_until: list[str] = []
        for enrollment in due:
            try:
                await _advance_enrollment(enrollment, db)
            except Exception as exc:
                logger.error(f"check_replies_pulse advance error enrollment={enrollment.id}: {exc}")

        # Log upcoming follow-ups not yet due (for visibility)
        upcoming = (
            db.query(SequenceEnrollment)
            .filter(
                SequenceEnrollment.status == "active",
                SequenceEnrollment.replied == False,
                SequenceEnrollment.next_send_at > now,
            )
            .limit(50)
            .all()
        )
        for e in upcoming:
            if e.next_send_at:
                delta_h = (e.next_send_at - now).total_seconds() / 3600
                hours_until.append(
                    f"enrollment {e.id} ({e.recipient_email}): {delta_h:.1f}h until next follow-up"
                )

        if due:
            db.commit()

        logger.info(
            f"check_replies_pulse: advanced {len(due)} due follow-up(s). "
            f"{len(upcoming)} pending. "
            + (("Next up: " + "; ".join(hours_until[:5])) if hours_until else "")
        )

    except Exception as exc:
        logger.error(f"check_replies_pulse error: {exc}")
        db.rollback()
    finally:
        db.close()
