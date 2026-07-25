from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from auth.database import get_db
from services.google_workspace_service import GoogleWorkspaceService
from services.redis_service import cache_google_api
from loguru import logger
from typing import Literal

router = APIRouter()


@cache_google_api(ttl_seconds=300)
async def _cached_list_workspace_assets(email: str, type: str, max_results: int, db: Session):
    svc = GoogleWorkspaceService(email, db)
    if type == "sheets":
        return await svc.list_sheets(max_results=max_results)
    if type == "slides":
        return await svc.list_slides(max_results=max_results)
    if type == "forms":
        return await svc.list_forms(max_results=max_results)
    if type == "drive":
        return await svc.list_files(max_results=max_results)
    if type == "docs":
        return await svc.list_docs(max_results=max_results)
    return await svc.list_tasks(max_results=max_results)

@router.get("/list")
async def list_workspace_assets(
    type: Literal["sheets", "slides", "forms", "tasks", "drive", "docs"] = Query(..., description="Type of asset to list"),
    email: str = Query(..., description="User email"),
    max_results: int = Query(50, description="Max results to return"),
    db: Session = Depends(get_db)
):
    """Fetch the list of Google Workspace assets (Sheets, Slides, Forms, Tasks, or all Drive files)."""
    try:
        if type == "tasks":
            svc = GoogleWorkspaceService(email, db)
            return await svc.list_tasks(max_results=max_results)
        return await _cached_list_workspace_assets(email, type, max_results, db)
            
    except Exception as e:
        logger.error(f"Failed to list {type} for {email}: {e}")
        return {"success": False, "error": str(e)}

from pydantic import BaseModel
from typing import Optional

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

@router.patch("/tasks/{task_id}")
async def update_workspace_task(
    task_id: str,
    update_data: TaskUpdate,
    email: str = Query(..., description="User email"),
    db: Session = Depends(get_db)
):
    try:
        svc = GoogleWorkspaceService(email, db)
        return await svc.update_task(
            task_id=task_id, 
            title=update_data.title, 
            notes=update_data.notes, 
            status=update_data.status
        )
    except Exception as e:
        logger.error(f"Failed to update task {task_id} for {email}: {e}")
        return {"success": False, "error": str(e)}
