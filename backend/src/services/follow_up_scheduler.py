"""
Follow-Up Scheduler
Replaces the stateless follow_up_hunter with a DB-backed persistent scheduler.

Lifecycle:
  scan_and_save_follow_ups(user_email, db)
    → scans sent mail, saves new FollowUp rows (status=pending)

  APScheduler job (every 5 min) → _pulse()
    → finds pending rows with send_after <= now
    → generates draft if missing
    → moves status to awaiting_approval
    → front-end polls GET /api/proactive/follow-ups to display them

  On user approval → mark status=sent, call send_email tool
  On user dismiss → mark status=cancelled
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import List

from loguru import logger


def _open_db():
    """Open a SQLAlchemy session, retrying once on OperationalError (stale pool connection)."""
    from auth.database import SessionLocal, engine
    from sqlalchemy.exc import OperationalError

    try:
        db = SessionLocal()
        # Force a cheap ping so pool_pre_ping can discard dead connections
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        return db
    except OperationalError:
        # Dispose the pool so the next attempt gets a fresh TCP connection
        engine.dispose()
        db = SessionLocal()
        return db


def init_follow_up_scheduler():
    """Start the APScheduler jobs. Called once from main.py lifespan."""
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        scheduler = AsyncIOScheduler()
        # Follow-up draft generation (5-min)
        scheduler.add_job(
            _pulse,
            trigger="interval",
            minutes=5,
            id="follow_up_pulse",
            replace_existing=True,
            misfire_grace_time=60,
        )
        # Auto-reply send-on-deadline (1-min)
        scheduler.add_job(
            _auto_reply_pulse,
            trigger="interval",
            minutes=1,
            id="auto_reply_pulse",
            replace_existing=True,
            misfire_grace_time=30,
        )
        scheduler.start()
        logger.info("Follow-up + auto-reply scheduler started")
        return scheduler
    except Exception as e:
        logger.error(f"Follow-up scheduler failed to start: {e}")
        return None


async def _auto_reply_pulse():
    """Send any PendingAutoReply rows whose deadline has passed."""
    try:
        from auth.models import PendingAutoReply
        from services.auto_reply_service import send_auto_reply

        db = _open_db()
        try:
            now = datetime.now(timezone.utc)
            due = (
                db.query(PendingAutoReply)
                .filter(
                    PendingAutoReply.status == "pending",
                    PendingAutoReply.send_deadline <= now,
                )
                .all()
            )
            for row in due:
                await send_auto_reply(row.id, db)
        finally:
            db.close()
    except Exception as exc:
        logger.error(f"auto_reply_pulse error: {exc}")


async def _pulse():
    """Check for due follow-ups and generate drafts for any missing content."""
    from auth.models import FollowUp

    db = _open_db()
    try:
        now = datetime.now(tz=timezone.utc)
        due: List[FollowUp] = (
            db.query(FollowUp)
            .filter(FollowUp.status == "pending", FollowUp.send_after <= now)
            .all()
        )

        if not due:
            return

        logger.info(f"follow_up_pulse: {len(due)} follow-up(s) due")

        for row in due:
            try:
                # 1. Generate draft if missing
                if not row.draft_content:
                    from services.follow_up_hunter import generate_follow_up_draft
                    days_ago = (now - row.send_after.replace(tzinfo=timezone.utc)).days if row.send_after.tzinfo else 0
                    draft = await generate_follow_up_draft(
                        original_subject=row.subject,
                        commitment_text=row.commitment,
                        recipient=row.recipient,
                        days_ago=max(days_ago, 0),
                    )
                    row.draft_content = draft

                # 2. Create/Sync with WorkflowInstance for unified HITL review
                from auth.models import User
                from models import WorkflowInstance, WorkflowStep
                user = db.query(User).filter(User.email == row.user_email).first()
                if not user:
                    continue

                # Create a new workflow for this follow-up
                wf = WorkflowInstance(
                    user_id=user.id,
                    goal=f"Follow-up: {row.subject}",
                    status="pending"
                )
                db.add(wf)
                db.flush() # Get wf.id

                # Create the primary email step
                step = WorkflowStep(
                    workflow_id=wf.id,
                    step_number=1,
                    description=f"Send follow-up to {row.recipient}",
                    tool_name="send_email",
                    tool_input={
                        "recipient": row.recipient,
                        "subject": f"Re: {row.subject}",
                        "body": row.draft_content
                    },
                    status="pending",
                    requires_approval=True
                )
                db.add(step)

                row.status = "awaiting_approval"
                db.commit()
                logger.info(f"follow_up_pulse: unified workflow {wf.id} created for follow-up {row.id}")
            except Exception as e:
                logger.warning(f"follow_up_pulse: failed to process row {row.id}: {e}")
                db.rollback()

    except Exception as e:
        logger.error(f"follow_up_pulse error: {e}")
    finally:
        db.close()


async def scan_and_save_follow_ups(user_email: str, db, days: int = 14) -> int:
    """
    Scan sent mail and persist newly discovered follow-up commitments to DB.
    Returns the count of new rows inserted.
    """
    from services.follow_up_hunter import scan_for_follow_ups
    from auth.models import FollowUp

    items = await scan_for_follow_ups(user_email, db, days=days)
    if not items:
        return 0

    inserted = 0
    for item in items:
        thread_id = item.get("thread_id")

        # Skip if this thread is already tracked (any status)
        if thread_id:
            exists = (
                db.query(FollowUp)
                .filter(FollowUp.user_email == user_email, FollowUp.thread_id == thread_id)
                .first()
            )
            if exists:
                continue

        days_ago = item.get("days_ago") or 0
        # Surface after 3 days of silence by default
        send_after = datetime.now(tz=timezone.utc) + timedelta(days=max(0, 3 - days_ago))

        row = FollowUp(
            user_email=user_email,
            thread_id=thread_id,
            recipient=item.get("recipient", ""),
            subject=item.get("subject", "(no subject)"),
            commitment=item.get("commitment", ""),
            status="pending",
            send_after=send_after,
        )
        db.add(row)
        inserted += 1

    if inserted:
        db.commit()
        logger.info(f"scan_and_save_follow_ups: saved {inserted} new follow-up(s) for {user_email}")

    return inserted


def get_pending_follow_ups(user_email: str, db) -> list:
    """Return all follow-ups awaiting user approval."""
    from auth.models import FollowUp

    rows = (
        db.query(FollowUp)
        .filter(
            FollowUp.user_email == user_email,
            FollowUp.status == "awaiting_approval",
        )
        .order_by(FollowUp.send_after)
        .all()
    )
    return [
        {
            "id": r.id,
            "recipient": r.recipient,
            "subject": r.subject,
            "commitment": r.commitment,
            "draft_content": r.draft_content,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def approve_follow_up(follow_up_id: int, user_email: str, db) -> bool:
    """Mark a follow-up as sent (call after the email tool executes)."""
    from auth.models import FollowUp

    row = db.query(FollowUp).filter(
        FollowUp.id == follow_up_id, FollowUp.user_email == user_email
    ).first()
    if not row:
        return False
    row.status = "sent"
    row.sent_at = datetime.now(tz=timezone.utc)
    db.commit()
    return True


def cancel_follow_up(follow_up_id: int, user_email: str, db) -> bool:
    """Dismiss a follow-up without sending."""
    from auth.models import FollowUp

    row = db.query(FollowUp).filter(
        FollowUp.id == follow_up_id, FollowUp.user_email == user_email
    ).first()
    if not row:
        return False
    row.status = "cancelled"
    db.commit()
    return True
