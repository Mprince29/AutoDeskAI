import json
from typing import Optional, Any, Dict
from loguru import logger
from sqlalchemy.orm import Session
from fastapi import Request
from auth.models import ActivityLog, User

# Max byte size for the serialized details JSON stored in DB.
# Keeps each row lean; anything beyond this is silently truncated.
_DETAILS_MAX_BYTES = 512


def _compact_details(details: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Strip None values, truncate long strings, cap total JSON size."""
    if not details:
        return None
    # Drop None values and truncate individual string fields to 200 chars
    cleaned = {
        k: (v[:200] if isinstance(v, str) and len(v) > 200 else v)
        for k, v in details.items()
        if v is not None and v != "" and v != []
    }
    if not cleaned:
        return None
    # Cap total serialized size
    serialized = json.dumps(cleaned, ensure_ascii=False)
    if len(serialized.encode()) > _DETAILS_MAX_BYTES:
        # Drop fields from the end until it fits
        keys = list(cleaned.keys())
        while keys and len(json.dumps({k: cleaned[k] for k in keys}, ensure_ascii=False).encode()) > _DETAILS_MAX_BYTES:
            keys.pop()
        cleaned = {k: cleaned[k] for k in keys}
    return cleaned or None


def record_activity(
    db: Optional[Session],
    user_email: str,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    status: str = "success",
    error_message: Optional[str] = None,
    level: Optional[str] = None,
    module: Optional[str] = None,
    request: Optional[Request] = None,
    user_id: Optional[int] = None
):
    """Record a user activity in the database with compact storage.

    Always opens its own session so callers can pass db=None when firing from
    a background thread (avoids racing against the FastAPI get_db() teardown).
    """
    from auth.database import SessionLocal
    own_session = db is None
    db = db or SessionLocal()
    try:
        if user_id is None and user_email and not user_email.startswith("anonymous"):
            user = db.query(User.id).filter(User.email == user_email).first()
            user_id = user[0] if user else None

        log = ActivityLog(
            user_id=user_id,
            user_email=user_email,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id)[:100] if entity_id is not None else None,
            status=status,
            error_message=error_message[:500] if error_message else None,
            details=_compact_details(details),
            level=level,
            module=module,
            ip_address=request.client.host if request and request.client else None
        )
        db.add(log)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to record activity log: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        if own_session:
            db.close()
