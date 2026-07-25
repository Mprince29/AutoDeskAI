"""
EpisodicMemory - Per-user, per-agent session context persistence.

Agents remember what happened in previous sessions, just like a human employee.
After each session, a compressed summary is stored. At next session start,
the last 3 summaries are injected into the system prompt.
"""

import os
from datetime import datetime, timezone
from typing import Optional

from loguru import logger
from sqlalchemy.orm import Session


# ── DB Operations ──────────────────────────────────────────────────────────────

def save_session_memory(
    db: Session,
    agent_id: int,
    user_id: int,
    task: str,
    result: str,
    key_decisions: Optional[list[str]] = None,
) -> None:
    """
    Compress the session (task + result) into a short summary and store it.
    Called by agent_executor after each successful task.
    """
    from auth.models import EpisodicMemory

    summary = _compress_session(task, result)
    if not summary:
        return

    mem = EpisodicMemory(
        agent_id=agent_id,
        user_id=user_id,
        session_summary=summary,
        key_decisions=key_decisions or [],
        user_preferences=_infer_preferences(task, result),
    )
    try:
        db.add(mem)
        db.commit()
        logger.debug(f"EpisodicMemory: saved for agent={agent_id} user={user_id}")
    except Exception as e:
        logger.warning(f"EpisodicMemory save failed: {e}")
        db.rollback()


def get_recent_memories(
    db: Session,
    agent_id: int,
    user_id: int,
    limit: int = 3,
) -> list[dict]:
    """
    Returns the last `limit` session summaries for this agent+user pair.
    Sorted newest-first.
    """
    from auth.models import EpisodicMemory

    rows = (
        db.query(EpisodicMemory)
        .filter(
            EpisodicMemory.agent_id == agent_id,
            EpisodicMemory.user_id == user_id,
        )
        .order_by(EpisodicMemory.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "date": row.created_at.strftime("%Y-%m-%d") if row.created_at else "unknown",
            "summary": row.session_summary,
            "key_decisions": row.key_decisions or [],
            "user_preferences": row.user_preferences or {},
        }
        for row in rows
    ]


def format_memories_for_prompt(memories: list[dict]) -> str:
    """
    Format recent memories for injection into the system prompt.
    Returns empty string if no memories.
    """
    if not memories:
        return ""

    lines = ["=== Previous Session Context ==="]
    for mem in memories:
        lines.append(f"[{mem['date']}]: {mem['summary']}")
        if mem.get("key_decisions"):
            for decision in mem["key_decisions"][:2]:
                lines.append(f"  • Decision: {decision}")

    return "\n".join(lines)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _compress_session(task: str, result: str) -> str:
    """
    Create a short summary of the session without an LLM call (keep it fast).
    Format: "Task: [task_short]. Outcome: [result_short]."
    """
    task_short = task[:120].strip()
    if task_short and not task_short.endswith("."):
        task_short += "."

    result_short = result[:200].strip()
    if result_short and not result_short.endswith("."):
        result_short += "."

    if not task_short:
        return ""

    if result_short:
        return f"Task: {task_short} Outcome: {result_short}"
    return f"Task: {task_short}"


def _infer_preferences(task: str, result: str) -> dict:
    """
    Heuristically infer user preferences from task language.
    E.g., "briefly explain" → prefers concise responses.
    """
    combined = (task + " " + result).lower()
    prefs = {}

    if any(w in combined for w in ("brief", "short", "concise", "quick", "tldr")):
        prefs["response_length"] = "concise"
    elif any(w in combined for w in ("detailed", "thorough", "comprehensive", "in-depth")):
        prefs["response_length"] = "detailed"

    if any(w in combined for w in ("bullet", "list", "points")):
        prefs["format"] = "bullet_points"
    elif any(w in combined for w in ("table", "structured")):
        prefs["format"] = "structured"

    return prefs
