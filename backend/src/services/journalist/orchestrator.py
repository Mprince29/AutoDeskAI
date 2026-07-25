import json
import os
import re
import time
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy.orm.attributes import flag_modified
from services.journalist.gemini_service import JournalistGeminiService
from services.journalist.llm_service import JournalistLLMService
from loguru import logger
from auth.database import SessionLocal
from auth.models import User
from models import JournalistReport

# Ordered preference list for LLM writing tasks.
# First provider whose key is available wins.
_LLM_PROVIDER_PREFERENCE = ["openai", "anthropic", "mistral", "groq", "deepseek", "gemini"]


def _resolve_journalist_keys(user_email: str, db) -> Tuple[str, str, str]:
    """
    Resolve keys for the AI Journalist pipeline.

    Returns:
        (gemini_key, llm_provider, llm_api_key)

    - gemini_key      : key for Gemini research + image generation (may be "")
    - llm_provider    : provider name for writing/outline/audit via LiteLLM
    - llm_api_key     : API key for that provider (empty → no writing provider found)

    Key resolution rules:
    - company users with use_company_keys=True (or unset) → env keys allowed
    - company users with use_company_keys=False → personal vault keys only
    - non-company users → personal vault keys ONLY (NO env fallback)
    """
    company_user = bool(user_email) and user_email.lower().endswith("@example.com")
    use_company_keys = company_user

    from services.vault_service import vault as _vault

    def _get_key(platform: str) -> str:
        try:
            cred = _vault.resolve_credential(user_email, platform, db)
            return (cred or {}).get("api_key", "")
        except Exception as e:
            logger.warning(f"Journalist: vault lookup failed for {platform}: {e}")
            return ""

    try:
        user = db.query(User).filter(User.email == user_email).first() if db and user_email else None
        if user and company_user:
            use_company_keys = user.use_company_keys if user.use_company_keys is not None else True
    except Exception as e:
        logger.warning(f"Journalist: user lookup failed ({e})")
        use_company_keys = company_user

    # Gemini key (for research + image generation)
    gemini_key = _get_key("gemini")
    if company_user and use_company_keys:
        gemini_key = gemini_key or os.getenv("GEMINI_API_KEY", "")

    # Writing LLM key — try providers in preference order
    llm_provider = ""
    llm_api_key = ""
    for provider in _LLM_PROVIDER_PREFERENCE:
        key = _get_key(provider)
        if not key and company_user and use_company_keys:
            # Try env fallback for company users
            env_map = {
                "openai": "OPENAI_API_KEY",
                "anthropic": "ANTHROPIC_API_KEY",
                "mistral": "MISTRAL_API_KEY",
                "groq": "GROQ_API_KEY",
                "deepseek": "DEEPSEEK_API_KEY",
                "gemini": "GEMINI_API_KEY",
            }
            key = os.getenv(env_map.get(provider, ""), "")
        if key:
            # Special case: if gemini is the only option, use the gemini key for writing too
            if provider == "gemini" and not gemini_key:
                gemini_key = key
            llm_provider = provider
            llm_api_key = key
            break

    # OpenAI key fetched separately - needed for image fallback regardless of writing provider
    openai_dalle_key = _get_key("openai")
    if not openai_dalle_key and company_user and use_company_keys:
        openai_dalle_key = os.getenv("OPENAI_API_KEY", "")

    return gemini_key, llm_provider, llm_api_key, openai_dalle_key


class JournalistOrchestrator:
    def __init__(self):
        # Services are stateless shells; they get fresh API keys on every pipeline run.
        # Do NOT store service instances here; create them per-request in run_pipeline.
        pass

    def _make_services(self, user_email: str, db) -> tuple:
        gemini_key, llm_provider, llm_api_key, openai_dalle_key = _resolve_journalist_keys(user_email, db)
        # Pass OpenAI key explicitly for image-generation fallback, independent of the writing provider
        gemini_svc = JournalistGeminiService(gemini_key=gemini_key, openai_key=openai_dalle_key)
        llm_svc = JournalistLLMService(provider=llm_provider, api_key=llm_api_key) if llm_provider else None
        return gemini_svc, llm_svc

    def _assert_pipeline_keys(self, user_email: str, db) -> None:
        gemini_key, llm_provider, llm_api_key, _ = _resolve_journalist_keys(user_email, db)
        missing = []
        if not llm_api_key:
            missing.append(
                "a writing LLM (OpenAI, Anthropic, Groq, Mistral, or DeepSeek)"
            )
        if missing:
            raise RuntimeError(
                f"Missing AI provider key(s): {', '.join(missing)}. "
                "Please add at least one in Settings → AI Provider before using AI Journalist. "
                "A Gemini key is optional (enables live web search and cover images)."
            )
        logger.info(
            f"Journalist: keys resolved — gemini={'yes' if gemini_key else 'no'}, "
            f"writing_provider={llm_provider}"
        )

    def _extract_word_count(self, topic: str) -> int:
        """
        Extract word count from topic string using regex.
        Patterns: "500 words", "1000w", "around 300 words"
        Returns: word count (default 200 if not found or < 200)
        """
        match = re.search(r'\b(\d+)\s*(?:word|words|w)\b', topic, re.IGNORECASE)
        if match:
            count = int(match.group(1))
            return max(count, 200)
        return 200

    async def run_pipeline(
        self,
        topic: str,
        category: str,
        tone: str,
        target_audience: str,
        user_id: int,
        user_email: str = "",
        db=None,
        report_id: Optional[int] = None,
        session_id: Optional[str] = None,
        persona: str = "Analytical",
        sources: Optional[List[str]] = None,
        grounding_sources: Optional[List[Dict[str, str]]] = None,
        history: Optional[List[Dict[str, str]]] = None,
        enable_web_search: bool = True,
        brand_voice: str = "Professional",
        language: str = "English",
    ):
        """
        Multi-stage AI content pipeline as an async generator yielding SSE frames.
        Stages: Research → Outline → Write → Audit → Result
        """

        def make_event(event_type: str, data: Any) -> str:
            payload: Dict[str, Any] = {"type": event_type}
            if event_type == "status":
                payload["message"] = data
            elif event_type == "result":
                payload["payload"] = data
            elif event_type == "error":
                payload["message"] = data
            elif event_type == "report_saved":
                payload["id"] = data
            elif event_type == "progress":
                payload["percentage"] = data
            return f"data: {json.dumps(payload)}\n\n"

        # Resolve user-specific API keys and create per-request service instances
        pipeline_start = time.perf_counter()

        try:
            self._assert_pipeline_keys(user_email, db)
            gemini_svc, llm_svc = self._make_services(user_email, db)
            has_gemini = bool(gemini_svc.genai_client)
            effective_web_search = enable_web_search
            if enable_web_search and not has_gemini:
                yield make_event("status", "Using web research...")
            else:
                yield make_event("status", "Analyzing topic and performing web discovery...")

            # Word limit detection
            expected_word_count = self._extract_word_count(topic)
            logger.info(f"Journalist Pipeline: Detected/Enforced word count: {expected_word_count}")

            # Stage 1: Research
            yield make_event("progress", 5)
            s1 = time.perf_counter()
            logger.info(f"Journalist Pipeline: Starting Stage 1 (Research) for topic: {topic}")
            yield make_event("status", "Conducting deep-dive web research...")
            yield make_event("progress", 10)
            research_data = await gemini_svc.conduct_research(
                topic=topic,
                category=category,
                tone=tone,
                target_audience=target_audience,
                persona=persona,
                enable_web_search=effective_web_search,
                sources=sources,
                grounding_sources=grounding_sources,
                history=history,
                llm_svc=llm_svc,
                brand_voice=brand_voice,
                language=language,
            )
            yield make_event("status", "Validating research sources and extracting data...")
            logger.info(f"Journalist Pipeline:  Stage 1 done in {time.perf_counter() - s1:.1f}s")
            yield make_event("progress", 35)

            # Stage 2: Data insights
            s2 = time.perf_counter()
            logger.info("Journalist Pipeline: Starting Stage 2 (Data Insights)")
            data_insights = research_data.get("data_insights", [])
            if data_insights:
                yield make_event("status", f"Found {len(data_insights)} data points for visualization...")
            logger.info(f"Journalist Pipeline:  Stage 2 done in {time.perf_counter() - s2:.1f}s")
            yield make_event("progress", 40)

            # Stage 3: Outline
            s3 = time.perf_counter()
            logger.info("Journalist Pipeline: Starting Stage 3 (Outline)")
            yield make_event("status", "Structuring the narrative flow...")
            outline = await llm_svc.generate_outline(
                topic=topic,
                category=category,
                tone=tone,
                target_audience=target_audience,
                research_data=research_data,
                history=history,
                expected_word_count=expected_word_count,
                brand_voice=brand_voice,
                language=language
            )
            logger.info(f"Journalist Pipeline:  Stage 3 done in {time.perf_counter() - s3:.1f}s")
            yield make_event("progress", 55)

            # Stage 4: Write
            s4 = time.perf_counter()
            logger.info(f"Journalist Pipeline: Starting Stage 4 (Write) as {persona}")
            yield make_event("status", f"Executing deep-dive report as an {persona} journalist...")

            markdown_content = ""
            async for chunk in llm_svc.write_article(
                topic=topic,
                category=category,
                tone=tone,
                target_audience=target_audience,
                research_data=research_data,
                grounding_sources=grounding_sources,
                outline_data=outline,
                persona=persona,
                history=history,
                expected_word_count=expected_word_count,
                brand_voice=brand_voice,
                language=language
            ):
                markdown_content += chunk
                yield make_event("delta", chunk)
            logger.info(f"Journalist Pipeline:  Stage 4 done in {time.perf_counter() - s4:.1f}s")
            yield make_event("progress", 90)

            # Stage 5: Editorial Audit
            s5 = time.perf_counter()
            logger.info("Journalist Pipeline: Starting Stage 5 (Editorial Audit)")
            yield make_event("status", "Performing final editorial audit...")

            # Audit is the primary post-processing task in the main pipeline.
            # Cover image and Social Kit are triggered manually by the user.
            audit_data = await llm_svc.generate_pro_audit(markdown_content, persona, topic, brand_voice=brand_voice, language=language)
            logger.info(f"Journalist Pipeline:  Stage 5 done in {time.perf_counter() - s5:.1f}s")
            yield make_event("progress", 100)

            total = time.perf_counter() - pipeline_start
            logger.info(f"Journalist Pipeline: 🏁 Total generation time: {total:.1f}s")

            # Final result
            final = {
                "topic": topic,
                "category": category,
                "markdown_content": markdown_content,
                "research_summary": research_data,
                "outline": outline,
                "data_insights": data_insights,
                "audit": audit_data,
                "image_url": None,
                "social_kit": None,
                "session_id": session_id,
                "updated_at": datetime.now().isoformat()
            }
            yield make_event("result", final)

            # Stage 6: Persistence
            try:
                with SessionLocal() as db:
                    saved_report_id: Optional[int] = None

                    if report_id:
                        # Update existing session record
                        report = db.query(JournalistReport).filter(JournalistReport.id == report_id, JournalistReport.user_id == user_id).first()
                        if report:
                            # Push current state to versions history before overwriting
                            prev_versions = list(report.versions or [])
                            prev_snapshot = {
                                "topic": report.topic,
                                "category": report.category,
                                "markdown_content": report.markdown_content,
                                "research_summary": report.research_summary,
                                "outline": report.outline,
                                "data_insights": report.data_insights,
                                "audit": report.audit,
                                "created_at": report.created_at.isoformat() if report.created_at else datetime.now(timezone.utc).isoformat()
                            }
                            prev_versions.append(prev_snapshot)

                            report.topic = topic
                            report.category = category
                            report.markdown_content = markdown_content
                            report.research_summary = research_data
                            report.outline = outline
                            report.data_insights = data_insights
                            report.audit = audit_data
                            report.versions = prev_versions
                            report.updated_at = datetime.now(timezone.utc)
                            if not report.session_id:
                                report.session_id = session_id

                            # Explicitly flag all JSON columns as modified so SQLAlchemy
                            # includes them in the UPDATE statement (required for JSON/JSONB)
                            flag_modified(report, "versions")
                            flag_modified(report, "research_summary")
                            flag_modified(report, "outline")
                            flag_modified(report, "data_insights")
                            flag_modified(report, "audit")

                            db.commit()
                            saved_report_id = report.id
                            logger.info(f"Journalist Pipeline: 🔄 Updated report {report_id} with version snapshot ({len(prev_versions)} versions total).")
                        else:
                            logger.warning(f"Journalist Pipeline: report_id {report_id} provided but not found. Falling back to new record.")
                            report_id = None # fallback to create

                    if not report_id:
                        # Create new session record
                        report = JournalistReport(
                            user_id=user_id,
                            topic=topic,
                            category=category,
                            markdown_content=markdown_content,
                            research_summary=research_data,
                            outline=outline,
                            data_insights=data_insights,
                            audit=audit_data,
                            versions=[],
                            session_id=session_id,
                            created_at=datetime.now()
                        )
                        db.add(report)
                        db.commit()
                        saved_report_id = report.id
                        logger.info(f"Journalist Pipeline: 💾 New session {report.id} saved to database for user {user_id}")

                    if saved_report_id:
                        yield make_event("report_saved", saved_report_id)
            except Exception as db_err:
                logger.error(f"Journalist Pipeline: Failed to save session to DB: {str(db_err)}")

        except Exception as e:
            total = time.perf_counter() - pipeline_start
            logger.error(f"Journalist Pipeline: Failed at some stage after {total:.1f}s. Error: {str(e)}")
            yield make_event("error", f"Pipeline failed: {str(e)}")
