from sqlalchemy import Column, Index, Integer, String, Text, DateTime, Boolean, JSON, ForeignKey, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
from sqlalchemy import UniqueConstraint
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field
from auth.database import Base
# from auth.models import User  # Commented out to avoid circular dependency

# SQLAlchemy Models - Following existing patterns
class AIAgent(Base):
    __tablename__ = "ai_agents"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=False)
    role = Column(Text, nullable=False)
    
    # Agent configuration as JSON (this is the key innovation)
    agent_config = Column(JSON, nullable=False)  # Complete agent configuration
    
    # Status and metadata
    status = Column(String(20), default="idle")  # idle, busy, offline
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    last_task_at = Column(DateTime(timezone=True), nullable=True)
    performance_score = Column(Float, default=0.0)

    # Brain pipeline outputs - stored after creation
    soul_document = Column(JSON, nullable=True)          # SOULDocument dict (the agent's DNA)
    research_context = Column(JSON, nullable=True)       # Raw research results for audit
    has_rag = Column(Boolean, default=False)             # True once ≥1 doc is indexed
    benchmark_score = Column(Float, nullable=True)       # AgentBenchmark quality score 0-1
    chroma_collection_id = Column(String(100), nullable=True)  # ChromaDB collection ref

    # Default agent flag - visible to all users
    is_default = Column(Boolean, default=False)

    # Agent creation metadata
    industry = Column(String(200), nullable=True)
    task_context = Column(Text, nullable=True)           # Original task description
    company_website = Column(String(500), nullable=True)
    
    # Relationships
    tasks = relationship("AgentTask", back_populates="agent")
    # api_access = relationship("AgentAPIAccess", back_populates="agent")  # Commented out to avoid circular dependency

    __table_args__ = (
        # Hot-path: fetch active agents for a user (agent gallery + tool routing)
        Index("ix_agent_user_active", "user_id", "is_active"),
        # Status polling (task runners check agent availability)
        Index("ix_agent_user_status", "user_id", "status"),
    )

class AgentTask(Base):
    __tablename__ = "agent_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(20), default="pending")  # pending, in_progress, completed, failed
    priority = Column(String(20), default="medium")  # low, medium, high, urgent
    agent_id = Column(Integer, ForeignKey("ai_agents.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    result = Column(JSON, nullable=True)  # Task execution result
    error_message = Column(Text, nullable=True)
    task_metadata = Column(JSON, nullable=True)  # Additional task metadata (renamed from 'metadata')
    
    # Relationships
    agent = relationship("AIAgent", back_populates="tasks")

    __table_args__ = (
        # Retrieve pending/in-progress tasks per user efficiently
        Index("ix_task_user_status", "user_id", "status"),
        # Agent dashboard: all tasks for an agent ordered by creation
        Index("ix_task_agent_created", "agent_id", "created_at"),
    )


class ExternalAction(Base):
    """Durable state for an external side effect initiated by an AgentTask."""
    __tablename__ = "external_actions"

    id = Column(Integer, primary_key=True, index=True)
    agent_task_id = Column(Integer, ForeignKey("agent_tasks.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    tool_name = Column(String(100), nullable=False, index=True)
    provider = Column(String(50), nullable=True)
    idempotency_key = Column(String(500), nullable=False, unique=True, index=True)
    request_hash = Column(String(64), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    request_payload = Column(JSON, nullable=True)
    result_payload = Column(JSON, nullable=True)
    provider_reference = Column(String(500), nullable=True, index=True)
    error_message = Column(Text, nullable=True)
    unknown_reason = Column(Text, nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    task = relationship("AgentTask", backref="external_actions")

class WorkflowTemplate(Base):
    __tablename__ = "workflow_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String(50), nullable=False)  # marketing, finance, hr, etc.
    agent_config_template = Column(JSON, nullable=False)  # Template for agent configuration
    is_public = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    usage_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class AgentToolCallLog(Base):
    """Audit log - every tool call executed by any agent is recorded here.

    Phase 4 addition. Used by the Network Guardian's audit_tool_call_log tool.
    agent_id is a plain integer (not FK) so the log survives agent deletion.
    """
    __tablename__ = "agent_tool_call_logs"

    id          = Column(Integer, primary_key=True, index=True)
    user_email  = Column(String(250), nullable=False, index=True)
    tool_name   = Column(String(100), nullable=False, index=True)
    agent_id    = Column(Integer, nullable=True, index=True)
    input_summary  = Column(Text, nullable=True)   # first 500 chars of JSON input
    result_summary = Column(Text, nullable=True)   # first 500 chars of JSON result
    was_blocked = Column(Boolean, default=False)   # True = HMAC gate rejected the call
    error_message  = Column(Text, nullable=True)   # populated if result had "error" key
    duration_ms = Column(Float, nullable=True)     # wall-clock ms for the call
    called_at   = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_atcl_user_time", "user_email", "called_at"),
    )


class UsageLog(Base):
    """Per-request LLM usage log. Written server-side on every completed agent call."""
    __tablename__ = "usage_logs"

    id          = Column(Integer, primary_key=True, index=True)
    user_email  = Column(String(250), nullable=False, index=True)
    tokens_used = Column(Integer, nullable=False, default=0)
    cost_usd    = Column(Float, nullable=False, default=0.0)
    model_used  = Column(String(200), nullable=True)
    task_summary = Column(Text, nullable=True)   # first 200 chars of the task/prompt
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_ul_user_time", "user_email", "created_at"),
    )


class WorkflowInstance(Base):
    """Tracks a high-level departmental goal (e.g. 'Hire Demo') as a multi-step persistent thread."""
    __tablename__ = "workflow_instances"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False) # Plain int to avoid User circular dep
    agent_id = Column(Integer, ForeignKey("ai_agents.id"), nullable=True)
    goal = Column(String(500), nullable=False)
    # status: pending → planning → running → completed → failed | awaiting_review
    status = Column(String(20), default="pending", index=True)

    # The full JSON plan generated by the Router/Orchestrator
    plan_json = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    quality_score = Column(Float, nullable=True) # 0.0 to 1.0 (HITL feedback)
    
    # Relationship
    steps = relationship("WorkflowStep", back_populates="workflow", cascade="all, delete-orphan")

    __table_args__ = (
        # HITL polling: find active/pending workflows per user
        Index("ix_workflow_user_status", "user_id", "status"),
    )


class WorkflowStep(Base):
    """An individual actionable node within a WorkflowInstance."""
    __tablename__ = "workflow_steps"

    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("workflow_instances.id"), nullable=False, index=True)

    step_number = Column(Integer, nullable=False)
    description = Column(String(500), nullable=False)
    tool_name = Column(String(100), nullable=True)
    tool_input = Column(JSON, nullable=True)

    # status: pending → approved → executing → completed | failed
    status = Column(String(20), default="pending", index=True)

    output_summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    requires_approval = Column(Boolean, default=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approval_expires_at = Column(DateTime(timezone=True), nullable=True)
    approval_payload_hash = Column(String(64), nullable=True)
    execution_nonce = Column(String(64), nullable=True, unique=True)

    __table_args__ = (
        Index("ix_workflow_step_workflow_status", "workflow_id", "status"),
    )

    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    quality_score = Column(Float, nullable=True) # 0.0 to 1.0 (Step-level feedback)

    # Relationship
    workflow = relationship("WorkflowInstance", back_populates="steps")


class AgentSkill(Base):
    """Reusable skill/playbook that can be pinned to agents to standardize behavior."""
    __tablename__ = "agent_skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    instructions = Column(Text, nullable=False)   # The actual playbook text injected into system prompt
    domain = Column(String(100), nullable=True)    # e.g. "sales", "hr", "legal", "engineering"
    owner_email = Column(String(250), nullable=False, index=True)
    is_shared = Column(Boolean, default=False)     # Shared across all users in the workspace
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    pins = relationship("AgentSkillPin", back_populates="skill", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_skill_owner", "owner_email"),
        Index("ix_skill_shared", "is_shared"),
    )


class AgentSkillPin(Base):
    """Join table: which skills are pinned to which agents."""
    __tablename__ = "agent_skill_pins"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("ai_agents.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_id = Column(Integer, ForeignKey("agent_skills.id", ondelete="CASCADE"), nullable=False, index=True)
    pinned_at = Column(DateTime(timezone=True), server_default=func.now())

    skill = relationship("AgentSkill", back_populates="pins")

    __table_args__ = (
        Index("ix_skill_pin_agent", "agent_id"),
    )


class AgentEvalLog(Base):
    """LLM-as-Judge evaluation record for every completed agent execution."""
    __tablename__ = "agent_eval_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String(250), nullable=False, index=True)
    agent_type = Column(String(100), nullable=True)
    task_summary = Column(Text, nullable=True)      # first 300 chars of task
    output_summary = Column(Text, nullable=True)    # first 300 chars of output
    scores = Column(JSON, nullable=False)           # {"relevance": 8, "completeness": 7, ...}
    overall_score = Column(Float, nullable=False)   # 0.0–10.0 weighted average
    feedback = Column(Text, nullable=True)          # Judge's one-line rationale
    judge_model = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_eval_user_time", "user_email", "created_at"),
    )


# Pydantic Models for API - Following your existing patterns
class AgentConfig(BaseModel):
    """Dynamic agent configuration structure"""
    name: str
    role: str
    description: str
    capabilities: List[str]
    tools: List[str]
    workflow_steps: List[Dict[str, Any]]
    core_type: Optional[str] = None
    department: Optional[str] = None
    llm_role: str = "drafter"  # Uses your existing LLM router roles
    temperature: float = 0.3
    max_tokens: Optional[int] = None
    custom_instructions: Optional[str] = None

class AIAgentCreate(BaseModel):
    """Create agent from natural language description"""
    description: str = Field(..., min_length=10)
    template_name: Optional[str] = None

class AIAgentResponse(BaseModel):
    """Agent response model"""
    id: int
    name: str
    description: str
    role: str
    agent_config: AgentConfig
    status: str
    created_at: datetime
    last_task_at: Optional[datetime]
    performance_score: float
    is_active: bool

class TaskCreate(BaseModel):
    """Create task for agent"""
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=10)
    agent_id: int
    priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")
    metadata: Optional[Dict[str, Any]] = None

class TaskResponse(BaseModel):
    """Task response model"""
    id: int
    title: str
    description: str
    status: str
    priority: str
    agent_id: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    result: Optional[Dict[str, Any]]
    error_message: Optional[str]
    metadata: Optional[Dict[str, Any]]

class GlobalTaskRequest(BaseModel):
    """Global task routing request"""
    task_description: str = Field(..., min_length=10)
    priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")
    context: Optional[Dict[str, Any]] = None

class AgentRecommendation(BaseModel):
    """Agent recommendation for task"""
    agent_id: int
    agent_name: str
    confidence_score: float
    reasoning: str
    estimated_time: Optional[str] = None

class WorkflowTemplateResponse(BaseModel):
    """Workflow template response"""
    id: int
    name: str
    description: str
    category: str
    agent_config_template: AgentConfig
    is_public: bool
    usage_count: int
    created_at: datetime

# New models for API key management and enhanced agent creation
class APIKey(Base):
    __tablename__ = "api_keys"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    service_name = Column(String(100), nullable=False)  # google_sheets, google_drive, etc.
    api_key = Column(Text, nullable=False)  # Encrypted API key
    encrypted = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used = Column(DateTime(timezone=True), nullable=True)
    usage_count = Column(Integer, default=0)
    
    # Relationships
    # user = relationship("User", back_populates="api_keys")  # Commented out to avoid circular dependency

# class AgentAPIAccess(Base):
#     __tablename__ = "agent_api_access"
#     
#     id = Column(Integer, primary_key=True, index=True)
#     agent_id = Column(Integer, ForeignKey("ai_agents.id"), nullable=False)
#     api_key_id = Column(Integer, ForeignKey("api_keys.id"), nullable=False)
#     permissions = Column(JSON, nullable=False)  # What the agent can do with this API
#     created_at = Column(DateTime(timezone=True), server_default=func.now())
#     
#     # Relationships
#     # agent = relationship("AIAgent", back_populates="api_access")  # Commented out to avoid circular dependency
#     api_key = relationship("APIKey")

# Enhanced Pydantic models
class APIKeyCreate(BaseModel):
    """Create API key for external service"""
    service_name: str = Field(..., description="Service name (e.g., google_sheets, google_drive)")
    api_key: str = Field(..., description="API key for the service")
    permissions: Optional[Dict[str, Any]] = Field(default={}, description="Permissions for this API key")

class APIKeyResponse(BaseModel):
    """API key response model"""
    id: int
    service_name: str
    is_active: bool
    created_at: datetime
    last_used: Optional[datetime]
    usage_count: int
    permissions: Dict[str, Any]

class EnhancedAgentCreate(BaseModel):
    """Enhanced agent creation with role and name"""
    name: str = Field(..., min_length=2, max_length=100, description="Agent name")
    role: str = Field(..., min_length=10, description="Detailed role description")
    description: Optional[str] = Field(None, description="Additional description")
    required_apis: Optional[List[str]] = Field(default=[], description="Required API services")

class AgentWithAPIAccess(BaseModel):
    """Agent with API access information"""
    id: int
    name: str
    role: str
    description: str
    status: str
    capabilities: List[str]
    tools: List[str]
    # api_access: List[APIKeyResponse]  # Commented out to avoid circular dependency
    created_at: datetime
    last_task_at: Optional[datetime]
    performance_score: float
    is_active: bool


# ── Telegram Integration Models ──────────────────────────────────────────────

class TelegramMessage(Base):
    """Persistent log of all Telegram interactions for history context."""
    __tablename__ = "telegram_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    chat_id = Column(String(50), nullable=False, index=True)
    message_id = Column(String(50), nullable=True) # Telegram's message ID
    text = Column(Text, nullable=False)
    direction = Column(String(10), nullable=False) # "inbound" or "outbound"
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

class TelegramMessageResponse(BaseModel):
    id: int
    chat_id: str
    text: str
    direction: str
    created_at: datetime

class TelegramConfigUpdate(BaseModel):
    bot_token: str
    chat_id: Optional[str] = None


# ── Phase 11: Smart Contact Book ─────────────────────────────────────────────

from sqlalchemy import UniqueConstraint

class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (
        UniqueConstraint("user_id", "email", name="uq_user_contact_email"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False, index=True)
    email = Column(String(250), nullable=False)
    nickname = Column(String(100), nullable=True)
    phone = Column(String(50), nullable=True)
    company = Column(String(200), nullable=True)
    title = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)  # list of strings
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ContactCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    email: EmailStr = Field(..., max_length=250)
    nickname: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=50)
    company: Optional[str] = Field(None, max_length=200)
    title: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None

class ContactUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=150)
    email: Optional[EmailStr] = Field(None, max_length=250)
    nickname: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=50)
    company: Optional[str] = Field(None, max_length=200)
    title: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None

class ContactResponse(BaseModel):
    id: int
    name: str
    email: str
    nickname: Optional[str]
    phone: Optional[str]
    company: Optional[str]
    title: Optional[str]
    notes: Optional[str]
    tags: Optional[List[str]]
    created_at: datetime

# AgentKnowledgeDoc is defined in auth/models.py - import from there to avoid duplicate table error
from auth.models import AgentKnowledgeDoc  # noqa: F401
