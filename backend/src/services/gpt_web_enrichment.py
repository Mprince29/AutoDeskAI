"""
GPT Web-Search Lead Enrichment
Uses OpenAI gpt-4o-search-preview to fill in missing lead data:
  company, role, domain, company_size, company_industry,
  company_location, company_description

Called after the initial SerpAPI LinkedIn search returns raw leads.
Each lead is enriched independently; results are yielded as they arrive
so the frontend can stream-update the UI row by row.
"""
import asyncio
import json
import os
import re
from typing import AsyncIterator, Optional

from loguru import logger


_SYSTEM_PROMPT = """You are a B2B sales research assistant.
Given a LinkedIn lead's name, headline, and URL, research and return structured JSON with:
- company: current company name (string or null)
- role: current job title (string or null)
- domain: company website domain like "acme.com" (string or null)
- company_size: employee range like "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+" (string or null)
- company_industry: industry (string or null)
- company_location: city, state, country (string or null)
- company_description: one sentence about what the company does (string or null)
- contact_email: person's professional email address if publicly listed anywhere (string or null)
- twitter_handle: their Twitter/X handle without @ (string or null)
- phone: publicly listed phone number (string or null)

Rules:
- Use only verifiable public information (company website, Twitter bio, personal site, press mentions)
- Return ONLY valid JSON, no markdown
- Use null for any field you cannot confidently determine
- For domain: return just the domain (no https:// or www.)
- For contact_email: only return if found on a public webpage — do NOT guess patterns"""


def _build_prompt(lead: dict) -> str:
    name = lead.get("contact_name", "")
    headline = lead.get("linkedin_headline") or lead.get("role") or ""
    url = lead.get("linkedin_url", "")
    company = lead.get("company", "") or ""
    return (
        f'Research this LinkedIn lead and return structured JSON:\n\n'
        f'Name: {name}\n'
        f'LinkedIn URL: {url}\n'
        f'Headline/Snippet: {headline}\n'
        f'Known company: {company or "unknown"}\n\n'
        f'Return JSON with: company, role, domain, company_size, company_industry, '
        f'company_location, company_description, contact_email, twitter_handle, phone'
    )


def _needs_enrichment(lead: dict) -> bool:
    """Return True if this lead is missing any enrichable field."""
    missing_company = not all([
        lead.get("company"),
        lead.get("domain"),
        lead.get("company_industry"),
        lead.get("company_location"),
    ])
    missing_contact = not any([
        lead.get("contact_email"),
        lead.get("twitter_handle"),
        lead.get("phone"),
    ])
    return missing_company or missing_contact


def _parse_gpt_response(text: str) -> Optional[dict]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text, flags=re.MULTILINE).strip()
    text = re.sub(r"```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


async def _enrich_single_lead(lead: dict, client) -> dict:
    """
    Call GPT web search for one lead. Returns a dict of fields to merge.
    Never raises — returns {} on any failure.
    """
    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="gpt-4o-search-preview",
            web_search_options={},
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_prompt(lead)},
            ],
        )
        raw = response.choices[0].message.content or ""
        parsed = _parse_gpt_response(raw)
        if not parsed:
            logger.debug(f"GPT enrichment: unparseable response for {lead.get('contact_name')}")
            return {}

        # Only keep fields that were actually null/empty in the original lead
        updates: dict = {}
        field_map = {
            "company": "company",
            "role": "role",
            "domain": "domain",
            "company_size": "company_size",
            "company_industry": "company_industry",
            "company_location": "company_location",
            "company_description": "company_description",
            "contact_email": "contact_email",
            "twitter_handle": "twitter_handle",
            "phone": "phone",
        }
        for gpt_key, lead_key in field_map.items():
            val = parsed.get(gpt_key)
            if val and not lead.get(lead_key):
                updates[lead_key] = val

        # Validate any email GPT returned — reject hallucinated addresses
        if updates.get("contact_email"):
            try:
                from services.lead_enrichment import verify_email
                status = await verify_email(updates["contact_email"])
                if status == "invalid":
                    logger.debug(f"GPT email rejected (invalid): {updates['contact_email']}")
                    del updates["contact_email"]
                else:
                    updates["email_verified"] = status
                    logger.info(f"GPT email verified ({status}): {updates['contact_email']}")
            except Exception:
                pass

        # Fall back to Hunter email finder if GPT didn't find a valid email and we have a domain
        domain = updates.get("domain") or lead.get("domain")
        if domain and not updates.get("contact_email") and not lead.get("contact_email"):
            try:
                from services.lead_enrichment import _hunter_email_finder, verify_email
                name = lead.get("contact_name", "")
                parts = name.strip().split()
                first = parts[0] if parts else ""
                last = parts[-1] if len(parts) > 1 else ""
                if first and last:
                    email = await asyncio.to_thread(
                        _hunter_email_finder, first, last, domain=domain
                    )
                    if email:
                        status = await verify_email(email)
                        if status != "invalid":
                            updates["contact_email"] = email
                            updates["email_verified"] = status
                            logger.info(f"Hunter email ({status}) for {name}: {email}")
            except Exception as e:
                logger.debug(f"Hunter email lookup failed for {lead.get('contact_name')}: {e}")

        logger.info(f"GPT enriched {lead.get('contact_name')}: {list(updates.keys())}")
        return updates

    except Exception as e:
        logger.warning(f"GPT enrichment failed for {lead.get('contact_name')}: {e}")
        return {}


async def enrich_leads_stream(leads: list[dict]) -> AsyncIterator[dict]:
    """
    Async generator — yields enrichment result dicts as each lead is processed.
    Each yielded dict: { "index": int, "updates": {...} }
    Leads that don't need enrichment are yielded immediately with empty updates.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.warning("OPENAI_API_KEY not set — skipping GPT web enrichment")
        for i in range(len(leads)):
            yield {"index": i, "updates": {}}
        return

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    # Enrich all leads concurrently (max 5 at a time to stay within rate limits)
    sem = asyncio.Semaphore(5)

    async def _bounded(i: int, lead: dict):
        async with sem:
            if not _needs_enrichment(lead):
                logger.debug(f"GPT enrichment skipped (already complete): {lead.get('contact_name')}")
                return i, {}
            logger.info(f"GPT enriching: {lead.get('contact_name')} (missing fields)")
            updates = await _enrich_single_lead(lead, client)
            return i, updates

    tasks = [asyncio.create_task(_bounded(i, lead)) for i, lead in enumerate(leads)]

    # Yield results as they complete
    for coro in asyncio.as_completed(tasks):
        i, updates = await coro
        yield {"index": i, "updates": updates}
