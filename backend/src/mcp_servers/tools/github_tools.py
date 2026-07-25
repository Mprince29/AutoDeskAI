import os
import asyncio
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from github import Github, GithubException

router = APIRouter()

# ── Request Schemas ──────────────────────────────────────────────────────────

class RepoRequest(BaseModel):
    repo_name: str
    email: Optional[str] = None

class CreateIssueRequest(BaseModel):
    repo_name: str
    title: str
    body: str
    labels: Optional[List[str]] = None
    email: Optional[str] = None

class SearchIssueRequest(BaseModel):
    repo_name: str
    query: str
    email: Optional[str] = None

class GetFileRequest(BaseModel):
    repo_name: str
    file_path: str
    email: Optional[str] = None

# ── Endpoints / Tool Handlers ─────────────────────────────────────────────────

@router.post("/get_repository_context")
async def get_repository_context(req: RepoRequest, db=None) -> dict:
    token = _resolve_github_token_for_request(req.email, db)
    if not token:
        raise HTTPException(status_code=401, detail="GitHub not connected. Add your GitHub token in Settings.")
    def _fetch():
        repo = Github(token).get_repo(req.repo_name)
        return {"name": repo.full_name, "description": repo.description,
                "stars": repo.stargazers_count, "open_issues": repo.open_issues_count,
                "html_url": repo.html_url}
    try:
        return await asyncio.to_thread(_fetch)
    except GithubException as e:
        msg = e.data.get("message", str(e)) if isinstance(e.data, dict) else str(e)
        if e.status == 404:
            msg = f"Repository '{req.repo_name}' not found. Ensure the format is 'owner/repo' and the token has access."
        raise HTTPException(status_code=e.status, detail=msg)

@router.post("/create_issue")
async def create_issue(req: CreateIssueRequest, db=None) -> dict:
    token = _resolve_github_token_for_request(req.email, db)
    if not token:
        raise HTTPException(status_code=401, detail="GitHub not connected.")
    def _create():
        repo = Github(token).get_repo(req.repo_name)
        issue = repo.create_issue(title=req.title, body=req.body, labels=req.labels or [])
        return {"issue_url": issue.html_url, "issue_number": issue.number,
                "title": issue.title, "state": issue.state}
    try:
        return await asyncio.to_thread(_create)
    except GithubException as e:
        raise HTTPException(status_code=e.status, detail=e.data.get("message", str(e)))

@router.post("/search_issues")
async def search_issues(req: SearchIssueRequest, db=None) -> dict:
    token = _resolve_github_token_for_request(req.email, db)
    if not token:
        raise HTTPException(status_code=401, detail="GitHub not connected.")
    def _search():
        g = Github(token)
        issues = g.search_issues(f"repo:{req.repo_name} {req.query}")
        results = []
        for i, issue in enumerate(issues):
            if i >= 10: break
            results.append({"number": issue.number, "title": issue.title,
                            "state": issue.state, "url": issue.html_url})
        return {"issues": results, "total": issues.totalCount}
    try:
        return await asyncio.to_thread(_search)
    except GithubException as e:
        raise HTTPException(status_code=e.status, detail=e.data.get("message", str(e)))

@router.post("/get_file_content")
async def get_file_content(req: GetFileRequest, db=None) -> dict:
    token = _resolve_github_token_for_request(req.email, db)
    if not token:
        raise HTTPException(status_code=401, detail="GitHub not connected.")
    def _get_file():
        repo = Github(token).get_repo(req.repo_name)
        file_content = repo.get_contents(req.file_path)
        if isinstance(file_content, list):
            entries = [{"path": f.path, "type": f.type, "size": f.size} for f in file_content]
            return {"path": req.file_path, "type": "directory", "entries": entries}
        return {"path": file_content.path, "content": file_content.decoded_content.decode("utf-8"),
                "type": "file", "size": file_content.size}
    try:
        return await asyncio.to_thread(_get_file)
    except GithubException as e:
        raise HTTPException(status_code=e.status, detail=e.data.get("message", str(e)))

# ── Vault-aware credential resolution ────────────────────────────────────────

def _resolve_github_token(user_email: str, db) -> str:
    from services.vault_service import vault
    cred = vault.resolve_credential(user_email, "github", db)
    return (cred.get("access_token") or cred.get("token") or "") if cred else ""

def _resolve_github_token_for_request(email: Optional[str], db) -> str:
    """Used by REST routes - resolves vault token for email, no shared-env fallback."""
    if not email or not db:
        return ""
    return _resolve_github_token(email, db)


# ── MCP Tool registrations ────────────────────────────────────────────────────

from mcp_servers.core.mcp_tools import mcp_tool


@mcp_tool(
    name="get_repository_context",
    description="Get summary info about a GitHub repository: stars, open issues, description, URL.",
    parameters={
        "type": "object",
        "properties": {
            "repo_name": {"type": "string", "description": "Repository in 'owner/repo' format, e.g. 'torvalds/linux'"},
        },
        "required": ["repo_name"],
    },
    provider="all",
    category="development",
)
async def tool_get_repository_context(user_email: str, db, repo_name: str) -> dict:
    token = _resolve_github_token(user_email, db)
    if not token:
        return {"error": "GitHub not connected. Go to Settings → Connected Platforms."}
    def _fetch():
        g = Github(token)
        repo = g.get_repo(repo_name)
        return {"name": repo.full_name, "description": repo.description,
                "stars": repo.stargazers_count, "open_issues": repo.open_issues_count,
                "html_url": repo.html_url}
    try:
        return await asyncio.to_thread(_fetch)
    except GithubException as e:
        msg = e.data.get("message", str(e)) if isinstance(e.data, dict) else str(e)
        return {"error": msg}


@mcp_tool(
    name="create_github_issue",
    description="Create a new issue in a GitHub repository.",
    parameters={
        "type": "object",
        "properties": {
            "repo_name": {"type": "string", "description": "Repository in 'owner/repo' format"},
            "title":     {"type": "string", "description": "Issue title"},
            "body":      {"type": "string", "description": "Issue description / body"},
            "labels":    {"type": "array", "items": {"type": "string"}, "description": "Optional labels list"},
        },
        "required": ["repo_name", "title", "body"],
    },
    provider="all",
    category="development",
    approval_required=True,
)
async def tool_create_github_issue(user_email: str, db, repo_name: str, title: str, body: str, labels: list = None) -> dict:
    token = _resolve_github_token(user_email, db)
    if not token:
        return {"error": "GitHub not connected."}
    def _create():
        g = Github(token)
        repo = g.get_repo(repo_name)
        issue = repo.create_issue(title=title, body=body, labels=labels or [])
        return {"issue_url": issue.html_url, "issue_number": issue.number, "title": issue.title, "state": issue.state}
    try:
        return await asyncio.to_thread(_create)
    except GithubException as e:
        return {"error": e.data.get("message", str(e)) if isinstance(e.data, dict) else str(e)}


@mcp_tool(
    name="search_github_issues",
    description="Search open/closed issues and pull requests in a GitHub repository.",
    parameters={
        "type": "object",
        "properties": {
            "repo_name": {"type": "string", "description": "Repository in 'owner/repo' format"},
            "query":     {"type": "string", "description": "Search keywords, e.g. 'login bug is:open'"},
        },
        "required": ["repo_name", "query"],
    },
    provider="all",
    category="development",
)
async def tool_search_github_issues(user_email: str, db, repo_name: str, query: str) -> dict:
    token = _resolve_github_token(user_email, db)
    if not token:
        return {"error": "GitHub not connected."}
    def _search():
        g = Github(token)
        results = g.search_issues(f"repo:{repo_name} {query}")
        items = []
        for i, issue in enumerate(results):
            if i >= 10: break
            items.append({"number": issue.number, "title": issue.title, "state": issue.state, "url": issue.html_url})
        return {"issues": items, "total": results.totalCount}
    try:
        return await asyncio.to_thread(_search)
    except GithubException as e:
        return {"error": e.data.get("message", str(e)) if isinstance(e.data, dict) else str(e)}
