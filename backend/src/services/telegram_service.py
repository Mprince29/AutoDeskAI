import os
import uuid
import asyncio
import httpx
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from loguru import logger
from auth.models import User
from models import APIKey, TelegramMessage
from utils.token_encryption import token_encryption

# Max reply length Telegram allows in a single message
_TELEGRAM_MAX_LEN = 4000

# ── Persistent HTTP client (connection pool, avoids per-call TCP handshake) ───
# Re-used across all Telegram API calls.  Timeouts: 5 s connect, 15 s read.
_TELEGRAM_TIMEOUT = httpx.Timeout(timeout=15.0, connect=5.0)
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    """Return (or create) the module-level persistent httpx client."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=_TELEGRAM_TIMEOUT)
    return _http_client

def escape_markdown_v2(text: str) -> str:
    """Escapes strings for Telegram's MarkdownV2.
    See: https://core.telegram.org/bots/api#markdownv2-style
    """
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return "".join(f"\\{c}" if c in escape_chars else c for c in text)

class TelegramService:
    _API_BASE = "https://api.telegram.org/bot"

    @staticmethod
    async def get_token_for_user(db: Session, user_id: int) -> Optional[str]:
        """Fetch and decrypt the Telegram bot token for a specific user.

        Reads from the vault (UserIntegration table) which is where Settings
        saves the token via vault.store_api_key. Falls back to the legacy
        APIKey table for tokens stored before the vault system was introduced.
        """
        from services.vault_service import vault

        # Primary: vault (new system - used by Settings UI)
        cred = vault.get(user_id, "telegram", db)
        if cred:
            token = cred.get("bot_token") or cred.get("token") or cred.get("access_token")
            if token:
                return token

        # Fallback: legacy APIKey table (pre-vault connections)
        api_key_row = db.query(APIKey).filter(
            APIKey.user_id == user_id,
            APIKey.service_name == "telegram",
            APIKey.is_active == True,
        ).first()
        if not api_key_row:
            return None
        try:
            return token_encryption.decrypt_token(api_key_row.api_key)
        except Exception as e:
            logger.error(f"Failed to decrypt legacy Telegram token for user {user_id}: {e}")
            return None

    @staticmethod
    async def register_webhook(db: Session, user: User, bot_token: str) -> bool:
        """Register the unique webhook URL for the user's bot with a secret_token for verification."""
        if not user.telegram_secret:
            user.telegram_secret = str(uuid.uuid4())
            db.commit()

        base_url = os.getenv("BACKEND_URL", os.getenv("API_BASE_URL", ""))

        if not base_url or "localhost" in base_url or "127.0.0.1" in base_url:
            logger.warning(
                f"Telegram webhook skipped for user {user.id}: "
                f"BACKEND_URL='{base_url}' is not a public HTTPS URL. "
                "Set BACKEND_URL to your deployed server URL to enable webhooks."
            )
            return True  # don't block token save on localhost

        webhook_url = f"{base_url}/api/webhooks/telegram/{user.telegram_secret}"

        # secret_token: sent in X-Telegram-Bot-Api-Secret-Token header on every update.
        # We derive it from user.telegram_secret so no extra storage is needed.
        webhook_secret = user.telegram_secret.replace("-", "")[:64]

        url = f"{TelegramService._API_BASE}{bot_token}/setWebhook"
        try:
            client = _get_http_client()
            resp = await client.post(url, json={
                "url": webhook_url,
                "secret_token": webhook_secret,
                "allowed_updates": ["message", "callback_query", "edited_message"],
            })
            data = resp.json()
            if data.get("ok"):
                logger.info(f"Telegram webhook registered for user {user.id} with secret verification")
                return True
            else:
                logger.error(f"Telegram setWebhook failed for user {user.id}: {data}")
                return False
        except Exception as e:
            logger.error(f"Error registering Telegram webhook for user {user.id}: {e}")
            return False

    @staticmethod
    async def send_message(
        db: Session,
        user_id: int,
        text: str,
        chat_id: Optional[str] = None,
        reply_markup: Optional[Dict[str, Any]] = None,
        disable_notification: bool = False,
        plain_text: bool = False,
    ) -> bool:
        """Send a message via the user's bot and log it to the database.

        Pass plain_text=True to skip MarkdownV2 escaping (e.g. for plain ack messages).
        """
        token = await TelegramService.get_token_for_user(db, user_id)
        if not token:
            logger.error(f"No Telegram token found for user {user_id}")
            return False

        target_chat_id = chat_id
        if not target_chat_id:
            user = db.query(User).filter(User.id == user_id).first()
            target_chat_id = user.telegram_chat_id if user else None

        if not target_chat_id:
            logger.error(f"No chat_id for Telegram message to user {user_id}")
            return False

        url = f"{TelegramService._API_BASE}{token}/sendMessage"

        def _make_payload(use_markdown: bool, msg_text: str) -> dict:
            p: dict = {
                "chat_id": target_chat_id,
                "text": msg_text,
                "disable_notification": disable_notification,
            }
            if use_markdown:
                p["parse_mode"] = "MarkdownV2"
            if reply_markup:
                p["reply_markup"] = reply_markup
            return p

        # Build the escaped version for MarkdownV2 and keep original for fallback
        escaped_text = escape_markdown_v2(text) if not plain_text else text
        use_md = not plain_text

        try:
            client = _get_http_client()
            resp = await client.post(url, json=_make_payload(use_md, escaped_text))
            data = resp.json()

            if data.get("ok"):
                db.add(TelegramMessage(
                    user_id=user_id, chat_id=str(target_chat_id),
                    message_id=str(data["result"]["message_id"]),
                    text=text, direction="outbound",
                ))
                db.commit()
                return True

            # MarkdownV2 parse failure → retry with original unescaped plain text
            if "can't parse entities" in str(data) or "parse" in str(data.get("description", "")):
                logger.warning(f"Telegram MarkdownV2 parse failed for user {user_id}, retrying as plain text")
                fallback_resp = await client.post(url, json=_make_payload(False, text))
                fallback_data = fallback_resp.json()
                if fallback_data.get("ok"):
                    db.add(TelegramMessage(
                        user_id=user_id, chat_id=str(target_chat_id),
                        message_id=str(fallback_data["result"]["message_id"]),
                        text=text, direction="outbound",
                    ))
                    db.commit()
                    return True
                logger.error(f"Telegram plain-text fallback also failed: {fallback_data}")

            logger.error(f"Telegram sendMessage failed for user {user_id}: {data}")
            return False

        except httpx.TimeoutException:
            logger.error(f"Telegram sendMessage timed out for user {user_id}")
            return False
        except Exception as e:
            logger.error(f"Error sending Telegram message for user {user_id}: {e}")
            return False

    @staticmethod
    async def handle_webhook(secret_id: str, payload: Dict[str, Any], header_token: str = "") -> None:
        """Process an incoming update from Telegram.

        header_token: value of X-Telegram-Bot-Api-Secret-Token header — verified against stored secret.
        Opens its own DB session (background task runs after request session is closed).
        """
        from auth.database import get_db as _get_db
        db: Session = next(_get_db())
        try:
            # 1. Identify user by secret_id
            user = db.query(User).filter(User.telegram_secret == secret_id).first()
            if not user:
                logger.warning(f"Received Telegram webhook with unknown secret: {secret_id}")
                return

            # 2. Verify secret_token header (set during setWebhook registration)
            import hmac as _hmac
            expected_secret = (user.telegram_secret or "").replace("-", "")[:64]
            if expected_secret and not _hmac.compare_digest(header_token or "", expected_secret):
                logger.warning(f"Telegram webhook secret mismatch for user {user.id} — rejecting")
                return

            # 3. Extract message details
            message = payload.get("message")
            if not message:
                return

            chat_id = str(message["chat"]["id"])
            text = message.get("text", "")
            message_id = str(message["message_id"])

            # 3. Detect Media
            media_context = ""
            if "photo" in message:
                media_context = "[User sent a photo]"
            elif "document" in message:
                doc_name = message["document"].get("file_name", "a file")
                media_context = f"[User sent a document: {doc_name}]"
            elif "voice" in message:
                media_context = "[User sent a voice message]"
            elif "video" in message:
                media_context = "[User sent a video]"

            if media_context and not text:
                text = media_context
            elif media_context:
                text = f"{text}\n\n{media_context}"

            # 4. Update user's chat_id if not set (automatic discovery)
            if not user.telegram_chat_id:
                user.telegram_chat_id = chat_id
                db.commit()

            # 5. Log the inbound message
            log = TelegramMessage(
                user_id=user.id,
                chat_id=chat_id,
                message_id=message_id,
                text=text,
                direction="inbound",
            )
            db.add(log)
            db.commit()

            logger.info(f"Logged inbound Telegram message from user {user.id} (media={bool(media_context)})")

            # 6. Dispatch to agent - pass only plain scalars, _dispatch_command
            #    opens its own session for the full agent pipeline run.
            if text and text.strip() != "/start":
                asyncio.create_task(
                    TelegramService._dispatch_command(user.id, user.email, chat_id, text.strip())
                )
        finally:
            db.close()

    @staticmethod
    async def _dispatch_command(user_id: int, user_email: str, chat_id: str, text: str) -> None:
        """Run the agent pipeline for an inbound Telegram command and reply.

        Receives plain values only (no db session) - opens its own fresh session
        so it is never affected by the request-scoped session closing.

        Users never need to know agent names - auto-routes by keywords:
        email/reply → Email Manager, meeting/schedule → Calendar, etc.
        Supported optional prefixes: /do, /ask, /run - or plain natural language.
        """
        from services.agent_executor import AgentExecutor
        from auth.database import get_db

        # Strip optional /do /ask /run prefix - natural language also works
        command = text
        for prefix in ("/do ", "/ask ", "/run "):
            if text.lower().startswith(prefix):
                command = text[len(prefix):]
                break

        # Open a fresh db session that lives for the lifetime of this task only
        db = next(get_db())
        try:
            # Immediately ack so the user knows it was received
            await TelegramService.send_message(
                db, user_id, "Processing your request...", chat_id, plain_text=True
            )

            executor = AgentExecutor()

            # Auto-route: keyword heuristic picks the right agent - no agent name needed
            agent = await executor.find_best_agent_for_task(command, user_email)

            if not agent:
                await TelegramService.send_message(
                    db, user_id,
                    "I couldn't find a suitable agent. Try being more specific, e.g. 'send email to...', 'schedule a meeting...', 'search GitHub for...'",
                    chat_id,
                )
                return

            # Build conversation history so short replies like "Yes" / "Yes send" make sense
            from models import TelegramMessage as TelegramMsg
            recent = (
                db.query(TelegramMsg)
                .filter(TelegramMsg.user_id == user_id, TelegramMsg.chat_id == chat_id)
                .order_by(TelegramMsg.created_at.desc())
                .limit(10)
                .all()
            )
            recent.reverse()
            history_lines = []
            _ack_texts = {"Processing your request...", escape_markdown_v2("Processing your request...")}
            for msg in recent:
                if msg.text and msg.text not in _ack_texts:
                    role = "User" if msg.direction == "inbound" else "Bot"
                    history_lines.append(f"{role}: {msg.text}")
            history_text = "\n".join(history_lines) if history_lines else ""

            result = await executor._execute_agent_workflow(
                agent,
                command,
                user_email,
                context={
                    "source": "telegram",
                    "chat_id": chat_id,
                    # Critical: agent must NOT call telegram_send_message to reply.
                    # _dispatch_command sends the reply automatically after this returns.
                    # Calling the tool would hit the HMAC security block and loop forever.
                    "reply_instruction": (
                        "IMPORTANT: You are responding to a Telegram message. "
                        "Do NOT call the telegram_send_message tool - your reply is delivered automatically. "
                        "You MUST use all other tools normally: list_emails, get_email, list_events, "
                        "send_email, create_document, web_search, and every other tool. "
                        "Only telegram_send_message is restricted. Return your answer as plain text."
                    ),
                    "conversation_history": history_text,
                },
            )

            # _execute_agent_workflow returns:
            # {"summary": {"message": <text>, "tools_used": [...]}, "result": {...}, ...}
            _r = result or {}
            output = (
                (_r.get("summary") or {}).get("message")
                or (_r.get("result", {}) or {}).get("summary", {}).get("message")
                or _r.get("output")
                or _r.get("message")
                or _r.get("error")
            )
            # Always ensure we have a plain string before slicing
            if not isinstance(output, str):
                output = str(output) if output else "Done."
            output = output.strip() or "Done."

            # Telegram enforces 4096-char limit per message - chunk if needed
            for chunk_start in range(0, len(output), _TELEGRAM_MAX_LEN):
                chunk = output[chunk_start:chunk_start + _TELEGRAM_MAX_LEN]
                await TelegramService.send_message(
                    db, user_id,
                    chunk,
                    chat_id,
                )

        except Exception as e:
            logger.error(f"Telegram command dispatch failed for user {user_id}: {e}")
            try:
                await TelegramService.send_message(
                    db, user_id,
                    f"Something went wrong: {str(e)[:300]}",
                    chat_id,
                )
            except Exception:
                pass  # if even send_message fails, just log and move on
        finally:
            db.close()
