import os
import asyncio
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from trello import TrelloClient

router = APIRouter()

# ── Dependency ────────────────────────────────────────────────────────────────

_trello_client: Optional[TrelloClient] = None
_trello_creds_used: Optional[tuple] = None

def get_trello_client() -> TrelloClient:
    global _trello_client, _trello_creds_used
    api_key = os.getenv("TRELLO_API_KEY")
    token = os.getenv("TRELLO_TOKEN")

    if not api_key or not token:
        raise HTTPException(
            status_code=401,
            detail="TRELLO_API_KEY or TRELLO_TOKEN not configured in .env"
        )
    creds = (api_key, token)
    if _trello_client is None or _trello_creds_used != creds:
        _trello_client = TrelloClient(api_key=api_key, token=token)
        _trello_creds_used = creds
    return _trello_client

# ── Request Schemas ──────────────────────────────────────────────────────────

class GetBoardsRequest(BaseModel):
    pass

class CreateCardRequest(BaseModel):
    list_id: str
    name: str
    desc: str = ""

class UpdateCardStatusRequest(BaseModel):
    card_id: str
    list_id: str

# ── Endpoints / Tool Handlers ─────────────────────────────────────────────────

@router.post("/get_trello_boards")
async def get_trello_boards(req: GetBoardsRequest) -> dict:
    def _get():
        client = get_trello_client()
        boards = client.list_boards()
        results = []
        for b in boards:
            lists = [{"id": l.id, "name": l.name} for l in b.list_lists()]
            results.append({
                "id": b.id,
                "name": b.name,
                "url": b.url,
                "lists": lists
            })
        return {"boards": results}
    try:
        return await asyncio.to_thread(_get)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/create_trello_card")
async def create_trello_card(req: CreateCardRequest) -> dict:
    def _create():
        client = get_trello_client()
        tlist = client.get_list(req.list_id)
        card = tlist.add_card(name=req.name, desc=req.desc)
        return {
            "id": card.id,
            "name": card.name,
            "url": card.url
        }
    try:
        return await asyncio.to_thread(_create)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/move_trello_card")
async def move_trello_card(req: UpdateCardStatusRequest) -> dict:
    def _move():
        client = get_trello_client()
        card = client.get_card(req.card_id)
        card.change_list(req.list_id)
        return {"success": True, "card_id": card.id}
    try:
        return await asyncio.to_thread(_move)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Vault-aware credential resolution ────────────────────────────────────────

def _resolve_trello_creds(user_email: str, db) -> dict:
    from services.vault_service import vault
    cred = vault.resolve_credential(user_email, "trello", db)
    if not cred:
        return {"api_key": "", "token": ""}
    return {"api_key": cred.get("api_key", ""), "token": cred.get("token", "")}


# ── MCP Tool registrations ────────────────────────────────────────────────────

from mcp_servers.core.mcp_tools import mcp_tool


@mcp_tool(
    name="get_trello_boards",
    description="List all Trello boards the user has access to, including their lists.",
    parameters={"type": "object", "properties": {}},
    provider="all",
    category="project_management",
)
async def tool_get_trello_boards(user_email: str, db) -> dict:
    creds = _resolve_trello_creds(user_email, db)
    if not creds["api_key"]:
        return {"error": "Trello not connected. Go to Settings → Connected Platforms."}
    def _get():
        client = TrelloClient(api_key=creds["api_key"], token=creds["token"])
        boards = client.list_boards()
        return {"boards": [{"id": b.id, "name": b.name, "url": b.url,
                            "lists": [{"id": l.id, "name": l.name} for l in b.list_lists()]}
                           for b in boards]}
    try:
        return await asyncio.to_thread(_get)
    except Exception as e:
        return {"error": str(e)}


@mcp_tool(
    name="create_trello_card",
    description="Create a new card in a Trello list.",
    parameters={
        "type": "object",
        "properties": {
            "list_id": {"type": "string", "description": "Trello list ID (get from get_trello_boards)"},
            "name":    {"type": "string", "description": "Card title"},
            "desc":    {"type": "string", "description": "Card description (optional)", "default": ""},
        },
        "required": ["list_id", "name"],
    },
    provider="all",
    category="project_management",
    approval_required=True,
)
async def tool_create_trello_card(user_email: str, db, list_id: str, name: str, desc: str = "") -> dict:
    creds = _resolve_trello_creds(user_email, db)
    if not creds["api_key"]:
        return {"error": "Trello not connected."}
    def _create():
        client = TrelloClient(api_key=creds["api_key"], token=creds["token"])
        tlist = client.get_list(list_id)
        card = tlist.add_card(name=name, desc=desc)
        return {"id": card.id, "name": card.name, "url": card.url}
    try:
        return await asyncio.to_thread(_create)
    except Exception as e:
        return {"error": str(e)}


@mcp_tool(
    name="move_trello_card",
    description="Move a Trello card to a different list (e.g. from 'To Do' to 'In Progress').",
    parameters={
        "type": "object",
        "properties": {
            "card_id": {"type": "string", "description": "Trello card ID"},
            "list_id": {"type": "string", "description": "Destination Trello list ID"},
        },
        "required": ["card_id", "list_id"],
    },
    provider="all",
    category="project_management",
    approval_required=True,
)
async def tool_move_trello_card(user_email: str, db, card_id: str, list_id: str) -> dict:
    creds = _resolve_trello_creds(user_email, db)
    if not creds["api_key"]:
        return {"error": "Trello not connected."}
    def _move():
        client = TrelloClient(api_key=creds["api_key"], token=creds["token"])
        card = client.get_card(card_id)
        card.change_list(list_id)
        return {"success": True, "card_id": card.id}
    try:
        return await asyncio.to_thread(_move)
    except Exception as e:
        return {"error": str(e)}
