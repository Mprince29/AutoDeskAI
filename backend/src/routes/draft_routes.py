from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.database import get_db
from auth.models import ContentDraft, User
from auth.routes import get_current_user
from mcp_servers.tools.draft_tools import tool_save_draft

router = APIRouter(prefix="/drafts", tags=["drafts"])


class DraftUpdateRequest(BaseModel):
    content: str
    title: str | None = None


def _serialize_draft(draft: ContentDraft) -> dict:
    return {
        "id": draft.id,
        "user_email": draft.user_email,
        "draft_type": draft.draft_type,
        "title": draft.title,
        "content": draft.content,
        "format": draft.fmt,
        "status": draft.status,
        "saved_url": draft.saved_url,
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
    }


def _get_owned_draft(db: Session, draft_id: str, email: str) -> ContentDraft:
    draft = db.query(ContentDraft).filter(ContentDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.user_email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this draft")
    return draft


@router.get("/{draft_id}")
async def get_draft(
    draft_id: str,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    draft = _get_owned_draft(db, draft_id, email)
    return {"draft": _serialize_draft(draft)}


@router.put("/{draft_id}")
async def update_draft(
    draft_id: str,
    payload: DraftUpdateRequest,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    draft = _get_owned_draft(db, draft_id, email)
    if draft.status == "saved":
        raise HTTPException(status_code=400, detail="This draft has already been saved.")

    draft.content = payload.content
    if payload.title:
        draft.title = payload.title
    db.commit()
    db.refresh(draft)
    return {"draft": _serialize_draft(draft)}


@router.post("/{draft_id}/save")
async def save_draft(
    draft_id: str,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    result = await tool_save_draft(user_email=email, db=db, draft_id=draft_id)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    draft = _get_owned_draft(db, draft_id, email)
    return {
        "draft": _serialize_draft(draft),
        "result": result,
    }
