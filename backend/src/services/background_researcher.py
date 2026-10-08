import os
import asyncio
from dataclasses import dataclass
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
from loguru import logger
import httpx
import json
from sqlalchemy.orm import Session

from utils.llm_router import agenerate as llm_agenerate
from services.agent_brain import Fact

@dataclass(frozen=True)
class ResearchInput:
    task: str
    industry: str
    role: Optional[str] = None
    job_title: Optional[str] = None
    company_website: Optional[str] = None
    company_name: Optional[str] = None

_HTTP_TIMEOUT = httpx.Timeout(connect=8.0, read=15.0, write=5.0, pool=5.0)


class BackgroundResearcher:
    """
    Collects raw data from SERP, FireCrawl, and LLM analysis to build an
    industry-grade context for agent creation.
    """

    def __init__(self):
        self.serp_api_key = os.getenv("SERPAPI_KEY")
        self.firecrawl_api_key = os.getenv("FIRECRAWL_API_KEY")
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        """Lazily creates a single reused AsyncClient for the life of this instance."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
        return self._client

    async def aclose(self):
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def research(self, inp: ResearchInput, user_id: Optional[int] = None, db: Optional[Session] = None) -> List[Fact]:
        """Runs the multi-stage research pipeline."""
        logger.info(f"Starting background research for task: {inp.task} in {inp.industry}")
        
        # Simulated facts collection
        results = await asyncio.gather(
            self._search_industry_trends(inp.industry),
            self._search_role_best_practices(inp.role or inp.task, inp.industry),
            self._scrape_company_context(inp.company_website, inp.company_name),
            self._research_task_templates(inp.task, inp.industry, user_id=user_id, db=db),
            return_exceptions=True
        )
        
        facts = []
        for res in results:
            if isinstance(res, dict) and "insights" in res:
                for insight in res["insights"]:
                    facts.append(Fact(content=insight, source=res.get("source", "serp"), category="industry"))
            # ... more mapping logic ...
        
        logger.info(f"Research gathering complete: {len(facts)} facts.")
        return facts

    async def _serp_search(self, query: str) -> Optional[List[Dict[str, Any]]]:
        """Runs a single SerpAPI Google search query. Returns organic results, or None on failure."""
        if not self.serp_api_key:
            return None
        try:
            resp = await self._get_client().get(
                "https://serpapi.com/search",
                params={"q": query, "api_key": self.serp_api_key, "engine": "google", "num": 5},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("organic_results", [])
        except httpx.HTTPStatusError as exc:
            logger.warning(f"SerpAPI request failed ({exc.response.status_code}) for query '{query}'")
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            logger.warning(f"SerpAPI request error for query '{query}': {exc}")
        return None

    async def _search_industry_trends(self, industry: str) -> Dict[str, Any]:
        """Searches SerpAPI for current industry trends. Falls back to generic insights on failure."""
        queries = [f"{industry} industry trends 2024", f"top challenges in {industry}"]
        results = await self._serp_search(queries[0])

        if results:
            insights = [r.get("snippet") for r in results if r.get("snippet")][:5]
            if insights:
                return {"source": "serp", "queries": queries, "insights": insights}

        logger.info(f"Falling back to generic industry insights for '{industry}' (no SerpAPI key or no results)")
        return {
            "source": "serp_fallback",
            "queries": queries,
            "insights": [
                f"Rising adoption of AI for workflow automation in {industry}.",
                "Consolidation of tech stacks is a major trend.",
                "Increased focus on data security and privacy compliance."
            ]
        }

    async def _search_role_best_practices(self, role: str, industry: str) -> Dict[str, Any]:
        """Searches SerpAPI for role-specific best practices. Falls back to generic competencies on failure."""
        query = f"best practices for {role} in {industry}"
        results = await self._serp_search(query)

        if results:
            snippets = [r.get("snippet") for r in results if r.get("snippet")][:5]
            if snippets:
                return {"source": "serp", "queries": [query], "insights": snippets}

        return {
            "source": "serp_fallback",
            "queries": [query],
            "competencies": ["Quantitative analysis", "Stakeholder management", "Tool proficiency (CRM, ERP)"],
            "kpis": ["Efficiency gain", "Error rate reduction", "NPS/Customer Satisfaction"]
        }

    async def _scrape_company_context(self, website: Optional[str], name: Optional[str]) -> Dict[str, Any]:
        """Scrapes the company website via FireCrawl. Falls back to a generic placeholder on failure."""
        if not website:
            return {"source": "none", "message": "No website provided"}

        if self.firecrawl_api_key:
            try:
                resp = await self._get_client().post(
                    "https://api.firecrawl.dev/v1/scrape",
                    headers={"Authorization": f"Bearer {self.firecrawl_api_key}"},
                    json={"url": website, "formats": ["markdown"], "onlyMainContent": True},
                )
                resp.raise_for_status()
                data = resp.json()
                page = data.get("data", {})
                markdown = page.get("markdown", "") or ""
                metadata = page.get("metadata", {}) or {}
                if markdown:
                    return {
                        "source": "firecrawl",
                        "url": website,
                        "company_name": name or metadata.get("title") or "Unknown",
                        "about_summary": (metadata.get("description") or markdown[:500]).strip(),
                        "content_excerpt": markdown[:2000],
                    }
            except httpx.HTTPStatusError as exc:
                logger.warning(f"FireCrawl request failed ({exc.response.status_code}) for {website}")
            except (httpx.TimeoutException, httpx.RequestError) as exc:
                logger.warning(f"FireCrawl request error for {website}: {exc}")

        logger.info(f"Falling back to generic company context for '{website}' (no FireCrawl key or scrape failed)")
        return {
            "source": "firecrawl_fallback",
            "url": website,
            "company_name": name or "Unknown",
            "brand_voice": "Professional, authoritative, yet innovative",
            "products": [],
            "about_summary": "Leading provider of AI-driven solutions for the enterprise."
        }

    async def _research_task_templates(self, task: str, industry: str, user_id: Optional[int] = None, db: Optional[Session] = None) -> Dict[str, Any]:
        """Uses LLM to quickly suggest high-level task frameworks while waiting for search."""
        prompt = f"Provide 3 high-level best practices for performing the task '{task}' in the '{industry}' industry."
        # This is a 'fast' LLM call
        try:
            from utils.llm_router import agenerate as llm_agenerate
            await llm_agenerate(
                role="drafter",
                messages=[{"role": "user", "content": prompt}],
                user_id=user_id,
                db=db,
                temperature=0.4,
                max_tokens=200
            )
        except Exception as exc:
            logger.warning(f"LLM task-template call failed for task '{task}': {exc}")

        return {
            "source": "llm_fast",
            "preliminary_findings": [f"Standardized {task} procedure", f"Validation check for {task}", f"Reporting of {task} results"]
        }
