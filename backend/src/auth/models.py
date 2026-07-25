from sqlalchemy import Column, Index, Integer, String, DateTime, Boolean, Text, Float, JSON, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=False)

    # Gmail OAuth tokens (encrypted)
    gmail_access_token = Column(Text, nullable=True)
    gmail_refresh_token = Column(Text, nullable=True)
    gmail_token_expires_at = Column(DateTime, nullable=True)

    # Calendar OAuth tokens (encrypted)
    calendar_access_token = Column(Text, nullable=True)
    calendar_refresh_token = Column(Text, nullable=True)
    calendar_token_expires_at = Column(DateTime, nullable=True)

    # Microsoft OAuth tokens (encrypted) - DISABLED
    # microsoft_access_token = Column(Text, nullable=True)
    # microsoft_refresh_token = Column(Text, nullable=True)
    # microsoft_token_expires_at = Column(DateTime, nullable=True)

    # Morning Briefing settings
    briefing_enabled = Column(Boolean, default=False)
    briefing_time = Column(String, nullable=True, default="06:00")  # UTC HH:MM

    # User preferences and settings
    timezone = Column(String, nullable=False, default="UTC")
    auto_classify_emails = Column(Boolean, default=True)
    auto_schedule_meetings = Column(Boolean, default=True)

    # Telegram Integration
    telegram_chat_id = Column(String, nullable=True) # ID of the user's personal chat with their bot
    telegram_secret = Column(String(100), unique=True, nullable=True) # Unique identifier for webhook routing

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Sender profile - injected into email signatures
    role = Column(String, nullable=True)  # e.g. "Senior Product Manager", "HR Lead"

    # Account status
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)

    # Company users can toggle between organization-managed keys and their own personal keys.
    # None = not yet set (treated as True for company users).
    use_company_keys = Column(Boolean, nullable=True, default=None)

    # Provider and model name (e.g. "openai" / "gpt-4o"). NULL means not yet configured.
    llm_provider = Column(String, nullable=True, default=None)
    preferred_model = Column(String, nullable=True)

    # Real-time monitoring state (toggled via Smart Inbox)
    is_monitoring = Column(Boolean, default=False)

    # Auto-reply feature - disabled by default; user must explicitly opt-in
    auto_reply_enabled = Column(Boolean, default=False)

    # AI Communication Profile (personality preferences)
    communication_profile = Column(Text, nullable=True)  # JSON string: {tone, length, focus, formality, emoji}

    # Onboarding status
    onboarding_completed = Column(Boolean, default=False)

    # Session continuation
    last_visited_path = Column(String, nullable=True)

    # Password Recovery
    reset_otp = Column(String(6), nullable=True)
    reset_otp_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    # api_keys = relationship("APIKey", back_populates="user")  # Commented out to avoid circular import


class LoginLog(Base):
    """Audit log for user authentication events (signups, logins, OAuth)."""
    __tablename__ = "login_logs"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    email      = Column(String, index=True, nullable=False)
    ip_address = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    status     = Column(String(20), nullable=False)   # "success" | "failed"
    method     = Column(String(20), nullable=False)   # "password" | "google"
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_ll_email_time", "email", "created_at"),
    )


class ActivityLog(Base):
    """Audit log for user activities and system-level events."""
    __tablename__ = "activity_logs"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email  = Column(String(250), nullable=True, index=True)
    action      = Column(String(100), nullable=True, index=True)    # e.g. "create_agent", "update_settings"
    entity_type = Column(String(50), nullable=True, index=True)     # "agent", "task", "contact", etc.
    entity_id   = Column(String(100), nullable=True)                # ID of the entity acted upon
    status      = Column(String(20), nullable=False, default="success", server_default="success", index=True) # "success", "failed"
    error_message = Column(Text, nullable=True)
    details     = Column(JSON, nullable=True)                       # Additional details about the action
    ip_address  = Column(String(50), nullable=True)

    # Merged from AppLog
    level       = Column(String(20), nullable=True, index=True)     # INFO, WARNING, ERROR, CRITICAL
    module      = Column(String(120), nullable=True)                # Code module (e.g. auth.routes)

    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_al_user_time", "user_email", "created_at"),
    )


class Document(Base):
    """Tracks documents uploaded by users - content stored in DB, no local files."""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    doc_uuid = Column(String(36), nullable=True, index=True)   # UUID returned to client
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=True)                  # kept for migration compat, unused
    mime_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)               # original (uncompressed) size

    # DB-native storage - eliminates /uploads filesystem dependency
    content_zlib = Column(LargeBinary, nullable=True)          # zlib-compressed raw file bytes
    parsed_text  = Column(Text,        nullable=True)          # pre-extracted text (max 60 k chars)

    created_at = Column(DateTime(timezone=True), server_default=func.now())




class AgentKnowledgeDoc(Base):
    """Tracks documents uploaded to an agent's RAG knowledge base."""
    __tablename__ = "agent_knowledge_docs"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, index=True, nullable=False)
    user_id = Column(Integer, index=True, nullable=False)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    mime_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)

    # Ingest pipeline status: pending → processing → indexed | failed
    status = Column(String(20), default="pending", nullable=False, index=True)
    chunk_count = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    indexed_at = Column(DateTime(timezone=True), nullable=True)


class EpisodicMemory(Base):
    """Per-user, per-agent session summaries for contextual continuity."""
    __tablename__ = "episodic_memory"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, index=True, nullable=False)
    user_id = Column(Integer, index=True, nullable=False)
    session_summary = Column(Text, nullable=False)
    key_decisions = Column(JSON, nullable=True)
    user_preferences = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AgentFeedback(Base):
    """User feedback on individual agent responses - drives AdaptiveLearner."""
    __tablename__ = "agent_feedback"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, index=True, nullable=True)
    user_id = Column(Integer, index=True, nullable=False)
    message_id = Column(String(50), nullable=True, index=True) # ID of the chat message being rated
    message_content = Column(Text, nullable=True) # The actual content that was rated
    response_quality = Column(Integer, nullable=False)   # 1–5
    feedback_text = Column(Text, nullable=True)
    feedback_category = Column(String(50), nullable=True)  # "tone" | "accuracy" | "completeness" | "format"
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserIntegration(Base):
    """Per-user platform credentials - replaces global env-var approach."""
    __tablename__ = "user_integrations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    platform = Column(String(50), nullable=False, index=True)   # "slack", "jira", "github", …
    auth_type = Column(String(20), nullable=False)              # "oauth2" | "api_key" | "bot_token"
    # Encrypted with token_encryption (Fernet)
    encrypted_token = Column(Text, nullable=True)
    encrypted_refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime(timezone=True), nullable=True)
    # Extra platform-specific data: workspace_id, bot_user_id, team_name, scopes …
    metadata_json = Column(JSON, nullable=True)
    # "connected" | "expired" | "error"
    status = Column(String(20), default="connected", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ChatSession(Base):
    """Groups chat messages into discrete sessions (conversations)."""
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    title = Column(String(200), nullable=False, default="New Chat")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    messages = relationship(
        "ChatMessage", back_populates="session",
        cascade="all, delete-orphan",
        order_by="ChatMessage.id",
    )


class ChatMessage(Base):
    """Per-user chat history - persisted across server restarts."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    session_id = Column(Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    role = Column(String(20), nullable=False)   # "user" | "assistant"
    content = Column(Text, nullable=False)
    attachments = Column(JSON, nullable=True)   # list of {id, filename}
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ChatSession", back_populates="messages")

    __table_args__ = (
        Index("ix_chatmsg_user_session", "user_email", "session_id", "id"),
    )


class FollowUp(Base):
    """Persistent follow-up tracking - replaces the in-memory follow_up_hunter state."""
    __tablename__ = "follow_ups"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    thread_id = Column(String, nullable=True, index=True)   # Gmail thread ID
    recipient = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    commitment = Column(Text, nullable=False)               # The detected commitment sentence
    draft_content = Column(Text, nullable=True)             # LLM-generated follow-up draft
    # status: pending → awaiting_approval → sent | cancelled
    status = Column(String(20), default="pending", nullable=False, index=True)
    # When to surface this follow-up (original sent_at + N days)
    send_after = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)


class TaskNotification(Base):
    """Background task completions stored for deferred display.

    Written when a background task finishes while the user is away.
    The dashboard reads these on tab-focus (visibilitychange) and shows
    a pop-up, then marks them seen so they never repeat.
    """
    __tablename__ = "task_notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    # Short label shown in the pop-up header
    task_title = Column(String(200), nullable=False)
    # One-paragraph result summary produced by the agent
    result_summary = Column(Text, nullable=True)
    # False until the user returns to the tab and the frontend marks it seen
    seen = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PendingAutoReply(Base):
    """Holds an LLM-drafted auto-reply awaiting user confirmation.

    Created by the Gmail webhook when auto_reply_enabled=True.
    The frontend receives an SSE event, shows a 2-minute countdown modal.
    If the user does nothing the APScheduler pulse sends the reply on deadline.
    If the user cancels, status → 'cancelled' and the reply is discarded.
    """
    __tablename__ = "pending_auto_replies"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    # Gmail thread the reply targets
    thread_id = Column(String, nullable=True)
    # Original sender's email address
    sender_email = Column(String, nullable=False)
    # Original email subject
    subject = Column(String, nullable=False)
    # LLM-drafted reply body
    draft_body = Column(Text, nullable=False)
    # UTC deadline: if status still 'pending' at this time → send automatically
    send_deadline = Column(DateTime(timezone=True), nullable=False)
    # pending → sent | cancelled
    status = Column(String(20), default="pending", nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)


class ContentDraft(Base):
    """In-chat draft for docs/spreadsheets/presentations — user reviews and edits before saving."""
    __tablename__ = "content_drafts"

    id = Column(String(36), primary_key=True)           # UUID
    user_email = Column(String, index=True, nullable=False)
    draft_type = Column(String(20), nullable=False)     # "document" | "spreadsheet" | "presentation"
    title = Column(String(300), nullable=False)
    content = Column(Text, nullable=False)              # markdown for docs, JSON for slides/sheets
    fmt = Column(String(10), nullable=True)             # "pdf"|"docx"|"xlsx"|"txt" (docs only)
    # pending → saved | discarded
    status = Column(String(20), default="pending", nullable=False, index=True)
    saved_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
