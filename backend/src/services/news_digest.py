"""
AI News Digest Service

Pipeline per run:
  1. SerpAPI google_news   → raw articles (geo-filtered, AI-keyword-gated)
  2. Content fetch         → urllib body extract (no JS needed; falls back to snippet)
  3. LLM relevance filter  → drop non-AI stories with strict YES/NO + reason (validator model)
  4. Company deep-dive     → for each company mentioned, SerpAPI organic search → LLM extract
  5. Plain-English rewrite → drafter model rewrites for non-technical community reader
  6. Persist to DB         → NewsDigest + NewsStory rows

Accuracy guardrails:
  - Relevance filter uses temperature=0.0 and demands JSON with "is_ai_relevant": true/false
  - Company facts are grounded in SerpAPI results, not hallucinated
  - Plain-English rewrite prompt explicitly forbids adding facts not in the source
  - Each stage validates its own output; failures are logged and skipped, not surfaced as results
"""
from __future__ import annotations

import asyncio
import json
import re
import urllib.parse
import urllib.request
from typing import Optional

from loguru import logger

from utils.llm_router import agenerate, get_text


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

_SERPAPI_BASE = "https://serpapi.com/search.json"

# Geo → SerpAPI gl code + location hint injected into query
_GEO_CONFIG: dict[str, dict] = {
    "us":    {"gl": "us", "location": "United States",  "label": "US"},
    "eu":    {"gl": "gb", "location": "Europe",         "label": "Europe"},
    "india": {"gl": "in", "location": "India",          "label": "India"},
    "all":   {"gl": "us", "location": "",               "label": "Global"},
}

# Core AI keyword gate — all queries include at least one of these
_AI_QUERY_TERMS = (
    '"artificial intelligence" OR "machine learning" OR "large language model" '
    'OR "generative AI" OR "AI model" OR "LLM" OR "deep learning" OR "AI startup" '
    'OR "AI funding" OR "AI regulation" OR "AI safety" OR "AI agent"'
)

# Non-AI topics to explicitly exclude in the relevance gate
_NON_AI_TOPICS = [
    "electric vehicle", "EV", "cryptocurrency", "blockchain", "NFT",
    "sports", "entertainment", "celebrity", "gaming", "hardware specs",
    "stock market", "real estate", "climate change", "politics",
]

MAX_ARTICLES_PER_GEO = 15   # cap raw SerpAPI results
MAX_STORIES_FINAL    = 10   # cap after filtering


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────────────────

def _http_get_json(url: str, timeout: int = 15) -> Optional[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.warning(f"HTTP GET failed {url}: {e}")
        return None


def _fetch_article_text(url: str, max_chars: int = 6000) -> str:
    """Fetch article body; strip tags; return plain text (max_chars)."""
    if not url:
        return ""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; NewsDigestBot/1.0)",
                "Accept": "text/html",
            },
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read(80_000).decode("utf-8", errors="ignore")
        # strip script / style blocks
        raw = re.sub(r"<(script|style)[^>]*>.*?</(script|style)>", " ", raw, flags=re.S | re.I)
        # strip all tags
        text = re.sub(r"<[^>]+>", " ", raw)
        # collapse whitespace
        text = re.sub(r"\s+", " ", text).strip()
        return text[:max_chars]
    except Exception as e:
        logger.debug(f"Article fetch failed {url}: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — SerpAPI news fetch
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_news_serpapi(api_key: str, geo: str) -> list[dict]:
    """Return raw news articles from SerpAPI for the given geo."""
    cfg = _GEO_CONFIG.get(geo, _GEO_CONFIG["all"])
    query = _AI_QUERY_TERMS
    if cfg["location"]:
        query += f' "{cfg["location"]}"'

    params = {
        "engine": "google_news",
        "q": query,
        "api_key": api_key,
        "hl": "en",
        "gl": cfg["gl"],
        "num": MAX_ARTICLES_PER_GEO,
    }
    url = f"{_SERPAPI_BASE}?{urllib.parse.urlencode(params)}"
    data = _http_get_json(url)
    if not data:
        return []

    articles: list[dict] = []
    for item in data.get("news_results", [])[:MAX_ARTICLES_PER_GEO]:
        articles.append({
            "headline": item.get("title", ""),
            "source":   item.get("source", {}).get("name", "") if isinstance(item.get("source"), dict) else str(item.get("source", "")),
            "url":      item.get("link", ""),
            "snippet":  item.get("snippet", ""),
            "published_at": item.get("date", ""),
            "geo_tag":  cfg["label"],
        })
    logger.info(f"[NewsDigest] SerpAPI returned {len(articles)} articles for geo={geo}")
    return articles


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Relevance filter (validator model, temperature=0)
# ─────────────────────────────────────────────────────────────────────────────

_RELEVANCE_SCHEMA = {
    "is_ai_relevant": "boolean — true only if this article is directly about AI/ML technology",
    "relevance_tag":  "string — one of: 'AI Model Release' | 'AI Startup' | 'AI Funding' | 'AI Regulation' | 'AI Research' | 'AI Product' | 'AI Safety' | 'AI Partnership' | 'Other AI'",
    "reason":         "string — one sentence explaining your decision",
}

async def _filter_relevance(article: dict) -> Optional[dict]:
    """
    Ask validator LLM: is this actually an AI story?
    Returns the article with relevance_tag added, or None if not relevant.
    """
    prompt = f"""You are a strict AI news classifier. Your only job is to determine if a news article is DIRECTLY about artificial intelligence, machine learning, or AI technology.

EXCLUDE anything about: {', '.join(_NON_AI_TOPICS)}, general tech company earnings unless AI-specific, policy unrelated to AI.

Article:
Headline: {article['headline']}
Source: {article['source']}
Snippet: {article['snippet']}

Respond ONLY with valid JSON matching this schema exactly:
{json.dumps(_RELEVANCE_SCHEMA, indent=2)}

Do not add any text outside the JSON."""

    resp = await agenerate(
        role="validator",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        response_format="json_object",
    )
    text = get_text(resp).strip()
    try:
        data = json.loads(text)
        if not isinstance(data.get("is_ai_relevant"), bool):
            raise ValueError("missing is_ai_relevant bool")
        if not data["is_ai_relevant"]:
            logger.debug(f"[NewsDigest] Filtered out: {article['headline'][:60]} — {data.get('reason','')}")
            return None
        article["relevance_tag"] = data.get("relevance_tag", "Other AI")
        return article
    except Exception as e:
        logger.warning(f"[NewsDigest] Relevance parse failed: {e} | raw={text[:200]}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — Company deep-dive (SerpAPI organic + extractor LLM)
# ─────────────────────────────────────────────────────────────────────────────

def _serpapi_company_search(company: str, api_key: str) -> list[str]:
    """Return top-5 organic snippet texts about a company from SerpAPI."""
    if not company or not api_key:
        return []
    params = {
        "engine": "google",
        "q": f'"{company}" AI company funding product',
        "api_key": api_key,
        "num": 5,
        "hl": "en",
    }
    url = f"{_SERPAPI_BASE}?{urllib.parse.urlencode(params)}"
    data = _http_get_json(url)
    if not data:
        return []
    snippets = []
    for r in data.get("organic_results", [])[:5]:
        s = r.get("snippet", "")
        if s:
            snippets.append(s)
    return snippets


async def _extract_company_info(company: str, snippets: list[str]) -> str:
    """Use extractor LLM to produce a 2-3 sentence factual summary about the company."""
    if not snippets:
        return ""
    combined = "\n".join(f"- {s}" for s in snippets)
    prompt = f"""You are an information extractor. Given web search snippets about "{company}", write 2-3 short factual sentences covering:
- What the company does
- Their recent AI-relevant news (funding, product launch, partnership — only if present in the snippets)
- Their rough scale/stage (startup/mid-size/enterprise) if inferable

STRICT RULES:
- Only use facts present in the snippets below. Do NOT invent anything.
- If a fact is not in the snippets, omit it.
- No bullet points. Plain sentences only.

Snippets:
{combined}

Output only the summary sentences, nothing else."""

    resp = await agenerate(
        role="extractor",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
    )
    return get_text(resp).strip()


async def _enrich_company(article: dict, api_key: str) -> dict:
    """Extract company name from headline, run SerpAPI search, produce fact summary."""
    # Extract company names via a fast LLM call
    resp = await agenerate(
        role="classifier",
        messages=[{
            "role": "user",
            "content": (
                f"Extract the main company or organisation name from this headline. "
                f"Return ONLY the company name, nothing else. If none, return NONE.\n\nHeadline: {article['headline']}"
            ),
        }],
        temperature=0.0,
        max_tokens=30,
    )
    company = get_text(resp).strip().strip('"').strip("'")
    # Take only the first company if the model returned multiple ("OpenAI and Google" → "OpenAI")
    company = re.split(r"\s+and\s+|,\s*|&\s*", company, maxsplit=1)[0].strip()
    if not company or company.upper() == "NONE" or len(company) > 80:
        article["company_info"] = ""
        return article

    snippets = await asyncio.to_thread(_serpapi_company_search, company, api_key)
    company_summary = await _extract_company_info(company, snippets)
    article["company_info"] = company_summary
    return article


# ─────────────────────────────────────────────────────────────────────────────
# Stage 4 — Plain-English rewrite (drafter model)
# ─────────────────────────────────────────────────────────────────────────────

async def _plain_english_rewrite(article: dict, body_text: str) -> dict:
    """Rewrite the article for a non-technical community manager."""
    source_content = body_text if body_text else article.get("snippet", "")
    if not source_content:
        article["plain_summary"] = article.get("snippet", "No summary available.")
        return article

    prompt = f"""You are writing a daily AI news briefing for a community/social media team. They are smart but NOT technical — they don't know what "transformer architecture", "inference", or "fine-tuning" means.

Your job: rewrite the article below into 3-4 plain English sentences that a non-technical person can scan in 10 seconds and understand WHY it matters to communities and businesses interested in AI.

STRICT RULES:
1. Only use facts from the article provided. Do NOT add facts not in the source.
2. Replace every technical term with a plain-language equivalent (e.g. "LLM" → "AI system", "inference" → "running the AI").
3. End with one sentence: "Why it matters:" followed by the business/community relevance.
4. No bullet points, no headers, no markdown. Plain prose only.
5. Max 80 words total.

Article headline: {article['headline']}
Source: {article['source']}

Article content:
{source_content[:4000]}

Write the plain-English summary now:"""

    resp = await agenerate(
        role="drafter",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=200,
    )
    summary = get_text(resp).strip()
    # Safety: if LLM returned nothing useful, fall back to snippet
    if not summary or len(summary) < 30:
        summary = article.get("snippet", "")
    article["plain_summary"] = summary
    return article


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────────────────────

async def run_digest(user_email: str, geo: str, serpapi_key: str) -> list[dict]:
    """
    Full pipeline. Returns list of story dicts ready to persist.
    geo: "us" | "eu" | "india" | "all"
    """
    if geo not in _GEO_CONFIG:
        geo = "all"

    # Stage 1: fetch raw articles
    raw_articles = await asyncio.to_thread(_fetch_news_serpapi, serpapi_key, geo)
    if not raw_articles:
        logger.warning(f"[NewsDigest] No articles returned from SerpAPI for geo={geo}")
        return []

    # Stage 2: parallel relevance filtering
    filter_tasks = [_filter_relevance(a) for a in raw_articles]
    filtered_results = await asyncio.gather(*filter_tasks, return_exceptions=True)
    relevant = [r for r in filtered_results if isinstance(r, dict)]
    relevant = relevant[:MAX_STORIES_FINAL]
    logger.info(f"[NewsDigest] {len(relevant)}/{len(raw_articles)} articles passed relevance filter")

    if not relevant:
        return []

    # Stage 3 & 4: fetch body → enrich company → plain-English rewrite (sequential per article)
    # Rewrite runs AFTER enrichment so company_info is available in the article dict.
    # Articles themselves are processed in parallel across the batch.
    async def _process_article(article: dict) -> dict:
        body_text = await asyncio.to_thread(_fetch_article_text, article.get("url", ""))
        article = await _enrich_company(article, serpapi_key)
        article = await _plain_english_rewrite(article, body_text)
        return article

    enriched = await asyncio.gather(*[_process_article(a) for a in relevant], return_exceptions=True)
    final_stories = [s for s in enriched if isinstance(s, dict)]

    logger.info(f"[NewsDigest] Pipeline complete: {len(final_stories)} stories for user={user_email} geo={geo}")
    return final_stories
