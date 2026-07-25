import os
from typing import Optional, Any, Dict
from loguru import logger
from dotenv import load_dotenv

# Ensure .env is loaded even in subprocesses (MCP servers)
load_dotenv()

# Import the new LiteLLM router
try:
    from .llm_router import agenerate as llm_agenerate, generate as llm_generate
    LLM_ROUTER_AVAILABLE = True
    logger.info(" LiteLLM router imported successfully")
except ImportError:
    try:
        from openai import OpenAI
        LLM_ROUTER_AVAILABLE = False
        logger.info("⚠️ Using legacy OpenAI client (OpenRouter)")
    except ImportError:
        LLM_ROUTER_AVAILABLE = False
        logger.warning("Neither LiteLLM router nor OpenAI client available")

# Legacy OpenAI client (kept for backward compatibility)
_client: Optional[Any] = None
_warned_missing_api_key: bool = False
# NOTE: _client is not thread-safe in async contexts.

def get_api_key() -> Optional[str]:
    """Get API key - now supports multiple providers via LiteLLM"""
    global _warned_missing_api_key

    if LLM_ROUTER_AVAILABLE:
        # Check if any of the required API keys are available
        openai_key = os.getenv("OPENAI_API_KEY")
        gemini_key = os.getenv("GEMINI_API_KEY")
        mistral_key = os.getenv("MISTRAL_API_KEY")
        groq_key = os.getenv("GROQ_API_KEY")
        if any([openai_key, gemini_key, mistral_key, groq_key]):
            return None  # Don't return a fake key; just rely on LLM_ROUTER_AVAILABLE
        else:
            if not _warned_missing_api_key:
                logger.warning("No API keys found for LiteLLM router (OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY)")
                _warned_missing_api_key = True
            return None

    # Fallback to old OpenRouter logic
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        if not _warned_missing_api_key:
            logger.debug("OPENROUTER_API_KEY not found in environment variables")
            _warned_missing_api_key = True
        return None
    return api_key

def get_client() -> Optional[Any]:
    """Get client - now returns LiteLLM router or legacy OpenAI client"""
    if LLM_ROUTER_AVAILABLE:
        class LiteLLMClient:
            class chat:
                class completions:
                    @staticmethod
                    async def create(*args, **kwargs):
                        # Map OpenAI-style parameters to LiteLLM router
                        messages = kwargs.get('messages', [])
                        model = kwargs.get('model', 'default')
                        temperature = kwargs.get('temperature', 0.3)
                        max_tokens = kwargs.get('max_tokens')
                        response_format = kwargs.get('response_format')
                        # Determine role based on model or context
                        role = "default"
                        if "classifier" in str(model).lower():
                            role = "classifier"
                        elif "extractor" in str(model).lower():
                            role = "extractor"
                        elif "validator" in str(model).lower():
                            role = "validator"
                        else:
                            role = "drafter"
                        # Pass response_format directly (no mapping here)
                        return await llm_agenerate(
                            role=role,
                            messages=messages,
                            temperature=temperature,
                            response_format=response_format,
                            max_tokens=max_tokens
                        )

                    @staticmethod
                    def create(*args, **kwargs):
                        messages = kwargs.get('messages', [])
                        model = kwargs.get('model', 'default')
                        temperature = kwargs.get('temperature', 0.3)
                        max_tokens = kwargs.get('max_tokens')
                        response_format = kwargs.get('response_format')
                        role = "default"
                        if "classifier" in str(model).lower():
                            role = "classifier"
                        elif "extractor" in str(model).lower():
                            role = "extractor"
                        elif "validator" in str(model).lower():
                            role = "validator"
                        else:
                            role = "drafter"
                        return llm_generate(
                            role=role,
                            messages=messages,
                            temperature=temperature,
                            response_format=response_format,
                            max_tokens=max_tokens
                        )
        return LiteLLMClient()

    # Fallback to old OpenAI client logic
    global _client
    if _client is not None:
        return _client

    try:
        from openai import OpenAI
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            return None
        referer = os.getenv("OPENROUTER_SITE_URL")
        title = os.getenv("OPENROUTER_SITE_NAME")
        default_headers = {}
        if referer:
            default_headers["HTTP-Referer"] = referer
        if title:
            default_headers["X-Title"] = title
        _client = OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers=default_headers or None,
        )
        return _client
    except ImportError:
        logger.error("OpenAI client not available")
        return None

def get_model(name: str = "default") -> str:
    """Get model name - ONLY from environment variables, no hardcoded defaults"""
    if LLM_ROUTER_AVAILABLE:
        model_mapping = {
            "default": "drafter",
            "classifier": "classifier",
        }
        role = model_mapping.get(name, "drafter")
        role_to_model = {
            "classifier": os.getenv("LLM_CLASSIFIER_MODEL"),
            "extractor": os.getenv("LLM_EXTRACTOR_MODEL"),
            "drafter": os.getenv("LLM_DRAFTER_MODEL"),
            "validator": os.getenv("LLM_VALIDATOR_MODEL"),
        }
        model = role_to_model.get(role)
        if not model:
            logger.error(f"No model configured for role '{role}' in environment variables")
            logger.error(f"Please set LLM_{role.upper()}_MODEL in your .env file")
            return None
        return model

    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        logger.error("No OPENROUTER_API_KEY found in environment variables")
        return None
    model = os.getenv("OPENROUTER_MODEL")
    if not model:
        logger.error("No OPENROUTER_MODEL found in environment variables")
        return None
    return model

# Log which LLM system is active
if LLM_ROUTER_AVAILABLE:
    logger.info(" Using LiteLLM router for multi-provider LLM access")
    configured_models = {
        "classifier": os.getenv("LLM_CLASSIFIER_MODEL"),
        "extractor":  os.getenv("LLM_EXTRACTOR_MODEL"),
        "drafter":    os.getenv("LLM_DRAFTER_MODEL"),
        "validator":  os.getenv("LLM_VALIDATOR_MODEL"),
    }
    logger.info(f"Configured models from .env: {configured_models}")
else:
    logger.info("⚠️ Using legacy OpenAI client (OpenRouter) - configure LLM_*_MODEL env vars to use LiteLLM")


