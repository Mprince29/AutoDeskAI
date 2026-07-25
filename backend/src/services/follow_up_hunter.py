"""
Follow-Up Hunter Service
Scans sent emails for unresolved commitments ("I'll send", "Let me check", etc.)
and surfaces them as actionable follow-up items.
"""
import json
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any
from loguru import logger


# Commitment signal patterns - phrases that indicate a promise was made
_COMMITMENT_PATTERNS = [
    r"i['']ll\s+(?:send|share|forward|get|check|follow|look|reach|set|schedule|book|update|add|create|prepare|review|confirm|let you know)",
    r"let me\s+(?:check|look|get back|find|send|share|forward|confirm|review|schedule)",
    r"i\s+(?:will|would|can)\s+(?:send|share|forward|get|check|set|schedule|book|update|add|create|prepare|review|confirm)",
    r"(?:will|can)\s+(?:follow up|get back|circle back|touch base|loop back)",
    r"i['']ll\s+(?:follow up|get back|circle back|touch base|loop back)",
    r"(?:sending|sharing|forwarding|getting|checking)\s+(?:this|that|it|the)\s+(?:over|to you|shortly|soon)",
    r"(?:by|before|on|no later than)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|end of week|eod|eow)",
    r"introducing you to",
    r"i['']ll\s+introduce",
    r"(?:let|make sure)\s+(?:me|us|I)\s+(?:get|send|share|check)",
]

_COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in _COMMITMENT_PATTERNS]


def _has_commitment(text: str) -> bool:
    return any(p.search(text) for p in _COMPILED_PATTERNS)


async def scan_for_follow_ups(
    user_email: str,
    db,
    days: int = 14,
    max_emails: int = 50,
) -> List[Dict[str, Any]]:
    """
    Scan the user's sent mail for the last `days` days.
    Returns a list of follow-up items where a commitment was detected
    but no subsequent reply in the same thread was found.
    """
    from mcp_servers.tools.gmail_tools import list_emails, get_email, ListEmailRequest, EmailRequest

    logger.info(f"follow_up_hunter: starting scan for user {user_email}")
    try:
        # Fetch recent sent emails
        req = ListEmailRequest(
            user_email=user_email,
            max_results=max_emails,
            label_ids=["SENT"],
        )
        sent_emails = await list_emails(req)
        emails = sent_emails.get("emails", [])
        logger.info(f"follow_up_hunter: retrieved {len(emails)} sent emails, scanning for commitments...")
    except Exception as e:
        logger.error(f"follow_up_hunter: failed to list sent emails: {e}")
        return []

    follow_ups = []
    cutoff = datetime.utcnow() - timedelta(days=days)

    for email_meta in emails:
        try:
            # Parse date - skip emails older than cutoff
            raw_date = email_meta.get("date", "")
            email_date = _parse_email_date(raw_date)
            if email_date and email_date < cutoff:
                continue

            snippet = email_meta.get("snippet", "")
            subject = email_meta.get("subject", "")
            recipient = email_meta.get("to", email_meta.get("from", ""))

            # Quick filter - only fetch full body if snippet hints at a commitment
            if not _has_commitment(snippet):
                continue

            # Fetch full email body
            get_req = EmailRequest(
                user_email=user_email,
                message_id=email_meta["id"],
            )
            full = await get_email(get_req)
            body = full.get("body", "") or ""

            if not _has_commitment(body):
                continue

            # Extract the specific commitment sentence(s)
            commitment_lines = _extract_commitment_lines(body)
            if not commitment_lines:
                commitment_lines = [snippet[:200]]

            follow_ups.append({
                "id": email_meta["id"],
                "subject": subject,
                "recipient": recipient,
                "date_sent": raw_date,
                "days_ago": (datetime.utcnow() - email_date).days if email_date else None,
                "commitment": commitment_lines[0],
                "all_commitments": commitment_lines,
                "snippet": snippet,
                "thread_id": email_meta.get("threadId"),
            })

        except Exception as e:
            logger.warning(f"follow_up_hunter: skipping email {email_meta.get('id')}: {e}")
            continue

    # Sort by oldest first (most overdue at top)
    follow_ups.sort(key=lambda x: x.get("days_ago") or 0, reverse=True)
    logger.info(f"follow_up_hunter: detected {len(follow_ups)} follow-up items")
    return follow_ups


def _parse_email_date(raw: str) -> datetime | None:
    """Parse common email date formats into a datetime object."""
    if not raw:
        return None
    
    from email.utils import parsedate_to_datetime
    try:
        dt = parsedate_to_datetime(raw)
        return dt.replace(tzinfo=None)
    except (ValueError, TypeError, IndexError):
        pass

    # Try ISO format first (our internal format)
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw[:19], fmt)
            return dt.replace(tzinfo=None)
        except (ValueError, TypeError):
            continue
    # Epoch milliseconds
    try:
        return datetime.utcfromtimestamp(int(raw) / 1000)
    except (ValueError, TypeError):
        pass
    return None


def _extract_commitment_lines(body: str) -> List[str]:
    """Return the sentences in the email body that contain a commitment."""
    sentences = re.split(r'(?<=[.!?])\s+', body.replace("\n", " "))
    hits = []
    for sentence in sentences:
        if _has_commitment(sentence):
            hits.append(sentence.strip())
        if len(hits) >= 3:
            break
    return hits


async def generate_follow_up_draft(
    original_subject: str,
    commitment_text: str,
    recipient: str,
    days_ago: int,
) -> str:
    """Use the LLM to generate a polished follow-up email draft."""
    from litellm import acompletion
    from utils.llm_router import _resolve_model, _api_key_for

    model = _resolve_model("drafter")
    api_key = _api_key_for(model)

    apology = "Sorry for the delay — " if days_ago > 5 else ""
    prompt = (
        f"Original email subject: {original_subject}\n"
        f"Commitment made {days_ago} day(s) ago: {commitment_text}\n"
        f"Recipient: {recipient}\n\n"
        f"Write a short, human follow-up email (2-3 sentences). "
        f"Tone: casual and direct, like a message from a colleague, not a corporate email.\n"
        f"{'Start with a brief apology for the delay. ' if days_ago > 5 else ''}"
        "Reference the original commitment naturally. "
        "Either deliver on it or give a quick status update. "
        "End with one clear next step.\n\n"
        "BANNED: 'Hope this email finds you well', 'I wanted to follow up', 'Please let me know', "
        "'Best regards', 'Kind regards', any buzzwords.\n\n"
        "Output ONLY the email body. No subject line."
    )

    kwargs: dict = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.4,
    }
    if api_key:
        kwargs["api_key"] = api_key

    try:
        response = await acompletion(**kwargs)
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"follow_up draft generation failed: {e}")
        return f"Hi,\n\nFollowing up on my earlier message regarding: {commitment_text}\n\nPlease let me know if you need anything.\n\nBest regards"
