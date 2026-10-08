"""
Webhook receivers for Google Push Notifications (Gmail + Calendar).

Google Pub/Sub delivers a POST within ~1s of an inbox event - no polling needed.
On receipt we:
  1. Decode the Pub/Sub envelope
  2. Resolve the user by email
  3. Find agents with an "email_received" / "calendar_event" trigger
  4. Compile + execute their DAG via WorkflowAutomationService (background task)
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy.orm import Session

from auth.database import get_db
from auth.models import User  # used by Gmail/Calendar webhook handlers below
from services.telegram_service import TelegramService
from services.slack_service import SlackService
from services.workflow_automation_service import WorkflowAutomationService

router = APIRouter()


def _verify_slack_signature(request_body: bytes, timestamp: str, signature: str) -> bool:
    """Verify that the request came from Slack using HMAC-SHA256.
    See: https://api.slack.com/authentication/verifying-requests-from-slack
    """
    signing_secret = os.getenv("SLACK_SIGNING_SECRET", "")
    if not signing_secret:
        logger.error("SLACK_SIGNING_SECRET is not configured — rejecting webhook")
        return False

    # Reject requests older than 5 minutes (replay protection)
    try:
        if abs(time.time() - float(timestamp)) > 300:
            logger.warning("Slack webhook: timestamp too old (possible replay attack)")
            return False
    except (ValueError, TypeError):
        return False

    base_string = f"v0:{timestamp}:{request_body.decode('utf-8', errors='replace')}"
    computed = "v0=" + hmac.new(  # noqa — hmac.new is the correct stdlib function
        signing_secret.encode(), base_string.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(computed, signature)


def _verify_telegram_secret(header_token: str, stored_secret: str) -> bool:
    """Verify X-Telegram-Bot-Api-Secret-Token header value."""
    if not stored_secret:
        return False
    return hmac.compare_digest(header_token or "", stored_secret)


# ── Google domain validation ──────────────────────────────────────────────────

@router.get("/google-push-validate")
async def validate_google_push():
    """Endpoint for Google domain verification if required."""
    return {"status": "success", "message": "Domain validated for Google Push Notifications."}


# ── Gmail Push Notification ───────────────────────────────────────────────────

@router.post("/gmail-push")
async def handle_gmail_push(request: Request, db: Session = Depends(get_db)):
    """
    Webhook receiver for Gmail Push Notifications (Google Cloud Pub/Sub).
    Triggered instantly when a new email arrives in a user's inbox.

    Flow:
      1. Decode Pub/Sub envelope → extract emailAddress + historyId
      2. Look up user by email in DB
      3. Fetch their active workflow agents
      4. Fire DAG for each agent that declares an "email_received" trigger
    """
    try:
        payload = await request.json()

        if "message" not in payload or "data" not in payload.get("message", {}):
            logger.warning("Gmail push: malformed Pub/Sub envelope - missing message.data")
            return {"status": "ignored"}

        data_b64 = payload["message"]["data"]
        data_json = base64.b64decode(data_b64).decode("utf-8")
        data = json.loads(data_json)

        email_address = data.get("emailAddress")
        history_id = data.get("historyId")

        if not email_address:
            logger.warning("Gmail push: no emailAddress in payload - ignoring")
            return {"status": "ignored"}

        logger.info(f"GMAIL WEBHOOK: activity for {email_address} (historyId={history_id})")

        # ── Resolve user ──────────────────────────────────────────────────────
        user = db.query(User).filter(User.email == email_address).first()
        if not user:
            logger.debug(f"Gmail push: no registered user for {email_address}")
            return {"status": "ignored"}

        if not user.is_monitoring:
            logger.debug(f"Gmail push: monitoring disabled for {email_address} - ignoring")
            return {"status": "ignored"}

        # ── Trigger DAG for each matching agent ───────────────────────────────
        workflow_service = WorkflowAutomationService(db)
        agents = workflow_service.get_user_agents(user.id)

        if not agents:
            return {"status": "no_agents"}

        triggered = 0
        for agent in agents:
            config = agent.agent_config or {}
            # Only fire agents that declare an "email_received" trigger in their config
            if "email_received" not in config.get("triggers", []):
                continue

            task_desc = (
                f"New Gmail activity (historyId={history_id}). "
                "Check inbox and execute your configured workflow."
            )
            try:
                from models import TaskCreate  # noqa: PLC0415
                task = await workflow_service.create_task(
                    user_id=user.id,
                    task_data=TaskCreate(
                        agent_id=agent.id,
                        title=f"Gmail trigger - historyId {history_id}",
                        description=task_desc,
                        priority="high",
                    ),
                )
                # Run DAG in the background - respond to Google immediately
                asyncio.create_task(workflow_service.execute_task(task.id))
                triggered += 1
                logger.info(f"DAG triggered for agent '{agent.name}' (task {task.id})")
            except Exception as exc:
                logger.error(f"Failed to trigger DAG for agent {agent.id}: {exc}")

        logger.info(f"Gmail webhook: {triggered} DAG(s) triggered for {email_address}")

        # ── Auto-reply: draft + store if feature is enabled ───────────────────
        # NOTE: pass only the email string - _handle_auto_reply opens its own
        # DB session because this runs after the request session is closed.
        if getattr(user, "auto_reply_enabled", False):
            asyncio.create_task(
                _handle_auto_reply(email_address, history_id)
            )

        return {"status": "success", "triggered": triggered}

    except Exception as e:
        logger.error(f"Error processing Gmail webhook: {e}")
        # Always return 200 - Google retries on non-2xx, flooding the endpoint
        return {"status": "error", "message": str(e)}


# ── Calendar Push Notification ────────────────────────────────────────────────

@router.post("/calendar-push")
async def handle_calendar_push(request: Request, db: Session = Depends(get_db)):
    """
    Webhook receiver for Google Calendar Push Notifications.
    Triggered when an event is created, updated, or deleted.

    Google sends headers (not body) for calendar events:
      X-Goog-Channel-ID, X-Goog-Resource-State, X-Goog-Resource-ID
    """
    try:
        channel_id      = request.headers.get("X-Goog-Channel-ID", "")
        resource_state  = request.headers.get("X-Goog-Resource-State", "")
        resource_id     = request.headers.get("X-Goog-Resource-ID", "")

        if not channel_id:
            logger.warning("Calendar push: missing X-Goog-Channel-ID header")
            return {"status": "ignored"}

        # "sync" is the initial verification ping - acknowledge and return
        if resource_state == "sync":
            logger.debug(f"Calendar push: sync ping for channel {channel_id}")
            return {"status": "sync_ack"}

        logger.info(
            f"CALENDAR WEBHOOK: channel={channel_id} state={resource_state} "
            f"resource={resource_id}"
        )

        # channel_id encodes the user email as "gmail_push_{user_email}_{uuid}"
        # Extract email for user lookup (convention set when registering the watch)
        user_email = _extract_email_from_channel(channel_id)
        if not user_email:
            logger.debug("Calendar push: could not extract user email from channel_id")
            return {"status": "ignored"}

        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            return {"status": "ignored"}

        workflow_service = WorkflowAutomationService(db)
        agents = workflow_service.get_user_agents(user.id)

        triggered = 0
        for agent in agents:
            config = agent.agent_config or {}
            if "calendar_event" not in config.get("triggers", []):
                continue

            try:
                from models import TaskCreate  # noqa: PLC0415
                task = await workflow_service.create_task(
                    user_id=user.id,
                    task_data=TaskCreate(
                        agent_id=agent.id,
                        title=f"Calendar trigger - {resource_state}",
                        description=(
                            f"Calendar event changed (state={resource_state}). "
                            "Execute your configured calendar workflow."
                        ),
                        priority="normal",
                    ),
                )
                asyncio.create_task(workflow_service.execute_task(task.id))
                triggered += 1
            except Exception as exc:
                logger.error(f"Calendar DAG trigger failed for agent {agent.id}: {exc}")

        return {"status": "success", "triggered": triggered}

    except Exception as e:
        logger.error(f"Error processing Calendar webhook: {e}")
        return {"status": "error", "message": str(e)}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _handle_auto_reply(user_email: str, history_id: str):
    """Draft an auto-reply for the most recent inbox email and store it as PendingAutoReply.

    Opens its own DB session - runs as asyncio.create_task after the request
    lifecycle ends, so the caller's session is already closed.
    """
    from auth.database import SessionLocal
    from mcp_servers.core.mcp_tools import execute_tool
    from services.auto_reply_service import generate_auto_reply_draft, create_pending_auto_reply

    db = SessionLocal()
    try:
        # Fetch the latest inbox message to get sender + subject + snippet
        result = await execute_tool(
            "list_emails",
            {"user_email": user_email, "max_results": 1, "label": "INBOX"},
            user_email,
            db,
        )
        emails = result.get("emails", [])
        if not emails:
            return

        latest = emails[0]
        sender = latest.get("from", "")
        subject = latest.get("subject", "(no subject)")
        snippet = latest.get("snippet", "")
        thread_id = latest.get("threadId") or latest.get("thread_id")

        # Don't auto-reply to our own sent mail or empty senders
        if not sender or user_email.lower() in sender.lower():
            return

        draft = await generate_auto_reply_draft(subject, sender, snippet)
        row = create_pending_auto_reply(
            user_email=user_email,
            thread_id=thread_id,
            sender_email=sender,
            subject=subject,
            draft_body=draft,
            db=db,
        )

        # Signal the SSE stream to broadcast an auto_reply_pending event
        _AUTO_REPLY_PENDING[user_email] = {
            "id": row.id,
            "sender": sender,
            "subject": subject,
            "draft": draft,
            "deadline": row.send_deadline.isoformat(),
        }
        logger.info(f"Auto-reply pending: id={row.id} for {user_email}")

    except Exception as exc:
        logger.error(f"_handle_auto_reply error for {user_email}: {exc}")
    finally:
        db.close()


# In-memory channel: webhook writes here → SSE endpoint drains it per user.
# { user_email: { id, sender, subject, draft, deadline } }
_AUTO_REPLY_PENDING: dict = {}


def _extract_email_from_channel(channel_id: str) -> str:
    """
    Extracts user email from a channel ID created by convention:
      "calendar_push_{user_email}_{uuid}"
    Returns empty string if the format doesn't match.
    """
    parts = channel_id.split("_", 2)
    # Expect ["calendar", "push", "{email}_{uuid}"] or similar
    if len(parts) >= 3:
        # Last segment is "{email}_{uuid}" - split on last underscore
        remainder = parts[2]
        idx = remainder.rfind("_")
        if idx != -1 and "@" in remainder[:idx]:
            return remainder[:idx]
    return ""


# ── Telegram Push Notification ────────────────────────────────────────────────

@router.post("/telegram/{secret_id}")
async def telegram_webhook(
    secret_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Entry point for all Telegram bot updates. Routed by per-user secret UUID.

    NOTE: We intentionally do NOT inject a db session here.
    Starlette background tasks run after the response is sent, at which point
    the request-scoped session from get_db() is already closed.  Passing that
    dead session to handle_webhook causes DetachedInstanceError / silent commit
    failures.  handle_webhook opens its own fresh session internally instead.
    """
    try:
        # Verify Telegram secret token header to prevent webhook injection
        header_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        body = await request.body()
        payload = json.loads(body)
        logger.info(f"Received Telegram webhook for secret {secret_id}")
        background_tasks.add_task(
            TelegramService.handle_webhook, secret_id, payload, header_token
        )
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error processing Telegram webhook: {e}")
        return {"status": "error", "message": str(e)}


# ── Slack Event Webhook ───────────────────────────────────────────────────────

@router.post("/slack/events")
async def slack_events_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Unified entry point for Slack Event subscriptions.
    Handles verification (challenge) and dispatches events to SlackService.
    Verifies HMAC-SHA256 signature before processing — prevents spoofed events.
    """
    # Read raw body first (needed for signature verification)
    body = await request.body()

    # URL verification challenge skips signature check (sent before signing is configured)
    try:
        payload = json.loads(body)
    except Exception:
        return JSONResponse({"status": "bad_request"}, status_code=400)

    if payload.get("type") != "url_verification":
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")
        if not _verify_slack_signature(body, timestamp, signature):
            logger.warning("Slack webhook: signature verification failed — rejecting")
            return JSONResponse({"status": "unauthorized"}, status_code=401)

    try:
        result = await SlackService.handle_webhook(db, payload)
        if "challenge" in result:
            return result
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error processing Slack webhook: {e}")
        # Always return 200 for Slack to avoid retries
        return {"status": "error", "message": str(e)}
