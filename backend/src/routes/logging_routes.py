from fastapi import APIRouter, Depends, Request, Body
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional, List, Union
from auth.routes import get_db
from utils.activity_logger import record_activity
from pydantic import BaseModel

router = APIRouter(prefix="/logs", tags=["logging"])

class ClientLogRequest(BaseModel):
    level: str = "INFO"
    message: str = ""
    action: Optional[str] = None
    url: Optional[str] = None
    stack: Optional[str] = None
    email: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

class ClientLogBatch(BaseModel):
    events: List[ClientLogRequest]

def _record_one(db: Session, entry: ClientLogRequest, ua: str, request: Request):
    record_activity(
        db,
        user_email=entry.email or "anonymous_client",
        action=f"client_event:{(entry.action or entry.level).strip()[:60]}",
        entity_type="client",
        status="failed" if entry.level in ("ERROR", "CRITICAL") else "success",
        level=entry.level,
        error_message=entry.message or entry.action or "",
        details={
            "url": entry.url,
            "stack": entry.stack,
            "browser_details": ua,
            **(entry.details or {})
        },
        request=request
    )

@router.post("/client")
async def log_client_event(
    request: Request,
    db: Session = Depends(get_db)
):
    """Accept either a single event or a batched {events:[...]} payload."""
    ua = request.headers.get("user-agent", "")
    try:
        raw = await request.json()
    except Exception:
        return {"success": False}

    if "events" in raw:
        # Batched payload from ActivityTelemetry flush
        batch = ClientLogBatch(**raw)
        for entry in batch.events[:50]:   # cap at 50 per flush
            _record_one(db, entry, ua, request)
    else:
        # Legacy single-event payload
        entry = ClientLogRequest(**raw)
        _record_one(db, entry, ua, request)

    return {"success": True}

@router.post("/security")
async def log_security_event(
    request: Request,
    action: str = Body(...),
    email: str = Body(...),
    status: str = Body("success"),
    details: Dict[str, Any] = Body(None),
    db: Session = Depends(get_db)
):
    """
    Internal endpoint (or frontend-triggered) for sensitive security audits.
    """
    record_activity(
        db,
        user_email=email,
        action=f"security_audit:{action}",
        status=status,
        level="WARNING" if status == "failed" else "INFO",
        details=details,
        request=request
    )
    return {"success": True}
