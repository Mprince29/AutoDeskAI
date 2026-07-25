import json
import os
import re
from typing import Any, Dict, List, Optional, Union

from litellm import acompletion, completion
from loguru import logger
from sqlalchemy.orm import Session


def _get_env_model(var_name: str) -> Optional[str]:
    value = os.getenv(var_name)
    if not value:
        logger.error(f"Model not configured: set {var_name} in your .env file")
        return None
    return value.strip()


def _get_env_list(var_name: str) -> List[str]:
    value = os.getenv(var_name, "")
    return [item.strip() for item in value.split(",") if item.strip()]


# Sensible default model per cloud provider when user hasn't set preferred_model
_PROVIDER_DEFAULT_MODEL: Dict[str, str] = {
    "openai":    "gpt-5.4-mini",
    "anthropic": "anthropic/claude-3-5-haiku-20241022",
    "groq":      "groq/llama-3.3-70b-versatile",
    "mistral":   "mistral/mistral-small-latest",
    "deepseek":  "deepseek/deepseek-chat",
    "gemini":    "gemini/gemini-2.0-flash",
    "local_llm": "openai/llama3.2",   # LM Studio - user must have a model loaded; this is the fallback name
    "ollama":    "openai/llama3.2",
}


def _api_key_for(model: str) -> Optional[str]:
    """Fallback: Return the explicit API key for a model prefix from env vars."""
    if model.startswith("openrouter/"):
        return os.getenv("OPENROUTER_API_KEY") or None
    if model.startswith("gemini/") or "gemini" in model:
        return os.getenv("GEMINI_API_KEY") or None
    if model.startswith("openai/") or "gpt-" in model:
        return os.getenv("OPENAI_API_KEY") or None
    if model.startswith("mistral/"):
        return os.getenv("MISTRAL_API_KEY") or None
    if model.startswith("groq/"):
        return os.getenv("GROQ_API_KEY") or None
    if model.startswith("claude") or model.startswith("anthropic/"):
        return os.getenv("ANTHROPIC_API_KEY") or None
    if model.startswith("deepseek/"):
        return os.getenv("DEEPSEEK_API_KEY") or None
    return None


# Role → Model mapping (system defaults)
ROLE_TO_MODEL: Dict[str, Optional[str]] = {
    "classifier": _get_env_model("LLM_CLASSIFIER_MODEL"),
    "extractor":  _get_env_model("LLM_EXTRACTOR_MODEL"),
    "drafter":    _get_env_model("LLM_DRAFTER_MODEL"),
    "validator":  _get_env_model("LLM_VALIDATOR_MODEL"),
    "router":     _get_env_model("LLM_ROUTER_MODEL"),
}

# Fallbacks per role
FALLBACKS: Dict[str, List[str]] = {
    "classifier": _get_env_list("LLM_CLASSIFIER_FALLBACKS"),
    "extractor":  _get_env_list("LLM_EXTRACTOR_FALLBACKS"),
    "drafter":    _get_env_list("LLM_DRAFTER_FALLBACKS"),
    "validator":  _get_env_list("LLM_VALIDATOR_FALLBACKS"),
    "router":     _get_env_list("LLM_ROUTER_FALLBACKS"),
}

# Google ADC cleanup omitted for brevity in this replace call (keep if already there)
if os.getenv("GEMINI_API_KEY") and "GOOGLE_APPLICATION_CREDENTIALS" in os.environ:
    os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS")


def _prefix_local_model(provider: str, model: str, api_base: Optional[str]) -> tuple:
    """
    Both ollama and local_llm use the OpenAI-compatible endpoint (openai/ prefix + /v1 base).
    This avoids LiteLLM's native ollama handler which has system-message compatibility issues.

      ollama    → "openai/llama3.2:latest",  api_base forced to end with /v1
      local_llm → "openai/model_name",        api_base forced to end with /v1
    """
    if provider in ("ollama", "local_llm"):
        if not model.startswith("openai/"):
            model = f"openai/{model}"
        # Ensure /v1 suffix - Ollama and LM Studio both expose OpenAI-compatible /v1
        if api_base:
            api_base = api_base.rstrip("/")
            if not api_base.endswith("/v1"):
                api_base = api_base + "/v1"
    return model, api_base


# ── Per-provider capability patterns ─────────────────────────────────────

# OpenAI reasoning models (o1/o3/o4) — NOT gpt-5.x chat models which support temperature/tools
_RE_OPENAI_REASONING = re.compile(
    r"^(o1|o3|o4|openai/o1|openai/o3|openai/o4)",
    re.IGNORECASE,
)
# Anthropic / Claude models
_RE_ANTHROPIC = re.compile(r"^(claude|anthropic/)", re.IGNORECASE)
# Local models routed through OpenAI-compatible endpoint (LM Studio / Ollama)
_RE_LOCAL = re.compile(r"^openai/(?!gpt-|o1|o3|o4)", re.IGNORECASE)

# Default max_tokens for Anthropic (required, has no server-side default)
_ANTHROPIC_DEFAULT_MAX_TOKENS = 8192

# Max output tokens for small local models - prevents empty responses
# Most 7B-and-under models top out at 2048 reliable output tokens
_LOCAL_MODEL_MAX_TOKENS = 2048


def _is_local_provider(provider: str) -> bool:
    """Return True if the provider is a local inference server (Ollama or LM Studio)."""
    return provider in ("ollama", "local_llm")


def _max_tokens_key(model: str) -> str:
    """Return the correct token-limit parameter name for the given model.

    OpenAI reasoning / GPT-5 models require 'max_completion_tokens'.
    All other providers use 'max_tokens'.
    """
    if _RE_OPENAI_REASONING.match(model):
        return "max_completion_tokens"
    return "max_tokens"


def _sanitize_kwargs(model: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Strip or patch parameters that specific providers reject.

    Called immediately before every LiteLLM completion() / acompletion() call
    so that provider-specific quirks are handled in one place.

    Rules applied:
      OpenAI reasoning (o1/o3/o4/gpt-5):
        - Remove 'temperature'  → API hard-rejects it
        - Remove 'tool_choice'  → not supported
        - Remove 'response_format' json_object → only json_schema allowed

      Anthropic (claude / anthropic/*):
        - Ensure 'max_tokens' present (required; no server default)
        - 'response_format' → LiteLLM handles via system-prompt injection; keep it

      LM Studio / Ollama (openai/<local-model>):
        - Drop 'response_format' → most local models silently ignore or error on it
    """
    is_reasoning = bool(_RE_OPENAI_REASONING.match(model))
    is_anthropic  = bool(_RE_ANTHROPIC.match(model))
    is_local      = bool(_RE_LOCAL.match(model))

    if is_reasoning:
        kwargs.pop("temperature", None)
        kwargs.pop("tool_choice", None)
        # json_object not supported on reasoning models - strip to avoid 400
        rf = kwargs.get("response_format")
        if isinstance(rf, dict) and rf.get("type") == "json_object":
            kwargs.pop("response_format", None)

    if is_anthropic:
        # max_tokens is required by Anthropic - set a safe default if caller omitted it
        if "max_tokens" not in kwargs and "max_completion_tokens" not in kwargs:
            kwargs["max_tokens"] = _ANTHROPIC_DEFAULT_MAX_TOKENS

    if is_local:
        # Local models loaded in LM Studio / Ollama may not implement response_format or stream_options
        kwargs.pop("response_format", None)
        kwargs.pop("stream_options", None)
        # Many small models return empty completions when asked for very large outputs.
        # Cap at _LOCAL_MODEL_MAX_TOKENS if the caller hasn't already set a tighter limit.
        for tok_key in ("max_tokens", "max_completion_tokens"):
            if tok_key in kwargs and (kwargs[tok_key] is None or kwargs[tok_key] > _LOCAL_MODEL_MAX_TOKENS):
                kwargs[tok_key] = _LOCAL_MODEL_MAX_TOKENS
        # Ensure tool_choice is set so small models actually attempt function-calling.
        # Without this hint many Ollama/LM Studio models silently skip tool invocations.
        if "tools" in kwargs and kwargs["tools"] and "tool_choice" not in kwargs:
            kwargs["tool_choice"] = "auto"

    # Gemini safety settings - disable all content filters so business content
    # (e.g. mentioning competitor AI companies) is never blocked silently.
    if "gemini" in model.lower():
        kwargs.setdefault("safety_settings", [
            {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ])

    # Gemini 2.5 Flash / Pro are hybrid thinking models. By default they spend
    # hidden "thinking tokens" before responding. With an 8k max_tokens budget
    # the model can exhaust all tokens on reasoning and return an empty content
    # field, which shows up as an empty response. Disabling thinking mode makes
    # the model behave deterministically like 2.0 Flash and eliminates this.
    if "gemini-2.5" in model.lower():
        kwargs.setdefault("thinking", {"type": "disabled"})

    return kwargs


def clean_messages(messages: List[Union[Dict, Any]]) -> List[Dict]:
    """
    Ensure all messages are plain dictionaries and tool_calls are sanitized.
    LiteLLM's internal Message objects or Gemini's provider-specific fields
    can trigger Pydantic serialization warnings when passed back to the API.
    """
    clean_msgs = []
    for m in messages:
        # Convert LiteLLM Message objects to dict
        if not isinstance(m, dict):
            try:
                # model_dump is Pydantic v2, dict() is v1
                m = m.model_dump() if hasattr(m, "model_dump") else m.dict() if hasattr(m, "dict") else dict(m)
            except Exception:
                m = dict(m)
        
        # Deep copy tool_calls and remove fields that trigger Pydantic warnings (like 'index', 'provider_specific_fields')
        if "tool_calls" in m and isinstance(m["tool_calls"], list):
            sanitized_tool_calls = []
            for tc in m["tool_calls"]:
                if isinstance(tc, dict):
                    tc_clean = tc.copy()
                    # These fields are non-standard and cause Pydantic serialization warnings in LiteLLM
                    tc_clean.pop("index", None)
                    tc_clean.pop("provider_specific_fields", None)
                    sanitized_tool_calls.append(tc_clean)
                else:
                    # If it's an object, convert it and clean
                    try:
                        tc_dict = tc.model_dump() if hasattr(tc, "model_dump") else tc.dict() if hasattr(tc, "dict") else dict(tc)
                        tc_dict.pop("index", None)
                        tc_dict.pop("provider_specific_fields", None)
                        sanitized_tool_calls.append(tc_dict)
                    except Exception:
                        sanitized_tool_calls.append(tc)
            m["tool_calls"] = sanitized_tool_calls
        
        clean_msgs.append(m)
    return clean_msgs


def _resolve_model(role: str) -> str:
    # If the caller passed a full model string (e.g. "gemini/gemini-2.0-flash"),
    # use it directly — don't look it up in the role→model map.
    if "/" in role:
        return role
    model = ROLE_TO_MODEL.get(role)
    if not model:
        # Fallback to a safe default if env is missing
        return "gemini/gemini-2.0-flash"
    return model


COMPANY_DOMAIN = "example.com"


def is_company_user(email: str) -> bool:
    return bool(email) and email.lower().endswith(f"@{COMPANY_DOMAIN}")


def _get_user_llm_config(user_id: Optional[int], db: Optional[Session]) -> Dict[str, Any]:
    """
    Fetch user-specific LLM config.

    Company users (organization-managed accounts):
      - Primary: system Gemini key from env (default, no override needed → return {})
      - Unless they have explicitly set a custom preferred_model / non-default provider

    External / BYO users:
      - Must have configured their own API key in Settings
      - Raises RuntimeError if no key is found - never falls back to company keys
    """
    if not user_id or not db:
        return {}

    from auth.models import User
    from services.vault_service import vault

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {}

    # Diagnostic: always log raw DB values so we can see exactly what's stored
    # NULL means "not yet chosen" → default True for company users, False for external users
    use_company_keys_db = user.use_company_keys if user.use_company_keys is not None else is_company_user(user.email)
    logger.debug(
        f"LLM config DB | user={user.email} | llm_provider={user.llm_provider!r} | "
        f"preferred_model={user.preferred_model!r} | use_company_keys={use_company_keys_db}"
    )

    if is_company_user(user.email):
        # Company users have two modes:
        #   use_company_keys=True  → env keys (Gemini primary, OpenAI env fallback via LiteLLM)
        #   use_company_keys=False → personal vault key for whichever provider they configured

        if use_company_keys_db:
            # Company env path: respect the user's selected provider/model, but source credentials from env.
            provider = user.llm_provider
            preferred_model = user.preferred_model
            if preferred_model:
                result = {"model": preferred_model}
                if provider:
                    result["provider"] = provider
                logger.debug(
                    f"LLM config | user={user.email} | source=env (company user-selected model) "
                    f"| provider={provider} | model={preferred_model}"
                )
                return result

            # Company key users: only deviate from Gemini if they set an explicit preferred_model above.
            # Selecting a non-Gemini provider alone (no model) is ignored — company keys are Gemini.

            # Default company env path: Gemini primary + configured fallbacks
            logger.debug(f"LLM config | user={user.email} | source=env (company Gemini primary)")
            return {}

        # Personal BYO path - look up vault with the provider the user explicitly selected
        provider = user.llm_provider
        if not provider:
            raise RuntimeError(
                "No AI provider selected. Please go to Settings → AI → Connect Your AI Keys, "
                "choose a provider, and add your API key."
            )
        cred = vault.get(user.id, provider, db)
        if cred:
            api_key = cred.get("api_key") or cred.get("token")
            config = {
                "provider": provider,
                "api_key": api_key,
                "api_base": cred.get("api_base"),
                "model": user.preferred_model or cred.get("model_name"),
            }
            result = {k: v for k, v in config.items() if v is not None}
            logger.debug(
                f"LLM config | user={user.email} | source=personal vault "
                f"| provider={provider} | model={result.get('model')}"
            )
            return result

        # Vault entry missing - user selected a provider but hasn't saved a key yet.
        raise RuntimeError(
            f"No API key found for provider '{provider}'. "
            "Please go to Settings → AI → Connect Your AI Keys and add your key."
        )

    # BYO (external) user - must have their own key configured
    provider = user.llm_provider
    if not provider:
        raise RuntimeError(
            "No AI provider selected. Please go to Settings → AI Provider, "
            "choose a provider, and add your API key."
        )
    cred = vault.resolve_credential(user.email, provider, db)
    api_key = cred.get("api_key") or cred.get("token") if cred else None
    if not api_key:
        raise RuntimeError(
            f"No API key configured for provider '{provider}'. "
            "Please go to Settings → AI Provider and add your API key."
        )
    config = {
        "provider": provider,
        "api_key": api_key,
        "api_base": cred.get("api_base"),
        "model": user.preferred_model or cred.get("model_name"),
    }
    result = {k: v for k, v in config.items() if v is not None}
    logger.debug(f"LLM config | user={user.email} | source=user-config (UI) | provider={provider} | model={result.get('model')} | api_base={result.get('api_base')}")
    return result


def generate(
    role: str,
    messages: List[Dict[str, str]],
    user_id: Optional[int] = None,
    db: Optional[Session] = None,
    temperature: float = 0.3,
    response_format: Optional[str] = None,
    max_tokens: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[str] = None,
) -> Dict[str, Any]:
    """Synchronous LLM generation with per-user BYO-AI support."""
    model = _resolve_model(role)
    user_cfg = _get_user_llm_config(user_id, db)

    # Override defaults with user-specific config if available
    api_key = user_cfg.get("api_key") or _api_key_for(model)
    api_base = user_cfg.get("api_base")
    
    # Override model when user has switched provider
    if user_cfg.get("provider"):
        provider = user_cfg["provider"]
        user_model = user_cfg.get("model")
        if user_model:
            model = user_model
        elif provider in _PROVIDER_DEFAULT_MODEL:
            model = _PROVIDER_DEFAULT_MODEL[provider]

        # Apply provider prefix for local models so LiteLLM knows the backend
        if provider in ("ollama", "local_llm"):
            model, api_base = _prefix_local_model(provider, model, api_base)

    _src = "user-config (UI)" if user_cfg else "env"
    _base_info = f" | api_base={api_base}" if api_base else ""
    logger.info(f"LLM generate | role={role} | model={model} | source={_src}{_base_info} | user={user_id}")

    # OpenAI-compatible local endpoints need a non-empty api_key (value is ignored by the server)
    if not api_key and api_base:
        api_key = "local"

    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": clean_messages(messages),
        "temperature": temperature,
        "api_key": api_key,
    }
    if api_base:
        kwargs["api_base"] = api_base
    if max_tokens is not None:
        kwargs[_max_tokens_key(model)] = max_tokens
    if tools is not None:
        kwargs["tools"] = tools
    if tool_choice is not None:
        kwargs["tool_choice"] = tool_choice
    if response_format == "json_object":
        kwargs["response_format"] = {"type": "json_object"}
    elif response_format == "json_schema":
        kwargs["response_format"] = {"type": "json_schema"}

    # Only apply env fallbacks for company-env mode (user_cfg empty).
    # For BYO users we must NOT silently fall back to company env keys.
    if not user_cfg:
        fallbacks = FALLBACKS.get(role, [])
        if fallbacks:
            kwargs["fallbacks"] = fallbacks

    kwargs = _sanitize_kwargs(model, kwargs)
    return completion(**kwargs)


async def agenerate(
    role: str,
    messages: List[Dict[str, str]],
    user_id: Optional[int] = None,
    db: Optional[Session] = None,
    temperature: float = 0.3,
    response_format: Optional[str] = None,
    max_tokens: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[str] = None,
) -> Dict[str, Any]:
    """Async LLM generation with per-user BYO-AI support."""
    model = _resolve_model(role)
    user_cfg = _get_user_llm_config(user_id, db)
    api_base = user_cfg.get("api_base")
    
    # Override model when user has switched provider
    if user_cfg.get("provider"):
        provider = user_cfg["provider"]
        user_model = user_cfg.get("model")
        if user_model:
            model = user_model
        elif provider in _PROVIDER_DEFAULT_MODEL:
            model = _PROVIDER_DEFAULT_MODEL[provider]

        # Apply provider prefix for local models so LiteLLM knows the backend
        if provider in ("ollama", "local_llm"):
            model, api_base = _prefix_local_model(provider, model, api_base)

    # Resolve API key only after the final model/provider is chosen.
    # Otherwise a company user who switches from Gemini -> OpenAI can end up
    # sending the Gemini env key to the OpenAI model on the primary attempt.
    api_key = user_cfg.get("api_key") or _api_key_for(model)

    # OpenAI-compatible local endpoints need a non-empty api_key (value is ignored by the server)
    if not api_key and api_base:
        api_key = "local"

    _src = "user-config (UI)" if user_cfg else "env"
    _base_info = f" | api_base={api_base}" if api_base else ""
    logger.info(f"LLM agenerate | role={role} | model={model} | source={_src}{_base_info} | user={user_id}")

    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": clean_messages(messages),
        "temperature": temperature,
        "api_key": api_key,
    }
    if api_base:
        kwargs["api_base"] = api_base
    if max_tokens is not None:
        kwargs[_max_tokens_key(model)] = max_tokens
    if tools is not None:
        kwargs["tools"] = tools
    if tool_choice is not None:
        kwargs["tool_choice"] = tool_choice
    if response_format == "json_object":
        kwargs["response_format"] = {"type": "json_object"}
    elif response_format == "json_schema":
        kwargs["response_format"] = {"type": "json_schema"}

    # Only apply env fallbacks for company-env mode (user_cfg empty).
    # For BYO users we must NOT silently fall back to company env keys.
    if not user_cfg:
        fallbacks = FALLBACKS.get(role, [])
        if fallbacks:
            kwargs["fallbacks"] = fallbacks

    kwargs = _sanitize_kwargs(model, kwargs)
    return await acompletion(**kwargs)


def get_text(response: Dict[str, Any]) -> str:
    """Extract assistant text content from an OpenAI-style LiteLLM response."""
    try:
        content = response["choices"][0]["message"]["content"]
        return content if isinstance(content, str) else json.dumps(content)
    except Exception:
        return ""


def get_json(response: Dict[str, Any]) -> Dict[str, Any]:
    """Parse assistant content as JSON; returns {} on failure."""
    try:
        content = get_text(response)
        return json.loads(content) if content else {}
    except Exception:
        return {}
