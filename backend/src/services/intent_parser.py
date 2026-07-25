"""
Three-tier intent router for voice commands.

Tier 1 - Trie-based navigation (O(k), 0ms, no LLM)
Tier 2 - LLM structured intent (classifier role, ~300ms)
Tier 3 - AgentExecutor passthrough (complex tasks, 2-10s)
"""

import json
from typing import Optional

from loguru import logger

from utils.llm_router import agenerate, get_text


# ── Tier 1: Trie for navigation commands ─────────────────────────────────────

class _TrieNode:
    __slots__ = ("children", "value")

    def __init__(self):
        self.children: dict[str, "_TrieNode"] = {}
        self.value: Optional[dict] = None


class _CommandTrie:
    def __init__(self):
        self.root = _TrieNode()

    def insert(self, phrase: str, action: dict) -> None:
        node = self.root
        for word in phrase.lower().split():
            node = node.children.setdefault(word, _TrieNode())
        node.value = action

    def match(self, text: str) -> Optional[dict]:
        """Exact match: ALL words in text must be consumed by the trie path.
        Partial prefix matches are rejected so that a command like
        "inbox emails from John" does not hijack to navigation."""
        words = text.lower().split()
        node = self.root
        for word in words:
            if word not in node.children:
                return None  # leftover words → not a pure nav command
            node = node.children[word]
        return node.value  # None if the full path has no registered action


_nav_trie = _CommandTrie()

_NAV_COMMANDS = {
    # Calendar
    "go to calendar":           "/tools/calendar",
    "open calendar":            "/tools/calendar",
    "show calendar":            "/tools/calendar",
    "show my calendar":         "/tools/calendar",
    "calendar":                 "/tools/calendar",
    "my calendar":              "/tools/calendar",
    # Inbox / Email
    "go to inbox":              "/tools/inbox",
    "open inbox":               "/tools/inbox",
    "check emails":             "/tools/inbox",
    "check my emails":          "/tools/inbox",
    "show inbox":               "/tools/inbox",
    "inbox":                    "/tools/inbox",
    "go to email":              "/tools/inbox",
    "open email":               "/tools/inbox",
    "show emails":              "/tools/inbox",
    # Dashboard
    "go to dashboard":          "/dashboard",
    "open dashboard":           "/dashboard",
    "command center":           "/dashboard",
    "dashboard":                "/dashboard",
    "home":                     "/dashboard",
    "go home":                  "/dashboard",
    # Agents
    "go to agents":             "/agents",
    "open agents":              "/agents",
    "manage agents":            "/agents",
    "show agents":              "/agents",
    "my agents":                "/agents",
    # Tools
    "go to tools":              "/tools",
    "open tools":               "/tools",
    "tools":                    "/tools",
    "show tools":               "/tools",
    # Settings
    "open settings":            "/settings",
    "go to settings":           "/settings",
    "settings":                 "/settings",
    "preferences":              "/settings",
    "go to preferences":        "/settings",
    # Exit continuous mode (handled as Tier 1 so no LLM round-trip)
    "stop listening":           "__exit_continuous__",
    "stop voice":               "__exit_continuous__",
    "exit voice":               "__exit_continuous__",
    "goodbye":                  "__exit_continuous__",
    "good bye":                 "__exit_continuous__",
    "end conversation":         "__exit_continuous__",
    "stop conversation":        "__exit_continuous__",
    "close voice":              "__exit_continuous__",
}

for _phrase, _page in _NAV_COMMANDS.items():
    _nav_trie.insert(_phrase, {"action": "navigate", "page": _page})



# ── Tier 2: LLM classification ────────────────────────────────────────────────

_CLASSIFY_SYSTEM = (
    "You are a voice command intent classifier for an AI workspace assistant.\n"
    "Given a voice command, return ONLY a valid JSON object (no markdown, no prose).\n\n"
    "TECH-NAME NORMALIZATION (CRITICAL):\n"
    "Voice STT engines often mis-transcribe compound technical product names. Before classifying,\n"
    "mentally correct obvious phonetic mis-transcriptions:\n"
    "  'Light LLM' or 'Lite LLM' → LiteLLM (Python library)\n"
    "  'chat GPT' / 'chat G P T' → ChatGPT\n"
    "  'Open A I' / 'open eye' → OpenAI\n"
    "  'git hub' → GitHub · 'git lab' → GitLab\n"
    "  'tensor flow' → TensorFlow · 'pie torch' / 'py torch' → PyTorch\n"
    "  'fast API' → FastAPI · 'my SQL' → MySQL · 'post gres' → PostgreSQL\n"
    "  'docker file' → Dockerfile · 'kube' / 'kubernetes' → Kubernetes\n"
    "When you recognize a phonetic tech name, use the CORRECT product name in `topic` and\n"
    "rewrite the `passthrough_text` with the correct name substituted in.\n\n"
    "INTENT TYPES:\n"
    "  send_email             - compose and send an email\n"
    "  create_draft           - save an email draft (not send)\n"
    "  schedule_meeting       - book or schedule a meeting or calendar event\n"
    "  read_emails            - read, list, or check emails\n"
    "  generate_image         - generate, design, or draw an image or logo\n"
    "  create_document        - create a Google Doc, report, memo, or text file\n"
    "  create_spreadsheet     - create a spreadsheet, data table, or CSV\n"
    "  create_presentation    - create slides, a deck, or a presentation\n"
    "  analyze_data           - analyze spreadsheet/sheet data, find insights, trends, or charts\n"
    "  manage_files           - organize, search, move, or manage Drive files and folders\n"
    "  create_form            - create a Google Form, survey, or questionnaire\n"
    "  manage_tasks           - create, list, update, or complete tasks and to-do items\n"
    "  translate_text         - translate text or a document to another language\n"
    "  simulate_communication - draft a calm, de-escalating response to a difficult or angry email\n"
    "  negotiate              - draft a sales proposal, counter-offer, or negotiation response\n"
    "  search_web             - search the web or look something up online\n"
    "  general_task           - any other complex or ambiguous task\n\n"
    "Return this JSON schema (no extra keys):\n"
    "{\n"
    '  "tier": 2,\n'
    '  "intent": "<intent_type>",\n'
    '  "needs_ghost_draft": true/false,\n'
    "  // true only for: send_email, create_draft, schedule_meeting, negotiate, simulate_communication\n"
    '  "params": {\n'
    '    "to_name": "",        // emails/negotiate: recipient name\n'
    '    "subject_hint": "",   // emails: topic hint\n'
    '    "body_hint": "",      // emails: key points\n'
    '    "attendee_hint": "",  // meetings: attendee name\n'
    '    "time_hint": "",      // meetings: time/date\n'
    '    "title_hint": "",     // docs/meetings/presentations: title\n'
    '    "description": "",    // images/forms/tasks: description\n'
    '    "language": "",       // translate: target language\n'
    '    "topic": ""           // data/web/presentations: exact normalized subject matter (correct tech name if phonetic)\n'
    "  },\n"
    '  "passthrough_text": "<command with corrected tech names substituted in>"\n'
    "}\n\n"
    "Use tier=3 only for genuinely ambiguous or multi-step cross-agent tasks.\n"
    "Set needs_ghost_draft=true only for: send_email, create_draft, schedule_meeting, negotiate, simulate_communication.\n"
    "Omit empty params fields.\n"
)


async def parse_intent(transcript: str, user_email: str) -> dict:
    """Route a voice transcript through three tiers. Returns an action dict."""
    text = transcript.strip()
    if not text:
        return {"tier": 0, "action": "empty"}

    # ── Tier 1: instant navigation ────────────────────────────────────────────
    nav = _nav_trie.match(text)
    if nav:
        logger.info(f"Voice Tier 1 (nav): '{text[:60]}' → {nav['page']}")
        return {"tier": 1, **nav, "original_text": text}

    # ── Tier 2/3: LLM classification ─────────────────────────────────────────
    try:
        resp = await agenerate(
            role="classifier",
            messages=[
                {"role": "system", "content": _CLASSIFY_SYSTEM},
                {"role": "user",   "content": text},
            ],
            temperature=0,
            max_tokens=300,
            response_format="json_object",
        )
        raw = get_text(resp).strip()
        # Strip accidental markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)

        # Force ghost draft for destructive or sensitive intents
        _FORCE_GHOST_INTENTS = {"send_email", "create_draft", "send_draft", "delete_email", "delete_event", "schedule_meeting", "simulate_communication", "negotiate"}
        if result.get("intent") in _FORCE_GHOST_INTENTS:
            result["needs_ghost_draft"] = True

        result.setdefault("original_text", text)
        result.setdefault("passthrough_text", text)
        logger.info(
            f"Voice Tier {result.get('tier','?')}: "
            f"intent={result.get('intent')} ghost={result.get('needs_ghost_draft')}"
        )
        return result

    except Exception as e:
        logger.warning(f"Intent parser LLM failed ({e}) - falling back to Tier 3")
        return {
            "tier": 3,
            "intent": "general_task",
            "needs_ghost_draft": False,
            "passthrough_text": text,
            "original_text": text,
        }


# ── Preview builder (for Ghost Draft UI) ─────────────────────────────────────

def build_ghost_preview(intent: dict) -> dict:
    """Build a human-readable preview dict for the Ghost Draft confirmation UI."""
    intent_type = intent.get("intent", "general_task")
    params = intent.get("params", {})
    transcript = intent.get("original_text", "")

    if intent_type == "send_email":
        to = params.get("to_name") or "recipient"
        subject = params.get("subject_hint") or "your message"
        return {
            "action": "Send Email",
            "to": to,
            "subject": subject,
            "body": params.get("body_hint") or transcript,
            "description": f"Compose and send an email to {to} about: {subject}",
        }

    if intent_type == "create_draft":
        to = params.get("to_name") or "recipient"
        return {
            "action": "Create Draft",
            "to": to,
            "subject": params.get("subject_hint") or "draft",
            "description": f"Save email draft to {to}",
        }

    if intent_type == "schedule_meeting":
        title = params.get("title_hint") or "Meeting"
        attendee = params.get("attendee_hint") or ""
        time_hint = params.get("time_hint") or ""
        desc = f"Schedule: {title}"
        if attendee:
            desc += f" with {attendee}"
        if time_hint:
            desc += f" at {time_hint}"
        return {
            "action": "Schedule Meeting",
            "title": title,
            **({"with": attendee} if attendee else {}),
            **({"time": time_hint} if time_hint else {}),
            "description": desc,
        }

    # Generic fallback
    return {
        "action": intent_type.replace("_", " ").title(),
        "description": transcript,
    }
