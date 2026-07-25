from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from dotenv import load_dotenv
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv()
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")
if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Add it to your .env file - SQLite is not supported.")


connect_args: dict = {
    "connect_timeout": 10,
    "options": "-c statement_timeout=30000",
}

engine_kwargs = {
    "poolclass": QueuePool,
    "pool_size": 3,
    "max_overflow": 7,   # 10 total — well under Supabase transaction-mode limits
    "pool_pre_ping": True,
    "pool_recycle": 300,   # recycle every 5 min — Supabase drops idle ~10 min
    "pool_timeout": 10,
    "connect_args": connect_args,
}

engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_kwargs)


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


_SCHEMA_VERSION = 28  # bump this integer whenever you add a new migration block below


def create_db_and_tables():
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _get_schema_version(conn) -> int:
    from sqlalchemy import text
    try:
        row = conn.execute(text("SELECT version FROM schema_version LIMIT 1")).fetchone()
        return row[0] if row else 0
    except Exception:
        conn.rollback()  # table doesn't exist yet — clear the aborted transaction
        return 0


def _set_schema_version(conn, version: int):
    from sqlalchemy import text
    conn.execute(text("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"))
    conn.execute(text("DELETE FROM schema_version"))
    conn.execute(text(f"INSERT INTO schema_version (version) VALUES ({version})"))
    conn.commit()


def _safe(conn, sql: str):
    """Execute SQL inside a savepoint so a failure rolls back only that statement."""
    from sqlalchemy import text
    try:
        conn.execute(text("SAVEPOINT _m"))
        conn.execute(text(sql))
        conn.execute(text("RELEASE SAVEPOINT _m"))
    except Exception as exc:
        try:
            conn.execute(text("ROLLBACK TO SAVEPOINT _m"))
        except Exception:
            pass
        print(f"[migration] skipped: {exc!s:.120}")


def _run_migrations():
    """Apply incremental schema changes that create_all cannot handle.

    Each statement runs inside a savepoint so a single failure never aborts
    the rest. Guarded by schema_version — costs one SELECT on hot-reloads.
    """
    from sqlalchemy import text
    with engine.connect() as conn:
        if _get_schema_version(conn) >= _SCHEMA_VERSION:
            return

        # ── 0. Tables from src/models.py (not in auth/models.py Base) ──────────
        # These must exist before the ALTER TABLE blocks below can run.
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS journalist_reports (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                topic VARCHAR(500) NOT NULL,
                category VARCHAR(100) NOT NULL,
                markdown_content TEXT NOT NULL,
                research_summary JSONB,
                outline JSONB,
                data_insights JSONB,
                audit JSONB,
                image_url TEXT,
                social_kit JSONB,
                versions JSONB,
                session_id VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS ai_agents (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                description TEXT NOT NULL,
                role TEXT NOT NULL,
                agent_config JSON NOT NULL,
                status VARCHAR DEFAULT 'active',
                user_id INTEGER NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                is_default BOOLEAN DEFAULT FALSE,
                has_rag BOOLEAN DEFAULT FALSE,
                last_task_at TIMESTAMPTZ,
                performance_score FLOAT,
                benchmark_score FLOAT,
                soul_document JSON,
                research_context JSON,
                chroma_collection_id VARCHAR,
                industry VARCHAR,
                task_context TEXT,
                company_website VARCHAR,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS agent_tasks (
                id SERIAL PRIMARY KEY,
                title VARCHAR NOT NULL,
                description TEXT NOT NULL,
                status VARCHAR DEFAULT 'pending',
                priority VARCHAR DEFAULT 'normal',
                agent_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                result JSON,
                error_message TEXT,
                task_metadata JSON,
                created_at TIMESTAMPTZ DEFAULT now(),
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS workflow_templates (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                description TEXT NOT NULL,
                category VARCHAR NOT NULL,
                agent_config_template JSON NOT NULL,
                is_public BOOLEAN DEFAULT FALSE,
                created_by INTEGER,
                usage_count INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS agent_tool_call_logs (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                tool_name VARCHAR NOT NULL,
                agent_id INTEGER,
                input_summary TEXT,
                result_summary TEXT,
                was_blocked BOOLEAN DEFAULT FALSE,
                error_message TEXT,
                duration_ms FLOAT,
                called_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS usage_logs (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                tokens_used INTEGER NOT NULL,
                cost_usd FLOAT NOT NULL,
                model_used VARCHAR,
                task_summary TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS workflow_instances (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                agent_id INTEGER,
                goal VARCHAR NOT NULL,
                status VARCHAR DEFAULT 'pending',
                plan_json JSON,
                quality_score FLOAT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now(),
                completed_at TIMESTAMPTZ
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS workflow_steps (
                id SERIAL PRIMARY KEY,
                workflow_id INTEGER NOT NULL,
                step_number INTEGER NOT NULL,
                description VARCHAR NOT NULL,
                tool_name VARCHAR,
                tool_input JSON,
                status VARCHAR DEFAULT 'pending',
                output_summary TEXT,
                error_message TEXT,
                requires_approval BOOLEAN DEFAULT FALSE,
                quality_score FLOAT,
                approved_at TIMESTAMPTZ,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS agent_skills (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                description TEXT NOT NULL,
                instructions TEXT NOT NULL,
                domain VARCHAR,
                owner_email VARCHAR NOT NULL,
                is_shared BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS agent_skill_pins (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL,
                skill_id INTEGER NOT NULL,
                pinned_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS agent_eval_logs (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                agent_type VARCHAR,
                task_summary TEXT,
                output_summary TEXT,
                scores JSON NOT NULL,
                overall_score FLOAT NOT NULL,
                feedback TEXT,
                judge_model VARCHAR,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS api_keys (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                service_name VARCHAR NOT NULL,
                api_key TEXT NOT NULL,
                encrypted BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                usage_count INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT now(),
                last_used TIMESTAMPTZ
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS telegram_messages (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                chat_id VARCHAR NOT NULL,
                message_id VARCHAR,
                text TEXT NOT NULL,
                direction VARCHAR NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name VARCHAR NOT NULL,
                email VARCHAR NOT NULL,
                nickname VARCHAR,
                phone VARCHAR,
                company VARCHAR,
                title VARCHAR,
                notes TEXT,
                tags JSON,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        conn.commit()

        # ── 1. Chat & Journalist Sessions ──────────────────────────────────────
        _safe(conn, "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE")
        _safe(conn, "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB")
        _safe(conn, "ALTER TABLE journalist_reports ADD COLUMN IF NOT EXISTS session_id VARCHAR(100)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_chatmsg_user_session ON chat_messages (user_email, session_id, id)")
        conn.commit()

        # ── 2. User Table Extensions ───────────────────────────────────────────
        _safe(conn, "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE")
        _safe(conn, "ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN DEFAULT FALSE")
        _safe(conn, "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp VARCHAR(6)")
        _safe(conn, "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMP WITH TIME ZONE")
        conn.commit()

        # ── 3. AI Agents & Feedback ────────────────────────────────────────────
        _safe(conn, "ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE")
        _safe(conn, "ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS message_id VARCHAR(50)")
        _safe(conn, "ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS message_content TEXT")
        _safe(conn, "ALTER TABLE agent_feedback ALTER COLUMN agent_id DROP NOT NULL")
        conn.commit()

        # ── 4. Content Drafts ──────────────────────────────────────────────────
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS content_drafts (
                id VARCHAR(36) PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                draft_type VARCHAR(20) NOT NULL,
                title VARCHAR(300) NOT NULL,
                content TEXT NOT NULL,
                fmt VARCHAR(10),
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ
            )
        """)
        _safe(conn, "ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS saved_url TEXT")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_content_drafts_user_email ON content_drafts (user_email)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_content_drafts_status ON content_drafts (status)")
        conn.commit()

        # ── 5. Activity Logs Enhancement ───────────────────────────────────────
        _safe(conn, "ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'success'")
        _safe(conn, "ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS error_message TEXT")
        _safe(conn, "ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS level VARCHAR(20)")
        _safe(conn, "ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS module VARCHAR(120)")
        _safe(conn, "ALTER TABLE activity_logs ALTER COLUMN user_email DROP NOT NULL")
        _safe(conn, "ALTER TABLE activity_logs ALTER COLUMN action DROP NOT NULL")
        conn.commit()

        # ── 6. Legacy Cleanup ──────────────────────────────────────────────────
        _safe(conn, "DROP TABLE IF EXISTS app_logs")
        conn.commit()

        # ── 7. Performance indexes ─────────────────────────────────────────────
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_updated ON chat_sessions (user_email, updated_at DESC)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_ai_agents_user_default ON ai_agents (user_id, is_default)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_activity_logs_email_created ON activity_logs (user_email, created_at DESC)")
        conn.commit()

        # ── 9. Sales Intelligence tables ──────────────────────────────────────
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS sales_contacts (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                contact_name VARCHAR(200) NOT NULL,
                contact_email VARCHAR(200),
                company VARCHAR(200) NOT NULL,
                role VARCHAR(200),
                domain VARCHAR(200),
                notes TEXT,
                intent_score INTEGER NOT NULL DEFAULT 0,
                last_signal_at TIMESTAMPTZ,
                last_contacted_at TIMESTAMPTZ,
                dossier JSONB,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sales_contacts_user ON sales_contacts (user_email)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sales_contacts_email ON sales_contacts (contact_email)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS signal_events (
                id SERIAL PRIMARY KEY,
                contact_id INTEGER NOT NULL REFERENCES sales_contacts(id) ON DELETE CASCADE,
                user_email VARCHAR NOT NULL,
                signal_type VARCHAR(50) NOT NULL,
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_signal_events_contact ON signal_events (contact_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_signal_events_type ON signal_events (signal_type)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS sales_campaigns (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                name VARCHAR(300) NOT NULL,
                subject_template TEXT NOT NULL,
                html_template TEXT NOT NULL,
                text_template TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'draft',
                total_recipients INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                open_count INTEGER DEFAULT 0,
                click_count INTEGER DEFAULT 0,
                reply_count INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT now(),
                sent_at TIMESTAMPTZ
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sales_campaigns_user ON sales_campaigns (user_email)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS campaign_recipients (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER NOT NULL REFERENCES sales_campaigns(id) ON DELETE CASCADE,
                user_email VARCHAR NOT NULL,
                recipient_email VARCHAR(300) NOT NULL,
                recipient_name VARCHAR(300),
                variables JSONB,
                tracking_token VARCHAR(36) UNIQUE NOT NULL,
                send_status VARCHAR(20) NOT NULL DEFAULT 'pending',
                open_count INTEGER DEFAULT 0,
                click_count INTEGER DEFAULT 0,
                first_opened_at TIMESTAMPTZ,
                last_opened_at TIMESTAMPTZ,
                first_clicked_at TIMESTAMPTZ,
                sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_campaign_recipients_campaign ON campaign_recipients (campaign_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_campaign_recipients_token ON campaign_recipients (tracking_token)")
        conn.commit()

        # ── 10. Lead Enrichment columns on sales_contacts ─────────────────────
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(500)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS company_size VARCHAR(50)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS company_industry VARCHAR(200)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS company_location VARCHAR(200)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS company_founded VARCHAR(10)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS linkedin_headline TEXT")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS company_news TEXT")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS email_verified VARCHAR(20)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(20)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS enrichment_source VARCHAR(100)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ")
        conn.commit()

        # ── 11. Ensure activity_logs.status has a SQL-level DEFAULT ──────────
        # On new DBs created via create_all, the ORM column has nullable=False
        # but no server_default, so the SQL DEFAULT clause was missing.
        _safe(conn, "ALTER TABLE activity_logs ALTER COLUMN status SET DEFAULT 'success'")
        conn.commit()

        # ── 12. Persist enrichment artifacts on sales_contacts ───────────────
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS company_description TEXT")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS company_logo VARCHAR(500)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS tech_stack JSONB")
        conn.commit()

        # ── 13. Lead timezone column on sales_contacts ────────────────────────
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS lead_timezone VARCHAR(100)")
        conn.commit()

        # ── 14. Fix updated_at on sales_contacts — add DEFAULT now() so INSERTs work ──
        _safe(conn, "ALTER TABLE sales_contacts ALTER COLUMN updated_at SET DEFAULT now()")
        _safe(conn, "ALTER TABLE sales_contacts ALTER COLUMN updated_at DROP NOT NULL")
        conn.commit()

        # ── 15. Session continuation column on users ──────────────────────────
        _safe(conn, "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_visited_path VARCHAR")
        conn.commit()

        # ── 16. outreach_tag column on sales_campaigns ───────────────────────
        _safe(conn, "ALTER TABLE sales_campaigns ADD COLUMN IF NOT EXISTS outreach_tag VARCHAR(100)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sales_campaigns_tag ON sales_campaigns (user_email, outreach_tag)")
        conn.commit()

        # ── 17. Email Sequences + Suppressed Emails tables ───────────────────
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS email_sequences (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                name VARCHAR(300) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_email_sequences_user ON email_sequences (user_email)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS sequence_steps (
                id SERIAL PRIMARY KEY,
                sequence_id INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
                step_number INTEGER NOT NULL,
                delay_days INTEGER NOT NULL DEFAULT 0,
                subject_template TEXT NOT NULL,
                html_template TEXT NOT NULL,
                text_template TEXT,
                stop_on VARCHAR(20) NOT NULL DEFAULT 'reply'
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sequence_steps_seq ON sequence_steps (sequence_id)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS sequence_enrollments (
                id SERIAL PRIMARY KEY,
                sequence_id INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
                user_email VARCHAR NOT NULL,
                recipient_email VARCHAR(300) NOT NULL,
                recipient_name VARCHAR(300),
                variables JSONB,
                current_step INTEGER NOT NULL DEFAULT 1,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                next_send_at TIMESTAMPTZ,
                replied BOOLEAN DEFAULT FALSE,
                opened BOOLEAN DEFAULT FALSE,
                clicked BOOLEAN DEFAULT FALSE,
                open_count INTEGER NOT NULL DEFAULT 0,
                early_triggered BOOLEAN NOT NULL DEFAULT FALSE,
                pause_reason VARCHAR(100),
                enrolled_at TIMESTAMPTZ DEFAULT now(),
                last_sent_at TIMESTAMPTZ
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_seq_enrollments_seq ON sequence_enrollments (sequence_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_seq_enrollments_user ON sequence_enrollments (user_email)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_seq_enrollments_email ON sequence_enrollments (recipient_email)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_seq_enrollments_next ON sequence_enrollments (next_send_at, status)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS suppressed_emails (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR NOT NULL,
                suppressed_email VARCHAR(300) NOT NULL,
                reason VARCHAR(30) NOT NULL DEFAULT 'unsubscribe',
                suppressed_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE UNIQUE INDEX IF NOT EXISTS ix_suppressed_user_email ON suppressed_emails (user_email, suppressed_email)")
        conn.commit()

        # ── 17b. SequenceEnrollment: add new columns to existing tables ───────
        _safe(conn, "ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0")
        _safe(conn, "ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS early_triggered BOOLEAN NOT NULL DEFAULT FALSE")
        _safe(conn, "ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(100)")
        conn.commit()

        # ── 18. SalesContact: escalated, escalated_at ────────────────────────
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS escalated BOOLEAN NOT NULL DEFAULT FALSE")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ")
        conn.commit()

        # ── 19. ObjectionLog + EscalationEvent tables ──────────────────────
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS objection_logs (
                id SERIAL PRIMARY KEY,
                contact_id INTEGER NOT NULL REFERENCES sales_contacts(id) ON DELETE CASCADE,
                user_email VARCHAR NOT NULL,
                objection_type VARCHAR(50) NOT NULL,
                sentiment VARCHAR(20) NOT NULL,
                reply_text TEXT NOT NULL,
                suggested_reply TEXT,
                rebuttal_used TEXT,
                was_sent BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_objection_logs_contact ON objection_logs (contact_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_objection_logs_user ON objection_logs (user_email)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS escalation_events (
                id SERIAL PRIMARY KEY,
                contact_id INTEGER NOT NULL REFERENCES sales_contacts(id) ON DELETE CASCADE,
                user_email VARCHAR NOT NULL,
                intent_score_at_escalation INTEGER NOT NULL,
                context_brief TEXT,
                notified_email BOOLEAN NOT NULL DEFAULT FALSE,
                notified_slack BOOLEAN NOT NULL DEFAULT FALSE,
                human_took_over BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_escalation_events_contact ON escalation_events (contact_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_escalation_events_user ON escalation_events (user_email)")
        conn.commit()

        # ── 20. ReengagementEntry + OutreachMemory tables ─────────────────
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS reengagement_entries (
                id SERIAL PRIMARY KEY,
                contact_id INTEGER NOT NULL REFERENCES sales_contacts(id) ON DELETE CASCADE,
                user_email VARCHAR NOT NULL,
                scheduled_at TIMESTAMPTZ NOT NULL,
                hook_theme VARCHAR(100),
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                draft_subject TEXT,
                draft_body TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_reengagement_contact ON reengagement_entries (contact_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_reengagement_scheduled ON reengagement_entries (scheduled_at, status)")
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS outreach_memory (
                id SERIAL PRIMARY KEY,
                contact_id INTEGER NOT NULL REFERENCES sales_contacts(id) ON DELETE CASCADE,
                user_email VARCHAR NOT NULL,
                angle VARCHAR(200) NOT NULL,
                message_summary TEXT,
                channel VARCHAR(50),
                used_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_outreach_memory_contact ON outreach_memory (contact_id)")
        conn.commit()

        # ── 21. IcpProfile table ──────────────────────────────────────────────
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS icp_profiles (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR UNIQUE NOT NULL,
                job_titles JSONB DEFAULT '[]',
                seniority_levels JSONB DEFAULT '[]',
                industries JSONB DEFAULT '[]',
                company_sizes JSONB DEFAULT '[]',
                revenue_min_m INTEGER,
                revenue_max_m INTEGER,
                locations JSONB DEFAULT '[]',
                keywords JSONB DEFAULT '[]',
                persona_description TEXT,
                product_name VARCHAR(100),
                product_description TEXT,
                sender_name VARCHAR(100),
                sender_title VARCHAR(100),
                cal_link VARCHAR(300),
                email1_template TEXT,
                email2_template TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_icp_profiles_user ON icp_profiles (user_email)")
        conn.commit()

        # ── 22. ProductKnowledgeBase table ────────────────────────────────────
        _safe(conn, """
            CREATE TABLE IF NOT EXISTS product_knowledge_base (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR,
                product_key VARCHAR(50) NOT NULL,
                display_name VARCHAR(200) NOT NULL,
                icp_job_titles JSONB DEFAULT '[]',
                icp_seniority_levels JSONB DEFAULT '[]',
                icp_industries JSONB DEFAULT '[]',
                icp_company_sizes JSONB DEFAULT '[]',
                icp_locations JSONB DEFAULT '[]',
                icp_keywords JSONB DEFAULT '[]',
                icp_segments JSONB,
                icp_persona_description TEXT,
                product_description TEXT,
                pain_points JSONB DEFAULT '[]',
                social_proof JSONB DEFAULT '[]',
                objection_rebuttals JSONB,
                cal_link VARCHAR(300),
                video_link VARCHAR(300),
                deck_link VARCHAR(300),
                email1_template TEXT,
                email2_template TEXT,
                sender_name VARCHAR(100),
                sender_title VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_pkb_user_key ON product_knowledge_base (user_email, product_key)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_pkb_key ON product_knowledge_base (product_key)")
        conn.commit()

        # ── 24. Lead organisational tagging columns ──────────────────────────
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS list_tag VARCHAR(100)")
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS geo_tag VARCHAR(50)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sc_list_tag ON sales_contacts (user_email, list_tag)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sc_geo_tag ON sales_contacts (user_email, geo_tag)")
        conn.commit()

        # ── 25. Product key on campaigns ─────────────────────────────────────
        _safe(conn, "ALTER TABLE sales_campaigns ADD COLUMN IF NOT EXISTS product_key VARCHAR(50)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sc_product_key ON sales_campaigns (user_email, product_key)")
        conn.commit()

        # ── 26. Product key on sales contacts (set at lead-save time) ─────────
        _safe(conn, "ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS product_key VARCHAR(50)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_sc_contact_product_key ON sales_contacts (user_email, product_key)")
        conn.commit()

        # ── 27. Thread-ID tracking for reply detection ────────────────────────
        # Store Gmail thread_id when sending so we can check for replies later.
        _safe(conn, "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(100)")
        _safe(conn, "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS replied BOOLEAN NOT NULL DEFAULT FALSE")
        _safe(conn, "ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(100)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_cr_thread ON campaign_recipients (gmail_thread_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_se_thread ON sequence_enrollments (gmail_thread_id)")
        conn.commit()

        # ── 28. Ensure gmail_thread_id & replied exist (re-apply for DBs that ──
        # ──     recorded v27 before these columns were added)               ──
        _safe(conn, "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(100)")
        _safe(conn, "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS replied BOOLEAN NOT NULL DEFAULT FALSE")
        _safe(conn, "ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(100)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_cr_thread ON campaign_recipients (gmail_thread_id)")
        _safe(conn, "CREATE INDEX IF NOT EXISTS ix_se_thread ON sequence_enrollments (gmail_thread_id)")
        conn.commit()

        # Mark schema as fully applied
        _set_schema_version(conn, _SCHEMA_VERSION)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
