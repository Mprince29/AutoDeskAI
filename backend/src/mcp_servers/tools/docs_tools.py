from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from auth.database import get_db
from services.google_workspace_service import GoogleWorkspaceService
from services.redis_service import cache_google_api
from loguru import logger

router = APIRouter()


@cache_google_api(ttl_seconds=300)
async def _cached_list_docs(email: str, max_results: int, db: Session):
    svc = GoogleWorkspaceService(email, db)
    return await svc.list_docs(max_results=max_results)


@cache_google_api(ttl_seconds=180)
async def _cached_search_docs(email: str, query: str, db: Session):
    svc = GoogleWorkspaceService(email, db)
    return await svc.search_drive_files(name_query=query)

@router.get("/list")
async def list_google_docs(
    email: str = Query(..., description="User email"),
    max_results: int = Query(50, description="Max results to return"),
    db: Session = Depends(get_db)
):
    """Fetch the list of Google Docs for the connected user."""
    try:
        return await _cached_list_docs(email, max_results, db)
    except Exception as e:
        logger.error(f"Failed to list Google Docs for {email}: {e}")
        return {"success": False, "error": str(e)}

@router.get("/search")
async def search_google_docs(
    email: str = Query(..., description="User email"),
    query: str = Query(..., description="Search query"),
    db: Session = Depends(get_db)
):
    """Search for Google Docs by name."""
    try:
        return await _cached_search_docs(email, query, db)
    except Exception as e:
        logger.error(f"Failed to search Google Docs for {email}: {e}")
        return {"success": False, "error": str(e)}
