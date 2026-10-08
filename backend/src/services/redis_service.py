import os
import json
import hashlib
from typing import Callable, Any, Dict, Optional
from functools import wraps
import redis.asyncio as redis
from loguru import logger

# Initialize Redis Client
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB = int(os.getenv("REDIS_DB", 0))

try:
    redis_client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        db=REDIS_DB,
        decode_responses=True,
        socket_connect_timeout=2,   # Fail fast if Redis is not running
        socket_timeout=2,
    )
except Exception as e:
    logger.error(f"Failed to initialize Redis client: {e}")
    redis_client = None

def get_redis() -> redis.Redis:
    """Returns the global Redis client instance."""
    return redis_client

def cache_google_api(ttl_seconds: int = 3600):
    """
    Decorator for caching Google API calls in Redis.
    Provides O(1) latency for repeated complex queries (like Drive searches or Gmail queries).
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if redis_client is None:
                return await func(*args, **kwargs)

            # Generate a deterministic cache key based on the function and its arguments.
            prefix = f"google_api:{func.__module__}.{func.__name__}"
            
            def _serialize(obj: Any) -> str:
                if hasattr(obj, "dict"):
                    return str(obj.dict())
                elif hasattr(obj, "model_dump"):
                    return str(obj.model_dump())
                return str(obj)

            # Serialize generic arguments (ignoring complex objects like 'self' or Request/Response)
            serializable_args = [_serialize(a) for a in args if hasattr(a, "dict") or hasattr(a, "model_dump") or isinstance(a, (str, int, float, bool, dict, list))]
            arg_str = ":".join(serializable_args)
            
            # Serialize kwargs deterministically
            kwarg_str = ":".join(f"{k}={_serialize(v)}" for k, v in sorted(kwargs.items()) if hasattr(v, "dict") or hasattr(v, "model_dump") or isinstance(v, (str, int, float, bool, dict, list)))

            
            raw_key = f"{prefix}:{arg_str}:{kwarg_str}"
            key_hash = hashlib.md5(raw_key.encode()).hexdigest()
            cache_key = f"{prefix}:{key_hash}"

            try:
                # O(1) Cache retrieval
                cached_data = await redis_client.get(cache_key)
                if cached_data:
                    logger.debug(f"🚀 Redis Cache HIT: {cache_key} (<1ms)")
                    return json.loads(cached_data)
            except Exception as e:
                logger.warning(f"Redis get error: {e}")

            # Cache Miss - Execute actual function (~800ms API call)
            result = await func(*args, **kwargs)

            try:
                if result is not None:
                    # Only cache if data is serializable
                    json_data = json.dumps(result)
                    await redis_client.setex(cache_key, ttl_seconds, json_data)
                    logger.debug(f"💾 Redis Cache SET: {cache_key}")
            except Exception as e:
                logger.warning(f"Redis set error: {e}")

            return result
        return wrapper
    return decorator

class AgentCache:
    """
    Manages caching for Agent LLM responses.
    Provides instant playback for repeated queries.
    """
    PREFIX = "agent_cache"
    KEY_VERSION = "v2"

    @staticmethod
    def _is_read_only_query(query: str) -> bool:
        """Never cache requests that could cause or describe a mutation."""
        q = query.lower()
        mutation_terms = (
            "send", "delete", "remove", "create", "update", "edit", "move",
            "cancel", "schedule", "post", "write", "save", "approve", "execute",
        )
        return not any(term in q for term in mutation_terms)

    @classmethod
    def _make_key(cls, user_email: str, agent_type: str, query: str) -> str:
        # Clean query: lowercase and strip to improve hit rate
        clean_query = query.lower().strip()
        raw = f"{cls.KEY_VERSION}:{user_email}:{agent_type}:{clean_query}"
        h = hashlib.md5(raw.encode()).hexdigest()
        return f"{cls.PREFIX}:{h}"

    @classmethod
    async def get(cls, user_email: str, agent_type: str, query: str) -> Optional[Dict[str, Any]]:
        if redis_client is None or not cls._is_read_only_query(query): return None
        key = cls._make_key(user_email, agent_type, query)
        try:
            data = await redis_client.get(key)
            if data:
                logger.info(f"🤖 Agent Cache HIT: {agent_type} | {user_email}")
                return json.loads(data)
        except Exception as e:
            logger.warning(f"AgentCache.get error: {e}")
        return None

    @classmethod
    async def set(cls, user_email: str, agent_type: str, query: str, result: Dict[str, Any], ttl: int = 300):
        if redis_client is None or not cls._is_read_only_query(query): return
        key = cls._make_key(user_email, agent_type, query)
        try:
            await redis_client.setex(key, ttl, json.dumps(result))
            logger.debug(f"🤖 Agent Cache SET: {agent_type} | {user_email}")
        except Exception as e:
            logger.warning(f"AgentCache.set error: {e}")
