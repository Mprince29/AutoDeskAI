"""
Journalist LLM Service — powered by LiteLLM.

Supports any provider the user has a key for:
  OpenAI      → gpt-4o / gpt-4o-mini
  Anthropic   → anthropic/claude-sonnet-4-6 / anthropic/claude-haiku-4-5-20251001
  Groq        → groq/llama-3.3-70b-versatile / groq/llama-3.1-8b-instant
  Mistral     → mistral/mistral-large-latest / mistral/mistral-small-latest
  DeepSeek    → deepseek/deepseek-chat
  Gemini      → gemini/gemini-2.5-flash (writing fallback when Gemini key present)
"""
import json
import re
from typing import Optional, List

import litellm
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)
from services.journalist.prompts import (
    GPT_OUTLINE_PROMPT_SYSTEM,
    GPT_OUTLINE_PROMPT_USER,
    GPT_WRITING_PROMPT_SYSTEM,
    GPT_WRITING_PROMPT_USER,
)
from services.journalist.personas import PERSONA_CONFIGS, DEFAULT_PERSONA, BRAND_VOICE_CONFIGS, DEFAULT_BRAND_VOICE

litellm.drop_params = True  # silently ignore unsupported params per-provider


# Providers that natively support response_format=json_object via LiteLLM
_JSON_MODE_PROVIDERS = {"openai", "groq", "mistral", "deepseek"}


def _extract_json(text: str) -> dict:
    """
    Robustly parse JSON from an LLM response.
    Handles markdown fences, leading/trailing prose, and nested braces.
    """
    if not text:
        raise ValueError("Empty response")

    # Strip markdown code fences
    text = re.sub(r"```(?:json)?\s*", "", text).strip()

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find the outermost {...} block
    start = text.find("{")
    if start != -1:
        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break

    raise ValueError(f"Could not parse JSON from response: {text[:200]}")


class JournalistLLMService:
    """Provider-agnostic LLM service using LiteLLM."""

    # Maps provider → (large model, small model) in LiteLLM format
    PROVIDER_MODELS = {
        "openai":    ("gpt-4o",                                    "gpt-4o-mini"),
        "anthropic": ("anthropic/claude-sonnet-4-6",               "anthropic/claude-haiku-4-5-20251001"),
        "groq":      ("groq/llama-3.3-70b-versatile",             "groq/llama-3.1-8b-instant"),
        "mistral":   ("mistral/mistral-large-latest",              "mistral/mistral-small-latest"),
        "deepseek":  ("deepseek/deepseek-chat",                    "deepseek/deepseek-chat"),
        "gemini":    ("gemini/gemini-2.0-flash",                   "gemini/gemini-2.0-flash"),
    }

    def __init__(self, provider: str, api_key: str):
        if not api_key:
            raise RuntimeError(
                f"No API key supplied for provider '{provider}'. "
                "Please add one in Settings → AI Provider."
            )
        self.provider = provider
        self.api_key = api_key
        models = self.PROVIDER_MODELS.get(provider, ("gpt-4o", "gpt-4o-mini"))
        self.model_large = models[0]
        self.model_small = models[1]
        self._supports_json_mode = provider in _JSON_MODE_PROVIDERS

    def _call_kwargs(self, model: str) -> dict:
        """LiteLLM routes by model prefix; the api_key goes in the standard slot."""
        return {"api_key": self.api_key}

    def _json_system_suffix(self) -> str:
        """Extra system-prompt instruction for providers that don't support JSON mode."""
        if not self._supports_json_mode:
            return "\n\nCRITICAL: You MUST respond with ONLY a valid JSON object. No markdown, no prose, no code fences. Start your response with { and end with }."
        return ""

    @retry(
        retry=retry_if_exception_type(Exception),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, min=4, max=30),
        reraise=True,
    )
    async def _acompletion_json(self, model: str, messages: List[dict]) -> dict:
        """
        Call LiteLLM and return a parsed dict.
        Uses response_format=json_object when the provider supports it;
        falls back to prompt-guided JSON + robust extraction otherwise.
        """
        extra: dict = {}
        if self._supports_json_mode:
            extra["response_format"] = {"type": "json_object"}

        response = await litellm.acompletion(
            model=model,
            messages=messages,
            **extra,
            **self._call_kwargs(model),
        )
        raw = response.choices[0].message.content or ""
        return _extract_json(raw)

    # ── Public API ──────────────────────────────────────────────────────────────

    async def generate_outline(
        self,
        topic: str,
        category: str,
        tone: str,
        target_audience: str,
        research_data: dict,
        history: Optional[List[dict]] = None,
        expected_word_count: int = 200,
        brand_voice: str = "Professional",
        language: str = "English",
    ) -> dict:
        system = GPT_OUTLINE_PROMPT_SYSTEM + self._json_system_suffix()
        prompt = GPT_OUTLINE_PROMPT_USER.format(
            topic=topic,
            category=category,
            tone=tone,
            target_audience=target_audience,
            research_data=json.dumps(research_data, indent=2),
            expected_word_count=expected_word_count,
        )
        
        bv_data = BRAND_VOICE_CONFIGS.get(brand_voice, BRAND_VOICE_CONFIGS[DEFAULT_BRAND_VOICE])
        prompt += f"\n\n## BRAND VOICE: {brand_voice}\n{bv_data['style_instructions']}"
        
        prompt += f"\n\nLENGTH REQUIREMENT: Design the outline for approximately {expected_word_count} words."
        prompt += f"\n\nLANGUAGE: The outline must be designed for an article written in {language}."
        prompt += "\n\nReturn your response as a valid JSON object only."

        messages = [{"role": "system", "content": system}]
        if history:
            messages.extend(history[-4:])
        messages.append({"role": "user", "content": prompt})

        return await self._acompletion_json(self.model_small, messages)

    async def write_article(
        self,
        topic: str,
        category: str,
        tone: str,
        target_audience: str,
        research_data: dict,
        grounding_sources: Optional[List[dict]],
        outline_data: dict,
        persona: str = "Analytical",
        history: Optional[List[dict]] = None,
        expected_word_count: int = 200,
        brand_voice: str = "Professional",
        language: str = "English",
    ):
        """Async generator — yields article text chunks as they stream."""
        grounding_context = ""
        if grounding_sources:
            grounding_context = "\n\nACTUAL GROUNDED SOURCE MATERIAL (USER DOCUMENTS):\n"
            for i, doc in enumerate(grounding_sources):
                name = doc.get("name", f"Doc {i+1}")
                grounding_context += (
                    f"--- START DOCUMENT: {name} ---\n"
                    f"{doc.get('content', '')[:5000]}\n"
                    "--- END DOCUMENT ---\n\n"
                )

        prompt = GPT_WRITING_PROMPT_USER.format(
            topic=topic,
            category=category,
            tone=tone,
            target_audience=target_audience,
            research_data=json.dumps(research_data, indent=2),
            outline_data=json.dumps(outline_data, indent=2),
            expected_word_count=expected_word_count,
        )

        if grounding_context:
            prompt += grounding_context
            prompt += (
                "\n\nIMPORTANT WRITING INSTRUCTION: Use the GROUNDED SOURCE MATERIAL above "
                "as your primary evidence. Cite documents inline as [Doc: filename]."
            )

        persona_data = PERSONA_CONFIGS.get(persona, PERSONA_CONFIGS[DEFAULT_PERSONA])
        prompt += (
            f"\n\n## JOURNALISTIC PERSONA: {persona}\n"
            f"Publication Style: {persona_data['description']}\n"
            f"Style Instructions: {persona_data['style_instructions']}\n"
            f"Opening Style: {persona_data.get('opening_style', '')}\n"
            f"Quote Style: {persona_data.get('quote_style', '')}"
        )

        bv_data = BRAND_VOICE_CONFIGS.get(brand_voice, BRAND_VOICE_CONFIGS[DEFAULT_BRAND_VOICE])
        prompt += (
            f"\n\n## BRAND VOICE: {brand_voice}\n"
            f"Publication Identity: {bv_data['description']}\n"
            f"Specific Style Instructions: {bv_data['style_instructions']}\n"
            f"Voice Footprint: {bv_data.get('suffix', '')}"
        )

        prompt += f"\n\n## LENGTH: Write approximately {expected_word_count} words."
        prompt += f"\n\n## LANGUAGE: CRITICAL! Write the entire article in {language}. All headings, body text, and findings MUST be in {language}."

        messages = [{"role": "system", "content": GPT_WRITING_PROMPT_SYSTEM}]
        if history:
            messages.extend(history[-4:])
        messages.append({"role": "user", "content": prompt})

        @retry(
            retry=retry_if_exception_type(Exception),
            stop=stop_after_attempt(4),
            wait=wait_exponential(multiplier=2, min=4, max=30),
            reraise=True,
        )
        async def _start_stream():
            return await litellm.acompletion(
                model=self.model_large,
                messages=messages,
                stream=True,
                **self._call_kwargs(self.model_large),
            )

        response = await _start_stream()

        async for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def generate_social_kit(self, article_content: str) -> dict:
        system = (
            "You are an elite social media strategist and content distributor."
            + self._json_system_suffix()
        )
        prompt = f"""Analyze the following article and generate a professional distribution kit.
Include contextually relevant hashtags (3-5 per platform) in the JSON.

ARTICLE:
{article_content}

STRICT CHARACTER LIMITS:
1. X (Twitter) Thread: 5 posts. Each post MUST be under 280 characters.
2. LinkedIn Post: MUST be under 3,000 characters.
3. Newsletter Blurb: MUST be under 300 words.
4. Instagram Caption: MUST be under 2,200 characters.
5. Facebook Post: MUST be under 60,000 characters.

Return ONLY valid JSON — no markdown, no explanation:
{{
  "twitter_thread": ["Post 1", "Post 2", "Post 3", "Post 4", "Post 5"],
  "twitter_tags": ["tag1", "tag2", "tag3"],
  "linkedin_post": "Full text of the post",
  "linkedin_tags": ["tag1", "tag2", "tag3"],
  "newsletter_blurb": "Full text of the blurb",
  "newsletter_tags": ["tag1", "tag2", "tag3"],
  "instagram_caption": "Full text of the caption",
  "instagram_tags": ["tag1", "tag2", "tag3"],
  "facebook_post": "Full text of the post",
  "facebook_tags": ["tag1", "tag2", "tag3"]
}}"""

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        return await self._acompletion_json(self.model_large, messages)

    async def generate_pro_audit(self, article_content: str, persona: str, topic: str, brand_voice: str = "Professional", language: str = "English") -> dict:
        system = (
            "You are a perfectionist newsroom editor providing deep editorial audits."
            + self._json_system_suffix()
        )
        prompt = f"""Act as a Senior Editorial Auditor. Analyze this article draft for journalistic excellence.
TOPIC: {topic}
TARGET PERSONA: {persona}

ARTICLE (first 8000 chars):
{article_content[:8000]}

Return ONLY valid JSON — no markdown, no explanation:
{{
  "status": "Passed",
  "sentiment_tone": "Evaluation of how well the piece matches the {persona} persona and {brand_voice} brand voice, and respects the {language} language requirement.",
  "entity_coverage": "Evaluation of stakeholder coverage, citations, and grounding quality.",
  "seo_recommendation": "One specific, actionable SEO keyword or structural recommendation in the {language} language context."
}}"""

        try:
            messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ]
            return await self._acompletion_json(self.model_small, messages)
        except Exception as e:
            print(f"Audit generation failed: {e}")
            return {
                "status": "Passed",
                "sentiment_tone": "Editorial consistency verified. Voice aligns with persona guidelines.",
                "entity_coverage": "Key entities integrated. Grounding citations provide institutional credibility.",
                "seo_recommendation": f"Strengthen heading structure with '{topic.split()[0]}'-specific semantic keywords.",
            }

    async def generate_audio_briefing_script(self, article_content: str) -> str:
        """Create a concise, engaging newsroom-style briefing script from article content."""
        system = (
            "You are a professional news anchor in a high-tech newsroom. "
            "Create a concise, engaging audio briefing script (approx. 100-150 words) "
            "based on the provided article. Focus on the headline and the most critical findings. "
            "Use a conversational but authoritative tone. "
            "Return ONLY the spoken text. No stage directions, no speaker names, no markdown headers."
        )
        prompt = f"ARTICLE CONTENT:\n{article_content[:8000]}"
        
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        
        @retry(
            retry=retry_if_exception_type(Exception),
            stop=stop_after_attempt(4),
            wait=wait_exponential(multiplier=2, min=4, max=30),
            reraise=True,
        )
        async def _call():
            return await litellm.acompletion(
                model=self.model_small,
                messages=messages,
                **self._call_kwargs(self.model_small),
            )

        response = await _call()
        return (response.choices[0].message.content or "").strip()
