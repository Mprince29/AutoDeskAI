"""
Sales Intelligence Service
- Signal collection: Google News, Adzuna jobs, Hacker News, Reddit, GitHub,
                     Crunchbase (unofficial), ProductHunt
- Intent scoring: recency-weighted signal model
- Next Best Action: LLM recommendation
"""
import os
import asyncio
import urllib.request
import urllib.parse
import json
import re
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

from utils.llm_router import agenerate


# ── Signal weights for intent scoring ───────────────────────────────────────
_SIGNAL_WEIGHTS = {
    "email_open":       10,
    "email_click":      20,
    "email_reply":      40,
    "news_mention":     15,
    "hiring_signal":    20,
    "funding_round":    30,   # strongest buying signal
    "product_launch":   22,
    "expansion":        20,
    "partnership":      18,
    "website_visit":    30,
    "reddit_mention":   12,
    "github_signal":    10,
    "multiple_opens":   15,
    "crunchbase_signal": 25,
    "producthunt_signal": 15,
    "hn_mention":        18,
}

_MAX_SCORE = 100


def _http_get(url: str, timeout: int = 8) -> Optional[bytes]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; SalesBot/1.0)",
            "Accept": "application/json, text/html, application/xml;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as e:
        logger.debug(f"HTTP GET failed {url}: {e}")
        return None


# ── News via SerpAPI Google News (real article URLs) ─────────────────────────
async def collect_news_signals(company: str) -> list[dict]:
    api_key = os.getenv("SERPAPI_API_KEY") or os.getenv("SERPAPI_KEY")
    if not api_key:
        return []

    def _fetch():
        # Try exact-phrase first; fall back to unquoted for small/unknown brands
        for q_str in [f'"{company}"', company]:
            query = urllib.parse.quote(q_str)
            url = (
                f"https://serpapi.com/search.json?engine=google_news"
                f"&q={query}&api_key={api_key}&num=10&hl=en&gl=us&tbs=qdr:y"
            )
            raw = _http_get(url, timeout=12)
            data = json.loads(raw) if raw else None
            if data and data.get("news_results"):
                return data
        return None

    data = await asyncio.to_thread(_fetch)
    if not data:
        return []

    signals = []
    seen_titles: set[str] = set()
    seen_urls: set[str] = set()

    # SerpAPI groups results as topics; each topic has a `stories` list with real links
    for topic in data.get("news_results", [])[:12]:
        stories = topic.get("stories") or []
        # If no stories, the topic itself may have a direct link
        candidates = stories if stories else [topic]
        for story in candidates:
            link = story.get("link", "")
            title = story.get("title", "").strip()
            if not link or not title:
                continue
            if "news.google.com" in link:
                continue
            title_key = title.lower()[:60]
            url_key = link.split("?")[0]
            if title_key in seen_titles or url_key in seen_urls:
                continue
            seen_titles.add(title_key)
            seen_urls.add(url_key)
            source_name = (story.get("source") or {}).get("name", "")
            signals.append({
                "type": "news_mention",
                "title": title,
                "url": link,
                "published_at": story.get("date", ""),
                "source": source_name or "google_news",
            })
            if len(signals) >= 8:
                break
        if len(signals) >= 8:
            break

    return signals


# ── Adzuna jobs ──────────────────────────────────────────────────────────────
async def collect_hiring_signals(company: str) -> list[dict]:
    app_id = os.getenv("ADZUNA_APP_ID")
    app_key = os.getenv("ADZUNA_APP_KEY")
    if not app_id or not app_key:
        return []

    def _fetch():
        query = urllib.parse.quote(company)
        url = (
            f"https://api.adzuna.com/v1/api/jobs/us/search/1"
            f"?app_id={app_id}&app_key={app_key}"
            f"&what_company={query}&results_per_page=10"
        )
        raw = _http_get(url)
        return json.loads(raw) if raw else None

    data = await asyncio.to_thread(_fetch)
    if not data or "results" not in data:
        return []

    signals = []
    seen_titles: set[str] = set()
    for job in data["results"][:10]:
        title = job.get("title", "").strip()
        if title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())
        signals.append({
            "type": "hiring_signal",
            "title": title,
            "location": job.get("location", {}).get("display_name", ""),
            "url": job.get("redirect_url", ""),
            "created_at": job.get("created", ""),
            "source": "adzuna",
        })

    return signals




# ── Reddit (free JSON API — no key needed) ───────────────────────────────────
async def collect_reddit_signals(company: str) -> list[dict]:
    def _fetch():
        # Quote exact company name for precision
        query = urllib.parse.quote(f'"{company}"')
        url = (
            f"https://www.reddit.com/search.json?q={query}"
            f"&sort=relevance&limit=25&t=year&type=link"
        )
        raw = _http_get(url, timeout=10)
        return json.loads(raw) if raw else None

    data = await asyncio.to_thread(_fetch)
    if not data:
        return []

    try:
        posts = data.get("data", {}).get("children", [])
    except Exception:
        return []

    # Require company name as a whole word (avoid "stripe" matching "stripes")
    company_pattern = re.compile(r'\b' + re.escape(company) + r'\b', re.IGNORECASE)

    signals = []
    seen: set[str] = set()
    for post in posts:
        d = post.get("data", {})
        title = d.get("title", "").strip()
        if not title or not company_pattern.search(title):
            continue
        if (d.get("ups") or 0) < 2:
            continue
        title_key = title.lower()[:60]
        if title_key in seen:
            continue
        seen.add(title_key)
        permalink = d.get("permalink", "")
        url = f"https://reddit.com{permalink}" if permalink else d.get("url", "")
        signals.append({
            "type": "reddit_mention",
            "title": title,
            "url": url,
            "subreddit": d.get("subreddit", ""),
            "score": d.get("ups", 0),
            "published_at": datetime.fromtimestamp(
                d.get("created_utc", 0), tz=timezone.utc
            ).isoformat() if d.get("created_utc") else "",
            "source": "reddit",
        })
        if len(signals) >= 6:
            break

    return signals


# ── GitHub (free API — no key for public data) ────────────────────────────────
async def collect_github_signals(company: str) -> list[dict]:
    def _fetch():
        query = urllib.parse.quote(company)
        url = f"https://api.github.com/search/repositories?q={query}&sort=updated&per_page=5"
        raw = _http_get(url, timeout=8)
        return json.loads(raw) if raw else None

    data = await asyncio.to_thread(_fetch)
    if not data or "items" not in data:
        return []

    signals = []
    for repo in data["items"][:5]:
        stars = repo.get("stargazers_count", 0)
        if stars < 5:
            continue
        signals.append({
            "type": "github_signal",
            "title": f"GitHub repo: {repo.get('full_name', '')} ★{stars}",
            "url": repo.get("html_url", ""),
            "description": (repo.get("description") or "")[:120],
            "published_at": repo.get("updated_at", ""),
            "source": "github",
        })

    return signals


# ── Crunchbase unofficial signals (free public search) ───────────────────────
async def collect_crunchbase_signals(company: str) -> list[dict]:
    """
    Fetch Crunchbase autocomplete (public, no key) to detect funding rounds.
    Falls back gracefully if blocked.
    """
    def _fetch():
        query = urllib.parse.quote(company)
        url = (
            f"https://www.crunchbase.com/v4/data/autocompletes"
            f"?query={query}&collection_ids=organizations&limit=3"
        )
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                "Accept": "application/json",
                "X-cb-user-key": "",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                return json.loads(resp.read())
        except Exception:
            return None

    data = await asyncio.to_thread(_fetch)
    if not data:
        return []

    signals = []
    try:
        for entity in (data.get("entities") or [])[:2]:
            props = entity.get("properties") or {}
            name = props.get("identifier", {}).get("value", "")
            if not re.search(re.escape(company), name, re.I):
                continue
            last_funding = props.get("last_funding_type")
            funding_total = props.get("funding_total", {}).get("value_usd")
            short_desc = props.get("short_description") or ""
            permalink = (props.get("identifier") or {}).get("permalink") or ""
            cb_url = f"https://www.crunchbase.com/organization/{permalink}" if permalink else ""

            if last_funding or funding_total:
                funding_str = last_funding or ""
                if funding_total:
                    funding_str += f" (${funding_total:,.0f} total)" if isinstance(funding_total, (int, float)) else ""
                signals.append({
                    "type": "crunchbase_signal",
                    "title": f"{name}: {funding_str}".strip(": "),
                    "url": cb_url,
                    "snippet": short_desc[:200],
                    "source": "crunchbase",
                    "published_at": "",
                })
    except Exception as e:
        logger.debug(f"Crunchbase parse error for {company}: {e}")

    return signals


# ── ProductHunt signals ───────────────────────────────────────────────────────
async def collect_producthunt_signals(company: str) -> list[dict]:
    """Search ProductHunt (public API, no key) for product launches by company."""
    def _fetch():
        query = urllib.parse.quote(company)
        url = f"https://www.producthunt.com/search?q={query}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"},
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                html = resp.read(30_000).decode("utf-8", errors="ignore")
            return html
        except Exception:
            return None

    html = await asyncio.to_thread(_fetch)
    if not html:
        return []

    # Extract product titles from PH search results via simple regex
    company_pattern = re.compile(r'\b' + re.escape(company) + r'\b', re.I)
    title_pattern = re.compile(r'"name"\s*:\s*"([^"]{5,80})"', re.I)
    url_pattern = re.compile(r'"url"\s*:\s*"(https://www\.producthunt\.com/posts/[^"]+)"', re.I)

    titles = title_pattern.findall(html)
    urls = url_pattern.findall(html)

    signals = []
    seen: set[str] = set()
    for i, title in enumerate(titles[:10]):
        if not company_pattern.search(title):
            continue
        title_key = title.lower()[:60]
        if title_key in seen:
            continue
        seen.add(title_key)
        url = urls[i] if i < len(urls) else "https://www.producthunt.com"
        signals.append({
            "type": "producthunt_signal",
            "title": f"ProductHunt: {title}",
            "url": url,
            "source": "producthunt",
            "published_at": "",
        })
        if len(signals) >= 3:
            break

    return signals


# ── Hacker News signals ──────────────────────────────────────────────────────
async def collect_hn_signals(company: str) -> list[dict]:
    """Search Algolia HN for company mentions in stories."""
    def _fetch():
        query = urllib.parse.quote(f'"{company}"')
        url = f"https://hn.algolia.com/api/v1/search?query={query}&tags=story&hitsPerPage=5"
        raw = _http_get(url)
        return json.loads(raw) if raw else None

    data = await asyncio.to_thread(_fetch)
    if not data or "hits" not in data:
        return []

    signals = []
    for hit in data["hits"]:
        signals.append({
            "type": "hn_mention",
            "title": hit.get("title", ""),
            "url": f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
            "points": hit.get("points", 0),
            "num_comments": hit.get("num_comments", 0),
            "published_at": hit.get("created_at", ""),
            "source": "hacker_news",
        })
    return signals


# ── Intent score calculator (recency-weighted) ───────────────────────────────
_RECENCY_WEIGHTS = [
    (30,  1.0),    # last 30 days   — full weight
    (90,  0.75),   # 30–90 days     — 75%
    (180, 0.50),   # 90–180 days    — 50%
    (365, 0.25),   # 180–365 days   — 25%
]


def _recency_multiplier(published_at: str) -> float:
    """Return a 0.1–1.0 multiplier based on how recent the signal is."""
    if not published_at:
        return 0.5  # unknown date — assume moderate recency
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(published_at[:19], fmt[:len(published_at[:19].replace("Z", ""))])
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_days = (datetime.now(timezone.utc) - dt).days
            for threshold, weight in _RECENCY_WEIGHTS:
                if age_days <= threshold:
                    return weight
            return 0.1
        except ValueError:
            continue
    return 0.5


def compute_intent_score(signals: list[dict], open_count: int = 0) -> int:
    score = 0.0
    for sig in signals:
        weight = _SIGNAL_WEIGHTS.get(sig.get("type", ""), 0)
        # Recency multiplier applied to external signals (not email events — they're real-time)
        meta = sig.get("metadata") or {}
        published = meta.get("published_at") or sig.get("published_at") or ""
        if sig.get("type") not in ("email_open", "email_click", "email_reply"):
            weight = weight * _recency_multiplier(published)
        score += weight

    if open_count > 2:
        score += _SIGNAL_WEIGHTS["multiple_opens"]

    return min(int(score), _MAX_SCORE)


# ── Full signal refresh for a contact ───────────────────────────────────────
async def refresh_contact_signals(company: str, domain: Optional[str] = None) -> list[dict]:
    """Collect all external signals for a company in parallel from 7 sources."""
    results = await asyncio.gather(
        collect_news_signals(company),
        collect_hiring_signals(company),
        collect_reddit_signals(company),
        collect_github_signals(company),
        collect_crunchbase_signals(company),
        collect_producthunt_signals(company),
        collect_hn_signals(company),
        return_exceptions=True,
    )
    signals = []
    for r in results:
        if isinstance(r, list):
            signals.extend(r)
        elif isinstance(r, Exception):
            logger.warning(f"Signal source error: {r}")
    return signals


# ── Next Best Action via LLM ─────────────────────────────────────────────────
def _format_signal_line(s: dict) -> str:
    stype = s.get("type", "unknown")
    created = s.get("created_at", "")[:10] if s.get("created_at") else "unknown date"
    meta = s.get("metadata") or {}

    if stype == "email_open":
        return f"- [email_open] Recipient opened the email on {created}"
    if stype == "email_click":
        url = meta.get("url", "a link")
        return f"- [email_click] Recipient clicked {url} on {created}"
    if stype == "email_reply":
        return f"- [email_reply] Recipient replied on {created}"
    if stype == "news_mention":
        title = meta.get("title") or s.get("title", "news item")
        return f"- [news_mention] {title} ({created})"
    if stype == "hiring_signal":
        title = meta.get("title") or s.get("title", "job posting")
        loc = meta.get("location", "")
        return f"- [hiring_signal] Hiring: {title}{' · ' + loc if loc else ''} ({created})"
    if stype == "reddit_mention":
        title = meta.get("title") or s.get("title", "Reddit post")
        sub = meta.get("subreddit", "")
        return f"- [reddit_mention] Reddit r/{sub}: {title} ({created})"
    if stype == "github_signal":
        title = meta.get("title") or s.get("title", "GitHub repo")
        return f"- [github_signal] {title} ({created})"
    # fallback
    detail = meta.get("title") or str(meta)[:80] if meta else s.get("title", "")
    return f"- [{stype}] {detail} ({created})"


async def get_next_best_action(
    contact_name: str,
    company: str,
    intent_score: int,
    signals: list[dict],
    last_contact_days: Optional[int],
    open_count: int = 0,
) -> dict:
    signal_lines = [_format_signal_line(s) for s in signals[:15]]
    signal_summary = "\n".join(signal_lines) if signal_lines else "No recent signals."

    last_contact_str = (
        f"{last_contact_days} day(s) ago" if last_contact_days is not None else "never contacted"
    )
    open_note = f" (opened {open_count}x total)" if open_count else ""

    prompt = f"""Lead: {contact_name} at {company}
Intent: {intent_score}/100{open_note} | Last contact: {last_contact_str}

Signals:
{signal_summary}

Rules: high intent+recent opens→act now; multiple opens no reply→nurture; hiring signal→pitch growth angle; news→use as hook; >14d no contact→re-engage.

Reply with ONLY this JSON (no markdown):
{{"action":"<verb phrase max 7 words>","reason":"<why, max 50 words, cite signals>","suggested_subject":"<email subject or null>","urgency":"high|medium|low"}}"""

    try:
        resp = await agenerate(
            role="drafter",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a sales strategist. Always respond with a single valid JSON object. "
                        "Keep 'reason' under 60 words and 'action' under 8 words."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=2048,
        )
        text = resp["choices"][0]["message"]["content"].strip()
        # Strip markdown fences
        if text.startswith("```"):
            lines = text.splitlines()
            text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        text = text.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            text = text[start:end]
        return json.loads(text)
    except Exception as e:
        logger.error(f"Next best action LLM failed: {type(e).__name__}: {e}", exc_info=True)
        return {
            "action": "Send a follow-up email",
            "reason": "Could not analyze signals — defaulting to a follow-up to maintain momentum.",
            "suggested_subject": f"Following up — {company}",
            "urgency": "medium",
        }
