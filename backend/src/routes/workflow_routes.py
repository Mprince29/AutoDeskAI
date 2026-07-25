from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from auth.routes import get_db, get_current_user
from models import WorkflowInstance, WorkflowStep
from services.workflow_automation_service import WorkflowAutomationService
from pydantic import BaseModel, Field
from loguru import logger
from utils.activity_logger import record_activity

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _resolve_placeholders(obj, replacements: dict):
    """Recursively replace __PLACEHOLDER__ strings in a tool_input structure.

    Replaces every key in `replacements` unconditionally.
    Doc-ID placeholders map to empty string when unresolved - the tool that
    receives an empty attachment_doc_ids entry will skip silently.
    Link-line placeholders always resolve to either the link sentence or "\n\n",
    so the candidate email body never shows a raw __PLACEHOLDER__ string.
    """
    if isinstance(obj, str):
        for placeholder, value in replacements.items():
            obj = obj.replace(placeholder, value)
        return obj
    elif isinstance(obj, list):
        # Filter out empty strings that were placeholder doc IDs
        resolved = [_resolve_placeholders(item, replacements) for item in obj]
        return [item for item in resolved if item != ""]
    elif isinstance(obj, dict):
        return {k: _resolve_placeholders(v, replacements) for k, v in obj.items()}
    return obj


async def _execute_step_in_background(workflow_id: int, step_id: int, user_email: str, user_id: int):
    """Execute an approved workflow step and update its status."""
    import ast
    import asyncio
    from auth.database import SessionLocal
    from mcp_servers.core.mcp_tools import execute_tool
    from services.security import GLOBAL_SIGNER

    db = SessionLocal()
    try:
        # Join through WorkflowInstance to guarantee this step belongs to the requesting user
        step = (
            db.query(WorkflowStep)
            .join(WorkflowInstance, WorkflowInstance.id == WorkflowStep.workflow_id)
            .filter(
                WorkflowStep.id == step_id,
                WorkflowInstance.id == workflow_id,
                WorkflowInstance.user_id == user_id,
            )
            .first()
        )
        if not step:
            return

        step.status = "executing"
        db.commit()

        # Copy to avoid mutating the stored JSON column
        tool_input = dict(step.tool_input or {})

        def _parse_output(summary: str) -> Dict[str, Any]:
            if not summary or summary in ("Done", ""):
                return {}
            try:
                parsed = ast.literal_eval(summary)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}

        # ── Wait for prerequisite create_document steps to complete ─────────────
        # If this step has placeholder tokens (e.g. __OFFER_LETTER_DOC_ID__), we
        # must wait until ALL earlier create_document steps are "completed" before
        # resolving - otherwise we'd resolve to empty and send an email without attachment.
        raw_input_str = str(tool_input)
        needs_doc_ids = "__OFFER_LETTER_DOC_ID__" in raw_input_str or "__NDA_DOC_ID__" in raw_input_str

        if needs_doc_ids:
            logger.info(f"Step {step.step_number} needs doc IDs - waiting for create_document steps to finish")
            deadline = 120  # max seconds to wait
            waited = 0
            poll_interval = 2

            while waited < deadline:
                db.expire_all()  # refresh from DB on each poll
                sibling_doc_steps = (
                    db.query(WorkflowStep)
                    .filter(
                        WorkflowStep.workflow_id == workflow_id,
                        WorkflowStep.tool_name == "create_document",
                        WorkflowStep.step_number < step.step_number,
                    )
                    .all()
                )
                all_done = all(s.status == "completed" for s in sibling_doc_steps)
                if all_done and sibling_doc_steps:
                    logger.info(f"All prerequisite create_document steps done after {waited}s wait")
                    break
                await asyncio.sleep(poll_interval)
                waited += poll_interval

            if waited >= deadline:
                logger.error(f"Timed out waiting for create_document steps - proceeding without doc IDs")

        # ── Resolve __PLACEHOLDER__ doc IDs from completed sibling steps ─────────
        completed_steps = (
            db.query(WorkflowStep)
            .filter(
                WorkflowStep.workflow_id == workflow_id,
                WorkflowStep.status == "completed",
            )
            .order_by(WorkflowStep.step_number)
            .all()
        )
        # First completed create_document = offer letter, second = NDA
        doc_steps = sorted(
            [s for s in completed_steps if s.tool_name == "create_document"],
            key=lambda s: s.step_number,
        )

        offer = _parse_output(doc_steps[0].output_summary) if len(doc_steps) >= 1 else {}
        nda   = _parse_output(doc_steps[1].output_summary) if len(doc_steps) >= 2 else {}

        offer_link = offer.get("web_view_link") or ""
        nda_link   = nda.get("web_view_link") or ""
        replacements = {
            "__OFFER_LETTER_DOC_ID__":  offer.get("document_id") or offer.get("file_id") or "",
            "__NDA_DOC_ID__":           nda.get("document_id") or nda.get("file_id") or "",
            "__OFFER_LETTER_LINK_LINE__": f"\nYou may also view or download it here: {offer_link}\n\n" if offer_link else "\n\n",
            "__NDA_LINK_LINE__":          f"\nYou may also view or download it here: {nda_link}\n\n" if nda_link else "\n\n",
        }
        tool_input = _resolve_placeholders(tool_input, replacements)
        logger.info(
            f"Step {step.step_number} placeholder resolution: "
            f"offer_doc={offer.get('document_id') or 'MISSING'}, "
            f"nda_doc={nda.get('document_id') or 'N/A'}"
        )

        # Inject HMAC so sensitive tools (send_email etc.) pass the security gate
        # Note: do NOT add user_email here - execute_tool receives it as a separate
        # parameter and strips any duplicate from tool_input before dispatching.
        tool_input["_security_signature"] = GLOBAL_SIGNER.generate_token("agent_chat", {}, user_email)

        result = await execute_tool(step.tool_name, tool_input, user_email, db)
        step.status = "completed"
        # Use 1000 chars for document steps so ast.literal_eval can parse the full dict
        # (document_id + web_view_link can be 250+ chars combined)
        limit = 1000 if step.tool_name == "create_document" else 500
        step.output_summary = str(result)[:limit] if result else "Done"
        db.commit()

        # Check if all steps in the workflow are done (re-verify ownership)
        wf = db.query(WorkflowInstance).filter(
            WorkflowInstance.id == workflow_id,
            WorkflowInstance.user_id == user_id,
        ).first()
        if wf:
            all_done = all(
                s.status in ("completed", "approved", "rejected")
                for s in wf.steps
            )
            if all_done:
                wf.status = "completed"

                # Build a concise completion summary for the chat
                completed = [s for s in wf.steps if s.status == "completed"]
                rejected = [s for s in wf.steps if s.status == "rejected"]
                lines = [f" **Workflow complete:** {wf.goal}\n"]
                for s in completed:
                    lines.append(f"• ✓ {s.description}" + (f" - {s.output_summary}" if s.output_summary and s.output_summary != "Done" else ""))
                for s in rejected:
                    lines.append(f"• ✗ {s.description} *(skipped)*")
                completion_msg = "\n".join(lines)
                db.commit()

                # Append to chat history so it appears in the dashboard
                try:
                    from auth.database import SessionLocal as _SL
                    from auth.models import ChatMessage
                    _hdb = _SL()
                    try:
                        _hdb.add(ChatMessage(user_email=user_email, role="assistant", content=completion_msg))
                        _hdb.commit()
                    finally:
                        _hdb.close()
                except Exception as _he:
                    logger.warning(f"Could not append workflow completion to chat history: {_he}")

    except Exception as e:
        logger.error(f"Step execution failed (step={step_id}): {e}")
        try:
            step = (
                db.query(WorkflowStep)
                .join(WorkflowInstance, WorkflowInstance.id == WorkflowStep.workflow_id)
                .filter(
                    WorkflowStep.id == step_id,
                    WorkflowInstance.id == workflow_id,
                    WorkflowInstance.user_id == user_id,
                )
                .first()
            )
            if step:
                step.status = "failed"
                step.output_summary = f"Error: {str(e)[:300]}"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

class StepUpdate(BaseModel):
    status: str # 'approved', 'rejected', 'modified'
    modified_input: Optional[Dict[str, Any]] = None

class CreateWorkflowRequest(BaseModel):
    goal: str = Field(..., description="The main objective for this workflow")
    agent_id: Optional[int] = Field(None, description="Optional agent ID to handle the overall workflow")

@router.get("/", response_model=List[Dict[str, Any]])
async def list_workflows(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    workflows = db.query(WorkflowInstance).filter(
        WorkflowInstance.user_id == current_user.id
    ).order_by(WorkflowInstance.created_at.desc()).all()
    
    return [
        {
            "id": w.id,
            "goal": w.goal,
            "status": w.status,
            "created_at": w.created_at,
            "step_count": len(w.steps)
        }
        for w in workflows
    ]

@router.get("/{workflow_id}", response_model=Dict[str, Any])
async def get_workflow_details(
    workflow_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    wf = db.query(WorkflowInstance).filter(
        WorkflowInstance.id == workflow_id,
        WorkflowInstance.user_id == current_user.id
    ).first()
    
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
        
    return {
        "id": wf.id,
        "goal": wf.goal,
        "status": wf.status,
        "plan": wf.plan_json,
        "steps": [
            {
                "id": s.id,
                "step_number": s.step_number,
                "description": s.description,
                "tool_name": s.tool_name,
                "tool_input": s.tool_input,
                "status": s.status,
                "result": s.output_summary,
                "requires_approval": s.requires_approval
            }
            for s in wf.steps
        ]
    }

@router.post("/create", response_model=Dict[str, Any])
async def create_workflow(
    request: Request,
    request_body: CreateWorkflowRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    service = WorkflowAutomationService(db)
    workflow = await service.create_workflow_from_goal(
        user_id=current_user.id,
        user_email=current_user.email,
        goal=request_body.goal,
        agent_id=request_body.agent_id
    )
    
    record_activity(
        db, current_user.email, "create_workflow",
        entity_type="workflow", entity_id=workflow.id,
        details={"goal": workflow.goal},
        request=request
    )
    
    return {
        "success": True,
        "workflow_id": workflow.id,
        "step_count": len(workflow.steps),
        "message": f"Workflow '{workflow.goal[:50]}...' created and planning complete."
    }

@router.post("/{workflow_id}/steps/{step_id}/approve")
async def approve_step(
    workflow_id: int,
    step_id: int,
    request: Request,
    update: StepUpdate,
    background_tasks: BackgroundTasks,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    step = db.query(WorkflowStep).join(WorkflowInstance).filter(
        WorkflowStep.id == step_id,
        WorkflowInstance.id == workflow_id,
        WorkflowInstance.user_id == current_user.id
    ).first()

    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    should_execute = False

    if update.status == "approved":
        step.status = "approved"
        should_execute = True
    elif update.status == "rejected":
        step.status = "rejected"
    elif update.status == "modified" and update.modified_input:
        step.status = "approved"
        step.tool_input = update.modified_input
        should_execute = True

    db.commit()

    if should_execute:
        background_tasks.add_task(
            _execute_step_in_background,
            workflow_id,
            step_id,
            current_user.email,
            current_user.id,
        )
    
    record_activity(
        db, current_user.email, "update_workflow_step",
        entity_type="workflow_step", entity_id=step_id,
        details={"workflow_id": workflow_id, "new_status": step.status},
        request=request
    )

    return {"success": True, "new_status": step.status}


@router.post("/{workflow_id}/cancel")
async def cancel_workflow(
    workflow_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel a pending/running workflow - marks it and all pending steps as cancelled."""
    wf = db.query(WorkflowInstance).filter(
        WorkflowInstance.id == workflow_id,
        WorkflowInstance.user_id == current_user.id,
    ).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if wf.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Workflow is already {wf.status}")

    for step in wf.steps:
        if step.status in ("pending", "approved", "executing"):
            step.status = "cancelled"
    wf.status = "cancelled"
    db.commit()
    
    record_activity(
        db, current_user.email, "cancel_workflow",
        entity_type="workflow", entity_id=workflow_id,
        request=request
    )
    
    return {"success": True, "workflow_id": workflow_id, "status": "cancelled"}


@router.post("/{workflow_id}/retry")
async def retry_workflow(
    workflow_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retry a failed/cancelled workflow - resets failed/cancelled steps to pending."""
    wf = db.query(WorkflowInstance).filter(
        WorkflowInstance.id == workflow_id,
        WorkflowInstance.user_id == current_user.id,
    ).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if wf.status == "completed":
        raise HTTPException(status_code=400, detail="Workflow already completed")

    for step in wf.steps:
        if step.status in ("failed", "cancelled"):
            step.status = "pending"
            step.output_summary = None
    wf.status = "pending"
    db.commit()
    
    record_activity(
        db, current_user.email, "retry_workflow",
        entity_type="workflow", entity_id=workflow_id,
        request=request
    )
    
    return {"success": True, "workflow_id": workflow_id, "status": "pending"}
