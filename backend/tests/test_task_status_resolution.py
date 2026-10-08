from datetime import datetime, timezone
from types import SimpleNamespace

from routes.agent_routes import _resolve_persisted_task_status


def test_persisted_task_status_overlays_live_celery_state():
    persisted = SimpleNamespace(
        id=12,
        status="completed",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        started_at=datetime(2026, 1, 1, 0, 1, tzinfo=timezone.utc),
        completed_at=datetime(2026, 1, 1, 0, 2, tzinfo=timezone.utc),
        result={"success": True},
        error_message=None,
    )

    payload = _resolve_persisted_task_status(
        persisted,
        {"task_id": "celery-1", "status": "SUCCESS"},
    )

    assert payload["status"] == "completed"
    assert payload["agent_task_id"] == 12
    assert payload["result"] == {"success": True}
    assert payload["created_at"].startswith("2026-01-01T00:00:00")


def test_celery_payload_remains_unchanged_without_persisted_task():
    celery_payload = {"task_id": "legacy-1", "status": "PROGRESS", "meta": {"step": "working"}}
    assert _resolve_persisted_task_status(None, celery_payload) == celery_payload


def test_persisted_status_marks_combined_source():
    persisted = SimpleNamespace(
        id=12,
        status="in_progress",
        created_at=None,
        started_at=None,
        completed_at=None,
        result=None,
        error_message=None,
    )

    payload = _resolve_persisted_task_status(
        persisted,
        {"task_id": "celery-1", "status": "PENDING"},
    )

    assert payload["source"] == "combined"
    assert payload["status"] == "in_progress"
