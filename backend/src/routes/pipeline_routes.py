"""
Agentic Pipeline Routes
=======================
  GET  /api/pipeline/mode            — get current live/test mode status
  POST /api/pipeline/mode            — toggle live mode on/off
  POST /api/pipeline/run             — run the full agentic pipeline (SSE stream)

Safety design:
  • Default mode is TEST (live=false) — all sends go to test_recipients
  • Only after manual toggle to live=true do real recipients receive mail
  • Toggle requires explicit confirmation payload
"""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.database import get_db
from services.pipeline_orchestrator import (
    get_live_mode, set_live_mode, run_pipeline,
    find_leads_phase, send_outreach_phase, get_leads_csv,
)

router = APIRouter(tags=["pipeline"])


# ── Mode management ───────────────────────────────────────────────────────────

@router.get("/mode")
async def get_pipeline_mode():
    """Return the current pipeline live/test mode."""
    live = get_live_mode()
    return {
        "live_mode": live,
        "label": "LIVE — emails sent to real leads" if live else "TEST — emails sent to test recipients only",
        "warning": None if not live else "Live mode is ON. All pipeline runs will contact real leads.",
    }


class ModeToggleRequest(BaseModel):
    live_mode: bool
    confirm: str   # must equal "I understand this will send real emails" when enabling live


@router.post("/mode")
async def set_pipeline_mode(body: ModeToggleRequest):
    """
    Toggle the pipeline between test mode and live mode.

    To enable live mode, you must pass:
      confirm: "I understand this will send real emails"
    """
    if body.live_mode and body.confirm != "I understand this will send real emails":
        raise HTTPException(
            status_code=400,
            detail='To enable live mode, set confirm to: "I understand this will send real emails"',
        )
    set_live_mode(body.live_mode)
    return {
        "live_mode": body.live_mode,
        "message": (
            "Live mode ENABLED. Real leads will receive emails on next pipeline run."
            if body.live_mode
            else "Test mode ENABLED. Emails will only go to test recipients."
        ),
    }


# ── Pipeline run ──────────────────────────────────────────────────────────────

class PipelineRunRequest(BaseModel):
    prompt: str                              # natural language: "Find 50 PR founders in India for EBIC"
    product_key: Optional[str] = None       # ebic | ebic-agency | retailio | autodeskai
    test_recipients: list[str] = []         # emails to redirect to in test mode
    follow_up_sequence_id: Optional[int] = None   # auto-enroll in this sequence after send
    force_live: bool = False                # override: send live even if global mode is test


@router.post("/run")
async def run_pipeline_route(
    body: PipelineRunRequest,
    email: str = Query(..., description="User's email address"),
    db: Session = Depends(get_db),
):
    """
    Execute the full agentic outreach pipeline with SSE streaming progress.

    Streams newline-delimited JSON events:
      {"step": "find_leads", "status": "running", "message": "...", "data": {...}, "ts": "..."}
      {"step": "find_leads", "status": "done",    "message": "...", "data": {...}, "ts": "..."}
      ...

    Steps: parse → find_leads → save_leads → enrich → email_gen → create_campaign → send → [sequence_enroll] → pipeline_complete

    Safety gate:
      • If global live_mode=false AND force_live=false → all sends go to test_recipients
      • If global live_mode=true  OR  force_live=true  → real leads are contacted
    """
    if not body.prompt or not body.prompt.strip():
        raise HTTPException(status_code=422, detail="prompt is required.")

    if not email:
        raise HTTPException(status_code=422, detail="email query parameter is required.")

    # Warn if live mode + no test safety net intended
    live_mode = get_live_mode() or body.force_live
    if not live_mode and not body.test_recipients:
        raise HTTPException(
            status_code=422,
            detail=(
                "test_recipients is required when pipeline is in test mode. "
                "Provide at least one internal email address, or enable live mode first."
            ),
        )

    async def _stream():
        async for chunk in run_pipeline(
            prompt=body.prompt,
            user_email=email,
            product_key=body.product_key,
            test_recipients=body.test_recipients,
            db=db,
            follow_up_sequence_id=body.follow_up_sequence_id,
            force_live=body.force_live,
        ):
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Pipeline-Live-Mode": str(live_mode).lower(),
        },
    )


# ── Two-phase pipeline ────────────────────────────────────────────────────────

class FindLeadsRequest(BaseModel):
    prompt: str
    product_key: Optional[str] = None


@router.post("/find-leads")
async def find_leads_route(
    body: FindLeadsRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Phase 1 of the two-step outreach pipeline.

    Finds + saves leads, then emits a "decision_required" SSE event containing
    a job_id and a count split (leads with email vs without email).

    The client shows the user two choices:
      - send_with_email_export_rest: send to those with emails, export the rest
      - export_all: export all as CSV without sending

    Use POST /api/pipeline/send-outreach with the job_id + chosen decision to continue.
    """
    if not body.prompt or not body.prompt.strip():
        raise HTTPException(422, "prompt is required.")

    async def _stream():
        async for chunk in find_leads_phase(
            prompt=body.prompt,
            user_email=email,
            product_key=body.product_key,
            db=db,
        ):
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class SendOutreachRequest(BaseModel):
    job_id: str
    decision: str                              # "send_with_email_export_rest" | "export_all"
    test_recipients: list[str] = []
    force_live: bool = False
    follow_up_sequence_id: Optional[int] = None


@router.post("/send-outreach")
async def send_outreach_route(
    body: SendOutreachRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Phase 2: execute the user's decision from /find-leads.

    decision="send_with_email_export_rest":
      Sends outreach emails to leads that have email addresses.
      Returns a CSV download link in the final event for leads without emails.

    decision="export_all":
      No emails sent — immediately returns a CSV download link for all leads.

    Streams NDJSON progress events identical to /run.
    """
    if body.decision not in ("send_with_email_export_rest", "export_all"):
        raise HTTPException(422, "decision must be 'send_with_email_export_rest' or 'export_all'.")

    live_mode = get_live_mode() or body.force_live
    if body.decision == "send_with_email_export_rest" and not live_mode and not body.test_recipients:
        raise HTTPException(422,
            "test_recipients is required when pipeline is in test mode. "
            "Provide at least one test email or enable live mode."
        )

    async def _stream():
        async for chunk in send_outreach_phase(
            job_id=body.job_id,
            decision=body.decision,
            test_recipients=body.test_recipients,
            force_live=body.force_live,
            follow_up_sequence_id=body.follow_up_sequence_id,
            db=db,
        ):
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Pipeline-Live-Mode": str(live_mode).lower(),
        },
    )


@router.get("/export-csv/{job_id}")
async def export_leads_csv(
    job_id: str,
    which: str = Query("no_email", description="'all' | 'no_email' | 'with_email'"),
):
    """
    Download leads from a find-leads job as CSV.

    which=no_email (default): only leads without email addresses
    which=all:                all leads from the job
    which=with_email:         only leads that have email addresses
    """
    if which not in ("all", "no_email", "with_email"):
        raise HTTPException(422, "which must be 'all', 'no_email', or 'with_email'.")

    csv_bytes = get_leads_csv(job_id, which=which)
    if csv_bytes is None:
        raise HTTPException(404, "Job not found or expired. Please re-run lead search.")

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="leads_{which}_{job_id[:8]}.csv"'},
    )
