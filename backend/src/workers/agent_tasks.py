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
) -> dict:
    """
    Execute an agent task asynchronously and stream progress to Redis.

    Returns the final result dict (also stored as Celery task result).
    """
    task_id = self.request.id
    logger.info(f"[Celery] Starting task {task_id} | user={user_email} | agent={agent_type}")

    _push_update(task_id, {"type": "status", "message": "Task queued - starting now..."})

    try:
        from auth.database import SessionLocal
        from services.agent_executor import agent_executor

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
                    ):
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
                    ):
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
        logger.info(f"[Celery] Task {task_id} completed | user={user_email}")
        return result

    except Exception as exc:
        logger.error(f"[Celery] Task {task_id} FAILED: {exc}")
        _push_update(task_id, {"type": "error", "message": str(exc)})
        raise
