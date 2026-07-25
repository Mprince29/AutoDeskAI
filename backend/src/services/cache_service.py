"""
Request-level caching for hot-path DB lookups (User, AIAgent).

Uses the same Redis instance as redis_service.py but on DB=1 to avoid
key collisions with the Google API cache on DB=0.

Gracefully degrades to a no-cache pass-through when Redis is unavailable -
the system continues working, just without the speed benefit.
"""
from __future__ import annotations

import json
import hashlib
from typing import Any, Callable, Optional
from loguru import logger

try:
    import redis.asyncio as aioredis

    _client = aioredis.Redis(
        host=__import__("os").getenv("REDIS_HOST", "localhost"),
        port=int(__import__("os").getenv("REDIS_PORT", 6379)),
        db=1,  # Separate DB from google_api cache (DB=0)
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    _REDIS_OK = True
except Exception as _e:
    _client = None
    _REDIS_OK = False
    logger.warning(f"cache_service: Redis unavailable, running without cache - {_e}")


def _key(namespace: str, *parts: Any) -> str:
    raw = f"{namespace}:" + ":".join(str(p) for p in parts)
    return "cache:" + hashlib.md5(raw.encode()).hexdigest()


async def _get(key: str) -> Optional[Any]:
    if not _REDIS_OK or _client is None:
        return None
    try:
        val = await _client.get(key)
        return json.loads(val) if val else None
    except Exception as e:
        logger.debug(f"cache_service get miss ({e})")
        return None


async def _set(key: str, value: Any, ttl: int) -> None:
    if not _REDIS_OK or _client is None or value is None:
        return
    try:
        await _client.setex(key, ttl, json.dumps(value, default=str))
    except Exception as e:
        logger.debug(f"cache_service set failed ({e})")


async def invalidate(namespace: str, *parts: Any) -> None:
    """Explicitly evict a cache entry (call on user update / agent update)."""
    if not _REDIS_OK or _client is None:
        return
    try:
        await _client.delete(_key(namespace, *parts))
    except Exception:
        pass


# ── High-level helpers (used directly in services) ───────────────────────────

async def get_user(user_email: str, db, ttl: int = 300) -> Any:
    """
    Return the User ORM row for *user_email*, served from Redis when warm.
    TTL default = 5 min - short enough that profile changes propagate quickly.
    """
    from auth.models import User

    cache_key = _key("user", user_email)
    cached = await _get(cache_key)
    if cached is not None:
        logger.debug(f"cache HIT user:{user_email}")
        # Reconstruct a lightweight dict - callers that only need .id / .email
        # can use this directly; callers needing the ORM object must fall through.
        return _DictUser(cached)

    user = db.query(User).filter(User.email == user_email).first()
    if user:
        payload = {
            "id": user.id,
            "email": user.email,
            "name": getattr(user, "name", ""),
            "role": getattr(user, "role", ""),
            "use_company_keys": getattr(user, "use_company_keys", False),
        }
        await _set(cache_key, payload, ttl)
    return user


async def get_agent(agent_id: int, db, ttl: int = 600) -> Any:
    """
    Return the AIAgent ORM row for *agent_id*, cached for 10 min.
    Agent configs change infrequently, so 10 min is safe.
    """
    from models import AIAgent

    cache_key = _key("agent", agent_id)
    cached = await _get(cache_key)
    if cached is not None:
        logger.debug(f"cache HIT agent:{agent_id}")
        return _DictAgent(cached)

    agent = db.query(AIAgent).filter(AIAgent.id == agent_id).first()
    if agent:
        payload = {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "role": agent.role,
            "agent_config": agent.agent_config,
            "status": agent.status,
            "is_active": agent.is_active,
            "user_id": agent.user_id,
            "custom_instructions": getattr(agent, "custom_instructions", ""),
        }
        await _set(cache_key, payload, ttl)
    return agent


# ── Lightweight proxy objects (avoid ORM session dependency) ──────────────────

class _DictUser:
    """Read-only dict-backed proxy for cached user data."""
    __slots__ = ("_d",)

    def __init__(self, d: dict):
        self._d = d

    def __getattr__(self, name: str):
        try:
            return self._d[name]
        except KeyError:
            return None

    def __bool__(self):
        return bool(self._d)


class _DictAgent:
    """Read-only dict-backed proxy for cached agent data."""
    __slots__ = ("_d",)

    def __init__(self, d: dict):
        self._d = d

    def __getattr__(self, name: str):
        try:
            return self._d[name]
        except KeyError:
            return None

    def __bool__(self):
        return bool(self._d)
