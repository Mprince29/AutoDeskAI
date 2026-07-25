"""
Celery application - async agent task execution.

Broker/backend: Redis (localhost:6379 by default, overridable via REDIS_URL).

Start the worker:
    cd backend
    celery -A src.workers.celery_app worker --loglevel=info --concurrency=4 -Q default,long_running

The worker process runs independently of uvicorn so long agent executions
(60-second LLM calls, multi-tool workflows) never block HTTP request threads.
"""
import os
from celery import Celery

_REDIS = os.getenv("REDIS_URL") or (
    f"redis://{os.getenv('REDIS_HOST', 'localhost')}:{os.getenv('REDIS_PORT', '6379')}/2"
)

celery_app = Celery(
    "autodeskai",
    broker=_REDIS,
    backend=_REDIS,
    include=["workers.agent_tasks"],
)

celery_app.conf.update(
    # Serialisation
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # Timing
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=660,          # 11 min hard limit (LLM timeout is 60 s × 10 rounds)
    task_soft_time_limit=600,     # 10 min soft limit → raises SoftTimeLimitExceeded

    # Worker behaviour
    worker_prefetch_multiplier=1, # each worker takes one task at a time (important for long tasks)
    worker_max_tasks_per_child=500,

    # Result TTL - keep results in Redis for 1 hour so the frontend can poll
    result_expires=3600,

    # Routing
    task_default_queue="default",
    task_routes={
        "workers.agent_tasks.run_agent_task": {"queue": "long_running"},
    },
)
