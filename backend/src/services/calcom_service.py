"""
Cal.com Integration Service — OAuth2

Token stored in vault under platform "calcom", retrieved by user_id.
OAuth app credentials: CAL_CLIENT_ID / CAL_CLIENT_SECRET in .env.

Public API:
  get_event_types(user_id, db)                  → list of event types
  generate_booking_link(event_type_slug, ...)   → pre-filled booking URL (no token needed)
  get_upcoming_bookings(user_id, db)            → list of upcoming bookings
  generate_premeeting_brief(contact, dossier)   → LLM markdown brief
"""
import asyncio
import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

CAL_BASE = "https://api.cal.com/v2"


# ── Token retrieval ────────────────────────────────────────────────────────────

def _get_token(user_id: int, db) -> str:
    """Retrieve Cal.com OAuth access token from vault. Returns '' if not connected."""
    try:
        from services.vault_service import vault
        cred = vault.get(user_id, "calcom", db)
        if cred:
            return cred.get("access_token", "")
    except Exception as e:
        logger.warning(f"Cal.com vault lookup failed: {e}")
    return ""


# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _cal_get(path: str, access_token: str) -> Optional[dict]:
    if not access_token:
        logger.warning("Cal.com: no access token — skipping request")
        return None
    req = urllib.request.Request(
        f"{CAL_BASE}{path}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "cal-api-version": "2024-08-13",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.warning(f"Cal.com GET {path} failed: {e}")
        return None


# ── Public functions ───────────────────────────────────────────────────────────

async def get_event_types(user_id: int, db) -> list[dict]:
    """List all event types for the connected Cal.com user."""
    token = await asyncio.to_thread(_get_token, user_id, db)
    if not token:
        return []
    data = await asyncio.to_thread(_cal_get, "/event-types", token)
    if not data:
        return []
    event_types = data.get("data") or data.get("event_types") or []
    if isinstance(event_types, dict):
        event_types = event_types.get("eventTypes") or []
    return [
        {
            "id": et.get("id"),
            "slug": et.get("slug"),
            "title": et.get("title"),
            "length": et.get("length"),
            "description": et.get("description"),
        }
        for et in event_types
        if isinstance(et, dict)
    ]


async def generate_booking_link(
    event_type_slug: str,
    name: str,
    email: str,
    timezone: str,
    cal_username: str = "",
    notes: str = "",
) -> str:
    """
    Build a pre-filled Cal.com booking URL.
    No token required — public URL with query params.
    cal_username: param override → CAL_USERNAME env var fallback.
    """
    username = cal_username or os.getenv("CAL_USERNAME", "")
    if not username or not event_type_slug:
        return ""

    params: dict = {}
    if name:
        params["name"] = name
    if email:
        params["email"] = email
    if timezone:
        params["timezone"] = timezone
    if notes:
        params["notes"] = notes

    qs = urllib.parse.urlencode(params)
    base = f"https://cal.com/{urllib.parse.quote(username)}/{urllib.parse.quote(event_type_slug)}"
    return f"{base}?{qs}" if qs else base


def _fetch_upcoming_bookings_sync(user_id: int, db) -> list[dict]:
    token = _get_token(user_id, db)
    if not token:
        return []
    data = _cal_get("/bookings?status=upcoming", token)
    if not data:
        return []
    bookings = data.get("data") or data.get("bookings") or []
    return [
        {
            "id": b.get("id"),
            "title": b.get("title"),
            "start": b.get("startTime"),
            "end": b.get("endTime"),
            "attendees": [a.get("email") for a in (b.get("attendees") or []) if isinstance(a, dict)],
            "status": b.get("status"),
        }
        for b in bookings
        if isinstance(b, dict)
    ]


async def get_upcoming_bookings(user_id: int, db) -> list[dict]:
    """Fetch confirmed upcoming bookings for the connected Cal.com user."""
    return await asyncio.to_thread(_fetch_upcoming_bookings_sync, user_id, db)


async def generate_premeeting_brief(contact: dict, dossier: dict) -> str:
    """LLM-generate a pre-meeting talking points brief. Returns markdown."""
    from utils.llm_router import agenerate, get_text

    dossier = dossier or {}
    pain_points = dossier.get("pain_points") or []
    icebreakers = dossier.get("icebreakers") or []
    recent_signals = dossier.get("recent_signals") or dossier.get("signals") or []

    context = "\n".join(filter(None, [
        f"Contact: {contact.get('contact_name', '')}",
        f"Company: {contact.get('company', '')}",
        f"Role: {contact.get('role', '')}",
        f"Industry: {contact.get('company_industry', '')}",
        f"Company Size: {contact.get('company_size', '')}",
        f"Location: {contact.get('company_location', '')}",
        f"Intent Score: {contact.get('intent_score', 0)}",
        f"LinkedIn Headline: {contact.get('linkedin_headline', '')}" if contact.get('linkedin_headline') else None,
        f"Company Description: {contact.get('company_description', '')}" if contact.get('company_description') else None,
        f"Tech Stack: {', '.join(contact.get('tech_stack') or [])}" if contact.get('tech_stack') else None,
        f"Pain Points: {'; '.join(pain_points)}" if pain_points else None,
        f"Icebreakers: {'; '.join(icebreakers)}" if icebreakers else None,
        f"Recent Signals: {'; '.join(str(s) for s in recent_signals[:5])}" if recent_signals else None,
    ]))

    system = (
        "You are an expert sales coach preparing a rep for a sales meeting. "
        "Generate a concise pre-meeting brief in Markdown with these sections:\n"
        "## Company Background\n## Pain Points\n## Recent Signals\n"
        "## Suggested Talking Points (3-5 bullets)\n"
        "## Likely Objections + How to Respond\n## Recommended Ask / CTA\n\n"
        "Keep it concise, actionable, and specific. No fluff."
    )

    try:
        resp = await agenerate(
            role="drafter",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": f"Contact context:\n{context}"},
            ],
            temperature=0.3,
            max_tokens=1500,
        )
        return get_text(resp).strip()
    except Exception as e:
        logger.error(f"Pre-meeting brief generation failed: {e}")
        return (
            f"## Pre-Meeting Brief: {contact.get('contact_name', 'Contact')}\n\n"
            f"**Company:** {contact.get('company', '')} | **Role:** {contact.get('role', '')}\n"
            f"**Intent Score:** {contact.get('intent_score', 0)}\n\n"
            f"### Pain Points\n" + "\n".join(f"- {p}" for p in pain_points) +
            "\n\n### Icebreakers\n" + "\n".join(f"- {ic}" for ic in icebreakers) +
            "\n\n*Brief generation failed — showing available data only.*"
        )
