"""
Social Media Tool — API Routes
Prefix: /api/social

News Digest:
  POST   /news/digest                      trigger digest generation (background)
  GET    /news/digests                     list past digests for user
  GET    /news/digest/{digest_id}          fetch digest + stories
  DELETE /news/digest/{digest_id}          delete a digest

ORM — Online Reputation Management:
  POST   /orm/scan                         kick off a scan (background)
  GET    /orm/posts                        list discovered posts (paginated, filterable)
  GET    /orm/posts/{post_id}              single post + suggestions
  POST   /orm/posts/{post_id}/suggest      (re-)generate comment suggestions
  POST   /orm/posts/{post_id}/approve      approve a suggestion as final comment
  POST   /orm/posts/{post_id}/reject       mark post as rejected
  DELETE /orm/posts/{post_id}              hard delete
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.database import get_db
from auth.models import (
    NewsDigest,
    NewsStory,
    OrmPost,
    OrmCommentSuggestion,
    OrmScanLog,
    User,
)
from services.news_digest import run_digest
from services.orm_scanner import run_scan
from loguru import logger

router = APIRouter(tags=["social"])


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────────────────────────────────────

class DigestRequest(BaseModel):
    email: str
    geo: str = Field("all", description="us | eu | india | all")


class ScanRequest(BaseModel):
    email: str
    keywords: list[str] = Field(..., min_length=1, description="Topics / niche keywords to search for")
    platforms: list[str] = Field(default=["linkedin"], description="linkedin | twitter | instagram")
    niche: str = Field("AI technology community", description="Niche context for relevance scoring")
    brand_context: str = Field(
        "An AI-focused company building tools for business teams",
        description="2-3 sentences describing the brand so relevance scoring is accurate",
    )
    brand_voice: str = Field(
        "Conversational, knowledgeable, not salesy. Peer-to-peer tone.",
        description="Describe how the brand sounds in comments",
    )
    brand_name: str = Field("M37 Labs", description="Brand name used in comment generation")
    geo: str = Field("us", description="us | eu | india | all")


class ApproveRequest(BaseModel):
    email: str
    suggestion_id: int = Field(..., description="ID of the OrmCommentSuggestion to approve")


class RejectRequest(BaseModel):
    email: str


class RegenerateSuggestRequest(BaseModel):
    email: str
    brand_voice: str = Field("Conversational, knowledgeable, not salesy. Peer-to-peer tone.")
    brand_name: str = Field("M37 Labs")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _serpapi_key() -> str:
    key = os.getenv("SERPAPI_API_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="SERPAPI_API_KEY not configured")
    return key


def _firecrawl_key() -> Optional[str]:
    return os.getenv("FIRECRAWL_API_KEY") or None


def _digest_dict(d: NewsDigest) -> dict:
    return {
        "id":          d.id,
        "user_email":  d.user_email,
        "geo":         d.geo,
        "status":      d.status,
        "story_count": d.story_count,
        "created_at":  d.created_at.isoformat() if d.created_at else None,
    }


def _story_dict(s: NewsStory) -> dict:
    return {
        "id":            s.id,
        "headline":      s.headline,
        "source":        s.source,
        "url":           s.url,
        "plain_summary": s.plain_summary,
        "company_info":  s.company_info,
        "relevance_tag": s.relevance_tag,
        "geo_tag":       s.geo_tag,
        "published_at":  s.published_at,
    }


def _post_dict(p: OrmPost, include_suggestions: bool = False) -> dict:
    d: dict = {
        "id":               p.id,
        "platform":         p.platform,
        "post_url":         p.post_url,
        "post_author":      p.post_author,
        "post_content":     p.post_content,
        "relevance_score":  p.relevance_score,
        "relevance_reason": p.relevance_reason,
        "status":           p.status,
        "scan_keyword":     p.scan_keyword,
        "approved_comment": p.approved_comment,
        "discovered_at":    p.discovered_at.isoformat() if p.discovered_at else None,
        "actioned_at":      p.actioned_at.isoformat() if p.actioned_at else None,
    }
    if include_suggestions:
        d["suggestions"] = [_suggestion_dict(s) for s in p.suggestions]
    return d


def _scan_log_dict(s: OrmScanLog) -> dict:
    return {
        "id":          s.id,
        "status":      s.status,
        "keywords":    s.keywords,
        "platforms":   s.platforms,
        "geo":         s.geo,
        "posts_found": s.posts_found,
        "error":       s.error,
        "started_at":  s.started_at.isoformat() if s.started_at else None,
        "finished_at": s.finished_at.isoformat() if s.finished_at else None,
    }


def _suggestion_dict(s: OrmCommentSuggestion) -> dict:
    return {
        "id":           s.id,
        "tone":         s.tone,
        "comment_text": s.comment_text,
        "generated_at": s.generated_at.isoformat() if s.generated_at else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Background workers
# ─────────────────────────────────────────────────────────────────────────────

async def _run_digest_bg(digest_id: int, user_email: str, geo: str):
    """Background task: run full news digest pipeline and persist results."""
    from auth.database import SessionLocal
    db = SessionLocal()
    try:
        serpapi_key = os.getenv("SERPAPI_API_KEY", "")
        if not serpapi_key:
            _mark_digest_failed(db, digest_id, "SERPAPI_API_KEY not configured")
            return

        stories = await run_digest(user_email, geo, serpapi_key)

        digest = db.query(NewsDigest).filter(NewsDigest.id == digest_id).first()
        if not digest:
            logger.error(f"[NewsDigest] Digest {digest_id} row missing after pipeline ran")
            return

        for s in stories:
            db.add(NewsStory(
                digest_id    = digest_id,
                headline     = s.get("headline", ""),
                source       = s.get("source", ""),
                url          = s.get("url", ""),
                plain_summary= s.get("plain_summary", ""),
                company_info = s.get("company_info", ""),
                relevance_tag= s.get("relevance_tag", ""),
                geo_tag      = s.get("geo_tag", geo),
                published_at = s.get("published_at", ""),
            ))

        digest.status      = "done"
        digest.story_count = len(stories)
        db.commit()
        logger.info(f"[NewsDigest] Digest {digest_id} complete: {len(stories)} stories")
    except Exception as e:
        logger.error(f"[NewsDigest] Digest {digest_id} failed: {e}")
        _mark_digest_failed(db, digest_id, str(e))
    finally:
        db.close()


def _mark_digest_failed(db: Session, digest_id: int, reason: str):
    digest = db.query(NewsDigest).filter(NewsDigest.id == digest_id).first()
    if digest:
        digest.status = "failed"
        db.commit()
    logger.error(f"[NewsDigest] Digest {digest_id} marked failed: {reason}")


async def _run_scan_bg(
    scan_log_id: int,
    user_email: str,
    keywords: list[str],
    platforms: list[str],
    niche: str,
    brand_context: str,
    brand_voice: str,
    brand_name: str,
    geo: str,
    user_id: Optional[int] = None,
):
    """Background task: run ORM scan, persist posts + suggestions, update scan log."""
    from auth.database import SessionLocal
    db = SessionLocal()
    try:
        serpapi_key = os.getenv("SERPAPI_API_KEY", "")
        if not serpapi_key:
            _mark_scan_failed(db, scan_log_id, "SERPAPI_API_KEY not configured")
            return

        firecrawl_key = os.getenv("FIRECRAWL_API_KEY") or None

        posts = await run_scan(
            user_email    = user_email,
            keywords      = keywords,
            platforms     = platforms,
            niche         = niche,
            brand_context = brand_context,
            brand_voice   = brand_voice,
            brand_name    = brand_name,
            serpapi_key   = serpapi_key,
            firecrawl_key = firecrawl_key,
            geo           = geo,
            user_id       = user_id,
            db            = db,
        )

        for p in posts:
            orm_post = OrmPost(
                user_email       = user_email,
                scan_id          = scan_log_id,
                platform         = p["platform"],
                post_url         = p.get("post_url", ""),
                post_author      = p.get("post_author", ""),
                post_content     = p.get("post_content", ""),
                relevance_score  = p.get("relevance_score", 0.0),
                relevance_reason = p.get("relevance_reason", ""),
                scan_keyword     = p.get("scan_keyword", ""),
                status           = "pending",
            )
            db.add(orm_post)
            db.flush()

            for sug in p.get("suggestions", []):
                db.add(OrmCommentSuggestion(
                    post_id      = orm_post.id,
                    comment_text = sug["comment_text"],
                    tone         = sug.get("tone", ""),
                ))

        scan_log = db.query(OrmScanLog).filter(OrmScanLog.id == scan_log_id).first()
        if scan_log:
            scan_log.status      = "done"
            scan_log.posts_found = len(posts)
            scan_log.finished_at = datetime.now(timezone.utc)

        db.commit()
        logger.info(f"[ORM] Scan {scan_log_id} complete: {len(posts)} posts for user={user_email}")
    except Exception as e:
        logger.error(f"[ORM] Scan {scan_log_id} failed for user={user_email}: {e}")
        _mark_scan_failed(db, scan_log_id, str(e))
    finally:
        db.close()


def _mark_scan_failed(db: Session, scan_log_id: int, reason: str):
    scan_log = db.query(OrmScanLog).filter(OrmScanLog.id == scan_log_id).first()
    if scan_log:
        scan_log.status   = "failed"
        scan_log.error    = reason
        scan_log.finished_at = datetime.now(timezone.utc)
        db.commit()
    logger.error(f"[ORM] Scan {scan_log_id} marked failed: {reason}")


# ─────────────────────────────────────────────────────────────────────────────
# News Digest endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/news/digest", status_code=202)
async def trigger_digest(body: DigestRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Start a news digest generation job. Returns immediately; poll GET /news/digest/{id}."""
    _serpapi_key()  # fail fast if not configured

    if body.geo not in ("us", "eu", "india", "all"):
        raise HTTPException(status_code=422, detail="geo must be: us | eu | india | all")

    digest = NewsDigest(user_email=body.email, geo=body.geo, status="pending")
    db.add(digest)
    db.commit()
    db.refresh(digest)

    background_tasks.add_task(_run_digest_bg, digest.id, body.email, body.geo)
    return {"digest_id": digest.id, "status": "pending", "message": "Digest generation started"}


@router.get("/news/digests")
def list_digests(email: str = Query(...), db: Session = Depends(get_db)):
    """List all past digests for a user, newest first."""
    digests = (
        db.query(NewsDigest)
        .filter(NewsDigest.user_email == email)
        .order_by(NewsDigest.created_at.desc())
        .all()
    )
    return [_digest_dict(d) for d in digests]


@router.get("/news/digest/{digest_id}")
def get_digest(digest_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    """Fetch a digest and all its stories."""
    digest = db.query(NewsDigest).filter(
        NewsDigest.id == digest_id,
        NewsDigest.user_email == email,
    ).first()
    if not digest:
        raise HTTPException(status_code=404, detail="Digest not found")

    result = _digest_dict(digest)
    result["stories"] = [_story_dict(s) for s in digest.stories]
    return result


@router.delete("/news/digest/{digest_id}", status_code=204)
def delete_digest(digest_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    digest = db.query(NewsDigest).filter(
        NewsDigest.id == digest_id,
        NewsDigest.user_email == email,
    ).first()
    if not digest:
        raise HTTPException(status_code=404, detail="Digest not found")
    db.delete(digest)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# ORM endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/orm/scan", status_code=202)
async def trigger_scan(body: ScanRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Kick off an ORM scan. Runs in background.
    New posts appear in GET /orm/posts as the scan completes.
    """
    _serpapi_key()

    valid_platforms = {"linkedin", "twitter", "instagram"}
    bad = [p for p in body.platforms if p not in valid_platforms]
    if bad:
        raise HTTPException(status_code=422, detail=f"Invalid platforms: {bad}. Use: linkedin | twitter | instagram")

    if not body.keywords:
        raise HTTPException(status_code=422, detail="At least one keyword required")

    scan_log = OrmScanLog(
        user_email = body.email,
        keywords   = body.keywords,
        platforms  = body.platforms,
        geo        = body.geo,
        status     = "running",
    )
    db.add(scan_log)
    db.commit()
    db.refresh(scan_log)

    _scan_user = db.query(User).filter(User.email == body.email).first()
    _scan_user_id = _scan_user.id if _scan_user else None

    background_tasks.add_task(
        _run_scan_bg,
        scan_log.id,
        body.email,
        body.keywords,
        body.platforms,
        body.niche,
        body.brand_context,
        body.brand_voice,
        body.brand_name,
        body.geo,
        _scan_user_id,
    )
    return {
        "scan_id": scan_log.id,
        "status":  "running",
        "message": f"ORM scan started for {len(body.keywords)} keyword(s) across {body.platforms}",
    }


@router.get("/orm/scans")
def list_scans(email: str = Query(...), db: Session = Depends(get_db)):
    """List all ORM scan runs for a user, newest first."""
    scans = (
        db.query(OrmScanLog)
        .filter(OrmScanLog.user_email == email)
        .order_by(OrmScanLog.started_at.desc())
        .limit(50)
        .all()
    )
    return [_scan_log_dict(s) for s in scans]


@router.get("/orm/scans/{scan_id}")
def get_scan_status(scan_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    """Poll this to know when a scan is done. status: running | done | failed."""
    scan = db.query(OrmScanLog).filter(OrmScanLog.id == scan_id, OrmScanLog.user_email == email).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _scan_log_dict(scan)


@router.get("/orm/posts")
def list_posts(
    email: str = Query(...),
    platform: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="pending | approved | rejected"),
    scan_id: Optional[int] = Query(None, description="filter by scan log ID"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List ORM posts, newest-first. Filter by platform and/or status."""
    
    # temporary auto-backfill for missing scan_id
    posts_missing = db.query(OrmPost).filter(OrmPost.scan_id == None).all()
    if posts_missing:
        scans = db.query(OrmScanLog).all()
        for post in posts_missing:
            matched_scan = None
            for s in scans:
                if post.scan_keyword and s.keywords and post.scan_keyword in s.keywords:
                    matched_scan = s
                    break
            if not matched_scan and scans:
                matched_scan = scans[-1] # fallback to latest scan
            if matched_scan:
                post.scan_id = matched_scan.id
        db.commit()

    q = db.query(OrmPost).filter(OrmPost.user_email == email)
    if platform:
        q = q.filter(OrmPost.platform == platform)
    if status:
        q = q.filter(OrmPost.status == status)
    if scan_id:
        q = q.filter(OrmPost.scan_id == scan_id)
    posts = q.order_by(OrmPost.relevance_score.desc(), OrmPost.discovered_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": q.count(),
        "posts": [_post_dict(p) for p in posts],
    }


@router.get("/orm/posts/{post_id}")
def get_post(post_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    """Fetch a single post with all its comment suggestions."""
    post = db.query(OrmPost).filter(OrmPost.id == post_id, OrmPost.user_email == email).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return _post_dict(post, include_suggestions=True)


@router.post("/orm/posts/{post_id}/suggest")
async def regenerate_suggestions(post_id: int, body: RegenerateSuggestRequest, db: Session = Depends(get_db)):
    """
    Re-generate comment suggestions for a post.
    Deletes existing suggestions and generates fresh ones.
    """
    post = db.query(OrmPost).filter(OrmPost.id == post_id, OrmPost.user_email == body.email).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Delete old suggestions
    db.query(OrmCommentSuggestion).filter(OrmCommentSuggestion.post_id == post_id).delete()
    db.commit()

    _regen_user = db.query(User).filter(User.email == body.email).first()
    _regen_user_id = _regen_user.id if _regen_user else None

    from services.orm_scanner import _generate_comments
    suggestions = await _generate_comments(
        post={"platform": post.platform, "post_content": post.post_content or ""},
        brand_voice=body.brand_voice,
        brand_name=body.brand_name,
        user_id=_regen_user_id,
        db=db,
    )

    if not suggestions:
        raise HTTPException(status_code=422, detail="Could not generate suggestions — post content may be too short")

    new_suggestions = []
    for s in suggestions:
        row = OrmCommentSuggestion(
            post_id      = post_id,
            comment_text = s["comment_text"],
            tone         = s.get("tone", ""),
        )
        db.add(row)
        new_suggestions.append(row)
    db.commit()
    for r in new_suggestions:
        db.refresh(r)

    return {"suggestions": [_suggestion_dict(s) for s in new_suggestions]}


@router.post("/orm/posts/{post_id}/approve")
def approve_post(post_id: int, body: ApproveRequest, db: Session = Depends(get_db)):
    """
    Approve a specific suggestion as the final comment.
    Marks post status=approved and stores the chosen text.
    Does NOT post anything — human copies and posts manually.
    """
    post = db.query(OrmPost).filter(OrmPost.id == post_id, OrmPost.user_email == body.email).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    suggestion = db.query(OrmCommentSuggestion).filter(
        OrmCommentSuggestion.id      == body.suggestion_id,
        OrmCommentSuggestion.post_id == post_id,
    ).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    post.status           = "approved"
    post.approved_comment = suggestion.comment_text
    post.actioned_at      = datetime.now(timezone.utc)
    db.commit()

    return {
        "status":           "approved",
        "approved_comment": post.approved_comment,
        "post_url":         post.post_url,
        "platform":         post.platform,
    }


@router.post("/orm/posts/{post_id}/reject")
def reject_post(post_id: int, body: RejectRequest, db: Session = Depends(get_db)):
    """Mark a post as rejected — won't show in pending queue."""
    post = db.query(OrmPost).filter(OrmPost.id == post_id, OrmPost.user_email == body.email).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    post.status      = "rejected"
    post.actioned_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "rejected"}


@router.delete("/orm/posts/{post_id}", status_code=204)
def delete_post(post_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    post = db.query(OrmPost).filter(OrmPost.id == post_id, OrmPost.user_email == email).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    db.delete(post)
    db.commit()
