"""
Sliding-window rate limiter for Sarvam AI API (60 RPM hard cap).

Uses collections.deque for O(1) popleft - no heap, no sorting.
Thread-safe via threading.Lock (asyncio tasks share the same OS thread,
but the lock is cheap and protects against future thread-pool use).
"""

import time
from collections import deque
from threading import Lock

_WINDOW = 60.0   # seconds
_LIMIT  = 55     # 60 RPM official limit − 5 safety buffer


class SarvamRateLimiter:
    def __init__(self) -> None:
        self._users: dict[str, deque] = {}
        self._lock = Lock()
        #  FIX #3: Track last cleanup to prevent unbounded _users dict growth
        self._last_cleanup = time.monotonic()
        self._cleanup_interval = 3600.0  # 1 hour

    # ── Internal ─────────────────────────────────────────────────────────────

    def _prune(self, dq: deque, cutoff: float) -> None:
        while dq and dq[0] < cutoff:
            dq.popleft()
    
    def _cleanup_users(self, now: float) -> None:
        """Remove stale user entries that haven't been used in the last 2 hours."""
        if now - self._last_cleanup < self._cleanup_interval:
            return
        # Delete users with no recent activity
        stale_cutoff = now - 7200.0  # 2 hours
        self._users = {
            email: dq for email, dq in self._users.items()
            if dq and dq[-1] > stale_cutoff  # Keep if any call was recent
        }
        self._last_cleanup = now

    # ── Public API ────────────────────────────────────────────────────────────

    def can_call(self, user_email: str) -> bool:
        """Return True if user has remaining quota in the current window."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_users(now)  #  Periodic cleanup
            dq = self._users.setdefault(user_email, deque())
            self._prune(dq, now - _WINDOW)
            return len(dq) < _LIMIT

    def record(self, user_email: str) -> None:
        """Record one API call for the user."""
        with self._lock:
            self._users.setdefault(user_email, deque()).append(time.monotonic())

    def usage(self, user_email: str) -> dict:
        """Return current usage stats for the user."""
        now = time.monotonic()
        with self._lock:
            dq = self._users.get(user_email, deque())
            active = sum(1 for t in dq if t > now - _WINDOW)
        return {
            "used": active,
            "limit": _LIMIT,
            "remaining": max(0, _LIMIT - active),
        }


# Module-level singleton
sarvam_limiter = SarvamRateLimiter()
