"""Skills / Playbooks API.

Aligns with the video's "Skills as Reusable Primitives" concept:
structured playbooks that can be saved, shared, and pinned to agents
to standardize behavior across the fleet.

Endpoints:
  POST   /api/skills                        — create skill
  GET    /api/skills?email=...              — list own + shared skills
  PUT    /api/skills/{id}                   — update skill
  DELETE /api/skills/{id}                   — delete skill
  POST   /api/skills/{id}/pin/{agent_id}    — pin skill to agent
  DELETE /api/skills/{id}/pin/{agent_id}    — unpin skill from agent
  GET    /api/skills/agent/{agent_id}       — skills pinned to an agent
  GET    /api/skills/evals/trend?email=...  — LLM-judge score trend
  GET    /api/skills/evals/recent?email=... — recent eval entries
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

from auth.database import get_db
from models import AgentSkill, AgentSkillPin, AgentEvalLog, AIAgent

router = APIRouter()


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class SkillCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1)
    instructions: str = Field(..., min_length=10)
    domain: Optional[str] = None
    is_shared: bool = False


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    domain: Optional[str] = None
    is_shared: Optional[bool] = None


class SkillOut(BaseModel):
    id: int
    name: str
    description: str
    instructions: str
    domain: Optional[str]
    owner_email: str
    is_shared: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Skill CRUD ───────────────────────────────────────────────────────────────

@router.post("", response_model=SkillOut)
def create_skill(
    body: SkillCreate,
    email: str = Query(..., description="Owner email"),
    db: Session = Depends(get_db),
):
    skill = AgentSkill(
        name=body.name,
        description=body.description,
        instructions=body.instructions,
        domain=body.domain,
        owner_email=email,
        is_shared=body.is_shared,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill


@router.get("", response_model=List[SkillOut])
def list_skills(
    email: str = Query(..., description="Requesting user email"),
    db: Session = Depends(get_db),
):
    """Return own skills + all shared skills."""
    skills = (
        db.query(AgentSkill)
        .filter(
            (AgentSkill.owner_email == email) | (AgentSkill.is_shared == True)
        )
        .order_by(AgentSkill.created_at.desc())
        .all()
    )
    return skills


@router.put("/{skill_id}", response_model=SkillOut)
def update_skill(
    skill_id: int,
    body: SkillUpdate,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    skill = db.query(AgentSkill).filter(AgentSkill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    if skill.owner_email != email:
        raise HTTPException(status_code=403, detail="Not your skill")
    for field_name, value in body.model_dump(exclude_none=True).items():
        setattr(skill, field_name, value)
    db.commit()
    db.refresh(skill)
    return skill


@router.delete("/{skill_id}")
def delete_skill(
    skill_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    skill = db.query(AgentSkill).filter(AgentSkill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    if skill.owner_email != email:
        raise HTTPException(status_code=403, detail="Not your skill")
    db.delete(skill)
    db.commit()
    return {"deleted": skill_id}


# ── Pinning ──────────────────────────────────────────────────────────────────

@router.post("/{skill_id}/pin/{agent_id}")
def pin_skill(
    skill_id: int,
    agent_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    skill = db.query(AgentSkill).filter(AgentSkill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    agent = db.query(AIAgent).filter(AIAgent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    existing = (
        db.query(AgentSkillPin)
        .filter(AgentSkillPin.agent_id == agent_id, AgentSkillPin.skill_id == skill_id)
        .first()
    )
    if existing:
        return {"status": "already_pinned"}

    pin = AgentSkillPin(agent_id=agent_id, skill_id=skill_id)
    db.add(pin)
    db.commit()
    return {"status": "pinned", "skill_id": skill_id, "agent_id": agent_id}


@router.delete("/{skill_id}/pin/{agent_id}")
def unpin_skill(
    skill_id: int,
    agent_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    pin = (
        db.query(AgentSkillPin)
        .filter(AgentSkillPin.agent_id == agent_id, AgentSkillPin.skill_id == skill_id)
        .first()
    )
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    db.delete(pin)
    db.commit()
    return {"status": "unpinned", "skill_id": skill_id, "agent_id": agent_id}


@router.get("/agent/{agent_id}", response_model=List[SkillOut])
def skills_for_agent(
    agent_id: int,
    db: Session = Depends(get_db),
):
    pins = db.query(AgentSkillPin).filter(AgentSkillPin.agent_id == agent_id).all()
    skills = [pin.skill for pin in pins if pin.skill]
    return skills


# ── Eval trend endpoints ─────────────────────────────────────────────────────

@router.get("/evals/trend")
def eval_trend(
    email: str = Query(...),
    limit: int = Query(default=30, le=200),
    db: Session = Depends(get_db),
):
    """Return the last N eval scores ordered ascending — for drawing a trend line."""
    rows = (
        db.query(AgentEvalLog)
        .filter(AgentEvalLog.user_email == email)
        .order_by(AgentEvalLog.created_at.desc())
        .limit(limit)
        .all()
    )
    rows = list(reversed(rows))  # ascending for chart
    return [
        {
            "id": r.id,
            "agent_type": r.agent_type,
            "overall_score": r.overall_score,
            "scores": r.scores,
            "feedback": r.feedback,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/evals/recent")
def eval_recent(
    email: str = Query(...),
    limit: int = Query(default=10, le=50),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(AgentEvalLog)
        .filter(AgentEvalLog.user_email == email)
        .order_by(AgentEvalLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "agent_type": r.agent_type,
            "task_summary": r.task_summary,
            "output_summary": r.output_summary,
            "overall_score": r.overall_score,
            "scores": r.scores,
            "feedback": r.feedback,
            "judge_model": r.judge_model,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
