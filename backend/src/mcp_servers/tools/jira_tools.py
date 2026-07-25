import os
import asyncio
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from jira import JIRA
from loguru import logger

router = APIRouter()

# ── Dependency ────────────────────────────────────────────────────────────────

def _get_jira_client_for_request(user_email: Optional[str], db) -> JIRA:
    """Create a fresh per-request Jira client. No global cache - prevents tenant bleed."""
    creds = _resolve_jira_creds(user_email, db) if user_email and db else {}
    if not creds.get("server"):
        # Fallback to env vars (e.g. admin routes with no email)
        server = os.getenv("JIRA_SERVER_URL")
        user = os.getenv("JIRA_USER_EMAIL")
        token = os.getenv("JIRA_API_TOKEN")
        if not server or not user or not token:
            raise HTTPException(
                status_code=401,
                detail="Jira credentials not found. Please connect your Jira account in Settings."
            )
        return JIRA(server=server, basic_auth=(user, token))
    return _make_jira_client(creds)


def _sanitize_jira_error(e: Exception) -> str:
    """Return a concise error message without leaking internal Jira URLs or stack traces."""
    msg = str(e)
    # jira library wraps responses; extract just the status + text when possible
    if hasattr(e, "status_code") and hasattr(e, "text"):
        return f"Jira API error {e.status_code}: {e.text[:200]}"
    # Trim anything that looks like a full URL or Python traceback line
    first_line = msg.splitlines()[0] if msg else "Unknown Jira error"
    return first_line[:300]

# ── Request Schemas ──────────────────────────────────────────────────────────

class JiraIssueRequest(BaseModel):
    issue_key: str
    email: Optional[str] = None

class CreateJiraTicketRequest(BaseModel):
    project_key: str
    summary: str
    description: str
    issue_type: str = "Task"
    email: Optional[str] = None

class SearchJiraRequest(BaseModel):
    jql_query: str
    email: Optional[str] = None

class CommentJiraRequest(BaseModel):
    issue_key: str
    comment: str
    email: Optional[str] = None

# ── Endpoints / Tool Handlers ─────────────────────────────────────────────────

@router.post("/get_jira_issue")
async def get_jira_issue(req: JiraIssueRequest, db=None) -> dict:
    def _get():
        jira = _get_jira_client_for_request(req.email, db)
        issue = jira.issue(req.issue_key)
        return {
            "key": issue.key, "summary": issue.fields.summary,
            "description": issue.fields.description, "status": issue.fields.status.name,
            "reporter": issue.fields.reporter.emailAddress if issue.fields.reporter else "Unknown",
            "assignee": issue.fields.assignee.emailAddress if issue.fields.assignee else "Unassigned",
        }
    try:
        return await asyncio.to_thread(_get)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_sanitize_jira_error(e))

@router.post("/create_jira_ticket")
async def create_jira_ticket(req: CreateJiraTicketRequest, db=None) -> dict:
    def _create():
        creds = _resolve_jira_creds(req.email, db) if req.email and db else {}
        server = creds.get("server") or os.getenv("JIRA_SERVER_URL", "")
        jira = _get_jira_client_for_request(req.email, db)
        new_issue = jira.create_issue(fields={
            "project": {"key": req.project_key}, "summary": req.summary,
            "description": req.description, "issuetype": {"name": req.issue_type},
        })
        return {"key": new_issue.key, "id": new_issue.id, "url": f"{server}/browse/{new_issue.key}"}
    try:
        return await asyncio.to_thread(_create)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_sanitize_jira_error(e))

@router.post("/search_jira_issues")
async def search_jira_issues(req: SearchJiraRequest, db=None) -> dict:
    def _search():
        jira = _get_jira_client_for_request(req.email, db)
        issues = jira.search_issues(req.jql_query, maxResults=10)
        return {"issues": [{"key": i.key, "summary": i.fields.summary,
                            "status": i.fields.status.name} for i in issues],
                "total_found": len(issues)}
    try:
        return await asyncio.to_thread(_search)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_sanitize_jira_error(e))

@router.post("/add_jira_comment")
async def add_jira_comment(req: CommentJiraRequest, db=None) -> dict:
    def _comment():
        jira = _get_jira_client_for_request(req.email, db)
        jira.add_comment(req.issue_key, req.comment)
        return {"success": True, "issue": req.issue_key}
    try:
        return await asyncio.to_thread(_comment)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_sanitize_jira_error(e))

# ── Vault-aware credential resolution ────────────────────────────────────────

def _resolve_jira_creds(user_email: str, db) -> dict:
    """Returns dict with server, token, oauth flag via centralized vault resolver."""
    from services.vault_service import vault
    cred = vault.resolve_credential(user_email, "jira", db)
    if not cred:
        return {"server": "", "user": "", "token": "", "oauth": False}
    # Company-key path: cred has jira_server + jira_email + access_token (API token → basic auth)
    # Personal OAuth path: cred has access_token + metadata.jira_server (OAuth Bearer token)
    token = cred.get("access_token") or cred.get("token") or ""
    server = (
        cred.get("jira_server")
        or (cred.get("metadata") or {}).get("jira_server")
        or (cred.get("metadata") or {}).get("server_url")
        or ""
    )
    # jira_email is present for API-token (basic auth) paths; absent for OAuth Bearer paths
    jira_email_field = cred.get("jira_email") or (cred.get("metadata") or {}).get("user_email") or ""
    # Use Bearer (OAuth) only when there is NO email - API tokens always need basic auth
    use_oauth_bearer = bool(token and not jira_email_field)
    return {
        "server": server,
        "user":   jira_email_field,
        "token":  token,
        "oauth":  use_oauth_bearer,
    }


def _make_jira_client(creds: dict) -> "JIRA":
    if creds.get("oauth"):
        return JIRA(server=creds["server"], token_auth=creds["token"])
    return JIRA(server=creds["server"], basic_auth=(creds["user"], creds["token"]))


# ── MCP Tool registrations ────────────────────────────────────────────────────

from mcp_servers.core.mcp_tools import mcp_tool


@mcp_tool(
    name="get_jira_issue",
    description="Fetch details of a Jira issue by its key (e.g. 'PROJ-123').",
    parameters={
        "type": "object",
        "properties": {
            "issue_key": {"type": "string", "description": "Jira issue key, e.g. 'PROJ-123'"},
        },
        "required": ["issue_key"],
    },
    provider="all",
    category="project_management",
)
async def tool_get_jira_issue(user_email: str, db, issue_key: str) -> dict:
    creds = _resolve_jira_creds(user_email, db)
    if not creds.get("server"):
        return {"error": "Jira not connected. Go to Settings → Connected Platforms."}
    def _get():
        jira = _make_jira_client(creds)
        issue = jira.issue(issue_key)
        return {
            "key": issue.key, "summary": issue.fields.summary,
            "description": issue.fields.description, "status": issue.fields.status.name,
            "reporter": issue.fields.reporter.emailAddress if issue.fields.reporter else "Unknown",
            "assignee": issue.fields.assignee.emailAddress if issue.fields.assignee else "Unassigned",
        }
    try:
        return await asyncio.to_thread(_get)
    except Exception as e:
        return {"error": _sanitize_jira_error(e)}


@mcp_tool(
    name="create_jira_ticket",
    description="Create a new Jira issue/ticket in a project.",
    parameters={
        "type": "object",
        "properties": {
            "project_key": {"type": "string", "description": "Jira project key, e.g. 'ENG'"},
            "summary":     {"type": "string", "description": "Ticket title/summary"},
            "description": {"type": "string", "description": "Detailed description"},
            "issue_type":  {"type": "string", "description": "Issue type: Task, Bug, Story (default: Task)", "default": "Task"},
        },
        "required": ["project_key", "summary", "description"],
    },
    provider="all",
    category="project_management",
    approval_required=True,
)
async def tool_create_jira_ticket(user_email: str, db, project_key: str, summary: str, description: str, issue_type: str = "Task") -> dict:
    creds = _resolve_jira_creds(user_email, db)
    if not creds.get("server"):
        return {"error": "Jira not connected."}
    def _create():
        jira = _make_jira_client(creds)
        issue = jira.create_issue(fields={
            "project": {"key": project_key}, "summary": summary,
            "description": description, "issuetype": {"name": issue_type},
        })
        return {"key": issue.key, "id": issue.id, "url": f"{creds['server']}/browse/{issue.key}"}
    try:
        return await asyncio.to_thread(_create)
    except Exception as e:
        return {"error": _sanitize_jira_error(e)}


@mcp_tool(
    name="search_jira_issues",
    description="Search Jira issues using JQL (Jira Query Language). Example JQL: 'project=ENG AND status=Open'",
    parameters={
        "type": "object",
        "properties": {
            "jql_query": {"type": "string", "description": "JQL query string"},
        },
        "required": ["jql_query"],
    },
    provider="all",
    category="project_management",
)
async def tool_search_jira_issues(user_email: str, db, jql_query: str) -> dict:
    creds = _resolve_jira_creds(user_email, db)
    if not creds.get("server"):
        return {"error": "Jira not connected."}
    def _search():
        jira = _make_jira_client(creds)
        issues = jira.search_issues(jql_query, maxResults=10)
        return {"issues": [{"key": i.key, "summary": i.fields.summary, "status": i.fields.status.name} for i in issues]}
    try:
        return await asyncio.to_thread(_search)
    except Exception as e:
        return {"error": _sanitize_jira_error(e)}
