import asyncio
import json
import base64
import httpx
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, urlunparse
from bs4 import BeautifulSoup
from google import genai
from google.genai import types
import litellm
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)
import logging
from services.journalist.prompts import GEMINI_RESEARCH_PROMPT
from services.journalist.personas import PERSONA_CONFIGS, DEFAULT_PERSONA

_logger = logging.getLogger(__name__)

def _is_rate_limit_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(kw in msg for kw in ("rate limit", "429", "quota", "resource_exhausted", "too many requests"))


class JournalistGeminiService:
    def __init__(self, gemini_key: str = "", openai_key: str = ""):
        self.genai_client = genai.Client(api_key=gemini_key) if gemini_key else None
        self.openai_key = openai_key  # used for DALL-E via litellm.aimage_generation

    def _require_gemini_client(self) -> genai.Client:
        if not self.genai_client:
            raise RuntimeError(
                "Gemini API key is missing. Please add it in Settings → AI Provider before using AI Journalist."
            )
        return self.genai_client

    @staticmethod
    def _normalize_url(url: str) -> Optional[str]:
        raw = (url or "").strip()
        if not raw:
            return None
        if raw.startswith("//"):
            raw = f"https:{raw}"
        elif "://" not in raw:
            raw = f"https://{raw}"

        try:
            parsed = urlparse(raw)
        except Exception:
            return None

        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return None

        netloc = parsed.netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        if netloc in {"example.com", "localhost"}:
            return None

        cleaned = parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=netloc,
            fragment="",
        )
        return urlunparse(cleaned)

    @staticmethod
    def _extract_candidate_urls(text: str) -> List[str]:
        if not text:
            return []
        candidates = []
        for token in text.replace("(", " ").replace(")", " ").split():
            token = token.strip(" \t\r\n'\"[]<>,.;")
            if token.startswith(("http://", "https://", "www.")):
                candidates.append(token)
        return candidates

    async def _validate_source(self, source: Dict[str, Any], fallback_title: str = "") -> Optional[Dict[str, str]]:
        normalized = self._normalize_url(str(source.get("url", "")))
        if not normalized:
            return None

        title = (str(source.get("title", "")) or fallback_title or normalized).strip()[:200]
        description = (str(source.get("description", "")) or "").strip()[:200]

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, verify=False) as client:
                response = await client.head(normalized)
                if response.status_code in {403, 405}:
                    response = await client.get(normalized)
                if response.status_code >= 400:
                    return None
                final_url = self._normalize_url(str(response.url)) or normalized
        except Exception:
            return None

        return {
            "title": title or final_url,
            "url": final_url,
            "description": description or "Verified source",
        }

    async def _finalize_sources(
        self,
        raw_sources: Any,
        raw_research_text: str,
        user_sources: Optional[List[str]] = None,
        grounding_candidates: Optional[List[Dict[str, str]]] = None,
    ) -> List[Dict[str, str]]:
        candidates: List[Dict[str, str]] = []

        # Priority 1: real Gemini grounding URLs (never hallucinated — from search metadata)
        for item in grounding_candidates or []:
            candidates.append(item)

        # Priority 2: step-2 structured sources (only used when no grounding metadata)
        if isinstance(raw_sources, list):
            for item in raw_sources:
                if isinstance(item, dict):
                    candidates.append(item)

        # Priority 3: inline URLs extracted from the raw research text
        for url in self._extract_candidate_urls(raw_research_text):
            candidates.append({"title": "", "url": url, "description": "Referenced in research notes"})

        for url in user_sources or []:
            candidates.append({"title": "", "url": url, "description": "Provided by the user"})

        seen_input_urls = set()
        deduped_candidates = []
        for item in candidates:
            normalized = self._normalize_url(str(item.get("url", "")))
            if not normalized or normalized in seen_input_urls:
                continue
            seen_input_urls.add(normalized)
            item = dict(item)
            item["url"] = normalized
            deduped_candidates.append(item)

        validated = await asyncio.gather(
            *(self._validate_source(item) for item in deduped_candidates[:12])
        )

        finalized = []
        seen_final_urls = set()
        for item in validated:
            if not item:
                continue
            if item["url"] in seen_final_urls:
                continue
            seen_final_urls.add(item["url"])
            finalized.append(item)
            if len(finalized) >= 8:
                break
        return finalized

    @staticmethod
    async def _serpapi_web_search(query: str, num_results: int = 8) -> List[Dict[str, str]]:
        """
        Search the web via SerpAPI (SERPAPI_API_KEY env var) and return
        a list of {title, url, description, content} dicts for the top results.
        Falls back to an empty list if the key is missing or the call fails.
        """
        import os
        api_key = os.getenv("SERPAPI_API_KEY", "")
        if not api_key:
            return []
        try:
            def _run() -> dict:
                from serpapi import GoogleSearch
                return GoogleSearch({
                    "q": query,
                    "num": num_results,
                    "api_key": api_key,
                }).get_dict()

            raw = await asyncio.to_thread(_run)
            results = []
            for r in raw.get("organic_results", []):
                link = r.get("link", "")
                if link:
                    results.append({
                        "title": r.get("title", ""),
                        "url": link,
                        "description": r.get("snippet", ""),
                    })
            print(f"Journalist Research: SerpAPI returned {len(results)} organic results.")
            return results
        except Exception as e:
            print(f"Journalist Research: SerpAPI search failed: {e}")
            return []

    async def _scrape_url(self, url: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, verify=False) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, "html.parser")
                    for tag in soup(["script", "style"]):
                        tag.decompose()
                    text = soup.get_text(separator=" ", strip=True)
                    return f"SOURCE CONTENT ({url}): {text[:2000]}..."
            return ""
        except Exception as e:
            print(f"Failed to scrape {url}: {e}")
            return ""

    async def generate_cover_image(self, topic: str, category: str, article_content: Optional[str] = None) -> str:
        gemini_client = self.genai_client

        # Build a more descriptive prompt if content is provided
        context_prompt = ""
        if article_content:
            # Extract key entities or first few sentences for better visual grounding
            context_prompt = f" Based on this article summary: {article_content[:500]}..."

        prompt = (
            f"A professional, high-fidelity editorial real photo for an article about "
            f"{topic} in the {category} category.{context_prompt} Real photography, photo-journalism style, "
            f"cinematic lighting, ultra-realistic, 8k resolution, journalist style, no text. "
            f"Lens: 35mm f/1.8. Avoid illustrations, 3D renders, or digital art."
        )

        # Use Gemini 2.5 Flash for high-quality editorial covers (verified stable)
        if gemini_client:
            try:
                response = gemini_client.models.generate_content(
                    model="models/gemini-2.0-flash",
                    contents=[
                        {
                            "role": "user",
                            "parts": [{"text": prompt}],
                        }
                    ],
                )

                for part in response.candidates[0].content.parts:
                    if hasattr(part, "inline_data") and part.inline_data:
                        image_bytes = part.inline_data.data
                        mime = part.inline_data.mime_type or "image/png"
                        optimized_b64 = self._optimize_image(image_bytes, mime)
                        return optimized_b64

            except Exception as e:
                print(f"Gemini Nano Banana failed: {e}")

        # Fallback 2: DALL-E 3 via LiteLLM (async, non-blocking)
        if self.openai_key:
            try:
                resp = await litellm.aimage_generation(
                    model="dall-e-3",
                    prompt=prompt,
                    size="1024x1024",
                    response_format="b64_json",
                    api_key=self.openai_key,
                )
                b64 = resp.data[0].b64_json if resp.data else None
                if b64:
                    image_bytes = base64.b64decode(b64)
                    return self._optimize_image(image_bytes, "image/png")
            except Exception as e:
                print(f"Journalist Image: DALL-E fallback failed: {e}")

        # Fallback 3: SerpAPI Google Images (stock photo, no AI generation needed)
        import os as _os
        serpapi_key = _os.getenv("SERPAPI_API_KEY", "")
        if serpapi_key:
            try:
                def _serpapi_img():
                    from serpapi import GoogleSearch
                    return GoogleSearch({
                        "engine": "google_images",
                        "q": f"{topic} {category} editorial journalism",
                        "api_key": serpapi_key,
                        "num": 10,
                        "safe": "active",
                    }).get_dict()

                result = await asyncio.wait_for(asyncio.to_thread(_serpapi_img), timeout=12.0)
                images = result.get("images_results", [])
                for img in (images[:8]):
                    url = img.get("original", "")
                    if url and url.startswith("https://"):
                        # Fetch and base64-encode so it matches the expected return format
                        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, verify=False) as client:
                            resp = await client.get(url)
                            if resp.status_code == 200:
                                mime = resp.headers.get("content-type", "image/jpeg").split(";")[0]
                                optimized = self._optimize_image(resp.content, mime)
                                print(f"Journalist Image: SerpAPI stock photo used for '{topic[:40]}'")
                                return optimized
            except Exception as e:
                print(f"Journalist Image: SerpAPI image fallback failed: {e}")

        # Fallback 4: Unsplash Source redirect (free, no key needed)
        try:
            import urllib.request as _urllib
            safe_q = f"{topic} {category}".replace(" ", "+")[:120]

            def _unsplash():
                req = _urllib.Request(
                    f"https://source.unsplash.com/1200x800/?{safe_q}",
                    headers={"User-Agent": "Mozilla/5.0 (compatible; JournalistBot/1.0)"},
                )
                with _urllib.urlopen(req, timeout=10) as resp:
                    final_url = resp.url
                    if "images.unsplash.com" in final_url:
                        return final_url
                return None

            unsplash_url = await asyncio.wait_for(asyncio.to_thread(_unsplash), timeout=12.0)
            if unsplash_url:
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                    resp = await client.get(unsplash_url)
                    if resp.status_code == 200:
                        mime = resp.headers.get("content-type", "image/jpeg").split(";")[0]
                        optimized = self._optimize_image(resp.content, mime)
                        print(f"Journalist Image: Unsplash stock photo used for '{topic[:40]}'")
                        return optimized
        except Exception as e:
            print(f"Journalist Image: Unsplash fallback failed: {e}")

        raise RuntimeError(
            "Cover image generation failed: no image provider succeeded. "
            "Add a Gemini or OpenAI key in Settings → AI Provider for AI-generated images."
        )

    def _optimize_image(self, image_bytes: bytes, mime_type: str) -> str:
        """
        Compress and resize image if necessary to ensure it's < 1MB.
        Converts to JPEG for better compression.
        """
        from PIL import Image
        import io

        # If already small enough (base64 is ~1.33x original, 1.3MB base64 approx 1MB file)
        if len(image_bytes) < 900000:
            b64 = base64.b64encode(image_bytes).decode("utf-8")
            return f"data:{mime_type};base64,{b64}"

        try:
            img = Image.open(io.BytesIO(image_bytes))
            
            # Convert RGBA to RGB if saving to JPEG
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            
            # Initial compression
            output = io.BytesIO()
            img.save(output, format="JPEG", quality=85, optimize=True)
            
            # If still too large, resize
            if output.tell() > 1000000:
                # Reduce resolution by 25%
                new_size = (int(img.width * 0.75), int(img.height * 0.75))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
                output = io.BytesIO()
                img.save(output, format="JPEG", quality=75, optimize=True)
            
            data = output.getvalue()
            b64 = base64.b64encode(data).decode("utf-8")
            return f"data:image/jpeg;base64,{b64}"
            
        except Exception as e:
            print(f"Image optimization failed: {e}")
            # Fallback to original if optimization fails, better than nothing
            b64 = base64.b64encode(image_bytes).decode("utf-8")
            return f"data:{mime_type};base64,{b64}"

    async def conduct_research(
        self,
        topic: str,
        category: str,
        tone: str,
        target_audience: str,
        persona: str = "Analytical",
        enable_web_search: bool = True,
        sources: Optional[List[str]] = None,
        grounding_sources: Optional[List[dict]] = None,
        history: Optional[List[dict]] = None,
        llm_svc=None,  # JournalistLLMService fallback when no Gemini key
        brand_voice: str = "Professional",
        language: str = "English",
    ) -> dict:
        gemini_client = self.genai_client  # may be None when no Gemini key
        source_context = ""
        if sources:
            # Parallel scraping for significantly faster research
            scrape_tasks = [self._scrape_url(url) for url in sources]
            scraped_results = await asyncio.gather(*scrape_tasks)
            scraped = [content for content in scraped_results if content]
            if scraped:
                source_context = "\n\nACTUAL SOURCE MATERIAL PROVIDED BY USER (WEB):\n" + "\n---\n".join(scraped)

        grounding_context = ""
        if grounding_sources:
            docs = []
            for doc in grounding_sources:
                name = doc.get("name", "Unknown Document")
                body = doc.get("content", "")
                if body:
                    docs.append(f"DOCUMENT ({name}): {body[:3000]}...")
            if docs:
                grounding_context = "\n\nGROUNDED SOURCE MATERIAL (UPLOADED FILES):\n" + "\n---\n".join(docs)

        history_context = ""
        if history:
            history_context = "\n\nCHAT HISTORY CONTEXT:\n"
            for msg in history[-3:]:
                role = "User" if msg["role"] == "user" else "Assistant/Previous Article"
                content = msg["content"][:500] + "..." if len(msg["content"]) > 500 else msg["content"]
                history_context += f"{role}: {content}\n"

        prompt = GEMINI_RESEARCH_PROMPT.format(
            topic=topic,
            category=category,
            tone=tone,
            target_audience=target_audience,
        )

        if source_context:
            prompt += source_context + "\n\nINSTRUCTION: Analyze the web source material above."
        if grounding_context:
            prompt += grounding_context + "\n\nINSTRUCTION: CRITICAL. This is the user's uploaded material. Prioritize these insights over web research."
        if history_context:
            prompt += history_context + "\n\nINSTRUCTION: Consider the conversation history above."
            
        prompt += f"\n\nTARGET OUTPUT LANGUAGE: {language}"

        from services.journalist.personas import PERSONA_CONFIGS, DEFAULT_PERSONA, BRAND_VOICE_CONFIGS, DEFAULT_BRAND_VOICE
        persona_data = PERSONA_CONFIGS.get(persona, PERSONA_CONFIGS[DEFAULT_PERSONA])
        prompt += (
            f"\n\nJOURNALISTIC PERSONA: {persona}\n"
            f"Description: {persona_data['description']}\n"
            f"Specific Research Focus: {persona_data['style_instructions']}"
        )

        bv_data = BRAND_VOICE_CONFIGS.get(brand_voice, BRAND_VOICE_CONFIGS[DEFAULT_BRAND_VOICE])
        prompt += f"\n\nBRAND VOICE: {brand_voice}\nPublication Perspective: {bv_data['description']}\nTarget Writing Style: {bv_data['style_instructions']}"

        # Real grounding URLs extracted from Gemini's search metadata (never hallucinated)
        grounding_candidates: List[Dict[str, str]] = []

        # ── Step 1: Gather raw research ────────────────────────────────────────────────
        if gemini_client and enable_web_search:
            tools = [types.Tool(google_search=types.GoogleSearch())]
            print("Journalist Research: Initializing Google Search Tooling...")
            step1_config = types.GenerateContentConfig(
                tools=tools,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            )
            print("Journalist Research: Sending payload to Gemini with web search...")

            @retry(
                retry=retry_if_exception_type(Exception),
                stop=stop_after_attempt(4),
                wait=wait_exponential(multiplier=2, min=4, max=30),
                reraise=True,
            )
            async def _step1_with_retry():
                return await gemini_client.aio.models.generate_content(
                    model="models/gemini-2.0-flash",
                    contents=prompt,
                    config=step1_config,
                )

            step1_response = await _step1_with_retry()
            raw_research_text = step1_response.text or ""
            if not raw_research_text:
                print("Journalist Research: Step 1 returned no text (grounding-only or blocked). Using prompt as base.")
                raw_research_text = prompt
            else:
                print(f"Journalist Research: Step 1 complete ({len(raw_research_text)} chars). Structuring...")

            # Always use SerpAPI for verified source URLs (Gemini grounding metadata is unreliable)
            serp_results = await self._serpapi_web_search(topic, num_results=8)
            if serp_results:
                grounding_candidates.extend(serp_results)
                print(f"Journalist Research: SerpAPI returned {len(serp_results)} verified sources.")
            else:
                print("Journalist Research: SerpAPI returned no results for sources.")

        elif enable_web_search:
            # No Gemini key — use SerpAPI for both research context and sources
            print("Journalist Research: No Gemini key, using SerpAPI for research...")
            serp_results = await self._serpapi_web_search(topic, num_results=8)
            if serp_results:
                grounding_candidates.extend(serp_results)
                scrape_tasks = [self._scrape_url(r["url"]) for r in serp_results[:5]]
                scraped = [c for c in await asyncio.gather(*scrape_tasks) if c]
                serp_context = "\n\nWEB SEARCH RESULTS (via SerpAPI):\n"
                for r in serp_results:
                    serp_context += f"\n[{r['title']}] {r['url']}\n{r['description']}\n"
                if scraped:
                    serp_context += "\n\nSCRAPED ARTICLE CONTENT:\n" + "\n---\n".join(scraped)
                raw_research_text = prompt + serp_context
                print(f"Journalist Research: SerpAPI — {len(grounding_candidates)} sources, {len(scraped)} scraped.")
            else:
                print("Journalist Research: SerpAPI returned no results, proceeding with topic knowledge only.")
                raw_research_text = prompt
        else:
            # Web search explicitly disabled
            print("Journalist Research: Web search disabled by user.")
            raw_research_text = prompt

        # ── Step 2: Structure raw research into clean JSON ─────────────────────────────
        structure_prompt = f"""You are a research analyst. Convert the raw research notes below into a structured JSON object.

Raw Research:
\"\"\"
{raw_research_text[:8000]}
\"\"\"

Return ONLY this JSON structure filled with insights from the research above:
{{
  "core_facts": ["fact1", "fact2", "fact3"],
  "statistics": ["stat with context 1", "stat with context 2"],
  "trends": ["trend1", "trend2", "trend3"],
  "contrarian_perspectives": ["contrarian view 1", "contrarian view 2"],
  "hidden_challenges": ["challenge1", "challenge2"],
  "stakeholders": ["stakeholder + role 1", "stakeholder + role 2"],
  "examples": ["example1", "example2"],
  "data_insights": [
    {{"label": "Metric name", "value": 0.0, "context": "Short context"}}
  ]
}}

Rules: Keep all strings under 200 chars. Return ONLY valid JSON. No markdown. No preamble."""

        # Brief pause to avoid consecutive Gemini calls hitting RPM limits
        if gemini_client:
            await asyncio.sleep(2)

        step2_text = ""
        if gemini_client:
            # Prefer Gemini for JSON structuring (JSON mode, no tools)
            step2_config = types.GenerateContentConfig(
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            )

            @retry(
                retry=retry_if_exception_type(Exception),
                stop=stop_after_attempt(4),
                wait=wait_exponential(multiplier=2, min=4, max=30),
                reraise=True,
            )
            async def _step2_with_retry():
                return await gemini_client.aio.models.generate_content(
                    model="models/gemini-2.0-flash",
                    contents=structure_prompt,
                    config=step2_config,
                )

            step2_response = await _step2_with_retry()
            step2_text = step2_response.text or ""
        elif llm_svc:
            # Fallback: use the available LiteLLM provider for structuring
            import litellm as _litellm
            _litellm.drop_params = True
            _r = await _litellm.acompletion(
                model=llm_svc.model_small,
                messages=[
                    {"role": "system", "content": "You are a research analyst. Return ONLY valid JSON, no markdown."},
                    {"role": "user", "content": structure_prompt},
                ],
                response_format={"type": "json_object"},
                **llm_svc._call_kwargs(llm_svc.model_small),
            )
            step2_text = _r.choices[0].message.content or ""
        else:
            step2_text = ""

        try:
            result = json.loads(step2_text)
            # Prefer real grounding URLs (from Gemini metadata) over step-2 hallucinated sources.
            step2_sources = result.get("sources") if not grounding_candidates else None
            result["sources"] = await self._finalize_sources(
                step2_sources,
                raw_research_text,
                user_sources=sources,
                grounding_candidates=grounding_candidates,
            )
            print(f"Journalist Research:  Step 2 structured successfully. Keys: {list(result.keys())}")
            return result
        except Exception as parse_err:
            raw_preview = step2_text[:300]
            print(f"[Journalist Research] Step 2 JSON parse failed: {parse_err}. Raw: {raw_preview}")
            return {
                "core_facts": [],
                "statistics": [],
                "trends": [],
                "contrarian_perspectives": [],
                "hidden_challenges": [],
                "stakeholders": [],
                "examples": [],
                "data_insights": [],
                "sources": [],
            }
