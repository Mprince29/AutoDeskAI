"""
db_log_sink.py - loguru sink that writes WARNING+ records to the app_logs DB table.

Design goals
------------
* Zero filesystem dependency - logs live in the same SQLite/Postgres DB as everything else.
* Minimal space: DEBUG + INFO go to stdout only; WARNING/ERROR/CRITICAL are persisted.
* Messages truncated to 600 chars; exception text appended for ERROR/CRITICAL (up to 1 500 chars total).
* Sink is synchronous (loguru calls it from its own thread) and uses a dedicated DB session
  that is opened/closed per call - safe under both SQLite + Postgres.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Lazy imports so this module can be imported before the ORM is fully set up.
# ---------------------------------------------------------------------------
_SINK_ENABLED = False


def enable_db_sink() -> None:
    """Call this once, after create_db_and_tables() has run."""
    global _SINK_ENABLED
    _SINK_ENABLED = True


def db_log_sink(message) -> None:  # noqa: ANN001
    """loguru sink callable - write WARNING+ to app_logs table."""
    if not _SINK_ENABLED:
        return

    record = message.record
    # loguru level numbers: DEBUG=10, INFO=20, WARNING=30, ERROR=40, CRITICAL=50
    if record["level"].no < 30:
        return

    try:
        from auth.database import SessionLocal
        from auth.models import ActivityLog

        raw_msg: str = record["message"]

        # Append exception info for ERROR+ (helps debugging without log files)
        exc = record.get("exception")
        if exc and record["level"].no >= 40:
            import traceback
            tb = "".join(traceback.format_exception(*exc)) if exc else ""
            raw_msg = f"{raw_msg}\n{tb}"

        # Hard cap to keep the DB lean
        MAX_CHARS = 600 if record["level"].no < 40 else 1500
        msg = raw_msg[:MAX_CHARS]

        module = (record.get("name") or "")[:120]

        db = SessionLocal()
        try:
            entry = ActivityLog(
                level=record["level"].name,
                error_message=msg,
                module=module,
                status="failed" if record["level"].no >= 40 else "success",
                action="system_log",
                details={"src": "system"},  # distinguishes from user-action logs
            )
            db.add(entry)
            db.commit()
        finally:
            db.close()

    except Exception:
        # Never let the sink crash the application
        pass
