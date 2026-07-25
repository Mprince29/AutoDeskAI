import os
import sys
from pathlib import Path
from loguru import logger
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

# Configure logging - stdout only (no local log files)
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    level="INFO",
    filter=lambda record: record["level"].name in ["INFO", "WARNING", "ERROR", "CRITICAL"],
)

import asyncio
import time
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from contextlib import asynccontextmanager

# Import routers after logger is configured
from auth.routes import router as auth_router
from routes.agent_routes import router as agent_router
from routes.dynamic_agent_routes import router as dynamic_agent_router
import mcp_servers.tools  # noqa: F401 - triggers @mcp_tool registration for all tool modules
from mcp_servers.tools.gmail_tools import router as gmail_router
from mcp_servers.tools.calendar_tools import router as calendar_router
from mcp_servers.tools.docs_tools import router as docs_router
from mcp_servers.tools.workspace_tools import router as workspace_router
from routes.document_routes import router as document_routes
from routes.voice_routes import router as voice_router
from routes.contact_routes import router as contact_router
from mcp_servers.tools.context_tools import router as context_router
from routes.webhooks import router as webhooks_router
from routes.proactive_routes import router as proactive_router
from routes.workflow_routes import router as workflow_router
from routes.integrations_routes import router as integrations_router
from mcp_servers.tools.telegram_tools import router as telegram_tools_router
from routes.notification_routes import router as notification_router
from routes.draft_routes import router as draft_router
from routes.logging_routes import router as logging_router
from routes.skills_routes import router as skills_router
from routes.social_routes import router as social_router
from auth.database import create_db_and_tables
import models  # noqa: F401 - ensures AgentToolCallLog (and all models) are in Base.metadata
from utils.activity_logger import record_activity
from auth.database import SessionLocal as _SL

# Create database tables, then attach the DB log sink (WARNING+ → app_logs table)
create_db_and_tables()
from services.db_log_sink import db_log_sink, enable_db_sink
logger.add(db_log_sink, level="WARNING", format="{message}", enqueue=True)
enable_db_sink()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    BANNER = """
 ┌────────────────────────┐
 │        AutoDeskAI           │
 └───────────────────────┘
    """
    print(BANNER)
    logger.info("Initializing AutoDeskAI API Intelligence...")
    
    components = []
    
    # Start morning briefing scheduler
    from services.briefing_agent import init_briefing_scheduler
    scheduler = init_briefing_scheduler()
    if scheduler:
        components.append("Scheduler")
    else:
        components.append("Scheduler(OFF)")

    # Start follow-up persistence scheduler (5-min pulse)
    from services.follow_up_scheduler import init_follow_up_scheduler
    fu_scheduler = init_follow_up_scheduler()
    if fu_scheduler:
        components.append("FollowUp-Scheduler")
    else:
        components.append("FollowUp-Scheduler(FAIL)")

    # Start RAG IngestWorker
    try:
        from auth.database import SessionLocal
        from services.knowledge_base import KnowledgeBase
        KnowledgeBase.init_worker(SessionLocal)
        await KnowledgeBase.start_worker()
        components.append("RAG-Worker")
    except Exception:
        components.append("RAG-Worker(FAIL)")

    # Start URL Watch Scheduler
    import asyncio
    from mcp_servers.tools.browser_watcher_tools import _URL_WATCH_REGISTRY, tool_diff_webpage
    
    async def _url_watch_scheduler():
        while True:
            await asyncio.sleep(300)
            try:
                for watch_id, entry in list(_URL_WATCH_REGISTRY.items()):
                    # Yield per iteration to prevent stalling user chats
                    await asyncio.sleep(0.05)
                    res = await tool_diff_webpage(entry["user_email"], None, watch_id)
                    if res.get("changed"):
                        logger.info(f"URL changed: {entry['url']} (Watch ID: {watch_id})")
            except Exception as e:
                logger.error(f"Error in URL watch scheduler: {e}")

    watch_task = asyncio.create_task(_url_watch_scheduler())
    components.append("URL-Watcher")

    # Final startup indicator
    env = os.getenv('ENVIRONMENT', 'development').upper()
    logger.info(f"System Online | {env} | Active: [{', '.join(components)}]")

    yield
    # Shutdown
    if scheduler:
        scheduler.shutdown(wait=False)
    if fu_scheduler:
        fu_scheduler.shutdown(wait=False)
    if watch_task and not watch_task.done():
        watch_task.cancel()
    logger.info("AutoDeskAI API shutting down")

app = FastAPI(
    title="AutoDeskAI API",
    description="Multi-Agent Workflow Automation Platform with AI-powered email management and meeting scheduling",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS - origins driven by env so ngrok / production domains just work.
# Set CORS_ORIGINS in .env as comma-separated list, e.g.:
#   CORS_ORIGINS=http://localhost:3000,https://xxxx.ngrok-free.app
_cors_env = os.getenv(
    "CORS_ORIGINS",
    "https://www.autodeskai.ai,https://autodeskai.ai,https://autodeskai.example.com,http://localhost:3000",
)
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
logger.info(f"CORS allowed origins: {_cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id"],
    max_age=600,  # cache preflight for 10 min — eliminates repeated OPTIONS requests
)

# ── Per-user sliding-window rate limiter ────────────────────────────────────
# Heavy endpoints (agent chat, task creation) are capped at 20 req/min per
# user email to prevent one user monopolising the connection pool.
# Falls back to in-memory counter when Redis is unavailable.

# Only POST/PUT/PATCH mutations on heavy AI endpoints are rate-limited.
# GET requests (sessions list, history, status) are never counted.
_RATE_LIMITED_PREFIXES = (
    "/api/agents/chat/stream",
    "/api/dynamic-agents/chat",
    "/api/agents/tasks",
)
_RATE_LIMIT_METHODS = {"POST", "PUT", "PATCH"}
_RATE_LIMIT_MAX = 60      # requests per window (was 20 — too tight for normal usage)
_RATE_LIMIT_WINDOW = 60   # seconds

# In-memory fallback: {key: (count, window_start)}
_rate_mem: dict = {}

_ACTIVITY_SKIP_PATHS = {
    "/health",
    "/health/db",
    "/favicon.ico",
    "/api/logs/client",
}
_ACTIVITY_SKIP_PREFIXES = (
    "/docs",
    "/openapi.json",
    "/redoc",
)
_ACTIVITY_LOGGED_READ_PREFIXES = (
    "/api/auth/",
    "/api/integrations/",
    "/api/proactive/briefing",
)
_ANONYMOUS_SLOW_SKIP_PATHS = {
    "/api/gmail/list_emails",
    "/api/calendar/list_events",
    "/api/logs/client",
    "/api/voice/health",
}

def _should_log_request_activity(request: Request, status_code: int) -> bool:
    """Keep the unified audit trail useful without filling the DB with polling noise."""
    if request.method == "OPTIONS":
        return False
    path = request.url.path
    if path in _ACTIVITY_SKIP_PATHS or any(path.startswith(p) for p in _ACTIVITY_SKIP_PREFIXES):
        return False
    if request.method == "POST" and path in {"/api/auth/login", "/api/auth/signup"}:
        return False  # auth routes write explicit auth_login/account_created rows with user identity
    if status_code >= 400:
        return False  # handled by error_logging_middleware with failure details
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        return True
    return any(path.startswith(p) for p in _ACTIVITY_LOGGED_READ_PREFIXES)


def _activity_email_from_request(request: Request) -> str:
    return (
        request.query_params.get("email")
        or request.headers.get("x-user-email")
        or request.headers.get("x-auth-email")
        or "anonymous"
    )


def _request_user_email(request: Request) -> str | None:
    email = (
        request.query_params.get("email")
        or request.headers.get("x-user-email")
        or request.headers.get("x-auth-email")
    )
    return email or None


def _request_action_name(request: Request) -> str:
    """Short, readable action name; IDs stay in details, not the action index."""
    path = request.url.path
    compact_path = path.removeprefix("/api/")
    parts = [p for p in compact_path.split("/") if p]
    normalized = []
    for part in parts[:4]:
        if part.isdigit() or len(part) > 32:
            normalized.append("{id}")
        else:
            normalized.append(part.replace("-", "_"))
    return f"request:{request.method.lower()}:{'.'.join(normalized) or 'root'}"[:100]


async def _is_rate_limited(key: str) -> bool:
    """Sliding window counter via Redis INCR+EXPIRE. Returns True if over limit."""
    try:
        from services.redis_service import get_redis
        r = get_redis()
        if r is not None:
            rkey = f"rl:{key}"
            count = await r.incr(rkey)
            if count == 1:
                await r.expire(rkey, _RATE_LIMIT_WINDOW)
            return count > _RATE_LIMIT_MAX
    except Exception:
        pass
    # In-memory fallback
    now = time.monotonic()
    # Prune stale entries to prevent unbounded growth under high unique-IP load
    if len(_rate_mem) > 5000:
        stale = [k for k, (_, ts) in _rate_mem.items() if (now - ts) >= _RATE_LIMIT_WINDOW]
        for k in stale:
            _rate_mem.pop(k, None)
    entry = _rate_mem.get(key)
    if entry is None or (now - entry[1]) >= _RATE_LIMIT_WINDOW:
        _rate_mem[key] = (1, now)
        return False
    count, start = entry
    count += 1
    _rate_mem[key] = (count, start)
    return count > _RATE_LIMIT_MAX


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.method not in _RATE_LIMIT_METHODS:
        return await call_next(request)
    path = request.url.path
    if any(path.startswith(p) for p in _RATE_LIMITED_PREFIXES):
        # Identify user by email query param or X-User-Email header
        user_key = (
            request.query_params.get("email")
            or request.headers.get("x-user-email")
            or request.client.host  # fallback to IP
        )
        if await _is_rate_limited(user_key):
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded - max {_RATE_LIMIT_MAX} agent requests per minute. Please wait and try again."
                },
                headers={"Retry-After": str(_RATE_LIMIT_WINDOW)},
            )
    return await call_next(request)


@app.middleware("http")
async def latency_logging_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    start_time = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start_time
    
    # Add duration to response headers for debugging
    response.headers["X-Response-Time"] = f"{duration:.3f}s"
    
    # Log slow requests (> 3 seconds) as a performance event
    if duration > 3.0:
        path = request.url.path
        user_email = _request_user_email(request)
        if path in _ACTIVITY_SKIP_PATHS or any(path.startswith(p) for p in _ACTIVITY_SKIP_PREFIXES):
            return response
        if not user_email and (path in _ANONYMOUS_SLOW_SKIP_PATHS or response.status_code < 500):
            return response
        
        db = _SL()
        try:
            record_activity(
                db,
                user_email=user_email or "anonymous",
                action="performance_warning:slow_request",
                entity_type="request",
                entity_id=f"{request.method}:{path}"[:100],
                error_message=f"Slow request: {request.method} {path} took {duration:.2f}s",
                level="WARNING",
                details={
                    "path": path,
                    "method": request.method,
                    "ms": int(duration * 1000),
                    "status": response.status_code
                },
                request=request
            )
        except Exception as e:
            logger.warning(f"Failed to log performance activity: {e}")
        finally:
            db.close()
            
    return response


@app.middleware("http")
async def activity_request_middleware(request: Request, call_next):
    """Compact audit row for user-visible API actions.

    Route-specific logs still carry rich details such as chat text or uploaded
    filenames. This middleware is the safety net for routes that do not yet
    call record_activity directly.
    """
    start_time = time.perf_counter()
    response = await call_next(request)

    if _should_log_request_activity(request, response.status_code):
        db = _SL()
        try:
            record_activity(
                db,
                user_email=_activity_email_from_request(request),
                action=_request_action_name(request),
                entity_type="request",
                status="success",
                details={
                    "path": request.url.path,
                    "method": request.method,
                    "status": response.status_code,
                    "ms": int((time.perf_counter() - start_time) * 1000),
                },
                request=request,
            )
        except Exception as e:
            logger.warning(f"Failed to log request activity: {e}")
        finally:
            db.close()

    return response


@app.middleware("http")
async def error_logging_middleware(request: Request, call_next):
    """Global middleware to log all 4xx and 5xx errors to ActivityLog."""
    response = await call_next(request)
    
    # Only log failures (4xx and 5xx)
    if response.status_code >= 400:
        # Don't log 401/403/404 for noise reduction, unless it's a 500
        # Actually, user wants failure logs, so let's log everything >= 400
        
        path = request.url.path
        # Skip noise like health checks or static assets if any
        if path in ("/health", "/health/db", "/favicon.ico"):
            return response

        # Try to identify user
        user_email = (
            request.query_params.get("email")
            or request.headers.get("x-user-email")
        )
        
        # If still no email, maybe try to decode JWT if present (optional complexity)
        # For now, if we have email, we log it.
        if user_email:
            # We use a background task or a new session to avoid blocking
            db = _SL()
            try:
                record_activity(
                    db,
                    user_email=user_email,
                    action=f"request_failure:{request.method}:{path}",
                    entity_type="request",
                    entity_id=f"{request.method}:{path}"[:100],
                    status="failed",
                    error_message=f"HTTP {response.status_code}",
                    details={
                        "path": path,
                        "method": request.method,
                        "status_code": response.status_code,
                        "query_params": dict(request.query_params)
                    },
                    request=request
                )
            except Exception as e:
                logger.warning(f"Failed to log error activity: {e}")
            finally:
                db.close()

    return response


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Global exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )

# Health check endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "AutoDeskAI API",
    }


@app.get("/health/db")
async def health_db():
    """Connection pool status - useful for diagnosing pool exhaustion under load."""
    try:
        from auth.database import engine
        pool = engine.pool
        return {
            "status": "healthy",
            "pool_size": pool.size(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "available": pool.size() - pool.checkedout(),
        }
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "error": str(e)})


# Real-time inbox update stream
# Inbox page subscribes to this to get live notifications when new emails arrive.
@app.get("/api/automated/updates")
async def automated_updates(email: str = Query(..., description="User email")):
    """SSE stream that fires an 'updated' event whenever the inbox monitoring detects
    new mail. Clients should reconnect on error (EventSource default behaviour).

    Protocol:
      - On connect: fires one 'updated' event so the UI refreshes immediately.
      - Every 25 s: sends a keep-alive comment so the connection is not dropped
        by proxies / load-balancers.
      - After 5 minutes the connection is closed; the browser's EventSource will
        reconnect automatically (unless the client called es.close()).
    """
    async def _event_stream():
        import json as _json
        from routes.webhooks import _AUTO_REPLY_PENDING

        # Immediate refresh trigger on connect
        yield "event: updated\ndata: {}\n\n"

        # 5-minute lifetime: 150 ticks × 2s = 300s
        # Keep-alive comment sent every 25s (every 12 ticks) to prevent proxy drops.
        for tick in range(150):
            await asyncio.sleep(2)
            # Drain any pending auto-reply events immediately (no 25s lag)
            if email in _AUTO_REPLY_PENDING:
                payload = _AUTO_REPLY_PENDING.pop(email)
                yield f"event: auto_reply_pending\ndata: {_json.dumps(payload)}\n\n"
            # Keep-alive every 25s
            if tick % 12 == 11:
                yield ": keep-alive\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering
            "Connection": "keep-alive",
        },
    )


# Register routers
app.include_router(auth_router, prefix="/api")
app.include_router(agent_router, prefix="/api/agents")
app.include_router(dynamic_agent_router, prefix="/api/dynamic-agents")
app.include_router(gmail_router, prefix="/api/gmail")
app.include_router(calendar_router, prefix="/api/calendar")
app.include_router(docs_router, prefix="/api/docs")
app.include_router(workspace_router, prefix="/api/workspace")
app.include_router(document_routes, prefix="/api/documents")
app.include_router(voice_router, prefix="/api/voice")
app.include_router(contact_router, prefix="/api/contacts")
app.include_router(context_router, prefix="/api/context")
app.include_router(webhooks_router, prefix="/api/webhooks")
app.include_router(proactive_router, prefix="/api/proactive")
app.include_router(workflow_router, prefix="/api")
app.include_router(integrations_router, prefix="/api/integrations")
app.include_router(telegram_tools_router, prefix="/api/integrations")
app.include_router(notification_router, prefix="/api/notifications")
app.include_router(draft_router, prefix="/api")
app.include_router(logging_router, prefix="/api")
app.include_router(skills_router, prefix="/api/skills")
app.include_router(social_router, prefix="/api/social")

# MICROSOFT DISABLED - uncomment block below to re-enable
# if os.environ.get("AZURE_CLIENT_ID"):
#     app.include_router(microsoft_auth_router, prefix="/api")
#     logger.info("Microsoft Auth endpoints enabled.")
# else:
#     logger.info("Microsoft Auth endpoints disabled (AZURE_CLIENT_ID not set).")

# Root endpoint
@app.get("/")
async def root():
    return {
        "message": "AutoDeskAI API",
        "version": "1.0.0",
        "description": "Multi-Agent Workflow Automation Platform",
        "docs": "/docs",
        "health": "/health",
        "workflow_health": "/api/workflow/health",
        "agent_health": "/api/agents/health",
    }

if __name__ == "__main__":
    import uvicorn
    import os
    import sys
    from pathlib import Path
    
    # Add src to Python path if running from backend directory
    if os.path.basename(os.getcwd()) != "src":
        src_path = Path(__file__).parent
        sys.path.insert(0, str(src_path))
    
    # Keep reload in dev, initialization now lives in lifespan
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="warning")
