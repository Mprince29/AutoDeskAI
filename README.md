# AutoDeskAI

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115.6-009688.svg)
![Next.js](https://img.shields.io/badge/Next.js-15.4-black.svg)
![React](https://img.shields.io/badge/React-19-61DAFB.svg)

An enterprise-grade, autonomous multi-agent workflow automation platform. AutoDeskAI enables AI-powered management of email, calendar, documents, spreadsheets, presentations, and voice interactions - all orchestrated through a unified, multi-provider LLM architecture.

The core differentiator is the **AgentBrain Pipeline**: a deterministic, 5-stage engine that replaces static agent prompts with a dynamic "configuration-first" approach. Agents are born through autonomous background research, context fusion, and a SOUL Synthesis stage that compiles a rich identity document defining the agent's personality, guardrails, domain expertise, and master instructions.

---

## ⚡ Quick Start (TL;DR)

**Get AutoDeskAI running in 5 minutes:**

```bash
# Clone and enter project
git clone https://github.com/your-org/AutoDeskAI.git
cd AutoDeskAI

# Backend setup
cd backend
python3.12 -m venv venv && source venv/bin/activate
pip install -r src/requirements.txt && playwright install chromium
cp .env.example .env  # Edit with your API keys
cd src && uvicorn main:app --reload

# Frontend setup (new terminal)
cd frontend
npm install && npm run dev

# Open browser
# Frontend: http://localhost:3000
# API Docs: http://localhost:8000/docs
```

**Prerequisites:** Python 3.11+, Node.js 18+, Git

---

## Table of Contents

- [Quick Start](#-quick-start-tldr)
- [System Architecture](#system-architecture)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Database Setup](#database-setup)
  - [Running the System](#running-the-system)
- [Environment Configuration](#environment-configuration)
- [Development Workflow](#development-workflow)
  - [Git Strategy](#git-strategy)
  - [Creating Features](#creating-features)
  - [Code Standards](#code-standards)
- [Troubleshooting](#troubleshooting)
- [Performance Optimization](#performance-optimization)
- [Directory Structure](#directory-structure)
- [Core Components](#core-components)
- [API Reference](#api-reference)
- [Docker Deployment](#docker-deployment)
- [Contributing](#contributing)
- [License](#license)

---

## System Architecture

The platform operates across three isolated layers: **Frontend Orchestration**, **Backend Intelligence**, and the **MCP Execution Loop**.

```mermaid
flowchart TD
    A["Next.js 15 Client (App Router)"]

    subgraph BACKEND["FastAPI Backend  |  Port 8000"]
        B1[Auth & OAuth Layer]
        B2[REST API Routes]
        B3[LLM Router - LiteLLM]
        B4[AgentBrain Pipeline]
        B5[AgentExecutor & MCPClient]
        B6[Workflow Automation Service]
        B7[RAG IngestWorker]
    end

    subgraph DATA["Data Layer"]
        C1[(SQLite - main DB)]
        C2[(ChromaDB - vector store)]
        C3[Redis - cache / rate limit]
    end

    subgraph TOOLS["MCP Tool Layer"]
        D1[Gmail / Outlook]
        D2[Google Calendar / MS Calendar]
        D3[Google Docs / Sheets / Slides]
        D4[Google Forms / Drive]
        D5[Web Search - SerpAPI]
        D6[Imagen 4 - image generation]
    end

    subgraph PROVIDERS["LLM Providers"]
        E1[Gemini 2.5 Flash - Drafter]
        E2[GPT-4.1 Mini - Extractor / Classifier / Router]
        E3[Groq Llama 3.3 70B - Validator]
        E4[Sarvam - Voice / TTS]
    end

    A -->|REST + SSE| B2
    B2 --> B1
    B2 --> B4
    B2 --> B6
    B4 --> B3
    B5 --> B3
    B3 --> E1 & E2 & E3
    B5 -->|MCP Protocol| TOOLS
    B7 -->|embeddings| C2
    B5 -->|RAG retrieve| C2
    B6 --> C1
    B1 --> C1
    B2 --> C3
    D4 --> D1
```

---

## Key Features

| Feature                       | Description                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| **AgentBrain v2**             | 5-stage pipeline: Research → Fuse → Rank → Compile → SOUL Synthesis                          |
| **Hybrid LLM Routing**        | 5 specialist models per role via LiteLLM - drafter, extractor, classifier, validator, router |
| **Auto-Ingest RAG**           | Upload PDFs / DOCX / CSV → background worker chunks, embeds, and indexes to ChromaDB         |
| **SSE Streaming**             | Real-time agent progress events over Server-Sent Events during creation and execution        |
| **SOUL-Aware Prompts**        | Dynamically assembled system prompts from SOUL document + RAG chunks + episodic memory       |
| **DAG Executor**              | Kahn's algorithm topological sort for parallel workflow step execution                       |
| **Google Workspace**          | Full integration: Gmail, Calendar, Docs, Sheets, Slides, Forms, Drive                        |
| **Microsoft 365**             | Outlook and Calendar via Microsoft Graph API (feature-gated)                                 |
| **Voice Interface**           | Voice input → intent → agent execution via Sarvam TTS + AssemblyAI                           |
| **Ghost-Draft Email**         | Draft-First Protocol - agent shows email draft for review before sending                     |
| **Proactive Briefings**       | APScheduler-driven morning intelligence briefings                                            |
| **Smart Contacts**            | Contact book with alias resolution (e.g., "send to Boss" → real email)                       |
| **Security Layer**            | HMAC-signed ghost-draft actions, Fernet encryption for OAuth tokens, exfiltration validator  |
| **Decision Tree Router**      | Pre-filtering safety evaluation on final drafted text before delivery                        |
| **Episodic Memory**           | Per-agent session memory stored in SQLite and injected into subsequent prompts               |
| **Relationship Intelligence** | Follow-up tracking and relationship scoring across email threads                             |

---

## Tech Stack

### Backend

| Component        | Technology                              |
| ---------------- | --------------------------------------- |
| Web Framework    | FastAPI 0.115.6 + Uvicorn               |
| Database ORM     | SQLAlchemy 2.0 - SQLite                 |
| Vector Store     | ChromaDB                                |
| LLM Abstraction  | LiteLLM (Gemini, OpenAI, Groq, Mistral) |
| Auth             | Google OAuth2 + MSAL (Microsoft)        |
| Background Jobs  | APScheduler, asyncio                    |
| Document Parsing | pypdf, python-docx, pandas              |
| Security         | cryptography (Fernet), python-jose      |
| Logging          | loguru - rotating file + stdout         |
| MCP Protocol     | fastmcp                                 |

### Frontend

| Component     | Technology              |
| ------------- | ----------------------- |
| Framework     | Next.js 15 (App Router) |
| UI Library    | React 19                |
| Styling       | Tailwind CSS v4         |
| Icons         | lucide-react            |
| Date Handling | date-fns, luxon         |
| Notifications | react-hot-toast         |
| Language      | TypeScript 5            |

---

## Getting Started

### Prerequisites

- **Python 3.11+** ([Download](https://www.python.org/downloads/))
- **Node.js 18+** ([Download](https://nodejs.org/))
- **Git**
- **API Keys** (Google, OpenAI, Gemini, etc. - see [Environment Configuration](#environment-configuration))

### Installation

#### Step 1: Clone Repository

```bash
git clone https://github.com/your-org/AutoDeskAI.git
cd AutoDeskAI
```

#### Step 2: Backend Setup

```bash
cd backend

# Create and activate virtual environment
python3.12 -m venv venv
source venv/bin/activate          # macOS/Linux
# or: venv\Scripts\activate       # Windows

# Install Python dependencies
pip install -r src/requirements.txt

# Install playwright browsers (required for web scraping)
playwright install chromium

# Create environment file
cp .env.example .env

# Edit .env with your API keys (see Environment Configuration section below)
# Then open .env and add:
# - GOOGLE_CLIENT_ID
# - OPENAI_API_KEY
# - GEMINI_API_KEY
# etc.
```

#### Step 3: Frontend Setup

```bash
cd frontend

# Install JavaScript dependencies
npm install

# Optional: Generate types from API schema
npm run types:generate
```

### Database Setup

The system uses **SQLite** by default. Database is auto-initialized on first backend startup.

```bash
# The database file is created automatically at:
# backend/db.sqlite3

# To reset the database (clears all data):
rm backend/db.sqlite3
# Next startup will recreate with fresh schema
```

**For PostgreSQL** (optional, for production):

```bash
# Update backend/.env:
DATABASE_URL=postgresql://user:password@localhost:5432/autodeskai

# Run migrations:
cd backend
alembic upgrade head
```

### Running the System

**Option 1: Run all 3 components (Recommended for Development)**

```bash
# Terminal 1: Backend API
cd backend
source venv/bin/activate
cd src
uvicorn main:app --reload

# Output: Uvicorn running on http://127.0.0.1:8000
# API Docs: http://localhost:8000/docs
# Health Check: http://localhost:8000/health
```

```bash
# Terminal 2: Frontend
cd frontend
npm run dev

# Output: http://localhost:3000
```

```bash
# Terminal 3: (Optional) Background Workers
cd backend
source venv/bin/activate
celery -A src.workers worker --loglevel=info

# Or: APScheduler tasks (built into uvicorn)
```

**Option 2: Docker Compose (Production)**

```bash
# Start full stack with Docker
docker compose up

# Services available:
# - Backend: http://localhost:8000
# - Frontend: http://localhost:3000
# - Redis: localhost:6379
```

---

## Development Workflow

### Git Strategy

**Branch naming:**
- `prod` - Production branch (stable, tested)
- `test` - Staging/integration branch
- `feature/description` - Feature branches from `test`
- `bugfix/description` - Bug fix branches from `test`

**Pull Request Process:**

1. Create feature branch from `test`:
   ```bash
   git checkout -b feature/my-feature origin/test
   ```

2. Keep changes focused (small, reviewable PRs = ~40% context remaining):
   ```bash
   # Stage changes carefully
   git add src/specific/files.py
   git commit -m "fix: brief description of change"
   ```

3. Push and create PR:
   ```bash
   git push origin feature/my-feature
   # Then open GitHub PR → test branch
   ```

4. After approval:
   ```bash
   # Squash merge to test
   git checkout test && git pull
   git merge --squash feature/my-feature
   git commit -m "feat: descriptive title"
   git push origin test
   ```

### Creating Features

**Use the Planning Pattern (saves tokens):**

1. **PLAN PHASE** (in VS Code):
   - Outline approach in 3-5 bullet points
   - Identify which files to modify
   - Get user approval

2. **CLEAR CONTEXT** (optional):
   - Use `/clear` command to start fresh
   - Claude will remember via memory system

3. **IMPLEMENT PHASE**:
   - Reference specific file paths and line numbers
   - Keep edits surgical and focused
   - Test incrementally

4. **SAVE PROGRESS**:
   - Commit with clear messages
   - Update `/memories/repo/` with findings

### Code Standards

1. **Type Hints**: All functions must have type hints
   ```python
   async def get_agent(agent_id: int, db: Session) -> Optional[AIAgent]:
       ...
   ```

2. **Error Handling**: Always include context in exceptions
   ```python
   try:
       result = await llm_call(...)
   except litellm.AuthenticationError as e:
       logger.error(f"LLM auth failed for user {user_id}: {e}")
       raise HTTPException(status_code=401, detail="Auth failed")
   ```

3. **Async-First**: All I/O must be non-blocking
   ```python
   # ❌ BAD - blocks event loop
   db.query(User).all()
   
   #  GOOD - non-blocking
   await asyncio.to_thread(db.query(User).all)
   ```

4. **Database Transactions**: Always use try/except with rollback
   ```python
   try:
       db.add(obj)
       db.commit()
   except Exception as e:
       db.rollback()
       raise
   ```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **"ModuleNotFoundError: No module named 'playwright'"** | Run: `pip install -r src/requirements.txt && playwright install chromium` |
| **"sqlite3.OperationalError: no such column"** | Database schema mismatch. Delete `db.sqlite3` and restart backend. |
| **"GOOGLE_CLIENT_ID is missing"** | Create `.env` file in `backend/` with your API keys (see Environment Configuration) |
| **"Port 8000 already in use"** | Change port: `uvicorn main:app --reload --port 8001` |
| **"Port 3000 already in use"** | Change port: `npm run dev -- -p 3001` |
| **Frontend can't reach backend** | Check `NEXT_PUBLIC_API_URL` in `frontend/.env.local` matches backend URL |
| **Chromium won't launch** | Run: `playwright install chromium --with-deps` |
| **LLM calls timing out** | Check API key validity and network connectivity. Review `backend/logs/app.log` |

### Debugging

**Enable verbose logging:**
```bash
# Backend
LOGLEVEL=DEBUG uvicorn main:app --reload

# Frontend
npm run dev -- --verbose
```

**Inspect the database:**
```bash
cd backend
sqlite3 db.sqlite3

# List tables
.tables

# View schema
.schema contacts

# Query data
SELECT * FROM users LIMIT 5;
```

**Monitor Redis (if enabled):**
```bash
redis-cli
> KEYS *
> GET key_name
```

---

## Performance Optimization

### Recent Bottleneck Fixes (v2.1.0)

All 6 critical performance bottlenecks have been resolved:

| # | Issue | Fix | Impact |
|---|-------|-----|--------|
| 1 | Message pruning O(N) delete | Batch SQL with subquery | **100x faster** |
| 2 | Wasted DB session per request | Reuse session from Depends | **-1 connection/request** |
| 3 | Memory leak in rate limiter | Hourly cleanup of stale users | **Unbounded → bounded** |
| 4 | Sync queries block event loop | `asyncio.to_thread()` wrapper | **Responsive under load** |
| 5 | Double query for agent lookup | Single optimized query | **2 queries → 1** |
| 6 | Missing database indices | Composite index on hot paths | **100x faster queries** |

**Result**: System now handles 10+ concurrent users without connection pool exhaustion, memory leaks, or event loop blocking.

### Context Management Best Practices

When working with Claude on this project:

1. **Use Claude.md for Architecture** - No need to read files to understand structure
2. **Be Specific** - "Fix line 45 in auth/models.py" not "fix the model issue"
3. **Small Branches** - Typical PR should leave 40% context remaining
4. **Start in PLAN Mode** - Outline approach, get approval, then clear context
5. **Use Memory System**:
   - `/memories/` for project-wide patterns (code style, standards)
   - `/memories/repo/` for codebase facts (tech stack, critical files)
   - `/memories/session/` for task-specific notes (current branch, progress)
6. **Switch Models Wisely**:
   - **Haiku** for research and documentation
   - **Opus 4.5** for normal coding tasks
   - **Opus 4.6** only for complex multi-file refactoring

---

---

## Environment Configuration

Create a `.env` file inside the `backend/` directory. All variables below are consumed by the backend.

```ini
# ── Google OAuth ────────────────────────────────────────────────────────────
# https://console.cloud.google.com → APIs & Services → Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
REDIRECT_URI=http://localhost:8000/api/auth/callback

# ── Microsoft OAuth (Optional - leave blank to disable) ─────────────────────
# AZURE_CLIENT_ID=
# AZURE_CLIENT_SECRET=
# AZURE_TENANT_ID=common
# AZURE_REDIRECT_URI=http://localhost:8000/api/auth/microsoft/callback

# ── Research & Scraping APIs ─────────────────────────────────────────────────
SERPAPI_API_KEY=your_serpapi_key       # https://serpapi.com
SERPAPI_KEY=your_serpapi_key           # alias used by background_researcher
FIRECRAWL_API_KEY=your_firecrawl_key   # https://firecrawl.dev (optional - falls back to httpx)

# ── LLM Provider Keys ────────────────────────────────────────────────────────
OPENAI_API_KEY=your_openai_key
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key

# ── Hybrid LLM Routing (Cost / Quality Optimization) ─────────────────────────
# 1. DRAFTER - heavy lifting, long context, document/email writing
LLM_DRAFTER_MODEL=gemini/gemini-2.5-flash

# 2. EXTRACTOR - fast, accurate JSON/structured output parsing
LLM_EXTRACTOR_MODEL=openai/gpt-4.1-mini

# 3. CLASSIFIER - intent classification and task routing
LLM_CLASSIFIER_MODEL=openai/gpt-4.1-mini

# 4. VALIDATOR - safety/rule checks (Groq free tier, high capability)
LLM_VALIDATOR_MODEL=groq/llama-3.3-70b-versatile

# 5. ROUTER - agent selection decisions
LLM_ROUTER_MODEL=openai/gpt-4.1-mini

# Fallbacks (comma-separated model strings, optional)
LLM_DRAFTER_FALLBACKS=
LLM_EXTRACTOR_FALLBACKS=
LLM_CLASSIFIER_FALLBACKS=
LLM_VALIDATOR_FALLBACKS=

# ── Security & Storage ────────────────────────────────────────────────────────
# Fernet key for encrypting OAuth tokens in SQLite
ENCRYPTION_SECRET_KEY=your_fernet_key   # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# HMAC secret for signing ghost-draft actions
AGENT_SECURITY_SECRET=your_hmac_secret  # python -c "import secrets; print(secrets.token_hex(32))"

# ChromaDB vector store path (created automatically if missing)
CHROMADB_PATH=./chroma_db

# ── Voice APIs ────────────────────────────────────────────────────────────────
SARVAM_API_KEY=your_sarvam_key          # https://sarvam.ai (TTS)

# ── Redis (Optional) ─────────────────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=sqlite:///./db.sqlite3

# ── Server ────────────────────────────────────────────────────────────────────
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
ENVIRONMENT=development
CORS_ORIGINS=http://localhost:3000
```

> **Note:** `GOOGLE_APPLICATION_CREDENTIALS` is intentionally removed at startup if `GEMINI_API_KEY` is present to prevent LiteLLM from routing Gemini calls through VertexAI instead of Google AI Studio.

---

## Directory Structure

```text
AutoDeskAI/
├── docker-compose.yml           # Multi-service orchestration (backend, frontend, Redis, Nginx)
│
├── backend/
│   ├── Dockerfile               # Python 3.11-slim, non-root user
│   ├── .env                     # Environment variables (copy from template above)
│   ├── db.sqlite3               # SQLite database
│   ├── logs/                    # Rotating log files (loguru)
│   ├── uploads/                 # Uploaded documents for RAG ingestion
│   └── src/
│       ├── main.py              # FastAPI app init, router registry, lifespan events
│       ├── models.py            # SQLAlchemy + Pydantic schemas (AIAgent, AgentTask, Contact, etc.)
│       │
│       ├── auth/
│       │   ├── database.py      # SQLite engine, SessionLocal, Base
│       │   ├── models.py        # User, AgentKnowledgeDoc ORM models
│       │   ├── oauth.py         # Google OAuth2 flow
│       │   ├── microsoft_auth.py# Microsoft MSAL OAuth flow (feature-gated)
│       │   └── routes.py        # /api/auth/* endpoints
│       │
│       ├── routes/
│       │   ├── agent_routes.py          # Built-in agent CRUD + task execution + SSE streaming
│       │   ├── dynamic_agent_routes.py  # AgentBrain v2 creation pipeline + SSE progress
│       │   ├── document_routes.py       # Document generation (Docs, Sheets, Slides) + RAG upload
│       │   ├── voice_routes.py          # Voice input → intent → agent execution
│       │   ├── contact_routes.py        # Smart contact book CRUD
│       │   ├── proactive_routes.py      # Morning briefing / proactive intelligence
│       │   ├── workflow_routes.py       # Workflow template management + task orchestration
│       │   └── webhooks.py              # Gmail push notification webhooks
│       │
│       ├── services/
│       │   ├── agent_brain.py           # AgentBrain: Fuse → Rank → Compile → SOUL Synthesis
│       │   ├── agent_executor.py        # AgentExecutor: resolves agent → builds prompt → MCP loop
│       │   ├── dynamic_agent_creator.py # DynamicAgentCreator + create_agent_v2 Brain pipeline
│       │   ├── background_researcher.py # BackgroundResearcher: SerpAPI + FireCrawl + LLM fast-facts
│       │   ├── knowledge_base.py        # KnowledgeBase: asyncio queue → chunking → ChromaDB index
│       │   ├── mcp_client.py            # MCPClient: LLM ↔ tool loop (run + run_stream)
│       │   ├── agent_registry.py        # AgentRegistry: built-in & custom AgentDefinitions
│       │   ├── workflow_automation_service.py # DAG compiler + Kahn's algo parallel executor
│       │   ├── briefing_agent.py        # APScheduler morning briefing
│       │   ├── episodic_memory.py       # Per-agent session memory (read/write SQLite)
│       │   ├── relationship_intelligence.py   # Email thread follow-up tracking
│       │   ├── follow_up_hunter.py      # Automated follow-up detection
│       │   ├── intent_parser.py         # NLP intent extraction for voice commands
│       │   ├── expert_router.py         # DecisionTreeRouter: pre-filter safety evaluation
│       │   ├── exfiltration_validator.py# Data leak prevention checks
│       │   ├── context_audit.py         # O(1) audit trace tracker
│       │   ├── context_engine.py        # Multi-turn conversation context manager
│       │   ├── redis_service.py         # Redis caching wrapper
│       │   ├── rate_limiter.py          # Per-user rate limiting
│       │   ├── resilience.py            # Retry + circuit-breaker patterns
│       │   ├── security.py              # ActionSigner (HMAC) for ghost-draft actions
│       │   ├── csv_cleaner.py           # CSV normalization and validation
│       │   └── google_workspace_service.py # Gmail, Calendar, Drive service wrappers
│       │
│       ├── mcp_servers/
│       │   ├── unified_server.py        # Unified MCP server entrypoint
│       │   ├── core/
│       │   │   ├── google_auth.py       # Google service account auth wrapper
│       │   │   └── mcp_tools.py         # Tool registry: get_tools_for_user(), execute_tool()
│       │   └── tools/
│       │       ├── gmail_tools.py       # read_email, send_email, list_emails, search_email
│       │       ├── outlook_tools.py     # Outlook equivalents via Microsoft Graph
│       │       ├── calendar_tools.py    # create/list/delete Google Calendar events
│       │       ├── ms_calendar_tools.py # Microsoft Calendar via Graph API
│       │       ├── sheets_tools.py      # create_spreadsheet, read_sheet, append_rows
│       │       ├── slides_tools.py      # create_presentation with Imagen 4 AI images
│       │       ├── forms_tools.py       # create_form, list_responses
│       │       ├── search_tools.py      # web_search via SerpAPI + fetch_webpage
│       │       ├── imagen_utils.py      # Imagen 4 image generation + Drive upload
│       │       ├── local_file_tools.py  # Local file read/write operations
│       │       └── context_tools.py     # resolve_contact, inject_context
│       │
│       └── utils/
│           ├── llm_router.py    # Hybrid LLM router: role → model → LiteLLM (sync + async)
│           ├── gpt.py           # Legacy OpenAI client wrapper
│           ├── prompts.py       # System prompt library
│           └── token_encryption.py  # Fernet encrypt/decrypt for OAuth tokens
│
└── frontend/
    └── src/
        ├── app/
        │   ├── layout.tsx           # Root layout with AuthContext + ThemeContext providers
        │   ├── page.tsx             # Landing / loader page
        │   ├── globals.css          # Global Tailwind + custom CSS variables
        │   ├── auth/                # Login + signup pages
        │   ├── dashboard/           # Main dashboard (email, calendar, Workspace)
        │   ├── agents/              # Agent management + chat interface
        │   │   ├── page.tsx         # Agent list and creation
        │   │   ├── [id]/            # Individual agent chat page
        │   │   └── create/          # New agent creation wizard
        │   ├── tools/               # Tool explorer (calendar, inbox, data)
        │   └── settings/            # User settings + OAuth connections
        │
        ├── components/
        │   ├── AIAgentChat.tsx      # Streaming chat interface with SSE parsing
        │   ├── AIAgentPanel.tsx     # Agent sidebar panel
        │   ├── VoiceMic.tsx         # Voice recording + real-time transcription
        │   ├── EmailCard.tsx        # Email card with priority indicators
        │   ├── EmailComposeModal.tsx # Compose + send email UI
        │   ├── EmailDetailModal.tsx  # Email thread view
        │   ├── DraftsModal.tsx      # Ghost-draft review and confirmation
        │   ├── AIReplyModal.tsx     # AI-suggested reply interface
        │   ├── EmailSections.tsx    # Inbox section grouping
        │   ├── EmailNotificationPanel.tsx # Live email notification sidebar
        │   ├── DateTimePicker.tsx   # Accessible calendar date picker
        │   ├── EventReminderModal.tsx # Calendar event creation modal
        │   ├── LoginForm.tsx        # JWT login form
        │   ├── SignupForm.tsx       # Account registration form
        │   ├── Header.tsx           # Top navigation + account switcher
        │
        ├── context/
        │   ├── AuthContext.tsx      # JWT token management + user state
        │   └── ThemeContext.tsx     # Light / dark mode toggle
        │
        ├── services/
        │   └── api.ts               # Centralized API client (all backend endpoints)
        │
        ├── hooks/                   # Custom React hooks
        └── utils/                   # Frontend utility functions
```

---

## Core Components

### 1. The AgentBrain Pipeline

When a new agent is requested via `/api/dynamic-agents/create-stream`, the platform does not generate a static prompt. Instead, a deterministic 5-stage pipeline runs with real-time SSE progress events:

| Stage              | Service                                      | What Happens                                                                                                                                  |
| ------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Research**       | `BackgroundResearcher`                       | Parallel calls to SerpAPI (industry trends, role best practices), FireCrawl (company website scraping), and an LLM fast-facts call            |
| **Fuse**           | `AgentBrain._fuse_and_deduplicate_from_list` | O(n) hash-based deduplication of all collected `Fact` objects                                                                                 |
| **Rank**           | `AgentBrain._rank_relevance`                 | Keyword-score relevance ranking, returns top 50 facts                                                                                         |
| **Compile**        | `AgentBrain._compile_knowledge`              | LLM-driven synthesis into structured knowledge: terminology, playbooks, quality rubric, anti-patterns                                         |
| **SOUL Synthesis** | `AgentBrain._synthesize_soul`                | Generates the `SoulDocument`: identity, personality, domain expertise, capabilities, workflows, guardrails, terminology, master system prompt |

The resulting `SoulDocument` and `research_context` are stored as JSON in the `ai_agents` table alongside a `benchmark_score` (0–1).

### 2. The AgentExecutor

The `AgentExecutor` is the runtime for all agent tasks. It:

1. Resolves the `agent_type` to an `AgentDefinition` (built-in registry or DB-backed custom agent)
2. Builds a unified system prompt - **SOUL-aware** if the agent has a `soul_document`, injecting: SOUL sections → RAG context chunks → episodic memory → workspace tool rules
3. Calls `MCPClient.run()` or `MCPClient.run_stream()` - the LLM ↔ tool loop
4. Passes the final draft through `DecisionTreeRouter.process_draft()` for safety pre-filtering
5. Saves session memory for SOUL-backed agents

The executor supports **14 distinct task protocols** baked into the system prompt, covering: document creation, spreadsheet generation, presentation creation, email composition (Draft-First Protocol), calendar scheduling, business analysis, research-and-compose, meeting intelligence, and image generation.

### 3. The Hybrid LLM Router

All LLM calls flow through `utils/llm_router.py`, which maps 5 specialist **roles** to configurable models via environment variables:

```
drafter    → Gemini 2.5 Flash      (heavy writing, 8K output budget)
extractor  → GPT-4.1 Mini          (JSON/structured output)
classifier → GPT-4.1 Mini          (intent + task classification)
validator  → Groq Llama 3.3 70B    (safety/rule checks, free tier)
router     → GPT-4.1 Mini          (agent selection)
```

LiteLLM handles the unified API surface, fallback chains, and API key injection. Swap any model by changing the corresponding `LLM_*_MODEL` environment variable - no code changes required.

### 4. The MCP Tool Layer

`mcp_servers/core/mcp_tools.py` is the dynamic tool registry. `get_tools_for_user(user_email, db)` returns only the tool schemas for services the user has connected OAuth tokens for - keeping the agent context lean and provider-agnostic. `execute_tool()` dispatches at runtime to the correct provider handler (Google vs Microsoft).

**Available MCP Tools:**

| Tool                          | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `send_email`                  | Send via Gmail or Outlook                      |
| `read_email` / `search_email` | Read and search inbox                          |
| `create_calendar_event`       | Create Google or MS Calendar event             |
| `list_events`                 | List upcoming calendar events                  |
| `create_document`             | Create Google Doc with full content            |
| `create_spreadsheet`          | Create Google Sheet with data rows             |
| `create_presentation`         | Create Google Slides deck with Imagen 4 images |
| `create_form`                 | Create Google Form                             |
| `web_search`                  | SerpAPI organic search results                 |
| `fetch_webpage`               | Deep page content extraction                   |
| `generate_image`              | Imagen 4 image generation + Drive upload       |
| `resolve_contact`             | Look up email from name/alias in contact book  |

### 5. Auto-Ingest RAG Pipeline

The `KnowledgeBase` is an `asyncio.Queue`-powered singleton:

```
Upload (PDF/DOCX/CSV) → /api/documents/upload
  → IngestJob pushed to asyncio.Queue
  → Background _ingest_worker picks it up
  → text extraction → recursive chunking (1000 chars, 200 overlap)
  → ChromaDB upsert (agent-scoped collection)
  → agent.has_rag = True
  → AgentExecutor injects chunks at runtime via hybrid retrieval
```

### 6. The Workflow DAG Executor

`WorkflowAutomationService._execute_task_with_agent_config()` implements a full parallel DAG executor:

1. **Build Graph**: constructs an adjacency list + in-degree map from workflow step `depends_on` fields
2. **Kahn's Algorithm**: O(V+E) topological sort produces ordered execution layers
3. **`asyncio.gather()`**: steps within each layer run in parallel

### 7. Built-in Agent Types

The `AgentRegistry` ships with the following pre-configured agent types, each with tailored keywords for automatic routing:

| Agent Type                | Routing Keywords                                         |
| ------------------------- | -------------------------------------------------------- |
| `email_manager`           | email, reply, send, inbox, draft, compose                |
| `calendar_assistant`      | meeting, schedule, calendar, event, appointment          |
| `data_analyst`            | analyze, data, spreadsheet, chart, CSV, budget, metrics  |
| `document_creator`        | document, write, summary, report, letter, memo           |
| `file_manager`            | folder, file, drive, organize, share, upload             |
| `communication_simulator` | angry, complain, escalate, apologize                     |
| `negotiation_advisor`     | discount, price, offer, counter, deal, contract          |
| `business_analyst`        | board report, executive summary, insights, data pipeline |
| `research_composer`       | research and email, investigate, competitive analysis    |
| `meeting_intelligence`    | meeting notes, transcript, action items, follow up       |

---

## API Reference

All routes are prefixed with `/api`. Interactive Swagger docs available at `http://localhost:8000/docs`.

| Method   | Endpoint                            | Description                       |
| -------- | ----------------------------------- | --------------------------------- |
| `GET`    | `/health`                           | Health check                      |
| `POST`   | `/api/auth/login`                   | JWT login                         |
| `POST`   | `/api/auth/register`                | User registration                 |
| `GET`    | `/api/auth/google`                  | Initiate Google OAuth             |
| `GET`    | `/api/auth/callback`                | Google OAuth callback             |
| `GET`    | `/api/agents/`                      | List user's agents                |
| `POST`   | `/api/agents/`                      | Create agent (classic)            |
| `POST`   | `/api/agents/{id}/execute`          | Execute agent task                |
| `POST`   | `/api/agents/{id}/stream`           | SSE streaming agent execution     |
| `POST`   | `/api/dynamic-agents/create`        | Create agent (AgentBrain v2)      |
| `GET`    | `/api/dynamic-agents/create-stream` | SSE streaming AgentBrain creation |
| `DELETE` | `/api/dynamic-agents/{id}`          | Delete agent + RAG cleanup        |
| `POST`   | `/api/documents/upload`             | Upload document for RAG ingestion |
| `POST`   | `/api/documents/create-doc`         | Create Google Doc                 |
| `POST`   | `/api/documents/create-sheet`       | Create Google Sheet               |
| `POST`   | `/api/documents/create-slides`      | Create Google Slides              |
| `GET`    | `/api/gmail/emails`                 | List inbox emails                 |
| `POST`   | `/api/gmail/send`                   | Send email                        |
| `GET`    | `/api/calendar/events`              | List calendar events              |
| `POST`   | `/api/calendar/events`              | Create calendar event             |
| `POST`   | `/api/voice/transcribe`             | Transcribe voice input            |
| `POST`   | `/api/voice/execute`                | Voice → intent → agent            |
| `GET`    | `/api/contacts/`                    | List contacts                     |
| `POST`   | `/api/contacts/`                    | Add contact                       |
| `GET`    | `/api/proactive/briefing`           | Get morning briefing              |
| `POST`   | `/api/workflow/tasks`               | Create workflow task              |
| `POST`   | `/api/webhook/gmail`                | Gmail push notification handler   |

---

## Docker Deployment

The `docker-compose.yml` bundles the full stack for production:

```bash
# Start all services (development)
docker compose up

# Production (includes Nginx reverse proxy)
docker compose --profile production up
```

**Services:**

| Service    | Port    | Description                        |
| ---------- | ------- | ---------------------------------- |
| `backend`  | 8000    | FastAPI API server                 |
| `frontend` | 3000    | Next.js application                |
| `redis`    | 6379    | Caching / rate limiting            |
| `nginx`    | 80, 443 | Reverse proxy (production profile) |

Environment variables for Docker are pulled from `backend/.env` via the compose `environment:` block.

---

## Contributing

### Code Standards

1. **Asynchronous by Default**: All database reads, LLM calls, and external API calls must use `async/await`. Heavy subroutines must use `asyncio.gather()` for concurrency.
2. **Transactional Safety**: State-changing operations on `AIAgent` or `AgentKnowledgeDoc` must include `db.rollback()` in the `except` block. Never leave partial state.
3. **LLM Router Protocol**: Never call LLM providers directly. Always use `utils.llm_router.agenerate(role=..., ...)`. Do not hardcode model names.
4. **Tool Registration**: New MCP tools must be registered in both `mcp_servers/core/mcp_tools.py` (schema + dispatch) and the relevant `tools/*.py` implementation file.
5. **RAG Awareness**: Any new agent path that creates an `AIAgent` and sets `has_rag=True` must call `KnowledgeBase.delete_agent_knowledge(agent_id)` on deletion.
6. **Security**: Email send operations must always pass through the Ghost-Draft (Draft-First) protocol unless explicitly invoked from a confirmed voice command flow.

### Development Tips

- Run the backend in reload mode: `uvicorn main:app --reload` from `backend/src/`
- The Swagger UI at `/docs` is the fastest way to test new endpoints
- All LLM calls are logged at `DEBUG` level in `backend/logs/app.log`
- Microsoft integration is feature-gated: set `AZURE_CLIENT_ID` in `.env` to enable it

---

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

_Built by [your-org](https://example.com)_ 
