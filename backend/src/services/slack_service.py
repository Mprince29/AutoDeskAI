import re
import asyncio
import httpx
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from loguru import logger
from auth.models import User, UserIntegration
from services.agent_executor import AgentExecutor
from auth.database import get_db

class SlackService:
    @staticmethod
    async def handle_webhook(db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Process incoming Slack events (mentions, DMs)."""
        # 1. URL Verification Challenge
        if payload.get("type") == "url_verification":
            logger.info("Slack URL verification challenge received")
            return {"challenge": payload.get("challenge")}

        event = payload.get("event")
        if not event:
            return {"status": "ignored"}

        # 2. Ignore bot messages to avoid loops
        if event.get("bot_id") or event.get("subtype") == "bot_message":
            return {"status": "ignored"}

        # Only process relevant event types
        event_type = event.get("type")
        if event_type not in ("app_mention", "message"):
            return {"status": f"ignored_type_{event_type}"}

        team_id = payload.get("team_id")
        user_slack_id = event.get("user")
        text = event.get("text", "")
        channel = event.get("channel", "")
        # thread_ts groups messages in a thread. If it's a new mention, use ts.
        thread_ts = event.get("thread_ts") or event.get("ts")

        # 3. Resolve user by team_id
        # We look for a UserIntegration row where platform='slack' 
        # and metadata_json contains this team_id
        integrations = db.query(UserIntegration).filter(
            UserIntegration.platform == "slack",
            UserIntegration.status == "connected"
        ).all()
        
        target_user = None
        for row in integrations:
            meta = row.metadata_json or {}
            # team_id is stored directly in metadata during OAuth callback (from auth.test response)
            stored_team_id = meta.get("team_id") or meta.get("team", {}).get("id") if isinstance(meta.get("team"), dict) else None
            if stored_team_id == team_id:
                target_user = db.query(User).filter(User.id == row.user_id).first()
                break
        
        if not target_user:
            logger.warning(f"Slack event for unknown team_id: {team_id}")
            return {"status": "unknown_team"}

        # 4. Dispatch to AgentExecutor
        if text:
            # Clean up text (remove bot mention if any)
            # Slack mentions look like <@U12345678>
            clean_text = re.sub(r'<@U[A-Z0-9]+>', '', text).strip()
            
            logger.info(f"Dispatching Slack command from {target_user.email} in {channel}")
            asyncio.create_task(
                SlackService._dispatch_command(
                    target_user.id, 
                    target_user.email, 
                    channel, 
                    clean_text, 
                    thread_ts
                )
            )

        return {"status": "dispatched"}

    @staticmethod
    async def _dispatch_command(user_id: int, user_email: str, channel: str, text: str, thread_ts: str) -> None:
        """Execute agent task and reply to Slack."""
        from mcp_servers.tools.slack_tools import tool_send_slack_message
        
        # Get a fresh DB session for the background task
        db = next(get_db())
        try:
            executor = AgentExecutor()
            
            # ACK immediately if it's a long task (optional, but Slack likes fast responses)
            # await tool_send_slack_message(user_email, db, channel, "_Thinking..._", thread_ts=thread_ts)

            # Heuristic routing to find the best agent
            agent = await executor.find_best_agent_for_task(text, user_email)
            if not agent:
                await tool_send_slack_message(
                    user_email, db, channel, 
                    "I couldn't find a suitable agent for this task. Try being more specific.",
                    thread_ts=thread_ts
                )
                return

            # Build conversation history (optional, Slack usually has its own, but we can pass it if we want)
            # For now, keep it simple.
            
            result = await executor._execute_agent_workflow(
                agent,
                text,
                user_email,
                context={
                    "source": "slack",
                    "channel": channel,
                    "thread_ts": thread_ts,
                    "reply_instruction": (
                        "You are responding via Slack. "
                        "Do NOT call the slack_send_message tool - your reply is posted automatically. "
                        "You MUST use all other tools normally: list_emails, get_email, list_events, "
                        "send_email, create_document, web_search, and every other tool. "
                        "Only slack_send_message is restricted. Return your answer as plain text."
                    )
                }
            )

            # Normalise output
            _r = result or {}
            output = (
                (_r.get("summary") or {}).get("message")
                or (_r.get("result", {}) or {}).get("summary", {}).get("message")
                or _r.get("output")
                or _r.get("message")
                or _r.get("error")
                or "Done."
            )
            
            if not isinstance(output, str):
                output = str(output)

            await tool_send_slack_message(
                user_email, db, channel, output.strip(), thread_ts=thread_ts
            )

        except Exception as e:
            logger.error(f"Slack background command dispatch failed for user {user_id}: {e}")
        finally:
            db.close()
