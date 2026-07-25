import sys
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from loguru import logger
import uvicorn
from contextlib import asynccontextmanager

# Setup paths
src_dir = Path(__file__).parent.parent
sys.path.insert(0, str(src_dir))

# Configure unified logger - stdout only (no local log files)
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    level="INFO",
)

# Initialize FastAPI Hub
app = FastAPI(
    title="Unified MCP Server",
    description="High-performance gateway for all Agentic Tools (Gmail, Calendar, etc.)",
    version="1.0.0",
)

# Global exception handler for tool consistency
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unified MCP Error: {exc} | Path: {request.url.path}")
    # Return structured error so main backend doesn't crash
    return JSONResponse(
        status_code=getattr(exc, 'status_code', 500),
        content={"error": getattr(exc, 'detail', str(exc))}
    )

from googleapiclient.errors import HttpError

@app.exception_handler(HttpError)
async def google_http_error_handler(request: Request, exc: HttpError):
    logger.error(f"Google API Error: {exc.reason} | Path: {request.url.path}")
    import json
    try:
        error_details = json.loads(exc.content.decode("utf-8") if isinstance(exc.content, bytes) else exc.content)
        detail = error_details.get("error", {}).get("message", exc.reason)
    except Exception:
        detail = exc.reason
    return JSONResponse(
        status_code=exc.resp.status,
        content={"error": detail}
    )

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Unified MCP Server"}

# Import routes from tools AFTER app is defined
from mcp_servers.tools.gmail_tools import router as gmail_router
from mcp_servers.tools.calendar_tools import router as calendar_router
from mcp_servers.tools.echo_tools import router as echo_router
from mcp_servers.tools.sheets_tools import router as sheets_router
from mcp_servers.tools.forms_tools import router as forms_router
from mcp_servers.tools.slides_tools import router as slides_router
from mcp_servers.tools.search_tools import router as search_router
app.include_router(gmail_router, prefix="/gmail", tags=["Gmail"])
app.include_router(calendar_router, prefix="/calendar", tags=["Calendar"])
app.include_router(echo_router, prefix="/echo-agent", tags=["Extensibility Test"])
app.include_router(sheets_router, prefix="/sheets", tags=["Sheets"])
app.include_router(forms_router, prefix="/forms", tags=["Forms"])
app.include_router(slides_router, prefix="/slides", tags=["Slides"])
app.include_router(search_router, prefix="/search", tags=["Search"])

# Corporate Command Center routers - each guarded so a missing library only
# disables that platform's HTTP routes; the rest of the MCP server keeps running.
try:
    from mcp_servers.tools.linkedin_tools import router as linkedin_router
    app.include_router(linkedin_router, prefix="/linkedin", tags=["LinkedIn"])
except ImportError:
    logger.warning("[unified_server] LinkedIn routes disabled")

try:
    from mcp_servers.tools.github_tools import router as github_router
    app.include_router(github_router, prefix="/github", tags=["GitHub"])
except ImportError:
    logger.warning("[unified_server] GitHub routes disabled - PyGithub not installed")

try:
    from mcp_servers.tools.jira_tools import router as jira_router
    app.include_router(jira_router, prefix="/jira", tags=["Jira"])
except ImportError:
    logger.warning("[unified_server] Jira routes disabled - jira library not installed")

try:
    from mcp_servers.tools.trello_tools import router as trello_router
    app.include_router(trello_router, prefix="/trello", tags=["Trello"])
except ImportError:
    logger.warning("[unified_server] Trello routes disabled - py-trello not installed")

try:
    from mcp_servers.tools.slack_tools import router as slack_router
    app.include_router(slack_router, prefix="/slack", tags=["Slack"])
except ImportError:
    logger.warning("[unified_server] Slack routes disabled - slack_sdk not installed")

try:
    from mcp_servers.tools.discord_tools import router as discord_router
    app.include_router(discord_router, prefix="/discord", tags=["Discord"])
except ImportError:
    logger.warning("[unified_server] Discord routes disabled - httpx not installed")

def run_unified_server():
    """Run the optimized Uvicorn server"""
    logger.info("🚀 Starting Unified MCP Server on port 8001...")
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(backend_dir / ".env")
    run_unified_server()
