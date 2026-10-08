import os
import shutil
import uuid
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import asyncio

from services.dynamic_agent_creator import DynamicAgentCreator, AgentCreationInput, create_agent_v2
from auth.routes import get_current_user
from auth.database import get_db
from auth.models import User, AgentKnowledgeDoc, AgentFeedback
from utils.activity_logger import record_activity
from loguru import logger

router = APIRouter()

# Storage directory for agent knowledge uploads
KNOWLEDGE_DIR = Path(os.getenv("AGENT_KNOWLEDGE_DIR", str(Path(__file__).parent.parent / "agent_knowledge")))
KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".csv", ".txt", ".xlsx"}
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024   # 25 MB
MAX_DOCS_PER_AGENT = 10
MAX_TOTAL_BYTES_PER_AGENT = 100 * 1024 * 1024  # 100 MB

# ── Pydantic models ────────────────────────────────────────────────────────────

class CreateAgentRequest(BaseModel):
    prompt: str
    agent_name: Optional[str] = None
    role_description: Optional[str] = None


class CreateFromBlueprintRequest(BaseModel):
    blueprint_id: str = Field(..., description="Slug from GET /blueprints, e.g. 'data_scientist'")
    customization_prompt: str = Field(..., min_length=3, description="What the user wants this agent to do")
    agent_name: Optional[str] = Field(None, description="Optional override for the agent name")


class CreateAgentV2Request(BaseModel):
    """Industry-grade v2 agent creation request."""
    task: str = Field(..., min_length=5, description="What this agent should do")
    industry: str = Field(..., min_length=2, description="Industry domain (e.g., B2B SaaS, Healthcare)")
    role: Optional[str] = Field(None, description="Agent role (e.g., Sales Development Rep)")
    job_title: Optional[str] = Field(None, description="Specific job title")
    company_website: Optional[str] = Field(None, description="Company URL to research")
    company_name: Optional[str] = Field(None, description="Company name")
    agent_name: Optional[str] = Field(None, description="Override agent name")

class CreateAgentResponse(BaseModel):
    success: bool
    agent: Dict[str, Any] = None
    message: str
    error: str = None

class UserAgentResponse(BaseModel):
    id: int
    name: str
    description: str
    role: str
    industry: Optional[str] = None
    benchmark_score: Optional[float] = None
    research_context: Optional[Dict[str, Any]] = None
    has_rag: Optional[bool] = False
    agent_config: Optional[Dict[str, Any]] = None
    capabilities: List[str]  # Changed from List[Dict[str, Any]] to List[str]
    tools: List[str]
    workflows: List[Dict[str, Any]]
    created_at: str = None
    is_default: bool = False

class UserAgentsListResponse(BaseModel):
    agents: List[UserAgentResponse]
    total_count: int

class UpdateAgentRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    role: Optional[str] = None
    industry: Optional[str] = None

# Dynamic agent creation routes
@router.post("/create", response_model=CreateAgentResponse)
async def create_agent_from_prompt(
    request: Request,
    body: CreateAgentRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new AI agent from natural language prompt"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to create agents for this user")

    try:
        creator = DynamicAgentCreator(db)
        
        result = await creator.create_agent_from_prompt(
            user_id=current_user.id,
            user_prompt=body.prompt,
            user_email=email,
            agent_name=body.agent_name,
            role_description=body.role_description
        )
        
        if result["success"]:
            record_activity(
                db, email, "create_agent",
                entity_type="agent", entity_id=result["agent"]["id"] if "agent" in result else None,
                details={"prompt": body.prompt, "method": "v1_prompt"},
                request=request
            )
            return CreateAgentResponse(**result)
        else:
            raise HTTPException(status_code=500, detail=result["error"])
            
    except Exception as e:
        logger.error(f"Error creating agent from prompt: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/user-agents", response_model=UserAgentsListResponse)
async def get_user_agents(
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all agents created by a specific user"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's agents")

    try:
        creator = DynamicAgentCreator(db)
        agents = await creator.get_user_agents(current_user.id)
        
        return UserAgentsListResponse(
            agents=agents,
            total_count=len(agents)
        )
        
    except Exception as e:
        logger.error(f"Error getting user agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/user-agents/{agent_id}")
async def delete_user_agent(
    agent_id: int,
    request: Request,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a user's agent"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to delete this user's agents")

    try:
        from models import AIAgent
        from sqlalchemy import or_
        # Scope: allow the check only on agents the user owns OR global default agents
        agent = db.query(AIAgent).filter(
            AIAgent.id == agent_id,
            or_(AIAgent.user_id == current_user.id, AIAgent.is_default == True),
        ).first()
        if agent and getattr(agent, "is_default", False):
            raise HTTPException(status_code=403, detail="Default agents cannot be deleted")

        creator = DynamicAgentCreator(db)
        success = await creator.delete_user_agent(current_user.id, agent_id)

        if success:
            record_activity(
                db, email, "delete_agent",
                entity_type="agent", entity_id=agent_id,
                request=request
            )
            return {"success": True, "message": "Agent deleted successfully"}
        else:
            raise HTTPException(status_code=404, detail="Agent not found or could not be deleted")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting user agent: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/user-agents/{agent_id}")
async def update_user_agent(
    agent_id: int,
    request: Request,
    body: UpdateAgentRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user's agent details"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to update this user's agents")

    import copy
    from models import AIAgent

    # Fetch by ID first to distinguish "not found" from "is a default agent"
    agent = db.query(AIAgent).filter(AIAgent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if getattr(agent, "is_default", False):
        raise HTTPException(status_code=403, detail="Default agents cannot be edited")

    # Return 404 (not 403) for agents that belong to another user to avoid leaking existence
    if agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")
    if body.name is not None:
        agent.name = body.name
    if body.description is not None:
        agent.description = body.description
    if body.role is not None:
        agent.role = body.role
    if body.industry is not None:
        agent.industry = body.industry

    config = dict(agent.agent_config) if agent.agent_config else {}
    if body.name is not None: config["name"] = body.name
    if body.description is not None: config["description"] = body.description
    if body.role is not None: config["role"] = body.role
    agent.agent_config = config

    try:
        db.commit()
        record_activity(
            db, email, "update_agent",
            entity_type="agent", entity_id=agent_id,
            details=body.model_dump(exclude_unset=True),
            request=request
        )
    except Exception as e:
        logger.error(f"Error updating agent: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {"success": True, "cloned": False, "message": "Agent updated successfully"}

# ── v2 Brain-powered creation ──────────────────────────────────────────────────

@router.post("/create-v2")
async def create_agent_v2_endpoint(
    request: Request,
    body: CreateAgentV2Request,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Industry-grade agent creation powered by the 5-stage AgentBrain pipeline.
    Requires task + industry. Role, job_title, company_website improve quality.
    """
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        inp = AgentCreationInput(
            task=body.task,
            industry=body.industry,
            role=body.role,
            job_title=body.job_title,
            company_website=body.company_website,
            company_name=body.company_name,
            agent_name=body.agent_name,
        )
        agent = await create_agent_v2(
            user_id=current_user.id,
            inp=inp,
            db=db,
        )
        response = {
            "success": True,
            "agent": {
                "id": agent.id,
                "name": agent.name,
                "description": agent.description,
                "role": agent.role,
                "industry": agent.industry,
                "benchmark_score": agent.benchmark_score,
                "has_rag": agent.has_rag,
                "capabilities": (agent.soul_document or {}).get("capabilities", []),
                "created_at": agent.created_at.isoformat() if agent.created_at else None,
            },
            "message": f"Agent '{agent.name}' created with Brain pipeline. Quality score: {(agent.research_context or {}).get('quality_score', 0):.0%}",
        }
        
        record_activity(
            db, email, "create_agent",
            entity_type="agent", entity_id=agent.id,
            details={"task": body.task, "industry": body.industry, "method": "v2_brain"},
            request=request
        )
        return response
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"create_agent_v2 failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── SSE streaming creation ─────────────────────────────────────────────────────

@router.post("/create-v2/stream")
async def create_agent_v2_stream(
    request: CreateAgentV2Request,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Stream Server-Sent Events during Brain-powered agent creation.
    Frontend connects and receives stage-by-stage progress until stage='done' or 'error'.
    """
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()

        async def progress_fn(stage: str, progress: float, message: str, **extra):
            await queue.put({"stage": stage, "progress": progress, "message": message, **extra})

        async def run_creation():
            try:
                inp = AgentCreationInput(
                    task=request.task,
                    industry=request.industry,
                    role=request.role,
                    job_title=request.job_title,
                    company_website=request.company_website,
                    company_name=request.company_name,
                    agent_name=request.agent_name,
                )
                await create_agent_v2(
                    user_id=current_user.id,
                    inp=inp,
                    db=db,
                    progress_fn=progress_fn,
                )
            except ValueError as e:
                # Validation errors (gibberish input, missing fields) - already friendly
                await queue.put({"stage": "error", "progress": 0.0, "message": str(e)})
            except RuntimeError as e:
                # Friendly LLM errors bubbled up from mcp_client / llm_router
                await queue.put({"stage": "error", "progress": 0.0, "message": str(e)})
            except Exception as e:
                logger.exception(f"Agent creation pipeline failed: {e}")
                raw = str(e).lower()
                if any(k in raw for k in ("api key", "authentication", "unauthorized", "401", "403")):
                    msg = (
                        "Agent creation failed because the AI provider's API key is invalid or missing. "
                        "Go to Settings → AI Models and connect a valid key, then try again."
                    )
                elif any(k in raw for k in ("rate limit", "quota", "429")):
                    msg = "Agent creation failed - AI provider rate limit hit. Wait 30 seconds and try again."
                elif any(k in raw for k in ("timeout", "timed out")):
                    msg = "The AI took too long to respond during creation. Please try again."
                elif any(k in raw for k in ("database", "operational", "sqlite")):
                    msg = (
                        "Agent creation failed due to a database error. "
                        "This is usually fixed by restarting the server. "
                        f"Technical detail: {str(e)[:120]}"
                    )
                else:
                    msg = (
                        f"Agent creation failed unexpectedly. "
                        f"Details: {str(e)[:200]} - if this keeps happening, check the server logs."
                    )
                await queue.put({"stage": "error", "progress": 0.0, "message": msg})

        task = asyncio.create_task(run_creation())

        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=120.0)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'stage': 'error', 'progress': 0.0, 'message': 'Agent creation timed out after 2 minutes. This can happen when the AI provider is slow or unreachable. Please check your connection and try again.'})}\n\n"
                    break

                yield f"data: {json.dumps(event)}\n\n"

                if event.get("stage") in ("done", "error"):
                    break
        finally:
            task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Agent feedback ─────────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    response_quality: int = Field(..., ge=1, le=5)
    feedback_text: Optional[str] = None
    feedback_category: Optional[str] = None  # "tone"|"accuracy"|"completeness"|"format"


@router.post("/{agent_id}/feedback")
async def submit_agent_feedback(
    agent_id: int,
    body: FeedbackRequest,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record user quality feedback on an agent response."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from models import AIAgent
    agent = db.query(AIAgent).filter(
        AIAgent.id == agent_id, AIAgent.user_id == current_user.id
    ).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    fb = AgentFeedback(
        agent_id=agent_id,
        user_id=current_user.id,
        response_quality=body.response_quality,
        feedback_text=body.feedback_text,
        feedback_category=body.feedback_category,
    )
    db.add(fb)
    db.commit()
    return {"success": True, "message": "Feedback recorded"}


@router.post("/{agent_id}/upload-knowledge")
async def upload_knowledge_doc(
    agent_id: int,
    request: Request,
    file: UploadFile = File(...),
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Upload a document to an agent's RAG knowledge base.
    Returns immediately - indexing happens in the background.
    """
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from models import AIAgent
    agent = db.query(AIAgent).filter(
        AIAgent.id == agent_id, AIAgent.user_id == current_user.id
    ).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check document count limit
    existing_count = db.query(AgentKnowledgeDoc).filter(
        AgentKnowledgeDoc.agent_id == agent_id,
        AgentKnowledgeDoc.status.in_(["pending", "processing", "indexed"]),
    ).count()
    if existing_count >= MAX_DOCS_PER_AGENT:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_DOCS_PER_AGENT} documents per agent reached",
        )

    # Validate file extension
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Save file
    doc_id = str(uuid.uuid4())
    agent_dir = KNOWLEDGE_DIR / str(agent_id)
    agent_dir.mkdir(parents=True, exist_ok=True)
    file_path = agent_dir / f"{doc_id}{ext}"

    try:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=400, detail=f"File exceeds 25MB limit")

        # Check total storage limit
        existing_docs = db.query(AgentKnowledgeDoc).filter(
            AgentKnowledgeDoc.agent_id == agent_id
        ).all()
        total_bytes = sum(d.size_bytes for d in existing_docs)
        if total_bytes + len(content) > MAX_TOTAL_BYTES_PER_AGENT:
            raise HTTPException(status_code=400, detail="Total storage limit (100MB) reached for this agent")

        with open(file_path, "wb") as f:
            f.write(content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Create DB record
    db_doc = AgentKnowledgeDoc(
        agent_id=agent_id,
        user_id=current_user.id,
        filename=file.filename or "unknown",
        file_path=str(file_path),
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        status="pending",
    )
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)

    record_activity(
        db, email, "upload_knowledge",
        entity_type="agent_knowledge", entity_id=db_doc.id,
        details={"agent_id": agent_id, "filename": db_doc.filename},
        request=request
    )

    # Enqueue background ingest
    try:
        from services.knowledge_base import KnowledgeBase, IngestJob
        KnowledgeBase.enqueue_ingest(IngestJob(
            agent_id=agent_id,
            doc_id=db_doc.id,
            file_path=file_path,
            filename=file.filename or "unknown",
            user_id=current_user.id,
        ))
    except Exception as e:
        logger.warning(f"Failed to enqueue ingest job: {e}")

    return {
        "success": True,
        "doc_id": db_doc.id,
        "filename": db_doc.filename,
        "size_bytes": db_doc.size_bytes,
        "status": "processing",
        "message": "Document uploaded. Indexing in background - check /knowledge-docs for status.",
    }


@router.get("/{agent_id}/knowledge-docs")
async def list_knowledge_docs(
    agent_id: int,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all knowledge documents for an agent with their ingest status."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from models import AIAgent
    agent = db.query(AIAgent).filter(
        AIAgent.id == agent_id, AIAgent.user_id == current_user.id
    ).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    docs = (
        db.query(AgentKnowledgeDoc)
        .filter(AgentKnowledgeDoc.agent_id == agent_id)
        .order_by(AgentKnowledgeDoc.created_at.desc())
        .all()
    )

    return {
        "agent_id": agent_id,
        "has_rag": agent.has_rag,
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "size_bytes": doc.size_bytes,
                "status": doc.status,
                "chunk_count": doc.chunk_count,
                "error_message": doc.error_message,
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
                "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else None,
            }
            for doc in docs
        ],
        "total": len(docs),
    }


@router.delete("/{agent_id}/knowledge-docs/{doc_id}")
async def delete_knowledge_doc(
    agent_id: int,
    doc_id: int,
    request: Request,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a knowledge document and remove its chunks from ChromaDB."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    doc = db.query(AgentKnowledgeDoc).filter(
        AgentKnowledgeDoc.id == doc_id,
        AgentKnowledgeDoc.agent_id == agent_id,
        AgentKnowledgeDoc.user_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete file
    try:
        Path(doc.file_path).unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"Failed to delete file {doc.file_path}: {e}")

    db.delete(doc)
    db.commit()

    record_activity(
        db, email, "delete_knowledge",
        entity_type="agent_knowledge", entity_id=doc_id,
        details={"agent_id": agent_id, "filename": doc.filename},
        request=request
    )

    return {"success": True, "message": "Document deleted"}


@router.get("/{agent_id}/status")
async def get_agent_status(
    agent_id: int,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get full status of an agent including SOUL, RAG, and quality metrics."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from models import AIAgent
    agent = db.query(AIAgent).filter(
        AIAgent.id == agent_id, AIAgent.user_id == current_user.id
    ).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    soul = agent.soul_document or {}
    research = agent.research_context or {}

    return {
        "id": agent.id,
        "name": agent.name,
        "role": agent.role,
        "industry": agent.industry,
        "status": agent.status,
        "is_active": agent.is_active,
        "has_rag": agent.has_rag,
        "benchmark_score": agent.benchmark_score,
        "quality_score": research.get("quality_score"),
        "soul": {
            "identity": soul.get("identity", {}),
            "personality": soul.get("personality", {}),
            "capabilities_count": len(soul.get("capabilities", [])),
            "workflows_count": len(soul.get("workflows", [])),
            "terminology_count": len(soul.get("terminology", {})),
            "guardrails_count": len(soul.get("guardrails", [])),
            "has_custom_instructions": bool(soul.get("custom_instructions")),
        },
        "research": {
            "facts_collected": research.get("facts_collected", 0),
            "quality_passed": research.get("quality_passed"),
        },
        "created_at": agent.created_at.isoformat() if agent.created_at else None,
    }


# ── Phase 11: Blueprint endpoints ─────────────────────────────────────────────

@router.get("/blueprints")
async def list_agent_blueprints(
    current_user: User = Depends(get_current_user),
):
    """Return all 6 agent archetype blueprints for the quick-start builder UI.

    No email param required - blueprints are platform-wide constants.
    """
    from services.agent_blueprints import get_all_blueprints
    return {"blueprints": get_all_blueprints()}


@router.post("/create-from-blueprint", response_model=CreateAgentResponse)
async def create_agent_from_blueprint(
    request: CreateFromBlueprintRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create an agent pre-seeded from an archetype blueprint.

    The blueprint's suggested tools and instructions are injected into the LLM
    prompt so the agent is created with the correct tool set without guessing.
    """
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    from services.agent_blueprints import BLUEPRINT_REGISTRY
    if request.blueprint_id not in BLUEPRINT_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown blueprint_id '{request.blueprint_id}'. "
                   f"Valid options: {', '.join(BLUEPRINT_REGISTRY.keys())}",
        )

    try:
        creator = DynamicAgentCreator(db)
        result = await creator.create_agent_from_prompt(
            user_id=current_user.id,
            user_prompt=request.customization_prompt,
            user_email=email,
            agent_name=request.agent_name,
            blueprint_id=request.blueprint_id,
        )

        if result["success"]:
            bp = BLUEPRINT_REGISTRY[request.blueprint_id]
            result["blueprint"] = {
                "id": bp.blueprint_id,
                "archetype_name": bp.archetype_name,
                "gating_summary": bp.gating_summary,
                "requires_credentials": bp.requires_credentials,
            }
            return CreateAgentResponse(**{k: v for k, v in result.items() if k in CreateAgentResponse.__fields__})
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "Creation failed"))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_agent_from_blueprint failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Health check for dynamic agent system ─────────────────────────────────────

@router.get("/metadata")
async def get_agent_metadata():
    """Return the base OpenClaw Core Types and Departments for dynamic frontend building."""
    from services.core_definitions import CORE_AGENTS, DEPARTMENTS
    return {
        "core_types": CORE_AGENTS,
        "departments": DEPARTMENTS,
        "message": "Dynamic agent architecture boilerplate"
    }

@router.get("/health")
async def dynamic_agent_system_health(
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Check the health of the dynamic agent creation system"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's agents")

    try:
        return {
            "status": "healthy",
            "service": "Dynamic Agent Creation System",
            "capabilities": [
                "LLM-powered agent analysis",
                "Dynamic template generation",
                "Custom workflow creation",
                "Tool integration",
                "Agent registry management"
            ],
            "supported_tools": "dynamic - see GET /api/dynamic-agents/blueprints or GET /api/tools/catalog",
            "timestamp": "now"
        }
        
    except Exception as e:
        logger.error(f"Dynamic agent system health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "Dynamic Agent Creation System",
            "error": str(e),
            "timestamp": "unknown"
        }


# ── Default agent management (admin only) ─────────────────────────────────────

@router.put("/user-agents/{agent_id}/set-default")
async def set_agent_as_default(
    agent_id: int,
    is_default: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle an agent's default flag. Only the agent's owner can promote/demote it.

    A default agent is visible to every user on the platform.
    """
    from models import AIAgent

    agent = db.query(AIAgent).filter(
        AIAgent.id == agent_id,
        AIAgent.user_id == current_user.id,
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found or not owned by you")

    agent.is_default = is_default
    db.commit()
    db.refresh(agent)

    action = "promoted to default" if is_default else "removed from defaults"
    logger.info(f"Agent {agent_id} ({agent.name}) {action} by user {current_user.id}")
    return {"success": True, "agent_id": agent_id, "is_default": is_default, "message": f"Agent {action}"}
