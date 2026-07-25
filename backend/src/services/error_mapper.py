"""
Maps raw exceptions / error strings to friendly, user-readable messages.
Usage:
    from services.error_mapper import friendly_error
    msg = friendly_error(exception_or_string)
"""

from __future__ import annotations

import re

# (pattern, friendly message)
_RULES: list[tuple[str, str]] = [
    (r"AuthenticationError|invalid.api.key|api key.*invalid|incorrect api key", "🔑 API key is invalid or expired - update it in Settings → API Keys"),
    (r"RateLimitError|rate.limit|rate_limit|429",                                "⏳ Model rate limit hit - the request will retry automatically"),
    (r"quota.exceeded|billing|insufficient.quota|insufficient_quota",            "💸 API quota exceeded - check your provider billing dashboard"),
    (r"timeout|timed.out|read timeout",                                          "🐢 Request timed out - try breaking the task into smaller steps"),
    (r"tool.call.loop|max.iterations|loop detected",                             "🔁 Agent got stuck in a loop - task stopped safely, no data was lost"),
    (r"no.credentials|credentials.not.found|token.expired|oauth",               "🔗 Account not connected or session expired - reconnect in Settings"),
    (r"file.not.found|no such file|404",                                         "📂 File not found - it may have been moved or deleted"),
    (r"permission.denied|403|forbidden|access.denied",                          "🔒 Permission denied - make sure the integration has the right access scopes"),
    (r"network|connection.refused|cannot.connect|unreachable",                  "🌐 Network error - check your internet connection and try again"),
    (r"invalid.model|model.not.found|no.model",                                 "🤖 Selected model is unavailable - switch to a different model in Settings"),
    (r"context.length|token.limit|maximum.context|max_tokens",                  "📏 Input too long for this model - shorten the task or split it"),
    (r"google.*error|drive.*error|gmail.*error|calendar.*error",                "📧 Google Workspace error - try reconnecting your Google account"),
]

_FALLBACK = "⚠️ Something went wrong - no data was lost. Try again or simplify the task."


def friendly_error(exc: Exception | str) -> str:
    """Return a friendly error message for the given exception or error string."""
    raw = str(exc).lower()
    for pattern, message in _RULES:
        if re.search(pattern, raw, re.IGNORECASE):
            return message
    return _FALLBACK
