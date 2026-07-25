import json
import asyncio
import os
from typing import Dict, Any, List, Optional, Tuple
from loguru import logger
from litellm import acompletion
from tenacity import (
    retry,
    retry_if_exception_type,
    wait_exponential,
    stop_after_attempt,
)

from mcp_servers.core.mcp_tools import execute_tool, SENSITIVE_TOOLS
from services.context_audit import AUDIT_TRACKER
from services.resilience import LLM_BREAKER
import uuid


class EmptyLLMResponseError(Exception):
    """Raised when the LLM returns a response with no choices (e.g. safety filter block)."""


def _friendly_error(err: Exception) -> str:
    """
    Convert a raw LiteLLM / provider exception into a clear, human-readable message
    that tells the user exactly what went wrong and what they should do about it.
    """
    raw = str(err).lower()

    # ── Authentication / API key problems ────────────────────────────────────
    if any(k in raw for k in ("authenticationerror", "api key not valid", "api_key_invalid",
                               "invalid api key", "no api key", "missing api key",
                               "api key", "api_key")):
        return (
            "AI provider authentication failed - the API key is missing or incorrect. "
            "Go to Settings → AI Models, connect your provider key, or ask your admin "
            "to update the server's .env file."
        )

    # ── Quota / rate limits ───────────────────────────────────────────────────
    if any(k in raw for k in ("rate limit", "ratelimit", "quota", "too many requests",
                               "429", "resource_exhausted")):
        return (
            "The AI provider's rate limit was reached - too many requests in a short time. "
            "Wait 30–60 seconds and try again, or switch to a different AI provider in Settings."
        )

    # ── Insufficient credits / billing ───────────────────────────────────────
    if any(k in raw for k in ("insufficient_quota", "billing", "payment", "credit",
                               "you exceeded your current quota")):
        return (
            "Your AI provider account has run out of credits or needs a payment update. "
            "Check your billing at the provider's dashboard, or switch providers in Settings → AI Models."
        )

    # ── Model not found / deprecated ─────────────────────────────────────────
    if any(k in raw for k in ("model not found", "does not exist", "no such model",
                               "invalid model", "model_not_found", "decommissioned")):
        return (
            "The configured AI model doesn't exist or has been retired. "
            "Go to Settings → AI Models and choose a valid model name, or clear your preferred model "
            "so the system falls back to its default."
        )

    # ── Context / token length ────────────────────────────────────────────────
    if any(k in raw for k in ("context length", "context_length", "token", "maximum context",
                               "too long", "max_tokens", "input too long")):
        return (
            "Your message or attached document is too long for the AI model to process at once. "
            "Try breaking it into smaller chunks, or remove the attached document and re-phrase."
        )

    # ── Timeout ───────────────────────────────────────────────────────────────
    if any(k in raw for k in ("timeout", "timed out", "connection timed out", "read timeout")):
        return (
            "The AI provider took too long to respond (timeout). "
            "This is usually a temporary issue - please try again in a moment."
        )

    # ── Network / connectivity ────────────────────────────────────────────────
    if any(k in raw for k in ("connection", "network", "unreachable", "refused",
                               "failed to connect", "name or service not known")):
        return (
            "Could not reach the AI provider - check your internet connection. "
            "If you're using a local model (Ollama / LM Studio) make sure the server is running."
        )

    # ── Provider-side server errors ───────────────────────────────────────────
    if any(k in raw for k in ("500", "502", "503", "504", "server error",
                               "internal server error", "service unavailable", "bad gateway")):
        return (
            "The AI provider is experiencing server issues right now. "
            "This is on their end - wait a few minutes and try again."
        )

    # ── Content / safety filter ───────────────────────────────────────────────
    if any(k in raw for k in ("safety", "content filter", "content_filter",
                               "blocked", "policy violation", "harmful")):
        return (
            "The AI provider's content filter blocked this request. "
            "Rephrase your message to avoid restricted topics and try again."
        )

    # ── Permission / scope ────────────────────────────────────────────────────
    if any(k in raw for k in ("permission", "unauthorized", "forbidden", "not authorized",
                               "401", "403")):
        return (
            "Access denied by the AI provider. Your API key may lack the required permissions. "
            "Re-generate your key with the correct scopes and update it in Settings → AI Models."
        )

    # ── Generic fallback (include the raw message for debugging) ─────────────
    short = str(err)[:200]
    return (
        f"An unexpected error occurred while calling the AI model. "
        f"Details: {short} - if this keeps happening, check the server logs or contact support."
    )


class MCPClient:
    """Single-purpose agentic loop: call LLM → execute tools → repeat.

    Design invariants:
      - No business logic (agents, workflows, etc.)
      - No direct Google API calls
      - Tool errors are caught and fed back to LLM - loop never crashes
      - LLM errors are retried with exponential backoff (4 attempts)
    """

    MAX_ROUNDS: int = 10
    LLM_TIMEOUT: int = 60  # seconds per call
    _FALLBACK_MODEL: str = "openai/gpt-5.4-mini"

    # Human-readable status labels shown to the user at each agentic loop round
    _ROUND_LABELS = [
        "Thinking about your request...",
        "Reviewing the results, planning next step...",
        "Refining my approach...",
        "Processing tool results...",
        "Continuing - almost there...",
        "Running additional checks...",
        "Finalising your response...",
    ]

    # Human-readable tool names shown in the "Using tool: X" status updates
    _TOOL_DISPLAY = {
        "list_emails":          "Reading your inbox",
        "get_email":            "Opening an email",
        "send_email":           "Sending an email",
        "draft_email":          "Drafting an email",
        "search_emails":        "Searching your emails",
        "list_events":          "Checking your calendar",
        "create_event":         "Creating a calendar event",
        "update_event":         "Updating a calendar event",
        "delete_event":         "Removing a calendar event",
        "list_files":           "Browsing Google Drive",
        "get_file":             "Opening a Drive file",
        "create_document":      "Creating a Google Doc",
        "draft_document":       "Preparing a document draft",
        "get_document":         "Reading a Google Doc",
        "get_sheet_data":       "Reading a spreadsheet",
        "update_sheet":         "Updating a spreadsheet",
        "create_spreadsheet":   "Creating a spreadsheet",
        "draft_spreadsheet":    "Preparing a spreadsheet draft",
        "search_web":           "Searching the web",
        "fetch_webpage":        "Fetching a web page",
        "generate_image":       "Generating an image",
        "create_presentation":  "Building a presentation",
        "draft_presentation":   "Preparing a presentation draft",
        "update_draft":         "Updating your draft",
        "save_draft":           "Saving your draft",
        "send_slack_message":   "Sending a Slack message",
        "create_github_issue":  "Creating a GitHub issue",
        "create_jira_ticket":   "Creating a Jira ticket",
        "send_discord_message": "Sending a Discord message",
        "send_telegram_message":"Sending a Telegram message",
        "create_trello_card":   "Creating a Trello card",
        "read_uploaded_document": "Reading your document",
    }

    def _tool_label(self, fn_name: str) -> str:
        """Return a friendly display name for a tool, falling back to the raw name."""
        return self._TOOL_DISPLAY.get(fn_name, fn_name.replace("_", " ").title())

    @staticmethod
    def _inject_draft_markers(text: str, messages: List[Dict[str, Any]]) -> str:
        """Ensure every [DRAFT:...] marker produced by draft tools appears in the final text.

        Gemini (and other LLMs) frequently strip the raw marker from their final response,
        leaving only the human-readable sentence. This scans all tool results for draft
        markers and prepends any that are missing from the text.
        """
        _DRAFT_TOOLS = {"draft_document", "draft_spreadsheet", "draft_presentation", "update_draft"}
        markers_to_inject = []
        for msg in messages:
            if msg.get("role") != "tool" or msg.get("name") not in _DRAFT_TOOLS:
                continue
            raw = msg.get("content", "")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            marker = payload.get("marker")
            if marker and marker not in text:
                markers_to_inject.append(marker)

        if not markers_to_inject:
            return text
        # Prepend all missing markers (deduplicated, latest last) then the LLM's text
        seen = set()
        unique = [m for m in markers_to_inject if not (m in seen or seen.add(m))]
        return "\n\n".join(unique) + "\n\n" + text

    @staticmethod
    def _fallback_final_text_from_tools(messages: List[Dict[str, Any]]) -> str:
        """Build a user-facing fallback when the model ends with an empty final message.

        This is especially helpful for read-style commands like "read my last email",
        where the tool returned the data correctly but the model failed to summarize it.
        """
        for msg in reversed(messages):
            if msg.get("role") != "tool":
                continue

            tool_name = msg.get("name")
            raw_content = msg.get("content", "")
            try:
                payload = json.loads(raw_content) if isinstance(raw_content, str) else raw_content
            except Exception:
                payload = raw_content

            if tool_name == "get_email" and isinstance(payload, dict):
                subject = payload.get("subject", "No Subject")
                sender = payload.get("from", "Unknown")
                body = (payload.get("body") or "").strip()
                body = body[:4000] if body else "No body text found."
                return (
                    f"## Latest Email\n"
                    f"**From:** {sender}\n"
                    f"**Subject:** {subject}\n\n"
                    f"{body}"
                )

            if tool_name == "list_emails" and isinstance(payload, dict):
                emails = payload.get("emails") or []
                if emails:
                    top = emails[0]
                    subject = top.get("subject", "No Subject")
                    sender = top.get("from", "Unknown")
                    snippet = (top.get("snippet") or "").strip() or "No preview available."
                    return (
                        f"## Latest Email\n"
                        f"**From:** {sender}\n"
                        f"**Subject:** {subject}\n\n"
                        f"{snippet}"
                    )

        # Generic fallback: summarise what tools actually ran so the user isn't left with a blank response
        tool_names = [m.get("name") for m in messages if m.get("role") == "tool" and m.get("name")]
        if tool_names:
            done_tools = list(dict.fromkeys(tool_names))  # deduplicate, preserve order
            readable = ", ".join(t.replace("_", " ") for t in done_tools)
            return f" Done — completed: {readable}."
        return " Task completed."

    def _load_llm_controls(self, user_email: str, db: Any) -> dict:
        """Load temperature/max_tokens/top_p from user_preferences.llm_controls."""
        _TEMP_MAP  = [0.0, 0.25, 0.5, 0.75, 1.0]
        _TOKEN_MAP = [512, 1024, 2048, 4096, 8192]
        _TOP_P_MAP = [0.7, 0.8, 0.9, 0.95, 1.0]
        defaults = {"temperature": 0.4, "max_tokens": 8192, "top_p": None, "is_local": False}
        if not user_email or not db:
            return defaults
        try:
            from auth.models import User as _User
            from utils.llm_router import _is_local_provider
            user = db.query(_User).filter(_User.email == user_email).first()
            if not user or not user.user_preferences:
                # Still check if they're on a local provider even without preferences
                is_local = _is_local_provider(user.llm_provider or "") if user else False
                return {**defaults, "is_local": is_local}
            c = user.user_preferences.get("llm_controls", {})
            creativity = int(c.get("creativity", 2))
            length     = int(c.get("length", 3))
            focus      = int(c.get("focus", 3))
            is_local = _is_local_provider(user.llm_provider or "")
            # Cap max_tokens for local models - small models return empty responses at high limits
            raw_max_tokens = _TOKEN_MAP[max(0, min(4, length - 1))]
            effective_max_tokens = min(raw_max_tokens, 2048) if is_local else raw_max_tokens
            return {
                "temperature": _TEMP_MAP[max(0, min(4, creativity - 1))],
                "max_tokens":  effective_max_tokens,
                "top_p":       _TOP_P_MAP[max(0, min(4, focus - 1))],
                "is_local":    is_local,
            }
        except Exception:
            return defaults

    async def _call_router(
        self,
        messages: List[Dict],
        tools: List[Dict],
        user_id: int,
        db: Any,
        model_role: str = "drafter",
        max_tokens: int = 8192,
        user_email: str = "",
    ):
        """Call the multi-tenant LLM router which handles Vault keys and Local LLMs.

        Company users (organization-managed accounts):
          - Primary: Gemini (env key)
          - Fallback on auth error: OpenAI gpt-5.4-mini (env key)

        External / BYO users:
          - Uses their configured key only - no company key fallback.
          - Auth errors surface directly so they know to fix their key in Settings.
        """
        from utils.llm_router import agenerate, is_company_user

        ctrl = self._load_llm_controls(user_email, db)
        effective_max_tokens = ctrl["max_tokens"] if max_tokens == 8192 else max_tokens
        extra_kwargs = {}
        if ctrl.get("top_p") is not None:
            extra_kwargs["top_p"] = ctrl["top_p"]

        try:
            response = await agenerate(
                role=model_role,
                messages=messages,
                user_id=user_id,
                db=db,
                tools=tools,
                max_tokens=effective_max_tokens,
                temperature=ctrl["temperature"],
                **extra_kwargs,
            )
        except Exception as primary_err:
            err_lower = str(primary_err).lower()
            is_auth_err = any(k in err_lower for k in (
                "authenticationerror", "api key", "api_key", "invalid_argument",
                "permission", "unauthorized", "401", "403",
            ))
            
            # Also catch rate limits and quota errors for fallback
            is_rate_limit_err = any(k in err_lower for k in (
                "ratelimiterror", "429", "quota exceeded", "resource_exhausted",
                "too many requests", "rate limit",
            ))

            # Attempt fallback only for company users who are actively using company keys
            _wants_company_keys = False
            if is_company_user(user_email) and db:
                try:
                    from auth.models import User as _User
                    _u = db.query(_User).filter(_User.email == user_email).first()
                    # NULL = not yet set → default True for company users
                    _wants_company_keys = _u.use_company_keys if (_u and _u.use_company_keys is not None) else True
                except Exception:
                    _wants_company_keys = False
            should_fallback = (is_auth_err or is_rate_limit_err) and _wants_company_keys

            if should_fallback:
                # Check vault for OpenAI credentials before using env var
                fallback_key = None
                if db:
                    try:
                        from services.vault_service import vault
                        cred = vault.resolve_credential(user_email, "openai", db)
                        fallback_key = cred.get("api_key") if cred else None
                    except Exception:
                        fallback_key = None
                
                # Fallback to OpenAI env key if no vault key found
                if not fallback_key:
                    fallback_key = os.getenv("OPENAI_API_KEY")
                
                if fallback_key:
                    logger.warning(
                        f"Primary LLM failed ({type(primary_err).__name__}) - switching to fallback model "
                        f"({self._FALLBACK_MODEL}). Original error: {primary_err}"
                    )
                    try:
                        from utils.llm_router import _max_tokens_key, _sanitize_kwargs, clean_messages
                        _fb_kwargs = _sanitize_kwargs(self._FALLBACK_MODEL, {
                            "model": self._FALLBACK_MODEL,
                            "messages": clean_messages(messages),
                            "tools": tools or None,
                            _max_tokens_key(self._FALLBACK_MODEL): max_tokens,
                            "temperature": 0.4,
                            "api_key": fallback_key,
                        })
                        response = await acompletion(**_fb_kwargs)
                    except Exception as fallback_err:
                        friendly = _friendly_error(fallback_err)
                        logger.error(f"Fallback model also failed: {fallback_err}")
                        raise RuntimeError(friendly) from fallback_err
                else:
                    # No fallback available, surface error
                    friendly = _friendly_error(primary_err)
                    logger.error(f"LLM call failed: {primary_err}")
                    raise RuntimeError(friendly) from primary_err
            elif is_auth_err:
                # BYO user: surface a clear message - no silent company key fallback
                logger.error(f"BYO user LLM auth error: {primary_err}")
                err_str = str(primary_err).lower()
                if "no api key" in err_str or "api key not found" in err_str or "missing" in err_str:
                    msg = (
                        "⚠️ No AI API key is configured.\n\n"
                        "Go to **Settings → AI Provider** and add your API key to start using the assistant."
                    )
                else:
                    msg = (
                        "⚠️ Your AI API key is invalid or has expired.\n\n"
                        "Go to **Settings → AI Provider** to update it."
                    )
                raise RuntimeError(msg) from primary_err
            else:
                # Non-recoverable error for non-company users
                friendly = _friendly_error(primary_err)
                logger.error(f"LLM call failed: {primary_err}")
                raise RuntimeError(friendly) from primary_err

        if not getattr(response, "choices", None) or len(response.choices) == 0:
            raise EmptyLLMResponseError(
                "The AI model returned an empty response. Please try again."
            )

        return response

    async def _call_router_with_retry(
        self,
        messages: List[Dict],
        tools: List[Dict],
        user_id: int,
        db: Any,
        model_role: str = "drafter",
        max_tokens: int = 8192,
        user_email: str = "",
        _retries: int = 2,
    ):
        """Wraps _call_router with retries for transient empty responses from Gemini."""
        last_err: Exception | None = None
        for attempt in range(_retries + 1):
            try:
                return await self._call_router(
                    messages=messages,
                    tools=tools,
                    user_id=user_id,
                    db=db,
                    model_role=model_role,
                    max_tokens=max_tokens,
                    user_email=user_email,
                )
            except EmptyLLMResponseError as e:
                last_err = e
                if attempt < _retries:
                    wait = 1.5 * (attempt + 1)
                    logger.warning(
                        f"Empty LLM response (attempt {attempt + 1}/{_retries + 1}), "
                        f"retrying in {wait:.1f}s…"
                    )
                    await asyncio.sleep(wait)
        # Final safety net: for company-key users, fall back to the OpenAI env model
        # if Gemini keeps returning empty responses after all retries.
        from utils.llm_router import is_company_user
        if last_err and is_company_user(user_email) and db:
            try:
                from auth.models import User as _User
                _u = db.query(_User).filter(_User.email == user_email).first()
                _wants_company_keys = _u.use_company_keys if (_u and _u.use_company_keys is not None) else True
            except Exception:
                _wants_company_keys = False

            if _wants_company_keys:
                fallback_key = os.getenv("OPENAI_API_KEY")
                if fallback_key:
                    logger.warning(
                        f"Empty Gemini response after {_retries + 1} attempts - switching to fallback model "
                        f"({self._FALLBACK_MODEL}) for user={user_email}"
                    )
                    from utils.llm_router import _max_tokens_key, _sanitize_kwargs, clean_messages
                    _fb_kwargs = _sanitize_kwargs(self._FALLBACK_MODEL, {
                        "model": self._FALLBACK_MODEL,
                        "messages": clean_messages(messages),
                        "tools": tools or None,
                        _max_tokens_key(self._FALLBACK_MODEL): max_tokens,
                        "temperature": 0.4,
                        "api_key": fallback_key,
                    })
                    return await acompletion(**_fb_kwargs)

        raise last_err

    async def run(
        self,
        *,
        system_prompt: str,
        tools: List[Dict],
        messages: List[Dict],
        user_email: str,
        db_session,
        model: Optional[str] = None,
        max_tokens: int = 8192,
        security_token: Optional[str] = None,
    ) -> Tuple[str, List[str], str]:
        """Run the LLM ↔ tool loop using the multi-tenant router."""
        from auth.models import User
        #  FIX #4: Wrap synchronous db.query() in asyncio.to_thread()
        # to prevent blocking the event loop during database I/O
        def _get_user_id():
            user = db_session.query(User).filter(User.email == user_email).first()
            return user.id if user else 0
        
        user_id = await asyncio.to_thread(_get_user_id)

        tools_used: List[str] = []
        current_messages = [{"role": "system", "content": system_prompt}] + messages

        thread_id = str(uuid.uuid4())
        AUDIT_TRACKER.init_thread(thread_id)

        for round_num in range(self.MAX_ROUNDS):
            logger.info(
                f"Agentic Loop | round {round_num + 1}/{self.MAX_ROUNDS} | user={user_email}"
            )

            try:
                response = await LLM_BREAKER.call(
                    asyncio.wait_for,
                    self._call_router_with_retry(
                        messages=current_messages,
                        tools=tools,
                        user_id=user_id,
                        db=db_session,
                        model_role=model or "drafter",
                        max_tokens=max_tokens,
                        user_email=user_email,
                    ),
                    timeout=self.LLM_TIMEOUT,
                )
            except asyncio.TimeoutError:
                raise RuntimeError("The AI provider took too long to respond. Please try again.")
            except Exception:
                raise

            message = response.choices[0].message
            # Convert LiteLLM message object to dict to avoid Pydantic serialization warnings in future rounds
            current_messages.append(message.model_dump() if hasattr(message, "model_dump") else dict(message))

            if not message.tool_calls:
                final_text = (message.content or "").strip() or self._fallback_final_text_from_tools(current_messages)
                final_text = self._inject_draft_markers(final_text, current_messages)
                _usage = getattr(response, "usage", None)
                _tokens = getattr(_usage, "total_tokens", 0) if _usage else 0
                _model_used = getattr(response, "model", None) or model or "unknown"
                try:
                    from models import UsageLog
                    from services.cost_utils import estimate_cost_usd
                    _cost = estimate_cost_usd(_tokens, _model_used)
                    _task_hint = (messages[-1].get("content", "") if messages else "")[:200]
                    db_session.add(UsageLog(
                        user_email=user_email,
                        tokens_used=_tokens,
                        cost_usd=_cost,
                        model_used=_model_used,
                        task_summary=_task_hint,
                    ))
                    db_session.commit()
                except Exception as _log_err:
                    logger.warning(f"UsageLog write failed (non-fatal): {_log_err}")
                logger.info(
                    f"Agentic Loop complete | rounds={round_num + 1} | "
                    f"tools={tools_used} | user={user_email}"
                )
                return final_text, tools_used, thread_id

            for tc in message.tool_calls:
                fn_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                logger.info(
                    f"Tool call → {fn_name} | args={list(args.keys())} | user={user_email}"
                )

                if fn_name in SENSITIVE_TOOLS and security_token:
                    args["_security_signature"] = security_token

                try:
                    result = await asyncio.wait_for(
                        execute_tool(fn_name, args, user_email, db_session),
                        timeout=45.0,
                    )
                except asyncio.TimeoutError:
                    result = {"error": f"Tool '{fn_name}' timed out after 45 seconds."}

                if fn_name == "get_email" and "message_id" in args:
                    AUDIT_TRACKER.add_email_trace(thread_id, args.get("message_id"))
                elif fn_name == "read_uploaded_document" and "doc_id" in args:
                    AUDIT_TRACKER.add_doc_trace(thread_id, args.get("doc_id"))
                elif fn_name in ["get_sheet_data", "create_spreadsheet"] and "spreadsheet_id" in args:
                    AUDIT_TRACKER.add_sheet_trace(thread_id, args.get("spreadsheet_id"))

                if fn_name not in tools_used:
                    tools_used.append(fn_name)

                current_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": fn_name,
                        "content": (
                            json.dumps(result)
                            if isinstance(result, dict)
                            else str(result)
                        ),
                    }
                )

        logger.warning(
            f"Agentic Loop hit max rounds ({self.MAX_ROUNDS}) | user={user_email}"
        )
        return (
            "I reached the maximum number of steps for this task - partial results may be shown above. "
            "Try breaking your request into smaller steps.",
            tools_used,
            thread_id,
        )

    async def run_stream(
        self,
        *,
        system_prompt: str,
        tools: List[Dict],
        messages: List[Dict],
        user_email: str,
        db_session,
        model: Optional[str] = None,
        max_tokens: int = 8192,
        security_token: Optional[str] = None,
    ):
        """Streaming generator version of run() using the multi-tenant router."""
        from auth.models import User
        #  FIX #4: Wrap synchronous db.query() in asyncio.to_thread()
        # to prevent blocking the event loop
        def _get_user_id():
            user = db_session.query(User).filter(User.email == user_email).first()
            return user.id if user else 0
        
        user_id = await asyncio.to_thread(_get_user_id)

        tools_used: List[str] = []
        current_messages = [{"role": "system", "content": system_prompt}] + messages

        thread_id = str(uuid.uuid4())
        AUDIT_TRACKER.init_thread(thread_id)

        for round_num in range(self.MAX_ROUNDS):
            label = self._ROUND_LABELS[min(round_num, len(self._ROUND_LABELS) - 1)]
            yield {"type": "status", "message": label}

            try:
                response = await LLM_BREAKER.call(
                    asyncio.wait_for,
                    self._call_router_with_retry(
                        messages=current_messages,
                        tools=tools,
                        user_id=user_id,
                        db=db_session,
                        model_role=model or "drafter",
                        max_tokens=max_tokens,
                        user_email=user_email,
                    ),
                    timeout=self.LLM_TIMEOUT,
                )
            except asyncio.TimeoutError:
                yield {
                    "type": "error",
                    "message": "The AI provider took too long to respond. Please try again.",
                }
                return
            except Exception as e:
                # _call_router already produced a friendly message - surface it directly
                yield {
                    "type": "error",
                    "message": str(e),
                }
                return

            message = response.choices[0].message
            # Convert LiteLLM message object to dict to avoid Pydantic serialization warnings in future rounds
            current_messages.append(message.model_dump() if hasattr(message, "model_dump") else dict(message))

            if not message.tool_calls:
                final_text = (message.content or "").strip() or self._fallback_final_text_from_tools(current_messages)
                final_text = self._inject_draft_markers(final_text, current_messages)
                _usage = getattr(response, "usage", None)
                _tokens = getattr(_usage, "total_tokens", 0) if _usage else 0
                _model_used = getattr(response, "model", None) or model or "unknown"

                # Persist to DB so the Settings usage widget has real server-side data
                try:
                    from models import UsageLog
                    from services.cost_utils import estimate_cost_usd
                    _cost = estimate_cost_usd(_tokens, _model_used)
                    _task_hint = (messages[-1].get("content", "") if messages else "")[:200]
                    _log_entry = UsageLog(
                        user_email=user_email,
                        tokens_used=_tokens,
                        cost_usd=_cost,
                        model_used=_model_used,
                        task_summary=_task_hint,
                    )
                    db_session.add(_log_entry)
                    db_session.commit()
                except Exception as _log_err:
                    logger.warning(f"UsageLog write failed (non-fatal): {_log_err}")

                yield {
                    "type": "result",
                    "text": final_text,
                    "tools_used": tools_used,
                    "token_count": _tokens,
                    "model_used": _model_used,
                    "context_trace_id": thread_id,
                }
                return

            for tc in message.tool_calls:
                fn_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                display_label = self._tool_label(fn_name)
                yield {"type": "tool_call", "tool": fn_name, "display": display_label, "args": args}

                if fn_name in SENSITIVE_TOOLS and security_token:
                    args["_security_signature"] = security_token

                try:
                    result = await asyncio.wait_for(
                        execute_tool(fn_name, args, user_email, db_session),
                        timeout=45.0,  # Prevent a single tool call from hanging the server
                    )
                except asyncio.TimeoutError:
                    result = {"error": f"Tool '{fn_name}' timed out after 45 seconds. Please try again."}

                if fn_name == "get_email" and "message_id" in args:
                    AUDIT_TRACKER.add_email_trace(thread_id, args.get("message_id"))
                elif fn_name == "read_uploaded_document" and "doc_id" in args:
                    AUDIT_TRACKER.add_doc_trace(thread_id, args.get("doc_id"))
                elif fn_name in ["get_sheet_data", "create_spreadsheet"] and "spreadsheet_id" in args:
                    AUDIT_TRACKER.add_sheet_trace(thread_id, args.get("spreadsheet_id"))

                # ── Workflow created: emit special event so the UI renders
                # an inline approval flow instead of navigating to the dashboard. ──
                if isinstance(result, dict) and result.get("workflow_id"):
                    yield {
                        "type": "workflow_created",
                        "workflow_id": result["workflow_id"],
                        "message": result.get("message", ""),
                    }

                if fn_name not in tools_used:
                    tools_used.append(fn_name)

                current_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": fn_name,
                        "content": (
                            json.dumps(result)
                            if isinstance(result, dict)
                            else str(result)
                        ),
                    }
                )

        yield {
            "type": "result",
            "text": (
                "I reached the maximum number of steps for this task - partial results may be shown above. "
                "Try breaking your request into smaller steps."
            ),
            "tools_used": tools_used,
            "context_trace_id": thread_id,
        }
