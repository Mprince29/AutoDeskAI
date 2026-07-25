from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from auth.database import get_db
from auth.models import User
from auth.routes import get_current_user
from services.telegram_service import TelegramService
from models import TelegramMessage, TelegramMessageResponse
from mcp_servers.core.mcp_tools import mcp_tool

router = APIRouter()


@router.get("/get_telegram_history")
async def get_telegram_history(
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict:
    """Fetch recent Telegram chat history from the local database."""
    messages = db.query(TelegramMessage).filter(
        TelegramMessage.user_id == current_user.id
    ).order_by(TelegramMessage.created_at.desc()).limit(limit).all()
    return {
        "messages": [
            {
                "id": m.id,
                "chat_id": m.chat_id,
                "text": m.text,
                "direction": m.direction,
                "timestamp": m.created_at.isoformat()
            }
            for m in reversed(messages)
        ]
    }


@router.post("/send_telegram_message")
async def send_telegram_message(
    text: str,
    chat_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict:
    """Send a message via the user's configured Telegram bot."""
    success = await TelegramService.send_message(db, current_user.id, text, chat_id)
    return {"success": success}


# ── MCP Tool registrations ────────────────────────────────────────────────────

@mcp_tool(
    name="send_telegram_message",
    description=(
        "Send a Telegram message to the user via their connected bot. "
        "Use this to proactively notify the user, share results, or reply to a Telegram command. "
        "Requires the user to have set up Telegram in Settings → Connected Platforms."
    ),
    parameters={
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "Message text to send. Plain text — no MarkdownV2 escaping needed.",
            },
            "chat_id": {
                "type": "string",
                "description": "Optional Telegram chat ID. Leave blank to send to the user's primary chat.",
            },
        },
        "required": ["text"],
    },
    provider="all",
    category="messaging",
    approval_required=True,
)
async def tool_send_telegram_message(user_email: str, db, text: str, chat_id: str = "") -> dict:
    from auth.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.email == user_email).first()
    if not user:
        return {"error": "User not found."}
    token = await TelegramService.get_token_for_user(db, user.id)
    if not token:
        return {"error": "Telegram not connected. Go to Settings → Connected Platforms to set up your bot."}
    success = await TelegramService.send_message(
        db, user.id, text, chat_id or None, plain_text=True
    )
    return {"success": success, "message": "Sent" if success else "Failed to send"}


@mcp_tool(
    name="get_telegram_history",
    description="Fetch recent Telegram chat messages between the user and their bot.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "Number of messages to fetch (default 10, max 50)", "default": 10},
        },
    },
    provider="all",
    category="messaging",
)
async def tool_get_telegram_history(user_email: str, db, limit: int = 10) -> dict:
    from auth.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.email == user_email).first()
    if not user:
        return {"error": "User not found."}
    messages = db.query(TelegramMessage).filter(
        TelegramMessage.user_id == user.id
    ).order_by(TelegramMessage.created_at.desc()).limit(min(limit, 50)).all()
    return {
        "messages": [
            {
                "text": m.text,
                "direction": m.direction,
                "timestamp": m.created_at.isoformat(),
            }
            for m in reversed(messages)
        ]
    }
