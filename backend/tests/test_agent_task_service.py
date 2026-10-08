from unittest.mock import Mock, patch

import workers.agent_tasks
from workers.agent_tasks import _agent_task_cancelled, _mark_agent_task_cancelled, _update_agent_task
from services.agent_task_service import request_agent_task_cancellation
from services.agent_task_service import enqueue_agent_task


class _FakeQuery:
    def __init__(self, agent):
        self.agent = agent

    def filter(self, *args):
        return self

    def first(self):
        return self.agent


class _FakeDb:
    def __init__(self, agent):
        self.agent = agent
        self.added = []
        self.commit_count = 0

    def query(self, model):
        return _FakeQuery(self.agent)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commit_count += 1

    def refresh(self, value):
        value.id = 321

    def close(self):
        pass


def test_enqueue_agent_task_delegates_to_existing_celery_executor():
    celery_result = Mock(id="celery-task-123")
    celery_task = Mock()
    celery_task.apply_async.return_value = celery_result

    with patch("workers.agent_tasks.run_agent_task", celery_task):
        result = enqueue_agent_task(
            user_email="user@example.com",
            task_description="Prepare a summary",
            agent_type="custom",
            agent_id=7,
            context={"source": "test"},
        )

    assert result is celery_result
    celery_task.apply_async.assert_called_once_with(
        kwargs={
            "user_email": "user@example.com",
            "task_description": "Prepare a summary",
            "agent_type": "custom",
            "agent_id": 7,
            "context": {"source": "test"},
            "agent_task_id": None,
        },
        queue="long_running",
    )


def test_enqueue_agent_task_normalizes_missing_context():
    celery_task = Mock()

    with patch("workers.agent_tasks.run_agent_task", celery_task):
        enqueue_agent_task(
            user_email="user@example.com",
            task_description="Prepare a summary",
            context=None,
        )

    celery_task.apply_async.assert_called_once_with(
        kwargs={
            "user_email": "user@example.com",
            "task_description": "Prepare a summary",
            "agent_type": "custom",
            "agent_id": None,
            "context": {},
            "agent_task_id": None,
        },
        queue="long_running",
    )


def test_enqueue_agent_task_preserves_legacy_queue_only_behavior_without_agent_id():
    celery_task = Mock()

    with patch("workers.agent_tasks.run_agent_task", celery_task):
        enqueue_agent_task(
            user_email="user@example.com",
            task_description="Run built-in agent",
            agent_type="email_manager",
            agent_id=None,
            db_session=Mock(),
            user_id=42,
        )

    celery_task.apply_async.assert_called_once()


def test_enqueue_agent_task_persists_database_agent_before_queueing():
    agent = Mock()
    db = _FakeDb(agent)
    celery_task = Mock()
    celery_result = Mock(id="celery-task-321")
    celery_task.apply_async.return_value = celery_result

    with patch("workers.agent_tasks.run_agent_task", celery_task):
        result = enqueue_agent_task(
            user_email="user@example.com",
            task_description="Prepare a summary",
            agent_id=7,
            db_session=db,
            user_id=42,
        )

    assert result is celery_result
    assert len(db.added) == 1
    record = db.added[0]
    assert record.user_id == 42
    assert record.agent_id == 7
    assert record.status == "pending"
    assert record.task_metadata["celery_task_id"] == "celery-task-321"
    celery_task.apply_async.assert_called_once_with(
        kwargs={
            "user_email": "user@example.com",
            "task_description": "Prepare a summary",
            "agent_type": "custom",
            "agent_id": 7,
            "context": {},
            "agent_task_id": 321,
        },
        queue="long_running",
    )
    assert db.commit_count == 2
    celery_task.apply_async.assert_called_once()


def test_enqueue_agent_task_marks_persisted_record_failed_when_queueing_fails():
    agent = Mock()
    db = _FakeDb(agent)
    celery_task = Mock()
    celery_task.apply_async.side_effect = RuntimeError("broker unavailable")

    with patch("workers.agent_tasks.run_agent_task", celery_task):
        try:
            enqueue_agent_task(
                user_email="user@example.com",
                task_description="Prepare a summary",
                agent_id=7,
                db_session=db,
                user_id=42,
            )
        except RuntimeError as exc:
            assert str(exc) == "broker unavailable"
        else:
            raise AssertionError("Expected queue failure")

    record = db.added[0]
    assert record.status == "failed"
    assert "Queue submission failed" in record.error_message
    assert db.commit_count == 2


def test_worker_lifecycle_helper_persists_status_fields():
    task = Mock()
    db = _FakeDb(task)

    with patch("auth.database.SessionLocal", return_value=db):
        _update_agent_task(
            321,
            status="completed",
            completed_at="now",
            result={"success": True},
        )

    assert task.status == "completed"
    assert task.completed_at == "now"
    assert task.result == {"success": True}
    assert db.commit_count == 1


def test_worker_cancellation_check_detects_cancelled_task():
    task = Mock(status="cancel_requested")
    db = _FakeDb(task)

    with patch("auth.database.SessionLocal", return_value=db):
        assert _agent_task_cancelled(321) is True


def test_worker_safe_checkpoint_marks_active_task_cancelled_and_emits_event():
    task = Mock(status="cancel_requested")
    db = _FakeDb(task)

    with patch("auth.database.SessionLocal", return_value=db), patch(
        "workers.agent_tasks._push_update"
    ) as push_update:
        result = _mark_agent_task_cancelled(321, "celery-321")

    assert result["cancelled"] is True
    assert task.status == "cancelled"
    push_update.assert_called_once()
    assert push_update.call_args.args[0] == "celery-321"
    assert push_update.call_args.args[1]["type"] == "cancelled"


def test_cancellation_request_marks_queued_task_cancelled():
    task = Mock(
        id=321,
        status="pending",
        task_metadata={"celery_task_id": "celery-321"},
    )
    db = _FakeDb(task)
    celery_app = Mock()

    with patch("workers.celery_app.celery_app", celery_app):
        cancelled = request_agent_task_cancellation(
            task_id="celery-321",
            user_id=42,
            db_session=db,
        )

    assert cancelled.status == "cancelled"
    assert cancelled.task_metadata["cancellation_requested_by"] == 42
    celery_app.control.revoke.assert_called_once_with("celery-321", terminate=False)


def test_cancellation_request_marks_active_task_cancel_requested_without_revoke():
    task = Mock(
        id=321,
        status="in_progress",
        task_metadata={"celery_task_id": "celery-321"},
    )
    db = _FakeDb(task)
    celery_app = Mock()

    with patch("workers.celery_app.celery_app", celery_app):
        cancelled = request_agent_task_cancellation(
            task_id="celery-321",
            user_id=42,
            db_session=db,
        )

    assert cancelled.status == "cancel_requested"
    celery_app.control.revoke.assert_not_called()
