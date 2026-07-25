"""
Task Notification Routes

Stores completed background task results so the frontend can show
a pop-up when the user returns to the Command Center tab.

Endpoints:
  GET  /api/notifications/pending        → unseen task completions for user
  POST /api/notifications/{id}/seen      → mark one notification as seen
  POST /api/notifications/seen-all       → mark all unseen as seen
  POST /api/notifications/write          → internal: write a new notification
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from auth.routes import get_current_user, get_db
from auth.models import User, TaskNotification
from loguru import logger

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(n: TaskNotification) -> dict:
    return {
        "id": n.id,
        "task_title": n.task_title,
        "result_summary": n.result_summary,
        "seen": n.seen,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


# ── Public write helper (called by agent route on task completion) ─────────────

from utils.activity_logger import record_activity

def write_task_notification(
    user_email: str,
    task_title: str,
    result_summary: Optional[str],
    db: Session,
) -> TaskNotification:
    """Create a TaskNotification row. Called internally when a background task finishes."""
    notif = TaskNotification(
        user_email=user_email,
        task_title=task_title,
        result_summary=result_summary,
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)
    
    # Audit log for the notification
    try:
        record_activity(
            db, user_email, "notification_created",
            entity_type="notification", entity_id=notif.id,
            details={"task_title": task_title}
        )
    except Exception as e:
        logger.warning(f"Failed to log notification activity: {e}")
        
    return notif


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/pending")
async def get_pending_notifications(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all unseen task notifications for the user."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    rows = (
        db.query(TaskNotification)
        .filter(TaskNotification.user_email == email, TaskNotification.seen == False)  # noqa: E712
        .order_by(TaskNotification.created_at.desc())
        .limit(20)
        .all()
    )
    return {"notifications": [_row_to_dict(r) for r in rows], "total": len(rows)}


@router.post("/{notif_id}/seen")
async def mark_notification_seen(
    notif_id: int,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a single notification as seen."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    row = db.query(TaskNotification).filter(
        TaskNotification.id == notif_id,
        TaskNotification.user_email == email,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")

    row.seen = True
    db.commit()
    return {"success": True, "id": notif_id}


@router.post("/seen-all")
async def mark_all_seen(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark every unseen notification for the user as seen."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    db.query(TaskNotification).filter(
        TaskNotification.user_email == email,
        TaskNotification.seen == False,  # noqa: E712
    ).update({"seen": True})
    db.commit()
    return {"success": True}
