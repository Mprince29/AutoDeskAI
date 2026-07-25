"""
Proactive Agent Routes
Exposes the three proactive intelligence services:
  GET  /api/proactive/follow-ups              → scan sent mail for broken promises
  POST /api/proactive/follow-ups/draft        → generate a follow-up draft for a specific item
  GET  /api/proactive/briefing                → generate on-demand morning briefing
  POST /api/proactive/briefing/run            → generate briefing AND email it to the user
  GET  /api/proactive/briefing/settings       → get user's briefing schedule settings
  PUT  /api/proactive/briefing/settings       → update briefing schedule
  GET  /api/proactive/relationship            → get relationship card for a contact email
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from auth.routes import get_current_user, get_db
from auth.models import User
from loguru import logger

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class FollowUpDraftRequest(BaseModel):
    email_id: str
    subject: str
    commitment: str
    recipient: str
    days_ago: int = 0


class BriefingSettingsRequest(BaseModel):
    enabled: bool
    time: str  # "HH:MM" in Local Time, e.g. "08:30" (supports multiple: "08:00,14:00")


# ── Request models ─────────────────────────────────────────────────────────────

class FollowUpApproveRequest(BaseModel):
    edited_draft: Optional[str] = None  # if user edited the draft before sending


# ── Follow-Up Hunter ────────────────────────────────────────────────────────────

@router.get("/follow-ups")
async def get_follow_ups(
    email: str = Query(...),
    days: int = Query(default=14, ge=1, le=30),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Scan sent emails, persist new follow-ups to DB, return pending-approval list."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        from services.follow_up_scheduler import scan_and_save_follow_ups, get_pending_follow_ups
        new_count = await scan_and_save_follow_ups(user_email=email, db=db, days=days)
        pending = get_pending_follow_ups(user_email=email, db=db)
        return {
            "follow_ups": pending,
            "total": len(pending),
            "new_discovered": new_count,
            "days_scanned": days,
        }
    except Exception as e:
        logger.error(f"follow-ups route error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/follow-ups/pending")
async def get_pending_follow_ups_route(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return only the follow-ups currently awaiting user approval (no re-scan)."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from services.follow_up_scheduler import get_pending_follow_ups
    pending = get_pending_follow_ups(user_email=email, db=db)
    return {"follow_ups": pending, "total": len(pending)}


@router.post("/follow-ups/{follow_up_id}/approve")
async def approve_follow_up_route(
    follow_up_id: int,
    request: FollowUpApproveRequest,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a follow-up as sent after user approves and agent sends the email."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from auth.models import FollowUp
    from services.follow_up_scheduler import approve_follow_up
    from mcp_servers.core.mcp_tools import execute_tool
    from services.security import GLOBAL_SIGNER

    row = db.query(FollowUp).filter(
        FollowUp.id == follow_up_id, FollowUp.user_email == email
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Follow-up not found")

    # If user provided an edited draft, save it before sending
    if request.edited_draft:
        row.draft_content = request.edited_draft
        db.commit()

    body = row.draft_content or ""
    if not body:
        raise HTTPException(status_code=400, detail="No draft content to send")

    # Generate HMAC so send_email passes the sensitive-tool security gate
    sig = GLOBAL_SIGNER.generate_token("agent_chat", {}, email)

    result = await execute_tool(
        "send_email",
        {
            "user_email": email,
            "to": row.recipient,
            "subject": f"Re: {row.subject}",
            "body": body,
            "_security_signature": sig,
        },
        email,
        db,
    )
    if result.get("error"):
        logger.error(f"send_email failed for follow-up {follow_up_id}: {result['error']}")
        raise HTTPException(status_code=500, detail=result["error"])

    approve_follow_up(follow_up_id, email, db)
    return {"success": True, "id": follow_up_id, "status": "sent"}


@router.post("/follow-ups/{follow_up_id}/cancel")
async def cancel_follow_up_route(
    follow_up_id: int,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Dismiss a follow-up without sending."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from services.follow_up_scheduler import cancel_follow_up
    ok = cancel_follow_up(follow_up_id, email, db)
    if not ok:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return {"success": True, "id": follow_up_id, "status": "cancelled"}


@router.post("/follow-ups/draft")
async def draft_follow_up(
    request: FollowUpDraftRequest,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """Generate a polished follow-up email draft for a specific commitment."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        from services.follow_up_hunter import generate_follow_up_draft
        draft = await generate_follow_up_draft(
            original_subject=request.subject,
            commitment_text=request.commitment,
            recipient=request.recipient,
            days_ago=request.days_ago,
        )
        return {
            "draft": draft,
            "suggested_subject": f"Following up: {request.subject}",
            "recipient": request.recipient,
        }
    except Exception as e:
        logger.error(f"follow-up draft error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Morning Briefing ─────────────────────────────────────────────────────────────

@router.get("/briefing")
async def get_briefing(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate and return the morning briefing without sending an email."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        from services.briefing_agent import generate_briefing
        briefing = await generate_briefing(user_email=email, db=db)
        return briefing
    except Exception as e:
        logger.error(f"briefing route error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/briefing/run")
async def run_briefing(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate the briefing AND send it to the user's email inbox."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        from services.briefing_agent import run_briefing_and_email
        result = await run_briefing_and_email(user_email=email, db=db)
        return {
            "success": True,
            "email_sent": result.get("email_sent", False),
            "narrative": result.get("narrative", ""),
            "summary": {
                "unread_emails": result["email"].get("unread_count", 0),
                "urgent_emails": result["email"].get("urgent_count", 0),
                "meetings_today": result["calendar"].get("event_count", 0),
                "pending_follow_ups": result["follow_ups"].get("count", 0),
            },
        }
    except Exception as e:
        logger.error(f"briefing/run error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/briefing/settings")
async def get_briefing_settings(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the user's current briefing schedule settings."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "enabled": bool(getattr(user, "briefing_enabled", False)),
        "time": getattr(user, "briefing_time", "06:00") or "06:00",
    }


@router.put("/briefing/settings")
async def update_briefing_settings(
    request: BriefingSettingsRequest,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enable/disable the morning briefing and set the delivery time (Local HH:MM)."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Validate time format (allow multiple comma-separated HH:MM)
    import re
    times = [t.strip() for t in request.time.split(",")]
    for t in times:
        if not re.match(r"^\d{2}:\d{2}$", t):
            raise HTTPException(status_code=400, detail="Each time must be in HH:MM format")

    user.briefing_enabled = request.enabled
    user.briefing_time = ",".join(times)
    db.commit()

    return {
        "success": True,
        "enabled": request.enabled,
        "time": request.time,
        "message": (
            f"Briefing scheduled daily at {request.time}."
            if request.enabled
            else "Briefing disabled."
        ),
    }


# ── Relationship Intelligence ──────────────────────────────────────────────────

@router.get("/relationship")
async def get_relationship(
    email: str = Query(...),
    contact: str = Query(..., description="Email address of the contact to analyze"),
    days: int = Query(default=60, ge=7, le=180),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a relationship intelligence card for a specific contact."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not contact or "@" not in contact:
        raise HTTPException(status_code=400, detail="'contact' must be a valid email address")

    try:
        from services.relationship_intelligence import get_relationship_card
        card = await get_relationship_card(
            user_email=email,
            contact_email=contact,
            db=db,
            scan_days=days,
        )
        return card
    except Exception as e:
        logger.error(f"relationship route error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Auto-Reply Settings ────────────────────────────────────────────────────────

class AutoReplySettingsRequest(BaseModel):
    enabled: bool


@router.get("/auto-reply/settings")
async def get_auto_reply_settings(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the user's current auto-reply enabled state."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {"enabled": bool(getattr(user, "auto_reply_enabled", False))}


@router.put("/auto-reply/settings")
async def update_auto_reply_settings(
    request: AutoReplySettingsRequest,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enable or disable auto-reply.  Frontend must show a danger confirmation before calling."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.auto_reply_enabled = request.enabled
    db.commit()
    return {
        "success": True,
        "enabled": request.enabled,
        "message": "Auto-reply enabled." if request.enabled else "Auto-reply disabled.",
    }


@router.delete("/auto-reply/{reply_id}")
async def cancel_auto_reply(
    reply_id: int,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel a pending auto-reply within the 2-minute window."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from auth.models import PendingAutoReply
    row = db.query(PendingAutoReply).filter(
        PendingAutoReply.id == reply_id,
        PendingAutoReply.user_email == email,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Pending reply not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Reply already {row.status}")

    row.status = "cancelled"
    db.commit()
    return {"success": True, "id": reply_id, "status": "cancelled"}


# ── Smart Inbox Monitoring ─────────────────────────────────────────────────────

@router.post("/monitoring/start")
async def start_inbox_monitoring(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Register a Gmail watch and enable real-time inbox monitoring."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from services.monitoring_service import monitoring_service
    success = await monitoring_service.start_monitoring(email, db)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to start monitoring")
        
    return {"success": True, "message": "Smart Inbox monitoring started"}


@router.post("/monitoring/stop")
async def stop_inbox_monitoring(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stop Gmail watch and disable real-time monitoring."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from services.monitoring_service import monitoring_service
    success = await monitoring_service.stop_monitoring(email, db)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to stop monitoring")
        
    return {"success": True, "message": "Smart Inbox monitoring stopped"}
