from fastapi import APIRouter, HTTPException, Depends, Query, Request
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from sqlalchemy.orm import Session
import asyncio
import json
import os
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from services.agent_executor import agent_executor
from services.agent_registry import agent_registry, AgentType
from services.security import GLOBAL_SIGNER
from auth.routes import get_current_user
from auth.database import get_db
from auth.models import User, ContentDraft
from utils.activity_logger import record_activity
from loguru import logger

router = APIRouter()

_CALENDAR_QUERY_RE = re.compile(
    r'\b(schedule|meeting|event|calendar|when|today|tomorrow|this week|next week|'
    r'upcoming|upcoming meeting|my calendar|my schedule|when do i|when am i|'
    r'agenda|available|free time|busy|google meet|join|zoom|teams meeting|'
    r'am i free|do i have|what meeting|what time|what events|monday|tuesday|'
    r'wednesday|thursday|friday|saturday|sunday)\b',
    re.IGNORECASE
)

_MONTH_DAY_PATTERNS = (
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%m/%d/%Y",
    "%m/%d/%y",
    "%B %d %Y",
    "%b %d %Y",
    "%B %d",
    "%b %d",
    "%d %B %Y",
    "%d %b %Y",
    "%d %B",
    "%d %b",
)
_WEEKDAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_DRAFT_MARKER_RE = re.compile(r"\[DRAFT:([^:\]]+):([^:\]]+):([^\]]+)\]")
_SAVE_DRAFT_RE = re.compile(
    r"\b(save it|save this|save to docs|save to drive|upload it|go ahead and save|"
    r"looks good|this looks good|approved|approve it|finalize it|finalise it|"
    r"yes save it|yes, save it|okay save it|ok save it)\b",
    re.IGNORECASE,
)
_LAST_EMAIL_RE = re.compile(r"\b(last|latest|most recent)\b.*\bemail\b|\b(read|get|show)\b.*\b(last|latest)\b.*\bemail\b", re.IGNORECASE)

# ── Q&A vs Task detection ─────────────────────────────────────────────────────

_QA_RE = re.compile(
    r'^(what[\s\'\"]|how[\s\'\"]|why[\s\'\"]|who[\s\'\"]|when[\s\'\"]|where[\s\'\"]|'
    r'explain |tell me |describe |define |can you |give me |is there |are there |'
    r'what\'s |whats |could you |summarize |compare |difference between|pros and cons|'
    r'advantages|disadvantages|what is |what are |what does |what do |'
    r'how does |how do |how can |is it |are they |do you |did you |should i |'
    r'help me understand|list the|list all|show me)',
    re.IGNORECASE
)

def _word_is_gibberish(word: str) -> bool:
    """Return True when a single word looks like random keyboard mashing.

    Two independent signals - either is enough:
      1. Vowel ratio < 20%  (real English words average ~38%)
      2. A run of 4+ consecutive consonants  (almost impossible in real words)
    """
    import re as _re
    w = _re.sub(r"[^a-z]", "", word.lower())
    if len(w) < 4:
        return False
    vowel_ratio = sum(1 for c in w if c in "aeiou") / len(w)
    if vowel_ratio < 0.20:
        return True
    # 4+ consecutive non-vowel letters → almost certainly not a real word
    max_consonant_run = max(
        (len(m.group()) for m in _re.finditer(r"[^aeiou]+", w)),
        default=0,
    )
    return max_consonant_run >= 4


def _is_gibberish(text: str) -> bool:
    """Return True when the entire input is clearly nonsensical/random characters.

    Rejects only when ALL non-trivial words (>3 chars) are detected as gibberish,
    so a phrase like 'send jkds email' is still accepted (real words anchor it).
    """
    words = text.strip().lower().split()
    if not words:
        return True
    # A single very short token is too ambiguous to judge
    if len(words) == 1 and len(words[0]) <= 4:
        return False
    non_trivial = [w for w in words if len(w) > 3]
    if not non_trivial:
        return False
    gibberish_count = sum(1 for w in non_trivial if _word_is_gibberish(w))
    return gibberish_count == len(non_trivial)


_EMBEDDED_TASK_RE = re.compile(
    r'\b(create|make|build|generate|send|schedule|write|compose|draft|'
    r'upload|save|download|analyze|search|find|fetch|read|check|show|view|list|'
    r'set up|setup|delete|remove|update|edit|modify|add|insert|book|organise|organize|'
    r'hire|onboard|recruit|register|invite|deploy|run|execute|start|stop|'
    r'cancel|remind|notify|translate|convert|export|import|merge|push|pull|'
    r'fire|promote|demote|assign|transfer|approve|reject|process)\b',
    re.IGNORECASE
)

# "I want to X", "I need to X", "I'd like to X", "I wish to X" - intent phrases
# that precede an action verb. These are always tasks regardless of sentence structure.
_INTENT_TASK_RE = re.compile(
    r'^I\s+(want|need|would like|\'d like|wish|am trying|am looking)\s+to\s+\w',
    re.IGNORECASE
)

# Queries that require live data - always route to agent (search_web / fetch_webpage)
_REALTIME_RE = re.compile(
    r'\b(weather|temperature|forecast|rain|humidity|wind speed|'
    r'stock price|share price|market|crypto|bitcoin|exchange rate|'
    r'news|headlines|breaking|latest|current|today|right now|live|'
    r'score|match result|standings|leaderboard|trending)\b',
    re.IGNORECASE
)

_TASK_START_RE = re.compile(
    r'^(create|make|build|generate|send|schedule|write|compose|draft|'
    r'upload|save|download|analyze|search|find|get|fetch|read|check|show|view|list|'
    r'set up|setup|delete|remove|update|edit|modify|add|insert|book|organise|organize|'
    r'hire|onboard|invite|register|deploy|run|execute|start|stop|cancel|'
    r'remind|notify|summarize|translate|convert|export|import|merge|push|pull)',
    re.IGNORECASE
)


def _is_qa(text: str) -> bool:
    """Detect pure Q&A vs actionable task.

    A message is Q&A when the user is asking/querying, not commanding an action.
    A message is a task when it contains a clear action verb directing the agent to DO something.

    Rule of thumb: tasks need action verbs. Anything that reads as a question -
    even without a '?' or a classic question starter - is Q&A if it has no action verb.
    """
    t = text.strip()

    # Live data (weather, stocks, news) → always route to agent (has web_search)
    if _REALTIME_RE.search(t):
        return False

    # Explicit action verb at start → unambiguous task
    if _TASK_START_RE.match(t):
        return False

    # "I want to hire / I need to send / I'd like to schedule…" → task
    if _INTENT_TASK_RE.match(t):
        return False

    # "show me my X" / "tell me my X" → always live user data → agent
    _SHOW_MY_RE = re.compile(
        r'\b(show me my|tell me my|get my|fetch my|what(\'s| is) my|display my|give me my)\b',
        re.IGNORECASE
    )
    if _SHOW_MY_RE.search(t):
        return False

    # Email / inbox read queries always need the agent (it has list_emails tool).
    # These look like Q&A but must fetch live data, even with a '?' at the end.
    _EMAIL_READ_RE = re.compile(
        r'\b(my emails|my inbox|unread emails|important emails|top \d+ emails|'
        r'latest emails|recent emails|email from|emails from|show.*emails|'
        r'list.*emails|emails today|emails this week|new emails|inbox emails|'
        r'check.*emails|read.*emails|what.*emails)\b',
        re.IGNORECASE
    )
    if _EMAIL_READ_RE.search(t):
        return False  # always route to agent so list_emails can be called

    # LinkedIn / integration live-data queries always need the agent
    _INTEGRATION_DATA_RE = re.compile(
        r'\b(linkedin|my profile|my calendar|my contacts|my drive|my slack|'
        r'my notion|my trello|my github)\b',  # "my jira" removed - Jira integration disabled
        re.IGNORECASE
    )
    if _INTEGRATION_DATA_RE.search(t):
        return False

    # Ends with '?' → usually Q&A, BUT if the question is asking the agent to
    # perform or verify an action ("did you send X?", "can you send X?",
    # "have you created X?") it is a deferred task - route to agent.
    if t.endswith('?'):
        _ACTION_QUESTION_RE = re.compile(
            r'\b(did you|have you|can you|could you|will you|would you)\s+'
            r'(send|create|email|share|schedule|book|draft|compose|generate|upload|save)\b',
            re.IGNORECASE
        )
        if _ACTION_QUESTION_RE.search(t):
            return False  # "did you send X?" → agent handles it
        return True

    # Classic Q&A opener (what/how/why/tell me/…) with no embedded action verb → Q&A
    if _QA_RE.match(t):
        if _EMBEDDED_TASK_RE.search(t):
            return False   # "could you create…" → task
        return True

    # Key insight: if the message contains NO action verb at all, the user is
    # asking / reflecting / describing - not commanding the agent to do something.
    # e.g. "previously how many days I have taken leave"
    #      "what happened in yesterday's meeting"
    #      "last month salary details"
    if not _EMBEDDED_TASK_RE.search(t):
        return True

    return False


def _safe_zoneinfo(tz_name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _iso_range_for_day(day: datetime) -> tuple[str, str]:
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = day.replace(hour=23, minute=59, second=59, microsecond=0)
    return start.isoformat(), end.isoformat()


def _infer_calendar_range(task: str, user_timezone: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    now = datetime.now(_safe_zoneinfo(user_timezone))
    lower = task.lower()

    if "today" in lower:
        return _iso_range_for_day(now)
    if "tomorrow" in lower:
        return _iso_range_for_day(now + timedelta(days=1))
    if "next week" in lower:
        next_monday = (now - timedelta(days=now.weekday())) + timedelta(days=7)
        next_sunday = next_monday + timedelta(days=6)
        start = next_monday.replace(hour=0, minute=0, second=0, microsecond=0)
        end = next_sunday.replace(hour=23, minute=59, second=59, microsecond=0)
        return start.isoformat(), end.isoformat()
    if "this week" in lower or re.search(r'\bweek\b', lower):
        monday = now - timedelta(days=now.weekday())
        sunday = monday + timedelta(days=6)
        start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
        end = sunday.replace(hour=23, minute=59, second=59, microsecond=0)
        return start.isoformat(), end.isoformat()

    for name, index in _WEEKDAY_INDEX.items():
        if re.search(rf'\b{name}\b', lower):
            delta = (index - now.weekday()) % 7
            if f"next {name}" in lower:
                delta = delta + 7 if delta != 0 else 7
            elif f"this {name}" in lower:
                delta = delta
            elif delta == 0:
                delta = 7
            target = now + timedelta(days=delta)
            return _iso_range_for_day(target)

    text_candidates = re.findall(
        r'\b\d{4}-\d{2}-\d{2}\b|'
        r'\b\d{1,2}/\d{1,2}/\d{2,4}\b|'
        r'\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b|'
        r'\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+\d{4})?\b',
        task,
        re.IGNORECASE,
    )
    for candidate in text_candidates:
        normalized = candidate.replace(",", "")
        for pattern in _MONTH_DAY_PATTERNS:
            try:
                parsed = datetime.strptime(normalized, pattern)
                if "%Y" not in pattern:
                    parsed = parsed.replace(year=now.year)
                    if parsed.date() < now.date():
                        parsed = parsed.replace(year=now.year + 1)
                parsed = parsed.replace(tzinfo=_safe_zoneinfo(user_timezone))
                return _iso_range_for_day(parsed)
            except ValueError:
                continue

    return None, None


async def _fetch_calendar_events(task: str, user_email: Optional[str], user_timezone: Optional[str]) -> List[Dict[str, Any]]:
    if not user_email or not _CALENDAR_QUERY_RE.search(task):
        return []

    try:
        from mcp_servers.tools.calendar_tools import list_events, EventListRequest

        time_min, time_max = _infer_calendar_range(task, user_timezone)
        req = EventListRequest(
            user_email=user_email,
            time_min=time_min,
            time_max=time_max,
            max_results=20,
        )
        result = await list_events(req)
        return result.get("events", []) or []
    except Exception as e:
        logger.warning(f"Failed to fetch calendar events for chat response: {e}")
        return []


def _fmt_event_time(raw: str, tz: Optional[str] = None) -> str:
    """Convert ISO datetime string to a readable local time string."""
    if not raw or raw == "TBD":
        return raw
    try:
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo as _ZI
        # Handle date-only events (all-day)
        if "T" not in raw:
            parsed = _dt.fromisoformat(raw)
            return parsed.strftime("%b %d, %Y (all day)")
        parsed = _dt.fromisoformat(raw)
        if tz:
            try:
                parsed = parsed.astimezone(_ZI(tz))
            except Exception:
                pass
        return parsed.strftime("%b %d, %Y at %I:%M %p %Z").replace("  ", " ").strip()
    except Exception:
        return raw


def _format_calendar_events_markdown(events: List[Dict[str, Any]], user_timezone: Optional[str] = None) -> str:
    if not events:
        return ""

    lines = []
    for event in events:
        raw_start = event.get("start", "TBD")
        start = event.get("start_display") or _fmt_event_time(raw_start, user_timezone)
        raw_end = event.get("end", "")
        end = event.get("end_display") or (_fmt_event_time(raw_end, user_timezone) if raw_end else "")
        attendees = event.get("attendees") or []
        attendee_text = f"{len(attendees)} attendee{'s' if len(attendees) != 1 else ''}" if attendees else "No attendees listed"
        time_range = f"{start} – {end}" if end else start
        line = f"- **{event.get('summary', 'Untitled')}** - {time_range} - {attendee_text}"
        if event.get("meetLink"):
            line += f"\n  [Join Meeting]({event['meetLink']})"
        elif event.get("htmlLink"):
            line += f"\n  [View Event]({event['htmlLink']})"
        lines.append(line)
    return "\n".join(lines)


def _inject_calendar_links(text: str, events: List[Dict[str, Any]], user_timezone: Optional[str] = None) -> str:
    if not events:
        return text

    formatted = _format_calendar_events_markdown(events, user_timezone)
    if not formatted:
        return text

    urls = [e.get("meetLink") or e.get("htmlLink") for e in events if e.get("meetLink") or e.get("htmlLink")]
    if urls and any(url in text for url in urls):
        return text

    section = f"\n\n## Calendar Links\n{formatted}"
    return f"{text.rstrip()}{section}"


def _latest_draft_id_from_history(history: List[Dict[str, str]]) -> Optional[str]:
    for item in reversed(history):
        if item.get("role") != "assistant":
            continue
        match = _DRAFT_MARKER_RE.search(item.get("content", ""))
        if match:
            return match.group(1)
    return None


async def _stream_save_draft_result(draft_id: str, email: str, db: Session):
    from mcp_servers.tools.draft_tools import tool_save_draft

    result = await tool_save_draft(user_email=email, db=db, draft_id=draft_id)
    if result.get("error"):
        yield json.dumps({"type": "error", "message": result["error"]}) + "\n"
        return

    message = result.get("message", "Saved successfully.")
    url = result.get("url")
    if url:
        message = f"{message}\n\n[Open File]({url})"
    yield json.dumps({"type": "result", "text": message, "tools_used": ["save_draft"]}) + "\n"


_SENDER_FROM_RE = re.compile(
    r'\b(?:from|by|sent by|email from|emails from)\s+([a-zA-Z0-9._%+\-@]+(?:\s+[a-zA-Z0-9._%+\-@]+)*)',
    re.IGNORECASE,
)
# Catches "latest email person@example.com" — bare email address near email keywords
_SENDER_BARE_EMAIL_RE = re.compile(
    r'\b(?:email|emails)\s+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})',
    re.IGNORECASE,
)


def _extract_sender_query(task: str) -> Optional[str]:
    """Extract a Gmail 'from:' query term from a natural-language task.

    Returns a string like 'from:alice@example.com' or 'from:zorawar' ready
    to pass as the Gmail search query, or None if no sender was mentioned.
    """
    # Priority 1: explicit "from X" / "sent by X"
    m = _SENDER_FROM_RE.search(task)
    if not m:
        # Priority 2: bare email address adjacent to "email" keyword
        m = _SENDER_BARE_EMAIL_RE.search(task)
    if not m:
        return None
    raw = m.group(1).strip()
    # Drop trailing filler words that got swept in by the greedy match
    for stop in ("is", "about", "regarding", "on", "please", "and", "or", "the"):
        if raw.lower().endswith(f" {stop}"):
            raw = raw[: -(len(stop) + 1)].strip()
    return f"from:{raw}" if raw else None


async def _stream_latest_email_result(email: str, task: str = ""):
    from mcp_servers.tools.gmail_tools import list_emails, get_email, ListEmailRequest, EmailRequest
    from fastapi import HTTPException as _HTTPEx

    sender_query = _extract_sender_query(task)
    req = ListEmailRequest(user_email=email, max_results=5, query=sender_query)

    try:
        inbox = await list_emails(req)
    except _HTTPEx as exc:
        detail = exc.detail or "Unknown error"
        if "not connected" in str(detail).lower() or exc.status_code == 400:
            msg = (
                "⚠️ Your Gmail account isn't connected yet.\n\n"
                "Go to **Settings → Integrations** and connect your Google account to fetch emails."
            )
        else:
            msg = f"⚠️ Could not fetch emails: {detail}"
        yield json.dumps({"type": "result", "text": msg, "tools_used": []}) + "\n"
        return
    except Exception as exc:
        yield json.dumps({"type": "result", "text": f"⚠️ Could not fetch emails: {exc}", "tools_used": []}) + "\n"
        return

    emails = inbox.get("emails") or []
    if not emails:
        if sender_query:
            sender_display = sender_query.replace("from:", "")
            yield json.dumps({"type": "result", "text": f"No emails found from **{sender_display}**.", "tools_used": ["list_emails"]}) + "\n"
        else:
            yield json.dumps({"type": "result", "text": "Your inbox appears to be empty — no emails found.", "tools_used": ["list_emails"]}) + "\n"
        return

    latest = emails[0]
    try:
        full_email = await get_email(EmailRequest(user_email=email, message_id=latest["id"]))
    except Exception:
        full_email = latest  # fall back to list metadata

    body = (full_email.get("body") or full_email.get("snippet") or "").strip() or "No body text found."
    heading = f"Latest Email from **{sender_query.replace('from:', '')}**" if sender_query else "Latest Email"
    text = (
        f"## {heading}\n"
        f"**From:** {full_email.get('from', 'Unknown')}\n"
        f"**Subject:** {full_email.get('subject', 'No Subject')}\n\n"
        f"{body}"
    )
    yield json.dumps({"type": "result", "text": text, "tools_used": ["list_emails", "get_email"]}) + "\n"


async def _stream_qa(task: str, doc_context: str = "", user_id: Optional[int] = None, db=None, history: Optional[List[Dict[str, str]]] = None, user_email: Optional[str] = None, user_timezone: Optional[str] = None, calendar_events: Optional[List[Dict[str, Any]]] = None):
    """Stream a direct LLM Q&A response without agent overhead.
    
    For calendar/meeting/schedule queries, fetches actual event data and includes
    it in the prompt so the LLM can provide clickable links to join meetings.
    """
    from litellm import acompletion
    from utils.llm_router import _resolve_model, _api_key_for, _get_user_llm_config, _prefix_local_model, _PROVIDER_DEFAULT_MODEL

    tz = _safe_zoneinfo(user_timezone)
    now_user = datetime.now(tz)
    today_str = now_user.strftime("%A, %B %d, %Y")

    system = (
        f"Current date: {today_str} (user's local time).\n\n"
        "You are AutoDeskAI AI, an intelligent workspace assistant. "
        "Answer clearly and helpfully. Use markdown formatting: "
        "**bold** for key terms, ## headings for sections, bullet points (- item) for lists. "
        "Be concise and direct. For research, trends, comparison, or explainer prompts, "
        "start with a short executive summary, then use a horizontal rule (---), then numbered sections with bold headings, "
        "and end with a ## Bottom Line section. Prefer compact bullets over long walls of text. If the user asks about capabilities, mention you can "
        "send emails, schedule meetings, create documents/spreadsheets/presentations, "
        "generate images, and manage Google Workspace.\n\n"
        "CRITICAL - CAPABILITY RULES:\n"
        "NEVER say 'I cannot send emails' or 'I cannot send documents' - you CAN send emails via the agent.\n"
        "If the user asks you to send a document/email or asks 'did you send X to Y?', respond:\n"
        "  'I can send that for you! Just say \"send the [document] to [name]\" and I will compose the "
        "email with the document link and ask for your confirmation before sending.'\n"
        "NEVER tell the user to send the email themselves - always offer to do it through the agent.\n\n"
        "IMPORTANT - DATA YOU DON'T HAVE ACCESS TO:\n"
        "If the user asks about personal records that are NOT connected to this platform "
        "(leave history, attendance, payroll, salary slips, HR records, appraisals, "
        "bank statements, tax filings, utility bills), respond like this:\n"
        "  1. State clearly what you don't have access to and why (1 sentence).\n"
        "  2. Tell them where they CAN find that information "
        "(e.g. 'Check your company HR portal / HRMS system / payslip email').\n"
        "  3. Offer: 'If you paste or upload the data here, I can instantly analyze it for you.'\n"
        "NEVER say 'please share a document so I can help' as the primary response - "
        "always answer the 'where to find it' part first.\n"
        "NOTE: Gmail / email IS connected. If asked about emails, say: "
        "'To fetch your actual emails, just say \"show my emails\" or \"list my inbox\" and I will retrieve them for you.'\n\n"
        "CALENDAR LINK FORMATTING:\n"
        "When you mention meetings or events that have links, ALWAYS format them as clickable markdown links:\n"
        "- For Google Meet: [Join Meeting](https://meet.google.com/xxx)\n"
        "- For event pages: [View Event](https://calendar.google.com/xxx)\n"
        "- Format: **[Event Name]** - [Time] - [Attendees]\n  [Join Meeting](link) or [View Event](link)"
    )
    
    calendar_data_context = ""
    events = calendar_events if calendar_events is not None else await _fetch_calendar_events(task, user_email, user_timezone)
    if events:
        calendar_data_context = "\n\n[CALENDAR DATA]\n" + _format_calendar_events_markdown(events, user_timezone) + "\n[END CALENDAR DATA]"
    
    if doc_context:
        system += f"\n\n[Uploaded Document]\n{doc_context[:25000]}"
    
    if calendar_data_context:
        system += f"\n\n{calendar_data_context}"

    model = _resolve_model("drafter")
    api_key = _api_key_for(model)
    api_base = None

    # Use the user's configured model/provider if available
    user_cfg = await asyncio.to_thread(_get_user_llm_config, user_id, db) if user_id and db else {}
    if user_cfg.get("provider"):
        provider = user_cfg["provider"]
        user_model = user_cfg.get("model")
        if user_model:
            model = user_model
        elif provider in _PROVIDER_DEFAULT_MODEL:
            model = _PROVIDER_DEFAULT_MODEL[provider]
        api_key = user_cfg.get("api_key") or api_key
        api_base = user_cfg.get("api_base")
        if provider in ("ollama", "local_llm"):
            model, api_base = _prefix_local_model(provider, model, api_base)

    # Build messages with conversation history so the LLM has context
    messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
    if history:
        messages.extend(history[-10:])  # last 10 turns for context
    messages.append({"role": "user", "content": task})

    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "stream": True,
    }
    # stream_options is an OpenAI-specific extension; Ollama / LM Studio reject it.
    _is_local_qa = api_base is not None  # local models always have an api_base
    if not _is_local_qa:
        kwargs["stream_options"] = {"include_usage": True}
    if _is_local_qa:
        # Small local models produce empty output above ~2048 tokens
        kwargs["max_tokens"] = 2048
    if api_key:
        kwargs["api_key"] = api_key
    if api_base:
        kwargs["api_base"] = api_base

    full_text = ""
    total_tokens = 0
    model_used = model
    try:
        response = await acompletion(**kwargs)
        async for chunk in response:
            # Some providers emit a final chunk with usage and no content
            usage = getattr(chunk, "usage", None)
            if usage:
                total_tokens = getattr(usage, "total_tokens", 0) or 0
                model_used = getattr(chunk, "model", None) or model_used
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                full_text += delta
                yield json.dumps({"type": "chunk", "text": delta}) + "\n"
        # Only append routing hint when no real data was returned (no calendar events, no lengthy answer)
        has_real_data = bool(events) or len(full_text) > 300
        if _EMBEDDED_TASK_RE.search(task) and not has_real_data:
            hint = (
                "\n\n---\n> **Want me to actually do this?** "
                "Start your message with an action verb (e.g. *Create a document about Gemini and save it to Drive*) "
                "or pick a specific agent from the **Agents** gallery and chat with it directly."
            )
            full_text += hint
            yield json.dumps({"type": "chunk", "text": hint}) + "\n"
        full_text = _inject_calendar_links(full_text, events, user_timezone)
        yield json.dumps({
            "type": "result",
            "text": full_text,
            "tools_used": [],
            "is_qa": True,
            "token_count": total_tokens,
            "model_used": model_used,
        }) + "\n"
    except Exception as e:
        logger.error(f"Direct LLM stream error: {e}")
        yield json.dumps({"type": "error", "message": str(e)}) + "\n"


async def _parse_doc_by_prefix(doc_id: str) -> str:
    """Fetch parsed text for a document stored in the DB by its doc_uuid.

    Documents are stored entirely in the database (content_zlib + parsed_text).
    parsed_text is pre-extracted at upload time so this is a fast DB lookup.
    Falls back to decompressing + re-parsing if parsed_text is missing.
    """
    from auth.database import SessionLocal
    from auth.models import Document
    import zlib

    def _db_fetch(uid: str) -> str:
        db = SessionLocal()
        try:
            doc = db.query(Document).filter(Document.doc_uuid == uid).first()
            if not doc:
                return ""
            # Fast path: pre-parsed text stored at upload time
            if doc.parsed_text:
                return doc.parsed_text[:50_000]
            # Slow path: decompress raw bytes and reparse
            if doc.content_zlib:
                from pathlib import Path
                raw = zlib.decompress(doc.content_zlib)
                ext = Path(doc.filename).suffix.lower()
                # Reuse the same parse logic from document_routes
                from routes.document_routes import _parse_bytes
                return _parse_bytes(raw, ext)[:50_000]
            return ""
        except Exception as e:
            logger.warning(f"DB doc lookup failed for {uid}: {e}")
            return ""
        finally:
            db.close()

    return await asyncio.to_thread(_db_fetch, doc_id)


async def _get_filename_by_prefix(doc_id: str) -> str:
    """Return the original filename for an uploaded file identified by UUID prefix."""
    import os
    from pathlib import Path
    upload_dir = Path(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))) / "uploads"
    for fname in upload_dir.iterdir():
        if fname.name.startswith(doc_id):
            # Filename format: {uuid}_{original_name} - strip the uuid_ prefix
            parts = fname.name.split("_", 1)
            return parts[1] if len(parts) > 1 else fname.name
    return ""


def _parse_file(file_path) -> str:
    """Extract text from a file. Returns empty string on failure."""
    from pathlib import Path
    ext = Path(file_path).suffix.lower()
    try:
        if ext == ".txt":
            return Path(file_path).read_text(errors="replace")[:50000]
        elif ext == ".csv":
            import pandas as pd
            df = pd.read_csv(file_path)
            return df.to_string(index=False)[:30000]
        elif ext == ".xlsx":
            import pandas as pd
            df = pd.read_excel(file_path)
            return df.to_string(index=False)[:30000]
        elif ext == ".docx":
            from docx import Document as DocxDocument
            doc = DocxDocument(str(file_path))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())[:50000]
        elif ext == ".pdf":
            try:
                from pypdf import PdfReader
            except ImportError:
                import PyPDF2 as pypdf_fallback
                reader = pypdf_fallback.PdfReader(str(file_path))
                return "\n".join(page.extract_text() or "" for page in reader.pages)[:50000]
            reader = PdfReader(str(file_path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)[:50000]
    except Exception as e:
        logger.warning(f"Failed to parse {file_path}: {e}")
    return ""


# ── Request/Response models ───────────────────────────────────────────────────

# Pydantic models for API requests/responses
class AgentTaskRequest(BaseModel):
    task_description: str
    agent_type: Optional[str] = None  # If not specified, system will auto-select
    context: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    task_description: str
    doc_id: Optional[str] = None        # single UUID prefix (legacy, kept for compat)
    doc_ids: Optional[List[str]] = None  # multiple uploaded documents
    context: Optional[Dict[str, Any]] = None
    agent_id: Optional[int] = None  # Explicit DB agent ID; bypasses auto-routing
    cost_opt_mode: bool = False  # User-opted cost optimization: use cheaper model for simple tasks
    session_id: Optional[int] = None  # Chat session to append messages to

class AgentTaskResponse(BaseModel):
    success: bool
    agent: Optional[Dict[str, Any]] = None
    task: str
    result: Optional[Dict[str, Any]] = None
    execution_time: str
    error: Optional[str] = None

class AgentStatusResponse(BaseModel):
    total_agents: int
    active_agents: int
    agent_types: Dict[str, Dict[str, Any]]
    tool_coverage: Dict[str, int]

class AgentExecutionHistoryResponse(BaseModel):
    executions: List[Dict[str, Any]]
    total_count: int

# Agent execution routes
@router.post("/execute", response_model=AgentTaskResponse)
async def execute_agent_task(
    request: AgentTaskRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Execute a task using an agent (auto-selects best agent if not specified)"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        if request.agent_type:
            # Use specified agent type
            result = await agent_executor.execute_agent_task(
                agent_type=request.agent_type,
                task_description=request.task_description,
                user_email=email,
                context=request.context
            )
        else:
            # Auto-select best agent for the task
            best_agent = await agent_executor.find_best_agent_for_task(
                request.task_description,
                email
            )
            
            if not best_agent:
                raise HTTPException(status_code=400, detail="No suitable agent found for this task")
            
            result = await agent_executor.execute_agent_task(
                agent_type=best_agent.agent_type,
                task_description=request.task_description,
                user_email=email,
                context=request.context
            )
        
        return AgentTaskResponse(**result)
        
    except Exception as e:
        logger.error(f"Error executing agent task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

from fastapi.responses import StreamingResponse

@router.post("/execute_stream")
async def execute_agent_stream(
    request: AgentTaskRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Execute a task and stream real-time Server-Sent Events (SSE) of the agent's thought process"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        agent_type = request.agent_type
        if not agent_type:
            best_agent = await agent_executor.find_best_agent_for_task(
                request.task_description,
                email
            )
            if not best_agent:
                raise HTTPException(status_code=400, detail="No suitable agent found for this task")
            agent_type = best_agent.agent_type

        return StreamingResponse(
            agent_executor.execute_agent_stream_task(
                agent_type=agent_type,
                task_description=request.task_description,
                user_email=email,
                context=request.context
            ),
            media_type="text/event-stream"
        )
        
    except Exception as e:
        logger.error(f"Error starting agent stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def _generate_session_title(timestamp=None) -> str:
    """Generate a session title with date and time.
    
    Example: "Chat - Apr 22, 2026 at 2:35 PM"
    """
    from datetime import datetime
    if timestamp is None:
        timestamp = datetime.now()
    # Format: "Chat - Apr 22, 2026 at 2:35 PM"
    return timestamp.strftime("Chat - %b %d, %Y at %I:%M %p")


def _session_create(email: str, title: str = None) -> int:
    """Create a new chat session and return its id."""
    from auth.database import SessionLocal
    from auth.models import ChatSession
    from datetime import datetime
    
    db = SessionLocal()
    try:
        if title is None:
            title = _generate_session_title(datetime.now())
        session = ChatSession(user_email=email, title=title)
        db.add(session)
        db.commit()
        db.refresh(session)
        return session.id
    finally:
        db.close()




def _history_get(email: str, session_id: Optional[int] = None) -> List[Dict[str, str]]:
    """Return chat messages for a session (or last 20 global if no session given)."""
    from auth.database import SessionLocal
    from auth.models import ChatMessage
    db = SessionLocal()
    try:
        q = db.query(ChatMessage).filter(ChatMessage.user_email == email)
        if session_id is not None:
            q = q.filter(ChatMessage.session_id == session_id)
            rows = q.order_by(ChatMessage.id.asc()).all()
        else:
            # For global/initial load, only take the last 20 messages to keep it fast
            rows = q.order_by(ChatMessage.id.desc()).limit(20).all()
            rows.reverse() # Back to chronological order
        return [{"role": r.role, "content": r.content, "attachments": r.attachments} for r in rows]
    finally:
        db.close()


def _history_append(email: str, role: str, content: str, session_id: Optional[int] = None, attachments: Optional[List[Dict[str, str]]] = None):
    """Append a message to the DB chat history for the given session."""
    from auth.database import SessionLocal
    from auth.models import ChatMessage, ChatSession
    from sqlalchemy.sql import func as sqlfunc
    db = SessionLocal()
    try:
        db.add(ChatMessage(user_email=email, session_id=session_id, role=role, content=content, attachments=attachments))
        if session_id is not None:
            db.query(ChatSession).filter(ChatSession.id == session_id).update(
                {"updated_at": sqlfunc.now()}, synchronize_session=False
            )
        db.commit()
    finally:
        db.close()

def _write_task_notification(email: str, task_title: str, result_summary: str):
    """Persist a TaskNotification row so the frontend can show a pop-up on tab-return.

    Only written for tasks that produced a substantive result (>80 chars) so that
    trivial Q&A answers don't spam the notification queue.
    """
    if not result_summary or len(result_summary) < 80:
        return  # skip short Q&A answers
    from auth.database import SessionLocal
    from auth.models import TaskNotification
    db = SessionLocal()
    try:
        db.add(TaskNotification(
            user_email=email,
            task_title=task_title[:200],
            result_summary=result_summary[:1000],
        ))
        db.commit()
    except Exception as exc:
        logger.warning(f"Could not write task notification for {email}: {exc}")
    finally:
        db.close()


@router.post("/chat/stream")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Smart chat endpoint: Q&A → direct LLM stream; tasks → agent pipeline."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Extract scalar values NOW while current_user is still attached to the session.
    # Accessing ORM attributes inside async generator closures causes DetachedInstanceError
    # because the SQLAlchemy session may expire before the generator resumes.
    user_id: int = current_user.id
    user_timezone: Optional[str] = current_user.timezone

    task = body.task_description.strip()
    if not task:
        raise HTTPException(status_code=400, detail="Empty message")

    # Guardrail: reject nonsensical / gibberish input before hitting the agent pipeline
    if _is_gibberish(task):
        async def _reject_gibberish():
            yield f"data: {json.dumps({'type': 'result', 'text': 'Please provide a clear task or question. I need meaningful input to help you - for example: \"Summarize my unread emails\" or \"Schedule a meeting with John tomorrow at 3pm\".', 'tools_used': []})}\n\n"
        return StreamingResponse(_reject_gibberish(), media_type="text/event-stream")

    # Parse attached document(s) - support both single doc_id (legacy) and doc_ids (multi)
    all_doc_ids: List[str] = []
    if body.doc_ids:
        all_doc_ids = body.doc_ids
    elif body.doc_id:
        all_doc_ids = [body.doc_id]

    doc_context = ""
    parsed_doc_names: List[str] = []
    if all_doc_ids:
        parts: List[str] = []
        for idx, did in enumerate(all_doc_ids, 1):
            try:
                text = await _parse_doc_by_prefix(did)
                if text:
                    # Find the original filename for display
                    fname = await _get_filename_by_prefix(did)
                    label = fname or f"Document {idx}"
                    parsed_doc_names.append(label)
                    parts.append(f"=== {label} (doc_id: {did}) ===\n{text}")
                else:
                    logger.warning(f"No text extracted from doc {did}")
            except Exception as e:
                logger.warning(f"Doc parse failed for {did}: {e}")
        if parts:
            doc_context = "\n\n".join(parts)

    # Build attachments for history persistence
    attachments_to_save = None
    if all_doc_ids:
        attachments_to_save = []
        for did in all_doc_ids:
            fname = await _get_filename_by_prefix(did) or did
            attachments_to_save.append({"id": did, "filename": fname})

    # Build full task with doc context if present.
    # The header explicitly tells the agent NOT to call read_uploaded_document -
    # the content is already here and the IDs are included in case it needs them.
    full_task = task
    if doc_context:
        full_task = (
            f"{task}\n\n"
            "━━━ UPLOADED DOCUMENT CONTENT (already parsed - do NOT call read_uploaded_document) ━━━\n"
            "The following documents have been fully extracted and injected below.\n"
            "Read them directly from this context. Do NOT call read_uploaded_document.\n\n"
            f"{doc_context}\n"
            "━━━ END OF UPLOADED DOCUMENTS ━━━"
        )

    # Resolve or create session - title is set once from the first user message
    session_id = body.session_id
    if session_id is None:
        session_id = await asyncio.to_thread(_session_create, email, task[:80])

    # Fetch history and calendar events in parallel — both are independent of each other
    history, calendar_events = await asyncio.gather(
        asyncio.to_thread(_history_get, email, session_id),
        _fetch_calendar_events(task, email, user_timezone),
    )

    # Fire activity log in the background — pass db=None so record_activity owns its session
    asyncio.ensure_future(asyncio.to_thread(
        record_activity, None, email, "chat_message",
        entity_type="chat",
        entity_id=str(session_id),
        details={
            "msg": task[:300],
            "type": "qa" if (_is_qa(task) and not all_doc_ids) else "task",
            "docs": [d["filename"] for d in (attachments_to_save or [])],
            "agent_id": body.agent_id,
        },
        request=request
    ))
    latest_draft_id = _latest_draft_id_from_history(history)

    if _LAST_EMAIL_RE.search(task):
        await asyncio.to_thread(_history_append, email, "user", task, session_id, attachments_to_save)

        async def _email_stream():
            final_text = ""
            async for line in _stream_latest_email_result(email, task):
                if line.strip():
                    try:
                        evt = json.loads(line.strip())
                        if evt.get("type") == "result":
                            final_text = evt.get("text", "")
                    except Exception:
                        pass
                yield line
            if final_text:
                await asyncio.to_thread(_history_append, email, "assistant", final_text, session_id)

        return StreamingResponse(
            _email_stream(),
            media_type="text/event-stream",
            headers={"X-Session-Id": str(session_id)},
        )

    # If no marker found in history, fall back to the most recent unsaved DB draft for this user
    if not latest_draft_id and _SAVE_DRAFT_RE.search(task):
        fallback = (
            db.query(ContentDraft)
            .filter(ContentDraft.user_email == email, ContentDraft.status != "saved")
            .order_by(ContentDraft.created_at.desc())
            .first()
        )
        if fallback:
            latest_draft_id = fallback.id

    if latest_draft_id and _SAVE_DRAFT_RE.search(task):
        draft = db.query(ContentDraft).filter(ContentDraft.id == latest_draft_id, ContentDraft.user_email == email).first()
        if draft and draft.status != "saved":
            await asyncio.to_thread(_history_append, email, "user", task, session_id, attachments_to_save)

            async def _save_stream():
                final_text = ""
                async for line in _stream_save_draft_result(latest_draft_id, email, db):
                    if line.strip():
                        try:
                            evt = json.loads(line.strip())
                            if evt.get("type") == "result":
                                final_text = evt.get("text", "")
                        except Exception:
                            pass
                    yield line
                if final_text:
                    await asyncio.to_thread(_history_append, email, "assistant", final_text, session_id)

            return StreamingResponse(
                _save_stream(),
                media_type="text/event-stream",
                headers={"X-Session-Id": str(session_id)},
            )

    # Check if the last assistant message was an email draft confirmation request
    # (covers both the normal draft-show and the security-block fallback message)
    _DRAFT_SIGNALS = ("Send this email?", "requires explicit user confirmation", "unable to send the email", "send this email")
    has_pending_draft = any(
        m["role"] == "assistant" and any(sig.lower() in m["content"].lower() for sig in _DRAFT_SIGNALS)
        for m in history[-4:]
    )

    # Detect mid-conversation: agent asked for a date/time/detail and user is replying.
    # In this case, bypass Q&A routing even if the reply has no action verb.
    _AGENT_PROMPT_SIGNALS = (
        "when would you like", "please provide", "what date", "what time",
        "provide a date", "provide a time", "which date", "which time",
        "what day", "please clarify", "let me know when", "let me know the date",
        "please confirm", "could you provide", "could you clarify",
    )
    agent_was_asking = any(
        m["role"] == "assistant" and any(sig in m["content"].lower() for sig in _AGENT_PROMPT_SIGNALS)
        for m in history[-2:]
    )

    # Route: Q&A (no doc, agent not mid-conversation, no explicit agent selected) → direct LLM
    # CRITICAL: when the user explicitly selected an agent (agent_id set), ALWAYS use the agent
    # pipeline so it can call real tools — never shortcut to Q&A (which has no tool access).
    if _is_qa(task) and not all_doc_ids and not agent_was_asking and not body.agent_id:
        await asyncio.to_thread(_history_append, email, "user", task, session_id, attachments_to_save)

        async def _qa_stream_with_history():
            final_text = ""
            async for line in _stream_qa(task, doc_context, user_id=user_id, db=db, history=history, user_email=email, user_timezone=user_timezone, calendar_events=calendar_events):
                if line.strip():
                    try:
                        evt = json.loads(line.strip())
                        if evt.get("type") == "result":
                            final_text = evt.get("text", "")
                    except Exception:
                        pass
                yield line
            if final_text:
                await asyncio.to_thread(_history_append, email, "assistant", final_text, session_id)

        return StreamingResponse(
            _qa_stream_with_history(),
            media_type="text/event-stream",
            headers={"X-Session-Id": str(session_id)}
        )

    # Task routing → explicit agent_id takes priority over auto-routing
    try:
        # ── Explicit agent selection (from gallery "Chat" button) ──
        if body.agent_id:
            #  FIX #2: Reuse the db session from Depends instead of opening a 2nd one
            # This avoids wasting a connection pool slot
            dynamic_agent = await agent_executor.find_agent_by_id(body.agent_id, email, db)
            # _DynamicAgent is a plain Python object (not an ORM model) - all
            # attributes are already captured from the DB row inside find_agent_by_id,
            # so no refresh/expunge is needed or valid here.

            if dynamic_agent is None:
                raise HTTPException(status_code=404, detail="Agent not found")

            chat_security_token = GLOBAL_SIGNER.generate_token(
                action="agent_chat", params={}, user_email=email
            )
            await asyncio.to_thread(_history_append, email, "user", task, session_id, attachments_to_save)

            async def _dynamic_stream_with_history():
                final_text = ""
                async for line in agent_executor.execute_dynamic_agent_stream(
                    agent=dynamic_agent,
                    task_description=full_task,
                    user_email=email,
                    context=body.context,
                    security_token=chat_security_token,
                    history_messages=history,
                ):
                    if line.strip():
                        try:
                            evt = json.loads(line.strip())
                            if evt.get("type") == "result":
                                final_text = _inject_calendar_links(evt.get("text", ""), calendar_events, user_timezone)
                                evt["text"] = final_text
                                line = json.dumps(evt) + "\n"
                        except Exception:
                            pass
                    yield line
                if final_text:
                    await asyncio.to_thread(_history_append, email, "assistant", final_text, session_id)
                    await asyncio.to_thread(
                        _write_task_notification, email,
                        full_task[:120], final_text,
                    )

            return StreamingResponse(
                _dynamic_stream_with_history(),
                media_type="text/event-stream",
                headers={"X-Session-Id": str(session_id)},
            )

        # ── Auto-routing (no agent_id) ────────────────────────────

        # Platform commands must never be hijacked by email_manager.
        # Detect them first so the heuristic below can't misroute them.
        _PLATFORM_NAMES = {
            "github":   "GitHub Assistant",
            # "jira":   "Jira Manager",  -- Jira integration disabled
            "trello":   "Trello Assistant",
            "slack":    "Slack Messenger",
            "discord":  "Discord Messenger",
            "telegram": "Telegram Bot",
        }
        _PLATFORM_RE = re.compile(
            r'\b(github|trello|slack|discord|telegram)\b',  # "jira" removed - Jira integration disabled
            re.IGNORECASE
        )
        platform_match = _PLATFORM_RE.search(full_task)
        is_platform_task = bool(platform_match)
        platform_display_name = _PLATFORM_NAMES.get(platform_match.group(1).lower()) if platform_match else None

        agent_type = None
        best_agent = await agent_executor.find_best_agent_for_task(full_task, email)
        if best_agent:
            agent_type = best_agent.agent_type

        # Normalise to string for all comparisons below
        agent_type_str = agent_type.value if hasattr(agent_type, "value") else str(agent_type) if agent_type else None

        # If keyword heuristic wrongly chose email_manager for a platform command, override it.
        if is_platform_task and agent_type_str == "email_manager":
            agent_type = "document_creator"
            agent_type_str = "document_creator"

        # STICKY ROUTING: pending email draft overrides document_creator back to email_manager
        if agent_type_str == "document_creator" and has_pending_draft and not is_platform_task:
            logger.info(f"Sticky routing preserved: {email} -> email_manager (pending draft)")
            agent_type = "email_manager"
            agent_type_str = "email_manager"

        if not agent_type:
            # Fall back to Q&A stream if no agent found
            return StreamingResponse(
                _stream_qa(task, doc_context, user_id=user_id, db=db, history=history, user_email=email, user_timezone=user_timezone, calendar_events=calendar_events),
                media_type="text/event-stream"
            )

        _CONFIRM_WORDS = ("send", "yes", "look", "good", "confirm", "ok", "sure", "proceed", "do it", "approve", "correct", "send it", "go ahead")
        is_confirm = any(w in full_task.lower() for w in _CONFIRM_WORDS)
        is_email_task = agent_type_str == "email_manager"

        # Platform tasks always get a security token (they have their own approval gate per tool).
        # Email tasks only get a token after the draft has been shown and user confirmed.
        chat_security_token = None
        if is_platform_task or not is_email_task or (has_pending_draft and is_confirm):
            chat_security_token = GLOBAL_SIGNER.generate_token(
                action="agent_chat", params={}, user_email=email
            )

        # Append user message to history before streaming
        await asyncio.to_thread(_history_append, email, "user", task, session_id, attachments_to_save)

        async def _stream_with_history():
            """Wrap the agent stream and write the final response into chat history."""
            final_text = ""
            merged_context = {**(body.context or {}), "cost_opt_mode": body.cost_opt_mode}
            async for line in agent_executor.execute_agent_stream_task(
                agent_type=agent_type,
                task_description=full_task,
                user_email=email,
                context=merged_context,
                security_token=chat_security_token,
                history_messages=history,
                display_name=platform_display_name,
            ):
                if line.strip():
                    try:
                        evt = json.loads(line.strip())
                        if evt.get("type") == "result":
                            final_text = _inject_calendar_links(evt.get("text", ""), calendar_events, user_timezone)
                            evt["text"] = final_text
                            line = json.dumps(evt) + "\n"
                    except Exception:
                        pass
                yield line
            # Store assistant reply so next turn can check has_pending_draft
            if final_text:
                await asyncio.to_thread(_history_append, email, "assistant", final_text, session_id)
                await asyncio.to_thread(
                    _write_task_notification, email,
                    full_task[:120], final_text,
                )

        return StreamingResponse(
            _stream_with_history(),
            media_type="text/event-stream",
            headers={"X-Session-Id": str(session_id)},
        )
    except Exception as e:
        logger.error(f"chat/stream routing error for user={email}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Async (Celery) execution endpoints ───────────────────────────────────────

class AsyncTaskRequest(BaseModel):
    task_description: str
    agent_type: Optional[str] = "custom"
    agent_id: Optional[int] = None
    context: Optional[Dict[str, Any]] = None


@router.post("/execute-async")
async def execute_agent_async(
    request: AsyncTaskRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
):
    """
    Queue a long-running agent task in Celery and return immediately.
    Poll GET /api/agents/task/{task_id}/status for progress + result.
    Also streams progress events from Redis at GET /api/agents/task/{task_id}/stream.
    """
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    try:
        from workers.agent_tasks import run_agent_task
        task = run_agent_task.apply_async(
            kwargs={
                "user_email": email,
                "task_description": request.task_description,
                "agent_type": request.agent_type or "custom",
                "agent_id": request.agent_id,
                "context": request.context or {},
            },
            queue="long_running",
        )
        return {"task_id": task.id, "status": "queued", "message": "Task is queued and will be processed shortly."}
    except Exception as e:
        logger.error(f"execute-async failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/task/{task_id}/status")
async def get_async_task_status(
    task_id: str,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
):
    """Poll Celery task status and return current result if complete."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    try:
        from celery.result import AsyncResult
        from workers.celery_app import celery_app as _celery
        result = AsyncResult(task_id, app=_celery)
        payload: Dict[str, Any] = {"task_id": task_id, "status": result.status}
        if result.ready():
            payload["result"] = result.result if result.successful() else None
            payload["error"] = str(result.result) if result.failed() else None
        elif result.state == "PROGRESS":
            payload["meta"] = result.info
        return payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/task/{task_id}/stream")
async def stream_async_task(
    task_id: str,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user),
):
    """
    SSE stream that replays Redis progress events for a queued task.
    The frontend connects here and gets the same event format as the
    synchronous /chat/stream endpoint.
    """
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    _REDIS_URL = os.getenv("REDIS_URL") or (
        f"redis://{os.getenv('REDIS_HOST', 'localhost')}:{os.getenv('REDIS_PORT', '6379')}/2"
    )

    async def _sse():
        import redis.asyncio as aioredis
        from celery.result import AsyncResult
        from workers.celery_app import celery_app as _celery

        r = aioredis.from_url(_REDIS_URL, decode_responses=True)
        stream_key = f"task_stream:{task_id}"
        cursor = 0
        try:
            while True:
                # Pop events the worker has pushed so far
                events = await r.lrange(stream_key, cursor, -1)
                for raw in events:
                    yield f"data: {raw}\n\n"
                cursor += len(events)

                # Check if the Celery task is done
                res = AsyncResult(task_id, app=_celery)
                if res.ready():
                    # Drain any remaining events
                    tail = await r.lrange(stream_key, cursor, -1)
                    for raw in tail:
                        yield f"data: {raw}\n\n"
                    break

                await asyncio.sleep(0.5)
        finally:
            await r.aclose()

    return StreamingResponse(_sse(), media_type="text/event-stream")


# ── Chat sessions & history endpoints ────────────────────────────────────────

@router.get("/chat/sessions")
async def list_chat_sessions(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all chat sessions for the user, newest first."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")

    def _query():
        from auth.models import ChatSession, ChatMessage
        from sqlalchemy import func as sqlfunc

        msg_count_sq = (
            db.query(sqlfunc.count(ChatMessage.id))
            .filter(
                ChatMessage.session_id == ChatSession.id,
                ChatMessage.user_email == email,
            )
            .correlate(ChatSession)
            .scalar_subquery()
        )
        return (
            db.query(
                ChatSession.id,
                ChatSession.title,
                ChatSession.created_at,
                ChatSession.updated_at,
                msg_count_sq.label("message_count"),
            )
            .filter(ChatSession.user_email == email)
            .order_by(ChatSession.updated_at.desc())
            .limit(20)
            .all()
        )

    rows = await asyncio.to_thread(_query)
    return {"sessions": [
        {
            "id": r.id,
            "title": r.title,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "message_count": r.message_count,
        }
        for r in rows
    ]}


@router.post("/chat/sessions")
async def create_chat_session(
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """Create a new empty chat session and return its id."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    sid = await asyncio.to_thread(_session_create, email)
    return {"session_id": sid}


@router.delete("/chat/sessions/{session_id}")
async def delete_chat_session(
    session_id: int,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a chat session and all its messages."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    from auth.models import ChatSession
    s = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_email == email).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.get("/chat/history")
async def get_chat_history(
    email: str = Query(..., description="User email"),
    session_id: Optional[int] = Query(default=None),
    current_user: User = Depends(get_current_user),
):
    """Return chat messages for a specific session."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    messages = await asyncio.to_thread(_history_get, email, session_id)
    return {"messages": messages, "count": len(messages)}


class FeedbackRequest(BaseModel):
    message_id: str
    rating: int  # 1 for down, 5 for up
    message_content: Optional[str] = None
    agent_id: Optional[int] = None
    feedback_text: Optional[str] = None


@router.post("/chat/feedback")
async def save_chat_feedback(
    request: FeedbackRequest,
    email: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save user feedback (thumbs up/down) for a specific message."""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized")
    from auth.models import AgentFeedback
    
    fb = AgentFeedback(
        user_id=current_user.id,
        message_id=request.message_id,
        message_content=request.message_content,
        agent_id=request.agent_id,
        response_quality=request.rating,
        feedback_text=request.feedback_text
    )
    db.add(fb)
    db.commit()
    return {"ok": True}


@router.post("/execute/{agent_type}", response_model=AgentTaskResponse)
async def execute_specific_agent_task(
    agent_type: str,
    request: AgentTaskRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Execute a task using a specific agent type"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        result = await agent_executor.execute_agent_task(
            agent_type=agent_type,
            task_description=request.task_description,
            user_email=email,
            context=request.context
        )
        
        return AgentTaskResponse(**result)
        
    except Exception as e:
        logger.error(f"Error executing specific agent task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Agent management routes
@router.get("/status", response_model=AgentStatusResponse)
async def get_agent_status(
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Get status of all agents"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        status = await agent_executor.get_agent_status()
        return AgentStatusResponse(**status)
        
    except Exception as e:
        logger.error(f"Error getting agent status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{agent_type}")
async def get_specific_agent_status(
    agent_type: str,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Get status of a specific agent type"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        status = await agent_executor.get_agent_status(agent_type)
        
        if "error" in status:
            raise HTTPException(status_code=404, detail=status["error"])
        
        return status
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting specific agent status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/list")
async def list_all_agents(
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """List all available agents with their capabilities"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        agents = agent_registry.get_all_agents()
        
        agent_list = []
        for agent in agents:
            agent_info = {
                "type": agent.agent_type.value,
                "name": agent.name,
                "description": agent.description,
                "is_active": agent.is_active,
                "capabilities": [
                    {
                        "name": cap.name,
                        "description": cap.description,
                        "examples": cap.examples or []
                    }
                    for cap in agent.capabilities
                ],
                "required_tools": [tool.value for tool in agent.required_tools],
                "optional_tools": [tool.value for tool in agent.optional_tools] if agent.optional_tools else [],
                "workflows": [
                    {
                        "step_name": step.step_name if hasattr(step, 'step_name') else step.get('step_name', 'Unknown') if isinstance(step, dict) else str(step),
                        "description": step.description if hasattr(step, 'description') else step.get('description', '') if isinstance(step, dict) else str(step),
                        "expected_output": step.expected_output if hasattr(step, 'expected_output') else step.get('expected_output', '') if isinstance(step, dict) else str(step)
                    }
                    for step in agent.workflows
                ]
            }
            agent_list.append(agent_info)
        
        return {
            "agents": agent_list,
            "total_count": len(agent_list)
        }
        
    except Exception as e:
        logger.error(f"Error listing agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/capabilities")
async def get_agent_capabilities(
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Get all available agent capabilities grouped by category"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        agents = agent_registry.get_active_agents()
        
        capabilities_by_category = {}
        for agent in agents:
            for capability in agent.capabilities:
                category = capability.name.split()[0].lower()  # Simple categorization
                
                if category not in capabilities_by_category:
                    capabilities_by_category[category] = []
                
                capabilities_by_category[category].append({
                    "agent_name": agent.name,
                    "agent_type": agent.agent_type.value,
                    "capability_name": capability.name,
                    "description": capability.description,
                    "examples": capability.examples or [],
                    "required_tools": [tool.value for tool in capability.required_tools]
                })
        
        return {
            "capabilities_by_category": capabilities_by_category,
            "total_capabilities": sum(len(caps) for caps in capabilities_by_category.values())
        }
        
    except Exception as e:
        logger.error(f"Error getting agent capabilities: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Agent execution history
@router.get("/history", response_model=AgentExecutionHistoryResponse)
async def get_execution_history(
    email: str = Query(..., description="User email"),
    limit: int = Query(50, description="Number of recent executions to return"),
    current_user: User = Depends(get_current_user)
):
    """Get recent agent execution history"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        history = agent_executor.get_execution_history(limit)
        
        # Filter history for this user
        user_history = [
            record for record in history 
            if record.get("user_email") == email
        ]
        
        return AgentExecutionHistoryResponse(
            executions=user_history,
            total_count=len(user_history)
        )
        
    except Exception as e:
        logger.error(f"Error getting execution history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Agent recommendation
@router.post("/recommend")
async def recommend_agent_for_task(
    request: AgentTaskRequest,
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Get agent recommendation for a specific task"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        best_agent = await agent_executor.find_best_agent_for_task(
            request.task_description,
            email
        )

        if not best_agent:
            raise HTTPException(status_code=400, detail="No suitable agent found for this task")

        # Get alternative agents that could also handle this task
        alternative_agents = []
        for agent in agent_registry.get_active_agents():
            if agent.agent_type != best_agent.agent_type:
                # Simple heuristic: check if agent has similar tools
                if any(tool in best_agent.required_tools for tool in agent.required_tools):
                    alternative_agents.append({
                        "type": agent.agent_type.value,
                        "name": agent.name,
                        "description": agent.description,
                        "confidence": "medium"  # Could be calculated more sophisticatedly
                    })
        
        return {
            "recommended_agent": {
                "type": best_agent.agent_type.value,
                "name": best_agent.name,
                "description": best_agent.description,
                "confidence": "high",
                "reasoning": f"Best match for task: {request.task_description}",
                "capabilities": [cap.name for cap in best_agent.capabilities],
                "required_tools": [tool.value for tool in best_agent.required_tools]
            },
            "alternative_agents": alternative_agents[:3],  # Top 3 alternatives
            "task": request.task_description
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Error recommending agent: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Health check for agent system
@router.get("/health")
async def agent_system_health(
    email: str = Query(..., description="User email"),
    current_user: User = Depends(get_current_user)
):
    """Check the health of the agent system"""
    if current_user.email != email:
        raise HTTPException(status_code=403, detail="Not authorized to access this user's emails")
    
    try:
        # Check if agent registry is working
        agents = agent_registry.get_active_agents()
        
        # Check if agent executor is working
        status = await agent_executor.get_agent_status()
        
        return {
            "status": "healthy",
            "service": "Agent System",
            "active_agents": len(agents),
            "total_agents": status.get("total_agents", 0),
            "registry_status": "operational",
            "executor_status": "operational",
            "timestamp": status.get("timestamp", "unknown")
        }
        
    except Exception as e:
        logger.error(f"Agent system health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "Agent System",
            "error": str(e),
            "timestamp": "unknown"
        }
