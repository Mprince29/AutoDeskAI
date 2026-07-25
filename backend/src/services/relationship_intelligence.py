"""
Relationship Intelligence Service
Analyzes email history with a specific contact and returns a relationship card:
  - Last contact date + days since
  - Interaction frequency
  - Common topics discussed
  - Tone trend (neutral / warm / cold)
  - Promises made / received (unresolved)
  - Suggested action (if relationship is cooling)
"""
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from loguru import logger


async def get_relationship_card(
    user_email: str,
    contact_email: str,
    db,
    scan_days: int = 60,
) -> Dict[str, Any]:
    """
    Build a relationship card for the given contact by scanning email history.
    """
    from mcp_servers.tools.gmail_tools import list_emails, get_email, ListEmailRequest, EmailRequest

    sent_emails, received_emails = [], []

    # Fetch emails TO this contact
    try:
        req_to = ListEmailRequest(
            user_email=user_email,
            max_results=30, label_ids=["SENT"],
            query=f"to:{contact_email}",
        )
        result = await list_emails(req_to)
        sent_emails = result.get("emails", [])
    except Exception as e:
        logger.warning(f"relationship_intelligence: sent fetch failed: {e}")

    # Fetch emails FROM this contact
    try:
        req_from = ListEmailRequest(
            user_email=user_email,
            max_results=30, label_ids=["INBOX"],
            query=f"from:{contact_email}",
        )
        result = await list_emails(req_from)
        received_emails = result.get("emails", [])
    except Exception as e:
        logger.warning(f"relationship_intelligence: received fetch failed: {e}")

    # Extract display name from "From" header of received emails  (e.g. "Jane Doe <jane@x.com>")
    contact_name = contact_email  # fallback to email
    for e in received_emails:
        from_header = e.get("from", "")
        if "<" in from_header:
            candidate = from_header.split("<")[0].strip().strip('"')
            if candidate:
                contact_name = candidate
                break

    if not sent_emails and not received_emails:
        return {
            "contact_email": contact_email,
            "status": "no_history",
            "message": f"No email history found with {contact_email} in the last {scan_days} days.",
        }

    # Parse and sort all interactions by date
    all_interactions = _parse_interactions(sent_emails, received_emails)

    if not all_interactions:
        return {"contact_email": contact_email, "status": "no_history"}

    all_interactions.sort(key=lambda x: x["date"] or datetime.min, reverse=True)

    last_interaction = all_interactions[0]
    last_contact_date = last_interaction["date"]
    days_since = (datetime.utcnow() - last_contact_date).days if last_contact_date else None

    # Compute frequency
    sent_count = len([i for i in all_interactions if i["direction"] == "sent"])
    received_count = len([i for i in all_interactions if i["direction"] == "received"])
    total = len(all_interactions)

    # Response rate: how often they replied to you
    response_rate = min(100, round((received_count / sent_count) * 100)) if sent_count > 0 else None

    # Avg response time (days between sent and next received)
    avg_response_days = _compute_avg_response_time(all_interactions)

    # Topic extraction via LLM
    topics = await _extract_topics(all_interactions[:10])

    # Tone trend detection (heuristics + optional LLM)
    tone = await _detect_tone_trend(
        all_interactions[:5], days_since,
        response_rate=response_rate,
        sent_count=sent_count,
        received_count=received_count,
    )

    # Commitment detection
    my_commitments = await _extract_commitments_from_list(
        [i for i in all_interactions if i["direction"] == "sent"], side="mine"
    )
    their_commitments = await _extract_commitments_from_list(
        [i for i in all_interactions if i["direction"] == "received"], side="theirs"
    )

    # Relationship health signal
    health = _compute_health(days_since, response_rate, tone)

    return {
        "contact_email": contact_email,
        "name": contact_name,
        "status": "ok",
        "last_contact_date": last_contact_date.strftime("%Y-%m-%d") if last_contact_date else None,
        "days_since_contact": days_since,
        "total_interactions": total,
        "sent_count": sent_count,
        "received_count": received_count,
        "response_rate_pct": response_rate,
        "avg_response_days": avg_response_days,
        "topics": topics,
        "tone_trend": tone,
        "health": health,
        "my_commitments": my_commitments,
        "their_commitments": their_commitments,
        "last_subject": last_interaction.get("subject", ""),
        "last_snippet": last_interaction.get("snippet", ""),
        "last_direction": last_interaction.get("direction", ""),
        "suggested_action": _suggest_action(health, days_since, my_commitments),
    }


def _parse_interactions(sent: list, received: list) -> List[Dict]:
    interactions = []
    for e in sent:
        interactions.append({
            "direction": "sent",
            "subject": e.get("subject", ""),
            "snippet": e.get("snippet", ""),
            "date": _parse_date(e.get("date", "")),
        })
    for e in received:
        interactions.append({
            "direction": "received",
            "subject": e.get("subject", ""),
            "snippet": e.get("snippet", ""),
            "date": _parse_date(e.get("date", "")),
        })
    return interactions


def _parse_date(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    
    from email.utils import parsedate_to_datetime
    try:
        dt = parsedate_to_datetime(raw)
        return dt.replace(tzinfo=None)
    except (ValueError, TypeError, IndexError):
        pass

    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw[:19], fmt)
        except (ValueError, TypeError):
            pass
    try:
        return datetime.utcfromtimestamp(int(raw) / 1000)
    except (ValueError, TypeError):
        pass
    return None


def _compute_avg_response_time(interactions: List[Dict]) -> Optional[float]:
    """Approximate: average days between a sent email and the next received email."""
    sent_dates = sorted(
        [i["date"] for i in interactions if i["direction"] == "sent" and i["date"]],
        reverse=False,
    )
    received_dates = sorted(
        [i["date"] for i in interactions if i["direction"] == "received" and i["date"]],
        reverse=False,
    )
    if not sent_dates or not received_dates:
        return None
    gaps = []
    for sd in sent_dates:
        # Find the first received date after this sent date
        replies = [rd for rd in received_dates if rd > sd]
        if replies:
            gaps.append((replies[0] - sd).days)
    return round(sum(gaps) / len(gaps), 1) if gaps else None


async def _extract_topics(interactions: List[Dict]) -> List[str]:
    """Use a lightweight LLM call to extract the main topics from recent email subjects/snippets."""
    if not interactions:
        return []
    context = "\n".join(
        f"[{i['direction'].upper()}] {i['subject']}: {i['snippet'][:100]}"
        for i in interactions[:8]
    )
    try:
        from litellm import acompletion
        from utils.llm_router import _resolve_model, _api_key_for, _max_tokens_key, _sanitize_kwargs
        model = _resolve_model("extractor")
        api_key = _api_key_for(model)
        kwargs = {
            "model": model,
            "messages": [{"role": "user", "content": (
                f"From these email snippets, extract 3-5 key topics discussed (2-4 words each, comma-separated, no punctuation):\n{context}"
            )}],
            "temperature": 0.1,
            _max_tokens_key(model): 80,
        }
        if api_key:
            kwargs["api_key"] = api_key
        kwargs = _sanitize_kwargs(model, kwargs)
        resp = await acompletion(**kwargs)
        raw = resp.choices[0].message.content.strip()
        return [t.strip() for t in raw.split(",") if t.strip()][:5]
    except Exception as e:
        logger.warning(f"relationship_intelligence: topic extraction failed: {e}")
        return []


async def _detect_tone_trend(recent: List[Dict], days_since: Optional[int], response_rate: Optional[int] = None, sent_count: int = 0, received_count: int = 0) -> str:
    """
    Classify the tone trend as warm / neutral / cooling / cold.

    Heuristic tiers (evaluated in order - LLM only called when truly ambiguous):
      1. Staleness: >45d → cold, >21d → cooling
      2. Engagement ratio: high response rate + bidirectional → warm
      3. Keyword scan: warm/cold signals in recent snippets
      4. LLM fallback (only if snippets are rich enough)
    """
    if not recent:
        return "neutral"

    # Tier 1 - staleness
    if days_since is not None and days_since > 45:
        return "cold"
    if days_since is not None and days_since > 21:
        return "cooling"

    # Tier 2 - engagement heuristics (no LLM needed)
    if response_rate is not None and response_rate >= 70 and days_since is not None and days_since <= 7:
        return "warm"
    if response_rate is not None and response_rate < 15 and sent_count >= 3:
        return "cooling"
    # Mutual conversation (both sides active) + recent = warm
    if sent_count >= 2 and received_count >= 2 and days_since is not None and days_since <= 14:
        return "warm"

    # Tier 3 - keyword scan (fast, deterministic)
    WARM_KEYWORDS = {"thank", "thanks", "appreciate", "great", "wonderful", "looking forward",
                     "excited", "happy", "glad", "please", "congratulation", "welcome"}
    COLD_KEYWORDS = {"unsubscribe", "stop emailing", "remove me", "no response", "not interested",
                     "please don't", "do not contact"}
    combined_text = " ".join(
        (i.get("subject", "") + " " + i.get("snippet", ""))[:120]
        for i in recent[:5]
    ).lower()
    cold_hits = sum(1 for kw in COLD_KEYWORDS if kw in combined_text)
    warm_hits  = sum(1 for kw in WARM_KEYWORDS if kw in combined_text)
    if cold_hits > 0:
        return "cold"
    if warm_hits >= 2:
        return "warm"

    # Tier 4 - LLM (only when there is enough snippet content to be meaningful)
    snippets = " ".join(i["snippet"][:80] for i in recent[:3] if i.get("snippet"))
    if not snippets or len(snippets) < 30:
        # Not enough text - fall back to engagement-based signal
        if response_rate is not None and response_rate >= 50:
            return "warm"
        return "neutral"

    try:
        from litellm import acompletion
        from utils.llm_router import _resolve_model, _api_key_for, _max_tokens_key, _sanitize_kwargs
        model = _resolve_model("extractor")
        api_key = _api_key_for(model)
        kwargs = {
            "model": model,
            "messages": [{"role": "user", "content": (
                "Classify the tone of this email exchange in ONE word only. "
                "Choose from: warm, neutral, cooling, cold.\n\n"
                f"Email snippets:\n{snippets}\n\nRespond with exactly one word:"
            )}],
            "temperature": 0.0,
            _max_tokens_key(model): 5,
        }
        if api_key:
            kwargs["api_key"] = api_key
        kwargs = _sanitize_kwargs(model, kwargs)
        resp = await acompletion(**kwargs)
        tone = resp.choices[0].message.content.strip().lower().split()[0]
        if tone in ("warm", "neutral", "cooling", "cold"):
            return tone
        # LLM returned something unexpected - fall back to warm_hits signal
        return "warm" if warm_hits >= 1 else "neutral"
    except Exception as e:
        logger.warning(f"relationship_intelligence: tone LLM failed: {e}")
        return "warm" if warm_hits >= 1 else "neutral"


async def _extract_commitments_from_list(interactions: List[Dict], side: str) -> List[str]:
    """Scan snippets for commitment language."""
    import re
    patterns = [
        r"i['']ll\s+\w+", r"let me\s+\w+", r"will\s+(?:send|share|get|check|follow up|circle back)",
        r"introducing you", r"by\s+(?:monday|tuesday|wednesday|thursday|friday|end of week|eow|eod)",
    ]
    compiled = [re.compile(p, re.IGNORECASE) for p in patterns]
    hits = []
    for i in interactions[:10]:
        snippet = i.get("snippet", "")
        if any(p.search(snippet) for p in compiled):
            hits.append(snippet[:150])
    return hits[:3]


def _compute_health(days_since: Optional[int], response_rate: Optional[int], tone: str) -> str:
    """Return green / yellow / red health signal."""
    if days_since is None:
        return "unknown"
    if days_since > 45 or tone == "cold":
        return "red"
    if days_since > 21 or tone == "cooling" or (response_rate is not None and response_rate < 30):
        return "yellow"
    return "green"


def _suggest_action(health: str, days_since: Optional[int], my_commitments: List[str]) -> Optional[str]:
    if my_commitments:
        return f"You have {len(my_commitments)} unresolved commitment(s). Follow up now."
    if health == "red":
        return f"Relationship has gone cold ({days_since} days since last contact). Consider reaching out."
    if health == "yellow":
        return f"Relationship cooling ({days_since} days since last contact). A brief check-in would help."
    return None
