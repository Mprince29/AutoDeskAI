"""
Minimal regression net for BackgroundResearcher's real-call/fallback paths.
"""
import pytest

from services.background_researcher import BackgroundResearcher


@pytest.mark.asyncio
async def test_search_industry_trends_falls_back_without_api_key(monkeypatch):
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    researcher = BackgroundResearcher()
    result = await researcher._search_industry_trends("fintech")
    assert result["source"] == "serp_fallback"
    assert len(result["insights"]) > 0
    await researcher.aclose()


@pytest.mark.asyncio
async def test_scrape_company_context_no_website_short_circuits():
    researcher = BackgroundResearcher()
    result = await researcher._scrape_company_context(None, "Acme Inc")
    assert result == {"source": "none", "message": "No website provided"}
    await researcher.aclose()


@pytest.mark.asyncio
async def test_scrape_company_context_falls_back_without_api_key(monkeypatch):
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    researcher = BackgroundResearcher()
    result = await researcher._scrape_company_context("https://acme.example.com", "Acme Inc")
    assert result["source"] == "firecrawl_fallback"
    assert result["company_name"] == "Acme Inc"
    await researcher.aclose()


@pytest.mark.asyncio
async def test_search_industry_trends_uses_real_serp_response(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"organic_results": [{"snippet": "AI adoption is accelerating in fintech."}]}

    class FakeClient:
        is_closed = False

        async def get(self, url, params=None):
            return FakeResponse()

    researcher = BackgroundResearcher()
    researcher.serp_api_key = "fake-key"
    researcher._client = FakeClient()

    result = await researcher._search_industry_trends("fintech")
    assert result["source"] == "serp"
    assert "AI adoption is accelerating in fintech." in result["insights"]
