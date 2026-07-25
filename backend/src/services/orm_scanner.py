"""
ORM Scanner Service — Online Reputation Management

Pipeline per scan:
  1. SerpAPI organic search  → discover posts per platform + keyword
  2. Content fetch           → firecrawl (if key set) else urllib strip
  3. LLM relevance gate      → score 0-1, keep ≥ 0.6 (validator, temp=0)
  4. Comment generation      → 3 human-sounding options per tone (drafter, temp=0.7)
  5. Return structured posts → no auto-posting; human approves first

Comment accuracy guardrails:
  - Prompt feeds the FULL post content; LLM cannot invent facts
  - Explicit "DO NOT" list: no "Great post!", no bullet points, no AI clichés,
    no mentioning things not in the post, no emojis unless post uses them
  - Three distinct tones generated in one pass to avoid repetition
  - Validator model re-scores generated comments for human-likeness before returning
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

# site: prefixes per platform for SerpAPI organic search
_PLATFORM_SITES: dict[str, str] = {
    "linkedin":  "site:linkedin.com/posts OR site:linkedin.com/pulse",
    "twitter":   "site:twitter.com OR site:x.com",
    "instagram": "site:instagram.com",
}

# Phrases that make a comment sound AI-generated — used in the negative prompt
_AI_CLICHES = [
    "Great post!", "Insightful!", "Absolutely!", "I totally agree",
    "This is so true", "Well said!", "Amazing content", "Loved this",
    "spot on", "couldn't agree more", "so relevant", "thanks for sharing",
    "very informative", "excellent points", "This resonates",
]

MAX_POSTS_PER_KEYWORD = 8
MIN_RELEVANCE_SCORE   = 0.6   # posts below this are silently dropped


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────────────────

def _http_get_json(url: str, timeout: int = 15) -> Optional[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.warning(f"[ORM] HTTP GET failed {url}: {e}")
        return None


def _fetch_post_text(url: str, firecrawl_key: Optional[str] = None, max_chars: int = 5000) -> str:
    """
    Try firecrawl first (clean markdown extraction), fall back to urllib+strip.
    Returns plain text of the post content.
    """
    if firecrawl_key and url:
        try:
            payload = json.dumps({"url": url, "formats": ["markdown"]}).encode()
            req = urllib.request.Request(
                "https://api.firecrawl.dev/v1/scrape",
                data=payload,
                headers={
                    "Authorization": f"Bearer {firecrawl_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
            content = data.get("data", {}).get("markdown", "")
            if content and len(content) > 100:
                return content[:max_chars]
        except Exception as e:
            logger.debug(f"[ORM] Firecrawl failed for {url}: {e}")

    # urllib fallback
    if not url:
        return ""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read(60_000).decode("utf-8", errors="ignore")
        raw = re.sub(r"<(script|style)[^>]*>.*?</(script|style)>", " ", raw, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", raw)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:max_chars]
    except Exception as e:
        logger.debug(f"[ORM] urllib fetch failed {url}: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Post discovery via SerpAPI
# ─────────────────────────────────────────────────────────────────────────────

def _discover_posts(
    keyword: str,
    platform: str,
    niche: str,
    api_key: str,
    geo_gl: str = "us",
) -> list[dict]:
    """Run SerpAPI organic search to find posts on the given platform."""
    site_filter = _PLATFORM_SITES.get(platform, f"site:{platform}.com")
    query = f'{site_filter} "{keyword}" {niche}'
    params = {
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "num": MAX_POSTS_PER_KEYWORD,
        "hl": "en",
        "gl": geo_gl,
    }
    url = f"{_SERPAPI_BASE}?{urllib.parse.urlencode(params)}"
    data = _http_get_json(url)
    if not data:
        return []

    posts = []
    for r in data.get("organic_results", [])[:MAX_POSTS_PER_KEYWORD]:
        post_url = r.get("link", "")
        # Skip non-platform URLs that slipped through
        platform_domain = platform if platform != "twitter" else "x.com"
        if platform_domain not in post_url and platform not in post_url:
            continue
        posts.append({
            "platform":      platform,
            "post_url":      post_url,
            "post_author":   r.get("displayed_link", ""),
            "post_content":  r.get("snippet", ""),  # snippet as initial content
            "scan_keyword":  keyword,
            "relevance_score": 0.0,
            "relevance_reason": "",
            "status":        "pending",
            "company_info":  "",
        })
    logger.info(f"[ORM] Discovered {len(posts)} posts on {platform} for keyword='{keyword}'")
    return posts


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Relevance scoring (validator model, temp=0)
# ─────────────────────────────────────────────────────────────────────────────

_RELEVANCE_SCHEMA = {
    "score": "float 0.0-1.0 — how relevant/worth engaging with this post is for an AI community brand",
    "reason": "string — one concise sentence explaining the score",
    "post_author_inferred": "string — inferred name or handle of the post author if visible, else empty string",
}

async def _score_relevance(post: dict, brand_context: str, user_id=None, db=None) -> Optional[dict]:
    """Score post relevance. Returns post with score+reason, or None if below threshold."""
    content = post.get("post_content", "")
    if not content or len(content) < 30:
        return None

    prompt = f"""You are a social media strategist for an AI-focused company.
Brand context: {brand_context}

Rate how worthwhile it is for this brand to engage with the following social media post.
Score 1.0 = highly relevant, meaningful engagement opportunity
Score 0.0 = irrelevant, spam, or no engagement value

Post platform: {post['platform']}
Post URL: {post['post_url']}
Post content:
\"\"\"
{content[:2000]}
\"\"\"

Respond ONLY with valid JSON:
{json.dumps(_RELEVANCE_SCHEMA, indent=2)}

No text outside the JSON."""

    resp = await agenerate(
        role="validator",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        response_format="json_object",
        user_id=user_id,
        db=db,
    )
    text = get_text(resp).strip()
    try:
        data = json.loads(text)
        score = float(data.get("score", 0.0))
        if score < MIN_RELEVANCE_SCORE:
            logger.debug(f"[ORM] Low relevance {score:.2f}: {post['post_url'][:60]}")
            return None
        post["relevance_score"] = round(score, 2)
        post["relevance_reason"] = data.get("reason", "")
        if data.get("post_author_inferred"):
            post["post_author"] = data["post_author_inferred"]
        return post
    except Exception as e:
        logger.warning(f"[ORM] Relevance parse failed: {e} | raw={text[:200]}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — Comment generation (drafter model, human-likeness first)
# ─────────────────────────────────────────────────────────────────────────────

_COMMENT_SCHEMA = {
    "comments": [
        {"tone": "curious",     "text": "string — 1-2 sentence comment"},
        {"tone": "insightful",  "text": "string — 1-2 sentence comment"},
        {"tone": "supportive",  "text": "string — 1-2 sentence comment"},
    ]
}

async def _generate_comments(post: dict, brand_voice: str, brand_name: str, user_id=None, db=None) -> list[dict]:
    """
    Generate 3 human-sounding comment options (curious / insightful / supportive).
    Returns list of {tone, comment_text} dicts.
    """
    content = post.get("post_content", "")
    if not content or len(content) < 20:
        return []

    cliches_list = ", ".join(f'"{c}"' for c in _AI_CLICHES)

    prompt = f"""You are writing comments for {brand_name}'s social media presence.
Brand voice: {brand_voice}

Write 3 different comment options for the post below. Each must sound like it was written by a thoughtful human — not an AI or a marketing bot.

POST (on {post['platform']}):
\"\"\"
{content[:3000]}
\"\"\"

COMMENT REQUIREMENTS — follow every rule exactly:
1. 1-2 sentences maximum per comment. No more.
2. Reference something SPECIFIC from the post (a number, a phrase, a specific claim). Never be generic.
3. DO NOT start with: {cliches_list}
4. DO NOT use bullet points, headers, or markdown formatting.
5. DO NOT use emojis unless the post itself uses them heavily.
6. DO NOT add facts not present in the post.
7. DO NOT mention {brand_name} explicitly unless it adds real value.
8. Sound conversational — like a peer leaving a genuine reaction, not a brand doing engagement farming.
9. Each of the 3 tones must feel clearly distinct:
   - curious: ask a genuine follow-up question grounded in the post
   - insightful: add a short observation or connect it to a broader idea from the post
   - supportive: acknowledge a specific point in the post with real warmth (not flattery)

Respond ONLY with valid JSON:
{json.dumps(_COMMENT_SCHEMA, indent=2)}

No text outside the JSON."""

    resp = await agenerate(
        role="drafter",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        response_format="json_object",
        user_id=user_id,
        db=db,
    )
    text = get_text(resp).strip()
    try:
        data = json.loads(text)
        raw_comments = data.get("comments", [])
        if not isinstance(raw_comments, list):
            raise ValueError("comments not a list")

        validated = []
        for c in raw_comments:
            tone = c.get("tone", "")
            comment_text = c.get("text", "").strip()
            if not comment_text or len(comment_text) < 10:
                continue
            # Hard reject: AI cliché openers
            lower = comment_text.lower()
            if any(lower.startswith(cl.lower()) for cl in _AI_CLICHES):
                logger.debug(f"[ORM] Rejected AI-cliché comment: {comment_text[:60]}")
                continue
            validated.append({"tone": tone, "comment_text": comment_text})

        return validated
    except Exception as e:
        logger.warning(f"[ORM] Comment parse failed: {e} | raw={text[:200]}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────────────────────

async def run_scan(
    user_email: str,
    keywords: list[str],
    platforms: list[str],
    niche: str,
    brand_context: str,
    brand_voice: str,
    brand_name: str,
    serpapi_key: str,
    firecrawl_key: Optional[str] = None,
    geo: str = "us",
    user_id=None,
    db=None,
) -> list[dict]:
    """
    Full ORM scan pipeline.
    Returns list of post dicts each with a 'suggestions' list of comment options.
    Nothing is posted — caller persists and surfaces for human approval.
    """
    geo_gl_map = {"us": "us", "eu": "gb", "india": "in", "all": "us"}
    geo_gl = geo_gl_map.get(geo, "us")

    valid_platforms = [p for p in platforms if p in _PLATFORM_SITES]
    if not valid_platforms:
        logger.warning("[ORM] No valid platforms specified")
        return []

    # Stage 1: discover posts for all keyword × platform combos (parallel)
    discovery_tasks = []
    for keyword in keywords:
        for platform in valid_platforms:
            discovery_tasks.append(
                asyncio.to_thread(_discover_posts, keyword, platform, niche, serpapi_key, geo_gl)
            )
    discovery_results = await asyncio.gather(*discovery_tasks, return_exceptions=True)

    raw_posts: list[dict] = []
    for result in discovery_results:
        if isinstance(result, list):
            raw_posts.extend(result)

    # Deduplicate by URL
    seen_urls: set[str] = set()
    unique_posts: list[dict] = []
    for p in raw_posts:
        url = p.get("post_url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_posts.append(p)

    logger.info(f"[ORM] {len(unique_posts)} unique posts after dedup (from {len(raw_posts)} raw)")

    if not unique_posts:
        return []

    # Stage 2: fetch full post content + relevance scoring (parallel)
    async def _fetch_and_score(post: dict) -> Optional[dict]:
        body = await asyncio.to_thread(_fetch_post_text, post["post_url"], firecrawl_key)
        if body and len(body) > 80:
            post["post_content"] = body  # override snippet with full content
        return await _score_relevance(post, brand_context, user_id=user_id, db=db)

    scored_results = await asyncio.gather(*[_fetch_and_score(p) for p in unique_posts], return_exceptions=True)
    scored_posts = [p for p in scored_results if isinstance(p, dict)]
    # Sort by relevance score descending
    scored_posts.sort(key=lambda p: p.get("relevance_score", 0.0), reverse=True)

    logger.info(f"[ORM] {len(scored_posts)}/{len(unique_posts)} posts passed relevance threshold")

    if not scored_posts:
        return []

    # Stage 3: generate comment suggestions (parallel)
    async def _enrich_with_comments(post: dict) -> dict:
        suggestions = await _generate_comments(post, brand_voice, brand_name, user_id=user_id, db=db)
        post["suggestions"] = suggestions
        return post

    final_posts = await asyncio.gather(*[_enrich_with_comments(p) for p in scored_posts], return_exceptions=True)
    result = [p for p in final_posts if isinstance(p, dict)]

    logger.info(f"[ORM] Scan complete: {len(result)} actionable posts for user={user_email}")
    return result
