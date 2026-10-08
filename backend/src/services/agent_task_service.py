"""Canonical entry point for backwards-compatible AgentTask execution.

This module deliberately delegates durable execution to the existing Celery
task. It does not introduce a second execution engine.
"""

from typing import Any, Dict, Optional

from loguru import logger


def enqueue_agent_task(
    *,
    user_email: str,
    task_description: str,
    agent_type: str = "custom",
    agent_id: Optional[int] = None,
    context: Optional[Dict[str, Any]] = None,
    db_session=None,
    user_id: Optional[int] = None,
):
    """Enqueue an AgentTask using the existing durable Celery executor.

    Database-backed agents are recorded in ``agent_tasks`` before enqueueing.
    Built-in agent types without an ``agent_id`` retain the legacy queue-only
    behavior because ``AgentTask.agent_id`` is currently non-nullable.
    """
    from workers.agent_tasks import run_agent_task

    task_record = None
    if agent_id is not None and db_session is not None and user_id is not None:
        from models import AIAgent, AgentTask

        agent = db_session.query(AIAgent).filter(
            AIAgent.id == agent_id,
            AIAgent.user_id == user_id,
            AIAgent.is_active.is_(True),
        ).first()
        if agent is None:
            raise ValueError("Agent not found or not accessible")

        task_record = AgentTask(
            user_id=user_id,
            agent_id=agent_id,
            title=task_description[:200],
            description=task_description,
            status="pending",
            task_metadata={"context": context or {}},
        )
        db_session.add(task_record)
        db_session.commit()
        db_session.refresh(task_record)

    try:
        celery_task = run_agent_task.apply_async(
            kwargs={
                "user_email": user_email,
                "task_description": task_description,
                "agent_type": agent_type,
                "agent_id": agent_id,
                "context": context or {},
                "agent_task_id": task_record.id if task_record is not None else None,
            },
            queue="long_running",
        )
    except Exception as exc:
        if task_record is not None:
            task_record.status = "failed"
            task_record.error_message = f"Queue submission failed: {exc}"
            db_session.commit()
        raise

    if task_record is not None:
        task_record.task_metadata = {
            **(task_record.task_metadata or {}),
            "celery_task_id": celery_task.id,
        }
        db_session.commit()
        logger.info(
            "Persisted AgentTask %s and queued Celery task %s",
            task_record.id,
            celery_task.id,
        )

    return celery_task


def request_agent_task_cancellation(*, task_id: str, user_id: int, db_session):
    """Request safe cancellation of an AgentTask owned by the user.

    Queued tasks become terminal ``cancelled`` tasks. Active tasks become
    ``cancel_requested`` and are stopped only at a worker safe checkpoint.
    """
    from datetime import datetime, timezone
    from models import AgentTask

    task = db_session.query(AgentTask).filter(
        AgentTask.user_id == user_id,
        AgentTask.task_metadata["celery_task_id"].as_string() == task_id,
    ).first()
    if task is None:
        raise ValueError("Task not found")

    if task.status in {"completed", "failed", "cancelled"}:
        raise ValueError(f"Task is already terminal: {task.status}")

    metadata = dict(task.task_metadata or {})
    metadata["cancellation_requested_at"] = datetime.now(timezone.utc).isoformat()
    metadata["cancellation_requested_by"] = user_id

    if task.status == "in_progress":
        task.status = "cancel_requested"
    else:
        task.status = "cancelled"
    task.task_metadata = metadata
    db_session.commit()

    # Revoke only queued work. Do not terminate an active worker process in
    # the middle of an external tool call.
    if task.status == "cancelled":
        from workers.celery_app import celery_app
        celery_app.control.revoke(task_id, terminate=False)

    return task
