"""
Celery task definitions for long-running agent execution.

Each task writes progress updates to a Redis key so the FastAPI
polling endpoint can surface them to the frontend without the worker
holding an open HTTP connection.
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

# Ensure the src directory is on the path when Celery forks workers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from celery import Task
from loguru import logger

from workers.celery_app import celery_app

_REDIS_URL = os.getenv("REDIS_URL") or (
    f"redis://{os.getenv('REDIS_HOST', 'localhost')}:{os.getenv('REDIS_PORT', '6379')}/2"
)


def _get_redis_sync():
    import redis
    return redis.from_url(_REDIS_URL, decode_responses=True)


def _push_update(task_id: str, data: dict) -> None:
    """Push a progress event into the Redis list for this task."""
    try:
        r = _get_redis_sync()
        r.rpush(f"task_stream:{task_id}", json.dumps(data))
        r.expire(f"task_stream:{task_id}", 3600)  # 1-hour TTL
    except Exception as e:
        logger.debug(f"Redis push failed: {e}")


def _update_agent_task(agent_task_id: int, **fields) -> None:
    """Persist worker lifecycle state without affecting task execution."""
    if not agent_task_id:
        return
    try:
        from auth.database import SessionLocal
        from models import AgentTask

        db = SessionLocal()
        try:
            task = db.query(AgentTask).filter(AgentTask.id == agent_task_id).first()
            if task:
                for key, value in fields.items():
                    setattr(task, key, value)
                db.commit()
        finally:
            db.close()
    except Exception as exc:
        logger.error(f"Failed to update AgentTask {agent_task_id}: {exc}")


def _agent_task_cancelled(agent_task_id: int) -> bool:
    if not agent_task_id:
        return False
    try:
        from auth.database import SessionLocal
        from models import AgentTask

        db = SessionLocal()
        try:
            task = db.query(AgentTask).filter(AgentTask.id == agent_task_id).first()
            return bool(task and task.status in {"cancelled", "cancel_requested"})
        finally:
            db.close()
    except Exception as exc:
        logger.error(f"Failed to check cancellation for AgentTask {agent_task_id}: {exc}")
        return False


def _mark_agent_task_cancelled(agent_task_id: int, celery_task_id: str) -> dict:
    """Persist and publish a cooperative cancellation result."""
    _update_agent_task(
        agent_task_id,
        status="cancelled",
        completed_at=datetime.now(timezone.utc),
    )
    message = "Task cancelled at a safe execution checkpoint."
    _push_update(celery_task_id, {"type": "cancelled", "message": message})
    return {"success": False, "cancelled": True, "message": message}


class _AgentTask(Task):
    """Base class that initialises the async event loop per worker process."""
    _loop = None

    @property
    def loop(self):
        if self._loop is None or self._loop.is_closed():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
        return self._loop


@celery_app.task(
    bind=True,
    base=_AgentTask,
    name="workers.agent_tasks.run_agent_task",
    max_retries=0,
    acks_late=True,
)
def run_agent_task(
    self,
    user_email: str,
    task_description: str,
    agent_type: str = "custom",
    agent_id: int = None,
    context: dict = None,
    agent_task_id: int = None,
) -> dict:
    """
    Execute an agent task asynchronously and stream progress to Redis.

    Returns the final result dict (also stored as Celery task result).
    """
    task_id = self.request.id
    logger.info(f"[Celery] Starting task {task_id} | user={user_email} | agent={agent_type}")
    if _agent_task_cancelled(agent_task_id):
        return _mark_agent_task_cancelled(agent_task_id, task_id)
    _update_agent_task(
        agent_task_id,
        status="in_progress",
        started_at=datetime.now(timezone.utc),
    )

    _push_update(task_id, {"type": "status", "message": "Task queued - starting now..."})

    try:
        from auth.database import SessionLocal
        from services.agent_executor import agent_executor

        async def _cancellation_check():
            return await asyncio.to_thread(_agent_task_cancelled, agent_task_id)

        self.update_state(state="PROGRESS", meta={"step": "initialising"})
        _push_update(task_id, {"type": "status", "message": "Initialising agent..."})

        db = SessionLocal()
        try:
            if agent_id:
                # Run specific DB agent
                async def _run_dynamic():
                    agent_obj = await agent_executor.find_agent_by_id(agent_id, user_email, db)
                    if not agent_obj:
                        return {"success": False, "error": "Agent not found"}
                    chunks = []
                    async for line in agent_executor.execute_dynamic_agent_stream(
                        agent=agent_obj,
                        task_description=task_description,
                        user_email=user_email,
                        context=context or {},
                        cancellation_check=_cancellation_check,
                        agent_task_id=agent_task_id,
                    ):
                        if _agent_task_cancelled(agent_task_id):
                            return _mark_agent_task_cancelled(agent_task_id, task_id)
                        if line.strip():
                            try:
                                evt = json.loads(line.strip())
                                _push_update(task_id, evt)
                                if evt.get("type") == "result":
                                    return evt
                            except Exception:
                                pass
                    return {"success": True, "text": "".join(chunks)}

                result = self.loop.run_until_complete(_run_dynamic())
            else:
                async def _run_auto():
                    final = {}
                    async for line in agent_executor.execute_agent_stream_task(
                        agent_type=agent_type,
                        task_description=task_description,
                        user_email=user_email,
                        context=context or {},
                        cancellation_check=_cancellation_check,
                        agent_task_id=agent_task_id,
                    ):
                        if _agent_task_cancelled(agent_task_id):
                            return _mark_agent_task_cancelled(agent_task_id, task_id)
                        if line.strip():
                            try:
                                evt = json.loads(line.strip())
                                _push_update(task_id, evt)
                                if evt.get("type") == "result":
                                    final = evt
                            except Exception:
                                pass
                    return final

                result = self.loop.run_until_complete(_run_auto())
        finally:
            db.close()

        _push_update(task_id, {"type": "done"})
        if isinstance(result, dict) and result.get("cancelled"):
            return result
        _update_agent_task(
            agent_task_id,
            status="completed",
            completed_at=datetime.now(timezone.utc),
            result=result,
        )
        logger.info(f"[Celery] Task {task_id} completed | user={user_email}")
        return result

    except Exception as exc:
        _update_agent_task(
            agent_task_id,
            status="failed",
            completed_at=datetime.now(timezone.utc),
            error_message=str(exc),
        )
        logger.error(f"[Celery] Task {task_id} FAILED: {exc}")
        _push_update(task_id, {"type": "error", "message": str(exc)})
        raise
