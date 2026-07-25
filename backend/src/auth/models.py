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


# ── Sales Intelligence Models ────────────────────────────────────────────────

class SalesContact(Base):
    """A company/person being tracked by the sales intelligence tool."""
    __tablename__ = "sales_contacts"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    contact_name = Column(String(200), nullable=False)
    contact_email = Column(String(200), nullable=True, index=True)
    company = Column(String(200), nullable=False)
    role = Column(String(200), nullable=True)
    domain = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)

    # Computed fields refreshed on each signal run
    intent_score = Column(Integer, default=0, nullable=False)
    last_signal_at = Column(DateTime(timezone=True), nullable=True)
    last_contacted_at = Column(DateTime(timezone=True), nullable=True)

    # Living dossier — JSON blob summarising all known context
    dossier = Column(JSON, nullable=True)

    # Lead enrichment fields
    linkedin_url = Column(String(500), nullable=True)
    company_size = Column(String(50), nullable=True)       # e.g. "11-50", "201-500"
    company_industry = Column(String(200), nullable=True)
    company_location = Column(String(200), nullable=True)
    company_founded = Column(String(10), nullable=True)
    linkedin_headline = Column(Text, nullable=True)
    company_description = Column(Text, nullable=True)
    company_logo = Column(String(500), nullable=True)
    tech_stack = Column(JSON, nullable=True)
    company_news = Column(Text, nullable=True)             # latest buying signal summary
    email_verified = Column(String(20), nullable=True)    # "valid" | "risky" | "invalid" | None
    enrichment_status = Column(String(20), nullable=True) # "pending" | "enriched" | "failed"
    enrichment_source = Column(String(100), nullable=True)  # e.g. "pdl+serpapi"
    enriched_at = Column(DateTime(timezone=True), nullable=True)
    lead_timezone = Column(String(100), nullable=True)       # e.g. "America/New_York" — inferred from location

    # Escalation tracking
    escalated = Column(Boolean, default=False, nullable=False)
    escalated_at = Column(DateTime(timezone=True), nullable=True)

    # Organisational tagging
    list_tag = Column(String(100), nullable=True, index=True)   # e.g. "Retail I", "Ebic", "Innovation Lab"
    geo_tag = Column(String(50), nullable=True, index=True)     # e.g. "US", "UK", "India"
    product_key = Column(String(50), nullable=True, index=True) # e.g. "ebic", "retailio" — set at lead-save time

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SignalEvent(Base):
    """A single signal event tied to a sales contact."""
    __tablename__ = "signal_events"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("sales_contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email = Column(String, index=True, nullable=False)

    # "email_open" | "email_click" | "email_reply" | "news_mention" | "hiring_signal" | "funding_round" | "website_visit"
    signal_type = Column(String(50), nullable=False, index=True)

    # Arbitrary extra data: URL clicked, article title, job title, etc.
    signal_metadata = Column("metadata", JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class SalesCampaign(Base):
    """A bulk email campaign."""
    __tablename__ = "sales_campaigns"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    name = Column(String(300), nullable=False)
    subject_template = Column(Text, nullable=False)
    html_template = Column(Text, nullable=False)
    text_template = Column(Text, nullable=True)

    # "draft" | "sending" | "sent" | "paused"
    status = Column(String(20), default="draft", nullable=False, index=True)

    total_recipients = Column(Integer, default=0)
    sent_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    open_count = Column(Integer, default=0)
    click_count = Column(Integer, default=0)
    reply_count = Column(Integer, default=0)

    # Optional tag to group campaigns by product / outreach type (e.g. "ProductA", "Q1-Push")
    outreach_tag = Column(String(100), nullable=True, index=True)
    # Link to ProductKnowledgeBase product_key (e.g. 'ebic', 'autodeskai')
    product_key = Column(String(50), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)


class CampaignRecipient(Base):
    """One recipient row per campaign × contact — holds per-recipient tracking state."""
    __tablename__ = "campaign_recipients"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("sales_campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email = Column(String, index=True, nullable=False)

    recipient_email = Column(String(300), nullable=False)
    recipient_name = Column(String(300), nullable=True)
    variables = Column(JSON, nullable=True)    # personalisation vars: {first_name, company, ...}

    # Unique token embedded in tracking pixel & redirect links for this recipient
    tracking_token = Column(String(36), unique=True, nullable=False, index=True)

    # "pending" | "sent" | "failed"
    send_status = Column(String(20), default="pending", nullable=False, index=True)

    # Tracking counters
    open_count = Column(Integer, default=0)
    click_count = Column(Integer, default=0)
    first_opened_at = Column(DateTime(timezone=True), nullable=True)
    last_opened_at = Column(DateTime(timezone=True), nullable=True)
    first_clicked_at = Column(DateTime(timezone=True), nullable=True)

    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Gmail thread ID captured at send time — used for reply detection
    gmail_thread_id = Column(String(100), nullable=True, index=True)
    replied = Column(Boolean, default=False, nullable=False)


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


# ─────────────────────────────────────────────────────────────────────────────
# Email Sequences (multi-step drip campaigns)
# ─────────────────────────────────────────────────────────────────────────────

class EmailSequence(Base):
    """A named multi-step drip sequence owned by a user."""
    __tablename__ = "email_sequences"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    name = Column(String(300), nullable=False)
    # "active" | "paused" | "archived"
    status = Column(String(20), default="active", nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    steps = relationship("SequenceStep", back_populates="sequence", cascade="all, delete-orphan", order_by="SequenceStep.step_number")
    enrollments = relationship("SequenceEnrollment", back_populates="sequence", cascade="all, delete-orphan")


class SequenceStep(Base):
    """One email step within a sequence."""
    __tablename__ = "sequence_steps"

    id = Column(Integer, primary_key=True, index=True)
    sequence_id = Column(Integer, ForeignKey("email_sequences.id", ondelete="CASCADE"), nullable=False, index=True)
    step_number = Column(Integer, nullable=False)          # 1-based order
    delay_days = Column(Integer, default=0, nullable=False) # days after previous step (0 = send immediately)
    subject_template = Column(Text, nullable=False)
    html_template = Column(Text, nullable=False)
    text_template = Column(Text, nullable=True)
    # "reply" | "open" | "click" | "none" — stop advancing if this event occurred
    stop_on = Column(String(20), default="reply", nullable=False)

    sequence = relationship("EmailSequence", back_populates="steps")


class SequenceEnrollment(Base):
    """Tracks one recipient's progress through a sequence."""
    __tablename__ = "sequence_enrollments"

    id = Column(Integer, primary_key=True, index=True)
    sequence_id = Column(Integer, ForeignKey("email_sequences.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email = Column(String, index=True, nullable=False)   # the sender
    recipient_email = Column(String(300), nullable=False, index=True)
    recipient_name = Column(String(300), nullable=True)
    variables = Column(JSON, nullable=True)                   # personalisation vars

    current_step = Column(Integer, default=1, nullable=False) # which step fires next (1-based)
    # "active" | "completed" | "stopped" | "unsubscribed"
    status = Column(String(20), default="active", nullable=False, index=True)
    next_send_at = Column(DateTime(timezone=True), nullable=True, index=True)  # UTC scheduled time

    # Track whether recipient has replied/opened/clicked (used for stop_on)
    replied = Column(Boolean, default=False)
    opened = Column(Boolean, default=False)
    clicked = Column(Boolean, default=False)

    # Count-based trigger: advance early when open_count >= 3
    open_count = Column(Integer, default=0, nullable=False)
    early_triggered = Column(Boolean, default=False, nullable=False)

    # Pause tracking
    pause_reason = Column(String(100), nullable=True)  # e.g. 'objection_reply', 'escalation'

    enrolled_at = Column(DateTime(timezone=True), server_default=func.now())
    last_sent_at = Column(DateTime(timezone=True), nullable=True)

    # Gmail thread ID of the last sent step — used for reply detection
    gmail_thread_id = Column(String(100), nullable=True, index=True)

    sequence = relationship("EmailSequence", back_populates="enrollments")


# ─────────────────────────────────────────────────────────────────────────────
# Suppressed Emails (unsubscribes + hard bounces)
# ─────────────────────────────────────────────────────────────────────────────

class SuppressedEmail(Base):
    """Emails that must never be contacted again."""
    __tablename__ = "suppressed_emails"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)    # sender who owns this suppression
    suppressed_email = Column(String(300), nullable=False, index=True)
    # "unsubscribe" | "bounce" | "manual"
    reason = Column(String(30), default="unsubscribe", nullable=False)
    suppressed_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_suppressed_user_email", "user_email", "suppressed_email", unique=True),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Objection Handling
# ─────────────────────────────────────────────────────────────────────────────

class ObjectionLog(Base):
    """Log of objection replies with suggested rebuttals."""
    __tablename__ = "objection_logs"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("sales_contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email = Column(String, index=True, nullable=False)
    objection_type = Column(String(50), nullable=False)  # budget | wrong_timing | competitor | no_authority | not_interested | other
    sentiment = Column(String(20), nullable=False)        # objection | neutral | positive
    reply_text = Column(Text, nullable=False)             # prospect's reply
    suggested_reply = Column(Text, nullable=True)         # LLM-generated response
    rebuttal_used = Column(Text, nullable=True)           # which rebuttal strategy was applied
    was_sent = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Escalation Events
# ─────────────────────────────────────────────────────────────────────────────

class EscalationEvent(Base):
    """Tracks high-intent contact escalations to human reps."""
    __tablename__ = "escalation_events"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("sales_contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email = Column(String, index=True, nullable=False)
    intent_score_at_escalation = Column(Integer, nullable=False)
    context_brief = Column(Text, nullable=True)
    notified_email = Column(Boolean, default=False, nullable=False)
    notified_slack = Column(Boolean, default=False, nullable=False)
    human_took_over = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Re-engagement and Outreach Memory
# ─────────────────────────────────────────────────────────────────────────────

class ReengagementEntry(Base):
    """Scheduled re-engagement email entries."""
    __tablename__ = "reengagement_entries"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("sales_contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email = Column(String, index=True, nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=False, index=True)
    hook_theme = Column(String(100), nullable=True)  # industry_news | new_case_study | product_update | competitor_move
    status = Column(String(20), default="pending", nullable=False, index=True)  # pending | sent | cancelled
    draft_subject = Column(Text, nullable=True)
    draft_body = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class IcpProfile(Base):
    """Persistent Ideal Customer Profile definition per user."""
    __tablename__ = "icp_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, unique=True, index=True, nullable=False)
    # Target personas
    job_titles = Column(JSON, default=list)          # ["CTO", "VP of Technology", ...]
    seniority_levels = Column(JSON, default=list)    # ["c_suite", "vp", "director"]
    # Company criteria
    industries = Column(JSON, default=list)
    company_sizes = Column(JSON, default=list)       # LinkedIn headcount buckets
    revenue_min_m = Column(Integer, nullable=True)   # $ millions
    revenue_max_m = Column(Integer, nullable=True)
    locations = Column(JSON, default=list)           # ["India", "USA", "UK", "Europe"]
    keywords = Column(JSON, default=list)            # intent keywords for SerpAPI
    # Persona description (free text — used in LLM prompts)
    persona_description = Column(Text, nullable=True)
    # Product context
    product_name = Column(String(100), nullable=True)
    product_description = Column(Text, nullable=True)
    sender_name = Column(String(100), nullable=True)
    sender_title = Column(String(100), nullable=True)
    cal_link = Column(String(300), nullable=True)
    # Email sequence templates (Email 1 and Email 2 stored verbatim)
    email1_template = Column(Text, nullable=True)
    email2_template = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ProductKnowledgeBase(Base):
    """
    Per-product outreach knowledge base.
    System records (user_email IS NULL) are global defaults; user records override them.
    Identified by product_key slug (e.g. 'ebic', 'autodeskai').
    """
    __tablename__ = "product_knowledge_base"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, nullable=True, index=True)   # NULL = system/global default
    product_key = Column(String(50), nullable=False, index=True)   # slug: 'ebic', 'autodeskai'
    display_name = Column(String(200), nullable=False)

    # ICP targeting
    icp_job_titles = Column(JSON, default=list)
    icp_seniority_levels = Column(JSON, default=list)
    icp_industries = Column(JSON, default=list)
    icp_company_sizes = Column(JSON, default=list)
    icp_locations = Column(JSON, default=list)
    icp_keywords = Column(JSON, default=list)
    icp_segments = Column(JSON, nullable=True)        # structured segment descriptions
    icp_persona_description = Column(Text, nullable=True)

    # Product value prop
    product_description = Column(Text, nullable=True)
    pain_points = Column(JSON, default=list)          # ["Manual monitoring", "Delayed crisis alerts"]
    social_proof = Column(JSON, default=list)         # ["8 hrs/week saved", "15-min crisis response"]
    objection_rebuttals = Column(JSON, nullable=True) # {price: "...", timing: "..."}

    # Outreach assets
    cal_link = Column(String(300), nullable=True)
    video_link = Column(String(300), nullable=True)
    deck_link = Column(String(300), nullable=True)
    email1_template = Column(Text, nullable=True)
    email2_template = Column(Text, nullable=True)

    # Sender defaults
    sender_name = Column(String(100), nullable=True)
    sender_title = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OutreachMemory(Base):
    """Records all outreach angles ever used for a contact — prevents repetition."""
    __tablename__ = "outreach_memory"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("sales_contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email = Column(String, index=True, nullable=False)
    angle = Column(String(200), nullable=False)       # the hook/theme used
    message_summary = Column(Text, nullable=True)     # brief of what was said
    channel = Column(String(50), nullable=True)       # email | sequence_step_1 etc.
    used_at = Column(DateTime(timezone=True), server_default=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Social Media Tool — News Digest
# ─────────────────────────────────────────────────────────────────────────────

class NewsDigest(Base):
    """A single AI news digest run for a user."""
    __tablename__ = "news_digests"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    geo = Column(String(20), nullable=False)          # us | eu | india | all
    status = Column(String(20), default="pending")    # pending | done | failed
    story_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    stories = relationship("NewsStory", back_populates="digest", cascade="all, delete-orphan")


class NewsStory(Base):
    """One AI news story inside a digest."""
    __tablename__ = "news_stories"

    id = Column(Integer, primary_key=True, index=True)
    digest_id = Column(Integer, ForeignKey("news_digests.id", ondelete="CASCADE"), nullable=False, index=True)
    headline = Column(String(400), nullable=False)
    source = Column(String(200), nullable=True)
    url = Column(String(800), nullable=True)
    plain_summary = Column(Text, nullable=True)       # non-technical plain English
    company_info = Column(Text, nullable=True)        # what's known about companies mentioned
    relevance_tag = Column(String(100), nullable=True)  # e.g. "AI Model Release", "Funding"
    geo_tag = Column(String(20), nullable=True)       # us | eu | india | global
    published_at = Column(String(100), nullable=True)

    digest = relationship("NewsDigest", back_populates="stories")


# ─────────────────────────────────────────────────────────────────────────────
# Social Media Tool — ORM (Online Reputation Management)
# ─────────────────────────────────────────────────────────────────────────────

class OrmPost(Base):
    """A discovered social post that may be worth engaging with."""
    __tablename__ = "orm_posts"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    platform = Column(String(30), nullable=False)     # linkedin | twitter | instagram
    post_url = Column(String(800), nullable=True)
    post_author = Column(String(200), nullable=True)
    post_content = Column(Text, nullable=True)
    relevance_score = Column(Float, default=0.0)      # 0.0 – 1.0
    relevance_reason = Column(Text, nullable=True)
    status = Column(String(20), default="pending")    # pending | approved | rejected
    approved_comment = Column(Text, nullable=True)    # human-selected final comment
    scan_keyword = Column(String(200), nullable=True) # keyword that surfaced this post
    scan_id = Column(Integer, ForeignKey("orm_scan_logs.id", ondelete="SET NULL"), nullable=True, index=True)
    discovered_at = Column(DateTime(timezone=True), server_default=func.now())
    actioned_at = Column(DateTime(timezone=True), nullable=True)

    suggestions = relationship("OrmCommentSuggestion", back_populates="post", cascade="all, delete-orphan")


class OrmCommentSuggestion(Base):
    """LLM-generated comment options for an ORM post (human must approve before use)."""
    __tablename__ = "orm_comment_suggestions"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("orm_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    comment_text = Column(Text, nullable=False)
    tone = Column(String(50), nullable=True)          # curious | supportive | insightful
    generated_at = Column(DateTime(timezone=True), server_default=func.now())

    post = relationship("OrmPost", back_populates="suggestions")


class OrmScanLog(Base):
    """Tracks the status of each ORM scan run so the frontend can poll for completion."""
    __tablename__ = "orm_scan_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    status = Column(String(20), default="running")    # running | done | failed
    keywords = Column(JSON, default=list)
    platforms = Column(JSON, default=list)
    geo = Column(String(20), nullable=True)
    posts_found = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
