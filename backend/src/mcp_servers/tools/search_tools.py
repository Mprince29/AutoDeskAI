import asyncio
import json
import os
import time
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# ── Engine definitions ────────────────────────────────────────────────────────

class SearchEngine(str, Enum):
    GOOGLE         = "google"
    GOOGLE_SCHOLAR = "google_scholar"
    GOOGLE_NEWS    = "google_news"


# ── Request model ─────────────────────────────────────────────────────────────

class WebSearchRequest(BaseModel):
    query:       str          = Field(..., min_length=1, max_length=500)
    engine:      SearchEngine = SearchEngine.GOOGLE
    num_results: int          = Field(10, ge=1, le=100)
    time_period: Optional[str] = Field(
        None,
        description="Filter by recency: 'd' (day), 'w' (week), 'm' (month), 'y' (year)",
    )


# ── Result normaliser ─────────────────────────────────────────────────────────
# Each engine returns a different top-level key and slightly different fields.
# This collapses all three into one consistent list schema.

_TIME_MAP = {"d": "qdr:d", "w": "qdr:w", "m": "qdr:m", "y": "qdr:y"}


def _normalise(raw: dict, engine: SearchEngine) -> List[Dict[str, Any]]:
    """Extract a flat list of {title, link, snippet, source, date} dicts."""
    out: List[Dict[str, Any]] = []

    if engine == SearchEngine.GOOGLE:
        for r in raw.get("organic_results", []):
            out.append({
                "title":   r.get("title", ""),
                "link":    r.get("link", ""),
                "snippet": r.get("snippet", ""),
                "source":  r.get("displayed_link", ""),
                "date":    r.get("date", ""),
            })

    elif engine == SearchEngine.GOOGLE_SCHOLAR:
        for r in raw.get("organic_results", []):
            pub = r.get("publication_info", {})
            out.append({
                "title":        r.get("title", ""),
                "link":         r.get("link", ""),
                "snippet":      r.get("snippet", ""),
                "source":       pub.get("summary", ""),
                "date":         pub.get("published", ""),
                "cited_by":     r.get("inline_links", {})
                                 .get("cited_by", {})
                                 .get("total", 0),
            })

    elif engine == SearchEngine.GOOGLE_NEWS:
        for r in raw.get("news_results", []):
            out.append({
                "title":   r.get("title", ""),
                "link":    r.get("link", ""),
                "snippet": r.get("snippet", ""),
                "source":  r.get("source", {}).get("name", ""),
                "date":    r.get("date", ""),
            })

    return out


# ── Blocking search runner ────────────────────────────────────────────────────

def _run_search(params: dict, retries: int = 3, backoff: float = 1.5) -> dict:
    """Execute the SerpAPI call synchronously (called via asyncio.to_thread)."""
    import requests as _requests
    from serpapi import GoogleSearch  # lazy import - only needed at call time

    api_key = os.getenv("SERPAPI_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="SERPAPI_API_KEY is not configured.")

    params["api_key"] = api_key
    last_exc: Exception = RuntimeError("unknown")
    for attempt in range(retries):
        try:
            search = GoogleSearch(params)
            # Use get_response directly so we can inspect the body before parsing
            resp = search.get_response()
            body = resp.text
            if not body or not body.strip():
                raise ValueError(f"SerpAPI returned empty body (HTTP {resp.status_code})")
            return json.loads(body)
        except (ValueError, json.JSONDecodeError, _requests.RequestException) as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))
    raise last_exc


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/web_search")
async def web_search(req: WebSearchRequest):
    params: Dict[str, Any] = {
        "engine": req.engine.value,
        "q":      req.query,
        "num":    req.num_results,
    }

    # Time-period filter - only valid for google / google_news
    if req.time_period and req.engine != SearchEngine.GOOGLE_SCHOLAR:
        tbs = _TIME_MAP.get(req.time_period)
        if tbs:
            params["tbs"] = tbs

    # Google Scholar uses "as_ylo" for year filter instead of tbs
    if req.time_period == "y" and req.engine == SearchEngine.GOOGLE_SCHOLAR:
        from datetime import date
        params["as_ylo"] = date.today().year - 1

    try:
        raw = await asyncio.to_thread(_run_search, params)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SerpAPI error: {str(e)}")

    results = _normalise(raw, req.engine)

    return {
        "success":      True,
        "query":        req.query,
        "engine":       req.engine.value,
        "result_count": len(results),
        "results":      results,
    }
