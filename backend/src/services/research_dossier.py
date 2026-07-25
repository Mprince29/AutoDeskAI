"""
Research Dossier Generator

Synthesizes all available intelligence about a contact + company into a
structured research brief used to power hyper-personalized outreach.

Dossier schema (stored as JSON in SalesContact.dossier):
  {
    "company_overview":    str — what they do, stage, size, market
    "tech_stack":         [str] — detected tools / integrations
    "buying_signals":     [str] — top signals with dates (human-readable)
    "pain_points":        [str] — inferred challenges for this role/company
    "outreach_angles":    [str] — 3 personalized opening hooks
    "icebreakers":        [str] — conversation starters based on news/signals
    "competitive_context": str  — relevant competitive landscape (if known)
    "confidence":          str  — "high" | "medium" | "low" (data coverage)
    "generated_at":        str  — ISO timestamp
  }
"""
import asyncio
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from loguru import logger

from utils.llm_router import agenerate, get_text


# ─────────────────────────────────────────────────────────────────────────────
# Helper: fetch a URL silently
# ─────────────────────────────────────────────────────────────────────────────

def _safe_get(url: str, timeout: int = 8) -> Optional[str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
            "Accept": "text/html,application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read(40_000).decode("utf-8", errors="ignore")
    except Exception as e:
        logger.debug(f"_safe_get failed {url}: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Company description from multiple free sources
# ─────────────────────────────────────────────────────────────────────────────

_META_RE = re.compile(
    r'<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\'][^>]+content=["\']([^"\']{15,400})',
    re.I,
)


def _description_from_html(html: str) -> Optional[str]:
    m = _META_RE.search(html)
    return m.group(1).strip() if m else None


async def _fetch_company_description(domain: Optional[str], company: str) -> Optional[str]:
    """Try Clearbit → Wikipedia → homepage in sequence."""
    # 1. Clearbit Autocomplete (free)
    if domain:
        clean = domain.replace("http://", "").replace("https://", "").split("/")[0]
        try:
            raw = await asyncio.to_thread(
                _safe_get,
                f"https://autocomplete.clearbit.com/v1/companies/suggest?query={urllib.parse.quote(clean)}",
            )
            if raw:
                data = json.loads(raw)
                for item in (data if isinstance(data, list) else []):
                    if clean in (item.get("domain") or ""):
                        desc = item.get("description")
                        if desc and len(desc) > 20:
                            return desc
        except Exception:
            pass

    # 2. Wikipedia summary API (free, no key)
    try:
        wiki_query = urllib.parse.quote(company.replace(" ", "_"))
        raw = await asyncio.to_thread(
            _safe_get,
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{wiki_query}",
            timeout=8,
        )
        if raw:
            data = json.loads(raw)
            if data.get("type") == "standard" and data.get("extract"):
                return data["extract"][:500]
    except Exception:
        pass

    # 3. Homepage meta description
    if domain:
        clean = domain.replace("http://", "").replace("https://", "").split("/")[0]
        html = await asyncio.to_thread(_safe_get, f"https://{clean}", timeout=10)
        if html:
            desc = _description_from_html(html)
            if desc:
                return desc

    return None


# ─────────────────────────────────────────────────────────────────────────────
# LinkedIn public profile page (no login needed for basic info)
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_linkedin_context(linkedin_url: Optional[str], contact_name: str, company: str) -> Optional[str]:
    """
    Scrape a LinkedIn public profile page for headline and about snippet.
    LinkedIn often blocks bots, but the first ~8KB usually contains structured data.
    """
    if not linkedin_url:
        return None
    raw = await asyncio.to_thread(_safe_get, linkedin_url, timeout=12)
    if not raw:
        return None

    # Extract JSON-LD or og:description
    jsonld_re = re.compile(r'<script type="application/ld\+json">(\{.*?})</script>', re.S)
    m = jsonld_re.search(raw)
    if m:
        try:
            data = json.loads(m.group(1))
            desc = data.get("description") or data.get("jobTitle")
            if desc:
                return str(desc)[:400]
        except Exception:
            pass

    og_re = re.compile(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']{10,300})', re.I)
    m = og_re.search(raw)
    if m:
        return m.group(1).strip()

    return None


# ─────────────────────────────────────────────────────────────────────────────
# LLM dossier synthesis
# ─────────────────────────────────────────────────────────────────────────────

_DOSSIER_SYSTEM = """You are an elite B2B sales researcher. You synthesize raw intelligence about
a prospect and company into a precise, actionable research dossier. Every claim must be grounded
in the provided data. If data is missing for a section, use an empty list or empty string.
Output ONLY valid JSON — no markdown fences, no commentary."""

_DOSSIER_PROMPT = """
Contact: {contact_name}
Title: {role}
Company: {company}
Domain: {domain}
Company Size: {company_size}
Industry: {industry}
Location: {location}
LinkedIn: {linkedin_url}

Company Description:
{description}

Tech Stack Detected: {tech_stack}

Recent Buying Signals / News:
{signals_text}

LinkedIn Context:
{linkedin_context}

Based on all the above intelligence, produce a JSON dossier with exactly these keys:

{{
  "company_overview": "2-3 sentence summary: what they do, their market position, stage",
  "tech_stack": ["list", "of", "tools"],
  "buying_signals": ["Top signal 1 (date if known)", "Top signal 2", "Top signal 3"],
  "notable_clients": ["Client or brand name they are known to serve, if inferable from description or signals — else empty list"],
  "recent_campaigns": ["A specific campaign, initiative, or product launch they ran recently, if mentioned in signals/news — else empty list"],
  "awards": ["Any award, recognition, or ranking mentioned in signals/description — else empty list"],
  "pain_points": [
    "Specific pain point 1 that a {role} at a {company_size} {industry} company typically faces",
    "Pain point 2 grounded in their tech stack or growth stage",
    "Pain point 3"
  ],
  "outreach_angles": [
    "Hook 1: reference a specific campaign they ran OR a client they serve OR a recent award",
    "Hook 2: tie their tech stack or hiring signal to a concrete problem you solve",
    "Hook 3: connect their growth stage or funding event to an outcome you can deliver"
  ],
  "icebreakers": [
    "Specific conversation starter referencing a campaign, client, award, or news item — be precise",
    "Second icebreaker"
  ],
  "competitive_context": "Brief note on who they likely already use or evaluate (based on tech stack / industry)",
  "confidence": "high|medium|low"
}}

Return ONLY the JSON object. No markdown, no explanation.
"""

_DOSSIER_KEYS = [
    "company_overview",
    "tech_stack",
    "buying_signals",
    "notable_clients",
    "recent_campaigns",
    "awards",
    "pain_points",
    "outreach_angles",
    "icebreakers",
    "competitive_context",
    "confidence",
]


def _extract_json_object(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    start, end = text.find("{"), text.rfind("}") + 1
    if start != -1 and end > start:
        return text[start:end]
    return text


def _truncation_repair(text: str) -> Optional[dict]:
    """
    Best-effort repair for JSON truncated mid-stream.
    Extracts all fully-parsed top-level keys and fills missing ones with defaults.
    """
    text = _extract_json_object(text)
    result: dict = {}
    # Try parsing key by key using regex for string/array values
    # Extract string values
    for m in re.finditer(r'"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"', text):
        result[m.group(1)] = m.group(2)
    # Extract array values (only if fully closed)
    for m in re.finditer(r'"(\w+)"\s*:\s*(\[(?:[^\[\]]|\[(?:[^\[\]])*\])*\])', text):
        try:
            result[m.group(1)] = json.loads(m.group(2))
        except Exception:
            pass
    return result if result else None


def _normalise_dossier_shape(data: dict) -> dict:
    def _strs(key: str) -> list[str]:
        return [str(x).strip() for x in (data.get(key) or []) if str(x).strip()]
    return {
        "company_overview": str(data.get("company_overview") or "").strip(),
        "tech_stack": _strs("tech_stack"),
        "buying_signals": _strs("buying_signals"),
        "notable_clients": _strs("notable_clients"),
        "recent_campaigns": _strs("recent_campaigns"),
        "awards": _strs("awards"),
        "pain_points": _strs("pain_points"),
        "outreach_angles": _strs("outreach_angles"),
        "icebreakers": _strs("icebreakers"),
        "competitive_context": str(data.get("competitive_context") or "").strip(),
        "confidence": str(data.get("confidence") or "low").strip().lower() or "low",
    }


async def _repair_dossier_json(raw_text: str, user_id=None, db=None) -> dict:
    repair_prompt = f"""Repair this malformed JSON into a valid JSON object.

Keep the same meaning, preserve the same schema, and return ONLY valid JSON
with these keys: {", ".join(_DOSSIER_KEYS)}.

Malformed JSON:
{raw_text}
"""
    resp = await agenerate(
        role="drafter",
        messages=[
            {"role": "system", "content": "You repair malformed JSON. Return only valid JSON."},
            {"role": "user", "content": repair_prompt},
        ],
        temperature=0,
        max_tokens=1500,
        response_format="json_object",
        user_id=user_id,
        db=db,
    )
    repaired = _extract_json_object(get_text(resp))
    return _normalise_dossier_shape(json.loads(repaired))


async def generate_contact_dossier(
    contact_name: str,
    role: Optional[str],
    company: str,
    domain: Optional[str],
    contact_email: Optional[str],
    linkedin_url: Optional[str],
    company_size: Optional[str],
    company_industry: Optional[str],
    company_location: Optional[str],
    tech_stack: Optional[list[str]],
    signals: list[dict],
    existing_description: Optional[str] = None,
    user_id: Optional[int] = None,
    db=None,
) -> dict:
    """
    Gather all available intelligence and synthesize a research dossier via LLM.
    Returns the dossier as a dict, ready to store in SalesContact.dossier.
    """
    # Fetch supplementary context in parallel
    async def _passthrough():
        return existing_description

    desc_coro = _passthrough() if existing_description else _fetch_company_description(domain, company)
    desc_task = asyncio.create_task(desc_coro)
    li_task = asyncio.create_task(_fetch_linkedin_context(linkedin_url, contact_name, company))

    description, linkedin_context = await asyncio.gather(
        desc_task, li_task, return_exceptions=True
    )

    if isinstance(description, Exception) or description is None:
        description = ""
    if isinstance(linkedin_context, Exception) or linkedin_context is None:
        linkedin_context = "Not available"

    # Format signals for prompt
    signal_lines = []
    for s in (signals or [])[:15]:
        meta = s.get("metadata") or s
        title = meta.get("title") or s.get("title") or ""
        stype = s.get("type", "")
        date = meta.get("published_at") or s.get("published_at") or ""
        date_str = f" ({date[:10]})" if date else ""
        signal_lines.append(f"[{stype}] {title}{date_str}")
    signals_text = "\n".join(signal_lines) if signal_lines else "No signals collected yet."

    prompt = _DOSSIER_PROMPT.format(
        contact_name=contact_name,
        role=role or "Decision Maker",
        company=company,
        domain=domain or "unknown",
        company_size=company_size or "unknown",
        industry=company_industry or "unknown",
        location=company_location or "unknown",
        linkedin_url=linkedin_url or "not available",
        description=description or "Not found",
        tech_stack=", ".join(tech_stack) if tech_stack else "Not detected",
        signals_text=signals_text,
        linkedin_context=linkedin_context,
    )

    try:
        resp = await agenerate(
            role="drafter",
            messages=[
                {"role": "system", "content": _DOSSIER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=2500,
            response_format="json_object",
            user_id=user_id,
            db=db,
        )
        text = _extract_json_object(get_text(resp))
        dossier = _normalise_dossier_shape(json.loads(text))
    except Exception as e:
        logger.warning(f"Dossier LLM parse failed for {contact_name} @ {company}: {e}")
        raw_text = get_text(resp) if 'resp' in locals() else ""
        # Try lightweight truncation repair first (no extra LLM call)
        partial = _truncation_repair(raw_text)
        if partial and any(partial.get(k) for k in ("company_overview", "pain_points", "outreach_angles")):
            logger.info(f"Dossier truncation repair succeeded for {contact_name}")
            dossier = _normalise_dossier_shape(partial)
        else:
            try:
                dossier = await _repair_dossier_json(raw_text, user_id=user_id, db=db)
            except Exception as repair_exc:
                logger.warning(f"Dossier repair failed for {contact_name} @ {company}: {repair_exc}")
                dossier = {
                    "company_overview": description[:300] if description else f"{company} — description not available.",
                    "tech_stack": tech_stack or [],
                    "buying_signals": [s.get("title", "") for s in signals[:3]],
                    "pain_points": [],
                    "outreach_angles": [],
                    "icebreakers": [],
                    "competitive_context": "",
                    "confidence": "low",
                }

    dossier["generated_at"] = datetime.now(timezone.utc).isoformat()
    return dossier
