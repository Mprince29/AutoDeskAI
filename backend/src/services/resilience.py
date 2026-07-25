"""
Resilience patterns: CircuitBreaker, retry_with_backoff, bounded Semaphore pool.
Used by background_researcher.py and other external-API callers.
"""

import asyncio
import random
import time
from enum import Enum
from typing import Callable, Any, Optional
from loguru import logger


# ── Circuit Breaker ────────────────────────────────────────────────────────────

class BreakerState(str, Enum):
    CLOSED = "closed"       # Normal operation - calls pass through
    OPEN = "open"           # API is down - calls are blocked, use fallback
    HALF_OPEN = "half_open" # Recovery probe - one call allowed through


class CircuitBreaker:
    """
    Prevents cascading failures when external APIs (SERP, scraper, LLM) are down.

    State machine:
      CLOSED  → (failure_threshold failures) → OPEN
      OPEN    → (recovery_timeout seconds)   → HALF_OPEN
      HALF_OPEN → (1 success)                → CLOSED
      HALF_OPEN → (1 failure)                → OPEN
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout: float = 60.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout

        self._state = BreakerState.CLOSED
        self._failure_count = 0
        self._last_failure_time: Optional[float] = None

    @property
    def state(self) -> BreakerState:
        if self._state == BreakerState.OPEN:
            if time.monotonic() - (self._last_failure_time or 0) >= self.recovery_timeout:
                self._state = BreakerState.HALF_OPEN
                logger.info(f"CircuitBreaker[{self.name}] → HALF_OPEN (probing recovery)")
        return self._state

    @property
    def is_open(self) -> bool:
        return self.state == BreakerState.OPEN

    def record_success(self):
        if self._state in (BreakerState.HALF_OPEN, BreakerState.OPEN):
            logger.info(f"CircuitBreaker[{self.name}] → CLOSED (recovered)")
        self._state = BreakerState.CLOSED
        self._failure_count = 0

    def record_failure(self):
        self._failure_count += 1
        self._last_failure_time = time.monotonic()
        if self._failure_count >= self.failure_threshold:
            if self._state != BreakerState.OPEN:
                logger.warning(
                    f"CircuitBreaker[{self.name}] → OPEN "
                    f"({self._failure_count} failures, will retry in {self.recovery_timeout}s)"
                )
            self._state = BreakerState.OPEN

    async def call(self, fn: Callable, *args, fallback=None, **kwargs) -> Any:
        """
        Execute fn(*args, **kwargs) through the circuit breaker.
        If OPEN: return fallback immediately (no call made).
        Records success/failure automatically.
        """
        if self.is_open:
            logger.debug(f"CircuitBreaker[{self.name}] OPEN - returning fallback")
            return fallback() if callable(fallback) else fallback

        try:
            result = await fn(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            err_detail = str(e) or f"<{type(e).__name__} with no message>"
            logger.warning(f"CircuitBreaker[{self.name}] failure: {err_detail}")
            if self.is_open and fallback is not None:
                return fallback() if callable(fallback) else fallback
            raise


# ── Retry with Exponential Backoff ────────────────────────────────────────────

async def retry_with_backoff(
    fn: Callable,
    *args,
    max_retries: int = 3,
    base_delay: float = 1.0,
    retryable_exceptions: tuple = (Exception,),
    **kwargs,
) -> Any:
    """
    Retry fn(*args, **kwargs) up to max_retries times with exponential backoff + jitter.

    Delay schedule: 1s, 2s, 4s (+ up to 0.5s jitter each).
    Only retries on retryable_exceptions. Re-raises on final attempt.
    """
    import httpx

    retryable = retryable_exceptions if retryable_exceptions != (Exception,) else (
        httpx.TimeoutException,
        httpx.HTTPStatusError,
        httpx.ConnectError,
        ConnectionError,
    )

    last_exc = None
    for attempt in range(max_retries):
        try:
            return await fn(*args, **kwargs)
        except retryable as e:
            last_exc = e
            if attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt) + random.uniform(0, 0.5)
            logger.debug(f"retry_with_backoff: attempt {attempt + 1} failed ({e}), retrying in {delay:.1f}s")
            await asyncio.sleep(delay)
        except Exception:
            raise  # Non-retryable - fail immediately

    raise last_exc  # Shouldn't reach here, but satisfies type checkers


# ── Bounded Semaphore Pool ─────────────────────────────────────────────────────

class SemaphorePool:
    """
    Named async semaphore pool. Prevents resource exhaustion across concurrent operations.

    Usage:
        pool = SemaphorePool()
        async with pool.acquire("agent_creation"):
            ...
    """

    _pools: dict[str, asyncio.Semaphore] = {}

    _limits = {
        "agent_creation": 3,    # Max 3 concurrent agent creation pipelines
        "serp_calls": 5,        # Max 5 concurrent SERP API calls
        "scrape_calls": 3,      # Max 3 concurrent website scrapes
        "llm_calls": 10,        # Max 10 concurrent LLM calls
        "chroma_writes": 5,     # Max 5 concurrent ChromaDB writes
    }

    def acquire(self, name: str) -> asyncio.Semaphore:
        if name not in self._pools:
            limit = self._limits.get(name, 10)
            self._pools[name] = asyncio.Semaphore(limit)
        return self._pools[name]


# Singletons
SERP_BREAKER = CircuitBreaker("serp", failure_threshold=3, recovery_timeout=60)
SCRAPE_BREAKER = CircuitBreaker("scrape", failure_threshold=5, recovery_timeout=30)
LLM_BREAKER = CircuitBreaker("llm", failure_threshold=3, recovery_timeout=120)
CHROMA_BREAKER = CircuitBreaker("chroma", failure_threshold=3, recovery_timeout=30)

SEMAPHORES = SemaphorePool()
