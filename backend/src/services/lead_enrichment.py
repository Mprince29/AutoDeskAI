"""
Lead Enrichment Service — multi-source waterfall pipeline:

  find_leads()           → LLM parses natural-language ICP → SerpAPI LinkedIn search
                            → email verification → ICP match scoring
  enrich_contact()       → PDL company firmographics
                            → Clearbit free company enrichment
                            → Company website scraping (description, tech hints)
                            → Email pattern generation + MX-verified guessing (6 patterns)
                            → Hunter domain search (email format detection)
                            → SerpAPI news → buying signal classification
                            → Email verification

Env vars:  PDL_API_KEY, SERPAPI_API_KEY, HUNTER_API_KEY
           BUILTWITH_API_KEY (optional — tech stack detection)
"""
import asyncio
import json
import os
import re
import socket
import urllib.parse
import urllib.request
from typing import Optional

from loguru import logger

from utils.llm_router import agenerate, get_text


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────────────────

def _http_post(url: str, payload: dict, headers: dict, timeout: int = 15) -> Optional[dict]:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.warning(f"POST {url} failed: {e}")
        return None


def _http_get(url: str, headers: dict | None = None, timeout: int = 12) -> Optional[dict]:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.warning(f"GET {url} failed: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# ICP natural language → structured filters (LLM)
# ─────────────────────────────────────────────────────────────────────────────

# Keywords that describe intent/timing signals — meaningful for scoring but useless in a LinkedIn search query
_INTENT_KEYWORD_RE = re.compile(
    r"\b(series\s+[a-e]|seed|pre-seed|post-seed|ipo|rais(ed|es|ing)|funding|invest(ed|or|ment)|"
    r"recently|just|new(ly)?|launch(ed)?|hiring|growing|scaling|expand(ing)?)\b",
    re.I,
)
_NOISY_KEYWORD_RE = re.compile(r"\b(compan(?:y|ies)|businesses|firms|startups?)\b", re.I)

# Human-readable size labels used for ICP scoring
_SIZE_MAP = {
    "1-10": "1-10", "2-10": "1-10", "seed": "1-10",
    "11-50": "11-50", "startup": "11-50", "small": "11-50",
    "51-200": "51-200", "mid": "51-200",
    "201-500": "201-500", "midmarket": "201-500",
    "501-1000": "501-1000",
    "1001-5000": "1001-5000", "enterprise": "1001-5000",
    "5000+": "5000+", "large": "5000+",
}


def _dedupe_preserve(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        value = (item or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


async def parse_icp_to_filters(icp_description: str, product_description: str = "") -> dict:
    """
    Uses LLM to convert a natural-language ICP description into structured
    search filters used for SerpAPI LinkedIn queries and ICP scoring.
    If product_description is provided it is used to sharpen keyword and industry targeting.
    """
    product_context = ""
    if product_description:
        product_context = f'\nProduct being sold: "{product_description}"\nUse this to refine which industries, job titles, and keywords are most relevant.'

    prompt = f"""Convert this Ideal Customer Profile description into structured search filters.

ICP: "{icp_description}"{product_context}

Rules:
- job_titles: specific job title strings (e.g. "VP of Sales", "Head of Marketing")
- seniority_levels: e.g. "founder", "c_suite", "vp", "director", "manager"
- industries: free-text industry names (e.g. "SaaS", "FinTech", "Healthcare")
- locations: city/state/country names
- company_sizes: use labels like "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"
- keywords: any other relevant keywords (product type, vertical, tech stack etc.)

Respond with ONLY valid JSON, no markdown:
{{"job_titles":[],"seniority_levels":[],"industries":[],"locations":[],"company_sizes":[],"keywords":[]}}"""

    _EMPTY: dict = {
        "job_titles": [], "seniority_levels": [], "industries": [],
        "locations": [], "company_sizes": [], "keywords": [],
    }
    try:
        resp = await agenerate(
            role="classifier",
            messages=[
                {"role": "system", "content": "You are an expert sales data analyst. Output only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=1200,
        )
        text = get_text(resp).strip()
        # Strip markdown fences
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        # Extract outermost JSON object
        start = text.find("{"); end = text.rfind("}")
        if start != -1 and end > start:
            text = text[start:end + 1]
        # Fix common truncation: if JSON is cut off, close open arrays/object
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            # Attempt to repair: remove trailing partial token and close structure
            text = re.sub(r',\s*"[^"]*$', '', text)  # remove last incomplete key
            text = re.sub(r',\s*$', '', text)          # remove trailing comma
            # Close unclosed arrays and the object
            open_arrays = text.count('[') - text.count(']')
            text += ']' * max(open_arrays, 0) + '}'
            parsed = json.loads(text)
        filters = {**_EMPTY, **{k: (v if isinstance(v, list) else []) for k, v in parsed.items() if k in _EMPTY}}
        # Drop noisy keywords
        filters["keywords"] = [
            kw for kw in _dedupe_preserve(filters["keywords"])
            if not _INTENT_KEYWORD_RE.search(kw) and not _NOISY_KEYWORD_RE.fullmatch(kw.strip())
        ][:6]
        logger.info(f"ICP parsed: {filters}")
        return filters
    except Exception as e:
        logger.warning(f"ICP parse failed ({e}) — returning empty filters")
        return _EMPTY


# ─────────────────────────────────────────────────────────────────────────────
# SerpAPI LinkedIn people search
# ─────────────────────────────────────────────────────────────────────────────

# Map common location strings to Google country codes for accurate gl= param
_LOCATION_GL_MAP = {
    "india": "in", "bangalore": "in", "mumbai": "in", "delhi": "in", "hyderabad": "in",
    "chennai": "in", "pune": "in",
    "united states": "us", "usa": "us", "us": "us", "new york": "us", "san francisco": "us",
    "california": "us", "texas": "us", "florida": "us",
    "united kingdom": "gb", "uk": "gb", "london": "gb", "england": "gb",
    "canada": "ca", "toronto": "ca", "vancouver": "ca",
    "australia": "au", "sydney": "au", "melbourne": "au",
    "germany": "de", "berlin": "de", "munich": "de",
    "france": "fr", "paris": "fr",
    "singapore": "sg",
    "dubai": "ae", "uae": "ae", "united arab emirates": "ae",
    "netherlands": "nl", "amsterdam": "nl",
    "brazil": "br", "são paulo": "br",
    "israel": "il", "tel aviv": "il",
}


def _infer_gl(locations: list[str]) -> str:
    """Infer the best Google country code from location filters."""
    for loc in locations:
        key = loc.lower().strip()
        if key in _LOCATION_GL_MAP:
            return _LOCATION_GL_MAP[key]
        for k, v in _LOCATION_GL_MAP.items():
            if k in key or key in k:
                return v
    return "us"


def _parse_linkedin_results(items: list[dict], seen_urls: set) -> list[dict]:
    """Parse SerpAPI organic_results into lead dicts, deduplicating by LinkedIn URL."""
    raw = []
    for item in items:
        link = item.get("link", "")
        title = item.get("title", "")
        snippet = item.get("snippet", "")

        if "linkedin.com/in/" not in link:
            continue
        profile_url = link.split("?")[0].rstrip("/")
        if profile_url in seen_urls:
            continue
        seen_urls.add(profile_url)

        name, role, company = "", "", ""
        # Strip "| LinkedIn" suffix and common variations
        title_clean = re.sub(r"\s*[-–|]\s*LinkedIn.*$", "", title, flags=re.IGNORECASE).strip()
        # Try "Name - Role at Company" pattern
        if " - " in title_clean:
            name_part, rest = title_clean.split(" - ", 1)
            name = name_part.strip()
            if " at " in rest:
                role_part, company_part = rest.rsplit(" at ", 1)
                role = role_part.strip()
                company = company_part.strip()
            else:
                role = rest.strip()
        # Try "Name | Role at Company" pattern
        elif " | " in title_clean:
            parts = title_clean.split(" | ", 1)
            name = parts[0].strip()
            rest = parts[1] if len(parts) > 1 else ""
            if " at " in rest:
                role_part, company_part = rest.rsplit(" at ", 1)
                role = role_part.strip()
                company = company_part.strip()
            else:
                role = rest.strip()
        else:
            name = title_clean

        # Reject obviously bad names (too long, contains URL fragments, etc.)
        if not name or len(name) > 60 or "/" in name:
            continue

        raw.append({
            "contact_name": name,
            "contact_email": None,
            "role": role or None,
            "company": company or "",
            "linkedin_url": profile_url,
            "linkedin_headline": snippet[:300] if snippet else None,
            "domain": None,
            "company_size": None,
            "company_industry": None,
            "company_location": None,
            "_source": "serpapi_linkedin",
        })
    return raw


def _run_serpapi_query(query: str, api_key: str, gl: str = "us", start: int = 0) -> list[dict]:
    """Execute a single SerpAPI Google search and return organic_results."""
    params: dict = {
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "num": 10,
        "hl": "en",
        "gl": gl,
    }
    if start:
        params["start"] = start
    try:
        req = urllib.request.Request(
            f"https://serpapi.com/search.json?{urllib.parse.urlencode(params)}",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read()).get("organic_results", [])
    except Exception as e:
        logger.warning(f"SerpAPI query failed ({query!r} start={start}): {e}")
        return []


def _build_linkedin_queries(
    job_titles: list[str],
    industries: list[str],
    locations: list[str],
    keywords: list[str],
) -> list[str]:
    """
    Build a diverse set of Google queries targeting LinkedIn profiles.
    Strategy:
      - One query per job title (up to 4) to get fresh result sets
      - Industry + location added as separate quoted terms (not OR-grouped)
        so Google treats each as an independent filter
      - Extra keyword appended where available
    """
    # Use first industry and first location as the primary anchor terms
    industry = f'"{industries[0]}"' if industries else ""
    location = f'"{locations[0]}"' if locations else ""
    kw = f'"{keywords[0]}"' if keywords else ""

    titles = job_titles[:6] if job_titles else [""]
    queries: list[str] = []
    for title in titles:
        parts = ["site:linkedin.com/in"]
        if title:
            parts.append(f'"{title}"')
        if industry:
            parts.append(industry)
        if location:
            parts.append(location)
        if kw:
            parts.append(kw)
        queries.append(" ".join(parts))

    # Add a second-location query if multiple locations provided
    if len(locations) > 1:
        loc2 = f'"{locations[1]}"'
        title = f'"{titles[0]}"' if titles[0] else ""
        parts = ["site:linkedin.com/in"]
        if title:
            parts.append(title)
        if industry:
            parts.append(industry)
        parts.append(loc2)
        queries.append(" ".join(parts))

    # Add a second-industry variation for broader coverage
    if len(industries) > 1:
        ind2 = f'"{industries[1]}"'
        title = f'"{titles[0]}"' if titles[0] else ""
        parts = ["site:linkedin.com/in"]
        if title:
            parts.append(title)
        parts.append(ind2)
        if location:
            parts.append(location)
        queries.append(" ".join(parts))

    # Keyword-only sweep to catch profiles that don't mention the exact title
    if keywords and job_titles:
        for kw_extra in keywords[1:3]:
            parts = ["site:linkedin.com/in", f'"{kw_extra}"']
            if industry:
                parts.append(industry)
            if location:
                parts.append(location)
            queries.append(" ".join(parts))

    return queries


def _serpapi_linkedin_search(
    job_titles: list[str],
    industries: list[str],
    locations: list[str],
    keywords: list[str],
    limit: int = 25,
) -> list[dict]:
    """
    Runs multiple SerpAPI queries in parallel (one per title + pagination)
    with correct country code (gl) derived from the location filters.
    Results are deduplicated by LinkedIn profile URL.
    """
    api_key = os.getenv("SERPAPI_API_KEY") or os.getenv("SERPAPI_KEY")
    if not api_key:
        logger.warning("SERPAPI_API_KEY not set — skipping LinkedIn search")
        return []

    gl = _infer_gl(locations)
    queries = _build_linkedin_queries(job_titles, industries, locations, keywords)

    # Build full job list: page 1 for all queries, then round-robin additional pages
    # until we have enough jobs to potentially satisfy the limit.
    # SerpAPI Google returns max 10 results per page (start=0,10,20,...,90 → up to 100 per query).
    results_per_page = 10
    jobs: list[tuple[str, int]] = [(q, 0) for q in queries]
    page_start = 10
    while len(jobs) * results_per_page < limit and page_start < 100:
        for q in queries:
            if len(jobs) * results_per_page >= limit:
                break
            jobs.append((q, page_start))
        page_start += 10

    logger.info(f"SerpAPI: {len(jobs)} queries, gl={gl}, targeting ~{limit} leads")

    seen_urls: set = set()
    raw: list[dict] = []

    for query, start in jobs:
        if len(raw) >= limit:
            break
        logger.info(f"  query: {query!r} start={start}")
        items = _run_serpapi_query(query, api_key, gl=gl, start=start)
        batch = _parse_linkedin_results(items, seen_urls)
        raw.extend(batch)
        logger.info(f"  → {len(batch)} new leads (running total {len(raw)})")

    logger.info(f"SerpAPI LinkedIn search: {len(raw)} unique profiles from {len(jobs)} queries")
    return raw[:limit]


async def _llm_extract_companies(leads: list[dict]) -> list[dict]:
    """
    Use LLM to extract company + role from LinkedIn headline text
    when the standard "Role at Company" pattern failed.
    Returns the same list with company/role filled where possible.
    """
    if not leads:
        return leads

    # Cap batch size to keep token usage under control and avoid truncation
    chunk_size = 20
    for chunk_start in range(0, len(leads), chunk_size):
        chunk = leads[chunk_start:chunk_start + chunk_size]
        chunk_items = "\n".join(
            f'{chunk_start+i+1}. name="{r["contact_name"]}" headline="{r["linkedin_headline"] or r["role"] or ""}"'
            for i, r in enumerate(chunk)
        )
        chunk_prompt = f"""Extract the current company name and job title for each person from their LinkedIn headline.
Return ONLY a JSON array (no markdown) with objects: {{"idx": 1, "company": "...", "role": "..."}}
Use null for company/role if genuinely unknown. Do not guess or invent data.

{chunk_items}"""
        try:
            resp = await agenerate(
                role="classifier",
                messages=[{"role": "user", "content": chunk_prompt}],
                max_tokens=1500,
                temperature=0,
            )
            text = get_text(resp).strip()
            text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
            # Extract JSON array
            start = text.find("["); end = text.rfind("]")
            if start != -1 and end > start:
                text = text[start:end + 1]
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                # Repair truncated array: remove last incomplete object and close
                text = re.sub(r',?\s*\{[^}]*$', '', text) + ']'
                parsed = json.loads(text)
            for item in parsed:
                idx = int(item.get("idx", 0)) - 1
                if 0 <= idx < len(leads):
                    if item.get("company"):
                        leads[idx]["company"] = item["company"]
                    if item.get("role") and not leads[idx]["role"]:
                        leads[idx]["role"] = item["role"]
        except Exception as e:
            logger.debug(f"LLM company extraction failed (chunk {chunk_start}): {e}")
    return leads


# ─────────────────────────────────────────────────────────────────────────────
# Email verification
# ─────────────────────────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")

_DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
    "yopmail.com", "10minutemail.com", "trashmail.com", "sharklasers.com",
}


def _verify_email_local(email: str) -> str:
    """
    Free local verification: regex + disposable domain check + MX record lookup.
    Returns: "valid" | "risky" | "invalid"
    """
    if not email or not _EMAIL_RE.match(email):
        return "invalid"

    domain = email.split("@")[-1].lower()

    if domain in _DISPOSABLE_DOMAINS:
        return "invalid"

    # MX record check via DNS
    try:
        socket.getaddrinfo(domain, None)
        # If DNS resolves, domain exists; assume risky (can't SMTP verify without sending)
        return "risky"
    except socket.gaierror:
        return "invalid"


def _verify_email_hunter(email: str) -> Optional[str]:
    """
    Hunter.io email verifier — uses credits only when Hunter key is set.
    Returns: "valid" | "risky" | "invalid" | None (if no key or API error)
    Hunter statuses: "valid", "invalid", "accept_all", "unknown" → map to our 3-tier
    """
    api_key = os.getenv("HUNTER_API_KEY")
    if not api_key or not email:
        return None

    params = urllib.parse.urlencode({"email": email, "api_key": api_key})
    data = _http_get(f"https://api.hunter.io/v2/email-verifier?{params}")
    if not data:
        return None

    result = (data.get("data") or {})
    status = result.get("status", "unknown")
    score = result.get("score", 0)  # 0-100

    if status == "valid" or score >= 70:
        return "valid"
    if status in ("accept_all", "unknown") or score >= 40:
        return "risky"
    return "invalid"


async def verify_email(email: str) -> str:
    """
    Verify a single email address. Tries Hunter first (if key set), falls back to local check.
    Returns: "valid" | "risky" | "invalid"
    """
    if not email:
        return "invalid"

    hunter_result = await asyncio.to_thread(_verify_email_hunter, email)
    if hunter_result:
        return hunter_result

    return await asyncio.to_thread(_verify_email_local, email)


# ─────────────────────────────────────────────────────────────────────────────
# ICP match scoring
# ─────────────────────────────────────────────────────────────────────────────

_AI_ANALYTICS_KEYWORDS = {
    "ai", "ml", "machine learning", "data science", "analytics",
    "automation", "digital transformation", "chief data", "chief ai",
    "chief digital",
}

# Map company_size bucket → approximate revenue tier (0=no fit, 1=poor, 2=ok, 3=good)
_SIZE_REVENUE_FIT: dict[str, int] = {
    "1-10": 1,
    "11-50": 2,
    "51-200": 3,
    "201-500": 3,
    "500-1000": 2,
    "501-1000": 2,
    "1001-5000": 2,
    "5000+": 1,
    "enterprise": 1,
    "startup": 2,
    "small": 2,
    "mid": 3,
    "midmarket": 3,
}


def score_icp_match(lead: dict, icp_filters: dict) -> int:
    """
    Score a lead 0–100 against ICP filters.

    Weights:
      job title match           30
      seniority match           20
      industry match            20
      location match            15
      company size match        15
      AI/analytics role bonus  +20 (capped at 100)
      revenue tier fit         +0-15 (capped at 100)
      has email bonus          +5  (capped at 100)
    """
    score = 0

    # Job title match (partial, case-insensitive)
    titles = [t.lower() for t in (icp_filters.get("job_titles") or [])]
    lead_role = (lead.get("role") or "").lower()
    if titles and lead_role:
        if any(t in lead_role or lead_role in t for t in titles):
            score += 30
        elif any(
            _title_keyword_overlap(lead_role, t) for t in titles
        ):
            score += 15

    # Seniority match
    seniority_targets = icp_filters.get("seniority_levels") or []
    if seniority_targets and lead.get("seniority") in seniority_targets:
        score += 20

    # Industry match (partial)
    industries = [i.lower() for i in (icp_filters.get("industries") or [])]
    lead_industry = (lead.get("company_industry") or "").lower()
    if industries and lead_industry:
        if any(ind in lead_industry or lead_industry in ind for ind in industries):
            score += 20

    # Location match
    locations = [loc.lower() for loc in (icp_filters.get("locations") or [])]
    lead_location = (lead.get("company_location") or "").lower()
    if locations and lead_location:
        if any(loc in lead_location or lead_location in loc for loc in locations):
            score += 15

    # Company size match
    size_ranges = icp_filters.get("company_sizes") or []
    lead_size = lead.get("company_size") or ""
    if size_ranges and lead_size:
        if lead_size in size_ranges:
            score += 15

    # AI/analytics role detection (+20)
    if lead_role:
        role_lower = lead_role.lower()
        if any(kw in role_lower for kw in _AI_ANALYTICS_KEYWORDS):
            score = min(score + 20, 100)

    # Revenue tier fit (+0/5/10/15 based on company size bucket fit)
    if lead_size:
        size_lower = lead_size.lower()
        tier_score = 0
        for bucket, tier in _SIZE_REVENUE_FIT.items():
            if bucket in size_lower or size_lower in bucket:
                tier_score = tier * 5  # 0, 5, 10, or 15
                break
        score = min(score + tier_score, 100)

    # Bonus: has email = actionable
    if lead.get("contact_email"):
        score = min(score + 5, 100)

    return min(score, 100)


def compute_combined_score(icp_score: int, intent_score: int) -> int:
    """
    Compute a combined fit+readiness score.
    Weighted blend: 60% ICP fit + 40% intent readiness.
    Both inputs expected in 0–100 range.
    Returns an integer 0–100.
    """
    icp = max(0, min(100, icp_score))
    intent = max(0, min(100, intent_score))
    return round(icp * 0.6 + intent * 0.4)


def _title_keyword_overlap(a: str, b: str) -> bool:
    """True if the two title strings share at least one meaningful keyword."""
    stop = {"of", "the", "a", "and", "or", "in", "at", "for", "to", "&"}
    words_a = {w for w in re.split(r"\W+", a) if w and w not in stop}
    words_b = {w for w in re.split(r"\W+", b) if w and w not in stop}
    return bool(words_a & words_b)


# ─────────────────────────────────────────────────────────────────────────────
# Buying signal classification from news
# ─────────────────────────────────────────────────────────────────────────────

# Keyword-based classifier — fast, no LLM credits needed
_SIGNAL_PATTERNS = [
    ("funding_round",  re.compile(r"\b(series [a-e]|seed round|raises?|funding|million|valuation|ipo|spac)\b", re.I)),
    ("hiring_signal",  re.compile(r"\b(hir(ing|es?)|recruit|job opening|talent|headcount|expand\w* team)\b", re.I)),
    # product_launch before expansion
    ("product_launch", re.compile(r"\b(launch(es|ed|ing)?|announc(es|ed|ing)|release[sd]?|unveil(s|ed)?)\b", re.I)),
    ("expansion",      re.compile(r"\b(expand(s|ed|ing)?|new market|new office|open(s|ed)? in|enter(s|ed)? market)\b", re.I)),
    ("partnership",    re.compile(r"\b(partner(s|ship)?|integrat|acqui(re|sition)|merger|strategic alliance)\b", re.I)),
]


def _classify_news_snippet(title: str, snippet: str = "") -> str:
    text = f"{title} {snippet}"
    for signal_type, pattern in _SIGNAL_PATTERNS:
        if pattern.search(text):
            return signal_type
    return "news_mention"


def _parse_news_into_signals(serpapi_results: dict, company: str) -> list[dict]:
    """
    Parse SerpAPI Google News results into structured buying signals with types.
    Returns list of signal dicts compatible with SignalEvent.
    """
    signals: list[dict] = []
    seen_titles: set[str] = set()
    seen_urls: set[str] = set()

    for topic in serpapi_results.get("news_results", [])[:10]:
        stories = topic.get("stories") or [topic]
        for story in stories:
            title = (story.get("title") or "").strip()
            link = story.get("link", "")
            if not title or "news.google.com" in link:
                continue
            title_key = title.lower()[:60]
            url_key = link.split("?")[0]
            if title_key in seen_titles or (url_key and url_key in seen_urls):
                continue
            seen_titles.add(title_key)
            if url_key:
                seen_urls.add(url_key)

            snippet = story.get("snippet", "")
            signal_type = _classify_news_snippet(title, snippet)
            signals.append({
                "type": signal_type,
                "title": title,
                "url": link,
                "snippet": snippet,
                "published_at": story.get("date", ""),
                "source": (story.get("source") or {}).get("name", "google_news"),
            })
            if len(signals) >= 8:
                return signals

    return signals


# ─────────────────────────────────────────────────────────────────────────────
# PDL company enrichment
# ─────────────────────────────────────────────────────────────────────────────

def _pdl_company_enrich(domain: str) -> dict:
    api_key = os.getenv("PDL_API_KEY")
    if not api_key or not domain:
        return {}
    params = urllib.parse.urlencode({"website": domain, "pretty": "true"})
    data = _http_get(
        f"https://api.peopledatalabs.com/v5/company/enrich?{params}",
        {"X-Api-Key": api_key},
    )
    if not data or data.get("status") == 404:
        return {}

    loc = data.get("location") or {}
    location_str = ", ".join(filter(None, [loc.get("locality"), loc.get("region"), loc.get("country")]))

    return {
        k: v for k, v in {
            "company_size": data.get("employee_count_range"),
            "company_industry": data.get("industry"),
            "company_location": location_str or None,
            "company_founded": str(data.get("founded")) if data.get("founded") else None,
        }.items() if v
    }


# ─────────────────────────────────────────────────────────────────────────────
# SerpAPI news fetch
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_serpapi_news(company: str) -> Optional[dict]:
    api_key = os.getenv("SERPAPI_API_KEY") or os.getenv("SERPAPI_KEY")
    if not api_key or not company:
        return None
    # Try exact-phrase first; fall back to unquoted for small/unknown brands
    for q_str in [f'"{company}"', company]:
        query = urllib.parse.quote(q_str)
        url = (
            f"https://serpapi.com/search.json?engine=google_news"
            f"&q={query}&api_key={api_key}&num=10&hl=en&gl=us&tbs=qdr:y"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                if data.get("news_results"):
                    return data
        except Exception as e:
            logger.debug(f"SerpAPI news failed for {company} (q={q_str!r}): {e}")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Clearbit free company enrichment (logo + description, no key required)
# ─────────────────────────────────────────────────────────────────────────────

def _clearbit_company(domain: str) -> dict:
    """
    Clearbit Autocomplete API — free, no key.
    Returns partial firmographic data: name, description, tags.
    """
    if not domain:
        return {}
    clean = domain.replace("http://", "").replace("https://", "").split("/")[0]
    url = f"https://autocomplete.clearbit.com/v1/companies/suggest?query={urllib.parse.quote(clean)}"
    try:
        data = _http_get(url, timeout=8)
        if not data or not isinstance(data, list):
            return {}
        for company in data:
            if isinstance(company, dict) and clean in (company.get("domain") or ""):
                return {
                    "company_description": company.get("description") or None,
                    "company_logo": company.get("logo") or None,
                }
    except Exception as e:
        logger.debug(f"Clearbit failed for {domain}: {e}")
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# Company website scraping — extract meta description + tech hints
# ─────────────────────────────────────────────────────────────────────────────

_META_DESC_RE = re.compile(
    r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']{10,300})',
    re.I,
)
_OG_DESC_RE = re.compile(
    r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']{10,300})',
    re.I,
)
_TITLE_RE = re.compile(r"<title[^>]*>([^<]{3,120})</title>", re.I)

# Common SaaS tech markers found in page HTML
_TECH_MARKERS = {
    "salesforce": "Salesforce", "hubspot": "HubSpot", "intercom": "Intercom",
    "zendesk": "Zendesk", "stripe": "Stripe", "twilio": "Twilio",
    "segment.com": "Segment", "mixpanel": "Mixpanel", "amplitude": "Amplitude",
    "marketo": "Marketo", "drift.com": "Drift", "calendly": "Calendly",
    "slack.com": "Slack", "notion.so": "Notion", "airtable.com": "Airtable",
    "google-analytics": "Google Analytics", "gtag": "Google Tag Manager",
    "hotjar": "Hotjar", "fullstory": "FullStory",
}


def _scrape_company_website(domain: str) -> dict:
    """
    Fetch company homepage and extract:
      - Meta description / OG description → company_description
      - Page title
      - Detected SaaS tech stack (from HTML markers)
    """
    if not domain:
        return {}
    clean = domain.replace("http://", "").replace("https://", "").split("/")[0]
    for scheme in ("https://", "http://"):
        url = f"{scheme}{clean}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
                "Accept": "text/html",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read(60_000).decode("utf-8", errors="ignore")
            break
        except Exception:
            html = ""
    if not html:
        return {}

    result: dict = {}

    # Description from meta tags
    for pat in (_META_DESC_RE, _OG_DESC_RE):
        m = pat.search(html)
        if m:
            desc = m.group(1).strip()
            if len(desc) > 20:
                result["company_description"] = desc[:400]
                break

    # Tech stack detection
    html_lower = html.lower()
    detected = [name for marker, name in _TECH_MARKERS.items() if marker in html_lower]
    if detected:
        result["tech_stack"] = list(dict.fromkeys(detected))[:10]  # dedup, cap at 10

    return result


# ─────────────────────────────────────────────────────────────────────────────
# BuiltWith tech stack (requires BUILTWITH_API_KEY — optional)
# ─────────────────────────────────────────────────────────────────────────────

def _builtwith_lookup(domain: str) -> list[str]:
    api_key = os.getenv("BUILTWITH_API_KEY")
    if not api_key or not domain:
        return []
    clean = domain.replace("http://", "").replace("https://", "").split("/")[0]
    params = urllib.parse.urlencode({"KEY": api_key, "LOOKUP": clean})
    data = _http_get(f"https://api.builtwith.com/free1/api.json?{params}", timeout=10)
    if not data:
        return []
    try:
        techs = []
        for group in (data.get("Results") or [{}])[0].get("Result", {}).get("Paths", []):
            for tech in group.get("Technologies", []):
                name = tech.get("Name")
                if name:
                    techs.append(name)
        return list(dict.fromkeys(techs))[:15]
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Hunter domain search — detect email pattern for a company domain
# ─────────────────────────────────────────────────────────────────────────────

def _hunter_email_finder(
    first_name: str, last_name: str, domain: Optional[str] = None, company: Optional[str] = None
) -> Optional[str]:
    """
    Hunter.io email finder — looks up the most likely email for a person.
    Accepts domain OR company name (Hunter supports both).
    Returns verified email string or None.
    """
    api_key = os.getenv("HUNTER_API_KEY")
    if not api_key or not first_name or not last_name:
        return None
    if not domain and not company:
        return None
    payload: dict = {"first_name": first_name, "last_name": last_name, "api_key": api_key}
    if domain:
        payload["domain"] = domain.replace("http://", "").replace("https://", "").split("/")[0]
    elif company:
        payload["company"] = company
    data = _http_get(f"https://api.hunter.io/v2/email-finder?{urllib.parse.urlencode(payload)}", timeout=12)
    if not data:
        return None
    result = (data.get("data") or {})
    email = result.get("email")
    score = result.get("score", 0)
    if email and score >= 20:
        return email
    return None


def _hunter_domain_search(domain: str) -> Optional[str]:
    """
    Hunter.io domain search — finds the predominant email pattern (e.g. {first}.{last}@).
    Returns pattern string or None.
    """
    api_key = os.getenv("HUNTER_API_KEY")
    if not api_key or not domain:
        return None
    clean = domain.replace("http://", "").replace("https://", "").split("/")[0]
    params = urllib.parse.urlencode({"domain": clean, "api_key": api_key})
    data = _http_get(f"https://api.hunter.io/v2/domain-search?{params}", timeout=10)
    if not data:
        return None
    return ((data.get("data") or {}).get("pattern")) or None


# ─────────────────────────────────────────────────────────────────────────────
# Email pattern generation + MX-verified guessing
# ─────────────────────────────────────────────────────────────────────────────

def _generate_email_patterns(first: str, last: str, domain: str) -> list[str]:
    """
    Generate the 8 most common B2B email patterns for a person at a domain.
    Returned in order of statistical frequency (most common first).
    """
    f = re.sub(r"[^a-z]", "", first.lower())
    l = re.sub(r"[^a-z]", "", last.lower())
    f1 = f[:1] if f else ""
    l1 = l[:1] if l else ""
    if not f or not l or not domain:
        return []
    d = domain.replace("http://", "").replace("https://", "").split("/")[0]
    patterns = []
    if f and l:
        patterns.extend([
            f"{f}.{l}@{d}",          # john.doe      — ~41%
            f"{f}{l}@{d}",            # johndoe       — ~14%
            f"{f1}{l}@{d}",           # jdoe          — ~12%
            f"{f}@{d}",               # john          — ~9%
            f"{f}_{l}@{d}",           # john_doe      — ~6%
            f"{l}.{f}@{d}",           # doe.john      — ~5%
            f"{f1}.{l}@{d}",          # j.doe         — ~4%
            f"{l}@{d}",               # doe           — ~3%
        ])
    return patterns


async def _find_email_by_patterns(
    first: str, last: str, domain: str, hunter_pattern: Optional[str] = None
) -> Optional[str]:
    """
    Try to find a valid email by:
    1. If Hunter revealed a pattern, try that pattern first.
    2. Then try all 8 standard patterns in parallel (MX-verify each).
    Returns the first pattern that passes local MX check as 'risky', or None.
    Does NOT use Hunter credits — only local DNS verification.
    """
    # Build candidate list
    pattern_map = {
        "{first}.{last}@": "{f}.{l}",
        "{first}{last}@": "{f}{l}",
        "{f}{last}@": "{f1}{l}",
        "{first}@": "{f}",
    }

    candidates = _generate_email_patterns(first, last, domain)

    # If Hunter found a pattern, slot that in as the first candidate
    if hunter_pattern:
        f = re.sub(r"[^a-z]", "", first.lower())
        l = re.sub(r"[^a-z]", "", last.lower())
        f1 = f[:1] if f else ""
        d = domain.replace("http://", "").replace("https://", "").split("/")[0]
        guess = (
            hunter_pattern
            .replace("{first}", f)
            .replace("{last}", l)
            .replace("{f}", f1)
            + f"@{d}"
        )
        candidates = [guess] + [c for c in candidates if c != guess]

    # Try each candidate — stop at first one that passes MX check
    for email in candidates[:8]:
        result = await asyncio.to_thread(_verify_email_local, email)
        if result in ("valid", "risky"):
            return email
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def find_leads(
    job_titles: list[str],
    industries: list[str],
    locations: list[str],
    company_sizes: list[str],
    limit: int = 25,
    seniority_levels: list[str] | None = None,
    keywords: list[str] | None = None,
    icp_filters: dict | None = None,
    product_description: str = "",
) -> list[dict]:
    """
    Search for leads via SerpAPI LinkedIn scrape. Scores each lead against ICP.
    Returns leads sorted by icp_score descending.
    """
    leads = await asyncio.to_thread(
        _serpapi_linkedin_search,
        job_titles=job_titles,
        industries=industries,
        locations=locations,
        keywords=keywords or [],
        limit=limit,
    )

    # LLM pass: recover company + role for leads where headline lacked "at Company"
    missing_company = [l for l in leads if not l.get("company")]
    if missing_company:
        await _llm_extract_companies(missing_company)

    filters = icp_filters or {
        "job_titles": job_titles,
        "seniority_levels": seniority_levels or [],
        "industries": industries,
        "locations": locations,
        "company_sizes": company_sizes,
    }
    for lead in leads:
        lead["icp_score"] = score_icp_match(lead, filters)

    leads.sort(key=lambda l: -l.get("icp_score", 0))
    return leads


async def find_leads_from_icp(
    icp_description: str,
    limit: int = 25,
    product_description: str = "",
) -> tuple[dict, list[dict]]:
    """
    Accept a natural language ICP description, parse it via LLM, run SerpAPI LinkedIn search.
    Returns (parsed_filters, leads).
    """
    filters = await parse_icp_to_filters(icp_description, product_description=product_description)
    leads = await find_leads(
        job_titles=filters.get("job_titles", []),
        industries=filters.get("industries", []),
        locations=filters.get("locations", []),
        company_sizes=filters.get("company_sizes", []),
        seniority_levels=filters.get("seniority_levels", []),
        keywords=filters.get("keywords", []),
        limit=limit,
        icp_filters=filters,
        product_description=product_description,
    )
    return filters, leads


async def enrich_contact(
    contact_name: str,
    company: str,
    domain: Optional[str],
    contact_email: Optional[str],
    linkedin_url: Optional[str],
) -> dict:
    """
    Multi-source waterfall enrichment for a saved contact:
      1. PDL → company firmographics (size, industry, location, founded)
      2. Clearbit free → company description + logo
      3. Website scrape → description fallback + tech stack detection
      4. BuiltWith → additional tech stack (if BUILTWITH_API_KEY set)
      5. Hunter domain search → detect email pattern
      6. Email pattern generation + MX-verify (6–8 patterns tried)
      7. SerpAPI news → buying signals (classified by type)
      8. Email verification

    Returns a dict of fields to set on the SalesContact record, plus
    a `_buying_signals` list for the caller to insert as SignalEvents.
    Sources list is stored in enrichment_source for audit.
    """
    updates: dict = {}
    sources: list[str] = []
    buying_signals: list[dict] = []

    name_parts = contact_name.strip().split(" ", 1)
    first_name = name_parts[0] if name_parts else ""
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    # ── 1. PDL company enrichment ─────────────────────────────────────────────
    if domain:
        try:
            pdl_data = await asyncio.to_thread(_pdl_company_enrich, domain)
            if pdl_data:
                updates.update(pdl_data)
                sources.append("pdl")
                logger.debug(f"PDL enriched {company}: {pdl_data}")
        except Exception as e:
            logger.debug(f"PDL failed for {company}: {e}")

    # ── 2 & 3. Clearbit + website scrape (in parallel) ───────────────────────
    if domain:
        clearbit_task = asyncio.to_thread(_clearbit_company, domain)
        website_task = asyncio.to_thread(_scrape_company_website, domain)
        clearbit_data, website_data = await asyncio.gather(
            clearbit_task, website_task, return_exceptions=True
        )

        if isinstance(clearbit_data, dict) and clearbit_data:
            # Only set description if PDL didn't already set it
            desc = clearbit_data.get("company_description")
            if desc and not updates.get("company_description"):
                updates["company_description"] = desc
            logo = clearbit_data.get("company_logo")
            if logo:
                updates["company_logo"] = logo
            sources.append("clearbit")

        if isinstance(website_data, dict) and website_data:
            if not updates.get("company_description") and website_data.get("company_description"):
                updates["company_description"] = website_data["company_description"]
                sources.append("website")
            if website_data.get("tech_stack"):
                existing = updates.get("tech_stack") or []
                merged = list(dict.fromkeys(existing + website_data["tech_stack"]))[:15]
                updates["tech_stack"] = merged

    # ── 4. BuiltWith tech stack (optional) ───────────────────────────────────
    if domain and os.getenv("BUILTWITH_API_KEY"):
        try:
            bw_stack = await asyncio.to_thread(_builtwith_lookup, domain)
            if bw_stack:
                existing = updates.get("tech_stack") or []
                merged = list(dict.fromkeys(existing + bw_stack))[:15]
                updates["tech_stack"] = merged
                sources.append("builtwith")
        except Exception as e:
            logger.debug(f"BuiltWith failed for {domain}: {e}")

    # ── 5 & 6. Hunter email finder → domain pattern → local pattern guessing ──
    if not contact_email and first_name:
        try:
            hunter_email = None

            # 5a. Hunter by domain (most accurate when domain is known)
            if domain and last_name:
                hunter_email = await asyncio.to_thread(
                    _hunter_email_finder, first_name, last_name, domain, None
                )

            # 5b. Hunter by company name (fallback when domain unknown or 5a failed)
            if not hunter_email and company and last_name:
                hunter_email = await asyncio.to_thread(
                    _hunter_email_finder, first_name, last_name, None, company
                )

            if hunter_email:
                updates["contact_email"] = hunter_email
                updates["email_verified"] = "valid"
                contact_email = hunter_email
                sources.append("hunter_finder")
                logger.debug(f"Hunter found email for {contact_name}: {hunter_email}")
            elif domain and last_name:
                # 5c. Hunter domain pattern + local pattern guessing fallback
                hunter_pattern = await asyncio.to_thread(_hunter_domain_search, domain)
                if hunter_pattern:
                    sources.append("hunter_pattern")
                    logger.debug(f"Hunter pattern for {domain}: {hunter_pattern}")
                guessed = await _find_email_by_patterns(first_name, last_name, domain, hunter_pattern)
                if guessed:
                    updates["contact_email"] = guessed
                    updates["email_verified"] = "risky"
                    contact_email = guessed
                    sources.append("email_pattern")
                    logger.debug(f"Pattern-guessed email for {contact_name}: {guessed}")
        except Exception as e:
            logger.debug(f"Email finding failed for {contact_name}: {e}")

    # ── 7. SerpAPI news + buying signal classification ────────────────────────
    try:
        raw_news = await asyncio.to_thread(_fetch_serpapi_news, company)
        if raw_news:
            buying_signals = _parse_news_into_signals(raw_news, company)
            if buying_signals:
                updates["company_news"] = "\n".join(
                    f"[{s['type']}] {s['title']}" for s in buying_signals
                )
                sources.append("serpapi")
    except Exception as e:
        logger.debug(f"SerpAPI news failed for {company}: {e}")

    # ── 8. Email verification ─────────────────────────────────────────────────
    if contact_email and not updates.get("email_verified"):
        try:
            verified = await verify_email(contact_email)
            updates["email_verified"] = verified
            if "email_pattern" not in sources:
                sources.append("email_verified")
        except Exception as e:
            logger.debug(f"Email verification failed for {contact_email}: {e}")

    updates["enrichment_status"] = "enriched" if len(sources) > 0 else "failed"
    updates["enrichment_source"] = "+".join(sources) if sources else None
    updates["_buying_signals"] = buying_signals
    return updates
