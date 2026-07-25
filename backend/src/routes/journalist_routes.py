"""
AI Journalist Tool - API routes.

Endpoints:
  POST /api/journalist/generate-content   SSE pipeline (research → outline → write → audit)
  POST /api/journalist/upload             Upload PDF/TXT and extract text for grounding
  POST /api/journalist/generate-image     Generate cover image (Imagen 4 → DALL-E 3 fallback)
  POST /api/journalist/generate-social-kit  Generate social media kit from article content
"""

import io
import os
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from pypdf import PdfReader
from loguru import logger
from auth.routes import get_current_user
from auth.database import get_db
from models import JournalistReport, JournalistReportResponse, JournalistSessionResponse
from services.journalist.orchestrator import JournalistOrchestrator
from utils.activity_logger import record_activity

router = APIRouter(prefix="/journalist", tags=["journalist"])

# One shared orchestrator instance (services are stateless)
_orchestrator = JournalistOrchestrator()


# ── Request / Response models ──────────────────────────────────────────────────

class ContentRequest(BaseModel):
    query: str = Field(..., description="The main topic or query")
    category: str = Field("Technology", description="Domain category")
    tone: str = Field("Analytical", description="Writing tone")
    persona: str = Field("Analytical", description="Newsroom persona")
    enable_web_search: bool = Field(True, description="Use live Google Search grounding")
    target_audience: str = Field("General Professionals")
    sources: List[str] = Field(default_factory=list, description="Optional research URLs")
    grounding_sources: List[Dict[str, str]] = Field(default_factory=list, description="Uploaded docs {name, content}")
    history: List[Dict[str, str]] = Field(default_factory=list, description="Chat history")
    report_id: Optional[int] = Field(None, description="Existing report ID to update versions")
    session_id: Optional[str] = Field(None, description="Session ID to group multiple reports")
    brand_voice: str = Field("Professional", description="Specific editorial brand voice")
    language: str = Field("English", description="Target output language")

class ReportSaveRequest(BaseModel):
    markdown_content: str
    topic: Optional[str] = None
    category: Optional[str] = None

class AudioRequest(BaseModel):
    content: str = Field(..., description="Article markdown content")
    report_id: Optional[int] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/generate-content")
async def generate_content(
    request_body: ContentRequest,
    request: Request,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    logger.info(f"Journalist: INCOMING REQUEST for query: {request_body.query}")
    """Stream the multi-stage AI journalist pipeline as Server-Sent Events."""
    logger.info(f"Journalist: Generating content for query: {request_body.query}")
    try:
        _orchestrator._assert_pipeline_keys(_current_user.email, db)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    record_activity(
        db, _current_user.email, "generate_journalist_report",
        entity_type="journalist_report",
        details={"query": request_body.query, "category": request_body.category},
        request=request
    )

    return StreamingResponse(
        _orchestrator.run_pipeline(
            topic=request_body.query,
            category=request_body.category,
            tone=request_body.tone,
            target_audience=request_body.target_audience,
            user_id=_current_user.id,
            user_email=_current_user.email,
            db=db,
            persona=request_body.persona,
            enable_web_search=request_body.enable_web_search,
            sources=request_body.sources,
            grounding_sources=request_body.grounding_sources,
            history=request_body.history,
            report_id=request_body.report_id,
            session_id=request_body.session_id,
            brand_voice=request_body.brand_voice,
            language=request_body.language,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    _current_user=Depends(get_current_user),
):
    """Extract text from a PDF or TXT file for use as grounding source."""
    filename = file.filename or "upload"
    logger.info(f"Journalist: Uploading file: {filename}")
    content = ""

    try:
        if filename.lower().endswith(".pdf"):
            raw = await file.read()
            reader = PdfReader(io.BytesIO(raw))
            for page in reader.pages:
                content += (page.extract_text() or "") + "\n"
        elif filename.lower().endswith(".txt"):
            content = (await file.read()).decode("utf-8")
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Upload PDF or TXT.")

        return {"name": filename, "content": content}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


class TranslateRequest(BaseModel):
    content: str = Field(..., description="Article markdown content to translate")
    target_language: str = Field(..., description="Target language (e.g. Hindi, Spanish)")


@router.post("/translate")
async def translate_article(
    request_body: TranslateRequest,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Translate article content into the target language using the user's configured LLM."""
    from services.journalist.orchestrator import _resolve_journalist_keys
    from services.journalist.llm_service import JournalistLLMService
    import litellm

    logger.info(f"Journalist: Translating article to {request_body.target_language} for {_current_user.email}")

    try:
        _gemini_key, llm_provider, llm_api_key, _openai_key = _resolve_journalist_keys(_current_user.email, db)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No AI provider configured. Add an API key in Settings → AI Provider.")

    llm_svc = JournalistLLMService(provider=llm_provider, api_key=llm_api_key)

    system = (
        "You are a professional multilingual editor. "
        "Translate the article faithfully, preserving all markdown formatting, "
        "headings, bold, bullet points, links, and the editorial voice of the original. "
        "Return ONLY the translated markdown — no preamble, no explanation."
    )
    user_prompt = (
        f"Translate the following article into **{request_body.target_language}**.\n\n"
        f"{request_body.content[:12000]}"
    )

    try:
        response = await litellm.acompletion(
            model=llm_svc.model_large,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            **llm_svc._call_kwargs(llm_svc.model_large),
        )
        translated = response.choices[0].message.content or ""
        return {"translated_content": translated.strip(), "language": request_body.target_language}
    except Exception as e:
        logger.error(f"Journalist: Translation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")


@router.post("/generate-image")
async def generate_image(
    request: Dict[str, Any],
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a cover image for an article topic."""
    topic = request.get("topic")
    category = request.get("category", "General")
    article_content = request.get("article_content") # New: content for visual grounding
    report_id = request.get("report_id") # New: for DB persistence
    
    logger.info(f"Journalist: Generating cover image for topic: {topic}")
    if not topic:
        raise HTTPException(status_code=400, detail="topic is required")

    gemini_svc, _llm = _orchestrator._make_services(_current_user.email, db)
    try:
        image_url = await gemini_svc.generate_cover_image(topic, category, article_content)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    # Persist to DB if report_id provided
    if report_id:
        report = db.query(JournalistReport).filter(JournalistReport.id == report_id, JournalistReport.user_id == _current_user.id).first()
        if report:
            report.image_url = image_url
            db.commit()
            logger.info(f"Journalist: Persisted cover image to report {report_id}")

    return {"image_url": image_url}


@router.post("/generate-social-kit")
async def generate_social_kit(
    request: Dict[str, Any],
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a social media distribution kit from article content."""
    article_content = request.get("article_content")
    report_id = request.get("report_id") # New: for DB persistence
    
    logger.info("Journalist: Generating social kit for article content")
    if not article_content:
        raise HTTPException(status_code=400, detail="article_content is required")

    _, llm_svc = _orchestrator._make_services(_current_user.email, db)
    if not llm_svc:
        raise HTTPException(status_code=400, detail="Social kit generation requires an AI provider key. Please add one in Settings → AI Provider.")
    try:
        kit = await llm_svc.generate_social_kit(article_content)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    # Persist to DB if report_id provided
    if report_id:
        report = db.query(JournalistReport).filter(JournalistReport.id == report_id, JournalistReport.user_id == _current_user.id).first()
        if report:
            report.social_kit = kit
            db.commit()
            logger.info(f"Journalist: Persisted social kit to report {report_id}")

    return kit


@router.get("/reports", response_model=List[JournalistReportResponse])
async def get_reports(
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fetch all saved investigative reports for the authenticated user."""
    reports = (
        db.query(JournalistReport)
        .filter(JournalistReport.user_id == _current_user.id)
        .order_by(JournalistReport.created_at.desc())
        .all()
    )
    return reports


@router.get("/sessions", response_model=List[JournalistSessionResponse])
async def get_sessions(
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return one entry per session for the history panel.
    
    Groups all reports by session_id. For each session, returns the
    most recent report as the representative entry plus a version_count.
    Legacy reports without session_id are returned individually.
    """
    all_reports = (
        db.query(JournalistReport)
        .filter(JournalistReport.user_id == _current_user.id)
        .order_by(JournalistReport.created_at.desc())
        .all()
    )

    # Group by session_id server-side
    session_map: dict = {}
    no_session_items = []

    for report in all_reports:
        if report.session_id:
            # Add 1 for the report row itself + length of its historical versions array
            v_count = 1 + (len(report.versions) if report.versions else 0)
            
            if report.session_id not in session_map:
                session_map[report.session_id] = {
                    "report": report,
                    "count": v_count,
                }
            else:
                session_map[report.session_id]["count"] += v_count
                # Keep the most recent (already ordered desc, so first seen is latest)
        else:
            no_session_items.append(report)

    results = []
    for session_id, data in session_map.items():
        r = data["report"]
        results.append(JournalistSessionResponse(
            session_id=session_id,
            latest_report_id=r.id,
            topic=r.topic,
            category=r.category,
            version_count=data["count"],
            created_at=r.created_at or datetime.now(timezone.utc),
            updated_at=r.updated_at,
            image_url=r.image_url,
        ))

    for r in no_session_items:
        results.append(JournalistSessionResponse(
            session_id=None,
            latest_report_id=r.id,
            topic=r.topic,
            category=r.category,
            version_count=1 + (len(r.versions) if r.versions else 0),
            created_at=r.created_at or datetime.now(timezone.utc),
            updated_at=r.updated_at,
            image_url=r.image_url,
        ))

    # Sort by most recent first, with fallback for missing timestamps
    results.sort(key=lambda x: x.created_at or datetime.now(timezone.utc), reverse=True)
    return results


@router.post("/reports/{report_id}/save")
async def save_report_edits(
    report_id: int,
    request_body: ReportSaveRequest,
    request: Request,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually save editor changes and push previous state to history."""
    report = (
        db.query(JournalistReport)
        .filter(JournalistReport.id == report_id, JournalistReport.user_id == _current_user.id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Snapshot current state into versions
    prev_versions = list(report.versions or [])
    prev_snapshot = {
        "topic": report.topic,
        "category": report.category,
        "markdown_content": report.markdown_content,
        "research_summary": report.research_summary,
        "outline": report.outline,
        "data_insights": report.data_insights,
        "audit": report.audit,
        "created_at": report.created_at.isoformat() if report.created_at else datetime.now(timezone.utc).isoformat()
    }
    prev_versions.append(prev_snapshot)

    # Update with new content
    report.markdown_content = request_body.markdown_content
    if request_body.topic:
        report.topic = request_body.topic
    if request_body.category:
        report.category = request_body.category
    
    report.versions = prev_versions
    report.updated_at = datetime.now(timezone.utc)

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(report, "versions")
    
    db.commit()

    record_activity(
        db, _current_user.email, "update_journalist_report",
        entity_type="journalist_report", entity_id=report_id,
        details={"topic": report.topic},
        request=request
    )

    return {"status": "success", "id": report.id, "version_count": 1 + len(prev_versions)}


@router.delete("/reports/{report_id}")
async def delete_report(
    report_id: int,
    request: Request,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a specific investigative report."""
    report = (
        db.query(JournalistReport)
        .filter(JournalistReport.id == report_id, JournalistReport.user_id == _current_user.id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or not owned by user")
    
    db.delete(report)
    db.commit()

    record_activity(
        db, _current_user.email, "delete_journalist_report",
        entity_type="journalist_report", entity_id=report_id,
        details={"topic": report.topic},
        request=request
    )

    return {"status": "success", "message": f"Report {report_id} deleted"}


@router.post("/generate-audio")
async def generate_audio_briefing(
    request_body: AudioRequest,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate an AI audio briefing based on article content."""
    logger.info(f"Journalist: Generating audio briefing for user {_current_user.email}")
    
    _, llm_svc = _orchestrator._make_services(_current_user.email, db)
    if not llm_svc:
        raise HTTPException(
            status_code=400, 
            detail="Audio briefing requires an AI provider key. Please add one in Settings → AI Provider."
        )
    
    try:
        # 1. Generate the concise script
        script = await llm_svc.generate_audio_briefing_script(request_body.content)
        if not script:
            raise HTTPException(status_code=500, detail="Failed to generate audio script")
        
        # 2. Call Sarvam TTS (Bulbul v3)
        sarvam_key = os.getenv("SARVAM_API_KEY", "").strip()
        if not sarvam_key:
             raise HTTPException(status_code=400, detail="Sarvam API key not configured on server.")
        
        # We reuse the constant from voice_routes if possible, or define it locally
        _SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                _SARVAM_TTS_URL,
                headers={
                    "api-subscription-key": sarvam_key,
                    "Content-Type": "application/json",
                },
                json={
                    "inputs": [script[:500]], # Sarvam usually caps around 500 characters
                    "target_language_code": "en-IN",
                    "speaker": "shubh",
                    "model": "bulbul:v3",
                    "enable_preprocessing": True,
                },
            )
            
            if resp.status_code != 200:
                logger.error(f"Sarvam TTS failed: {resp.status_code} - {resp.text}")
                raise HTTPException(status_code=502, detail="TTS service error")
                
            data = resp.json()
            audios = data.get("audios", [])
            if not audios:
                raise HTTPException(status_code=502, detail="TTS returned no audio")
            
            return {"audio_b64": audios[0], "script": script}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Journalist: Audio briefing generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Audio generation failed: {str(e)}")
