import json
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from auth.models import User
from auth.database import Base
from mcp_servers.core.mcp_tools import _TOOL_REGISTRY, execute_tool
from models import ExternalAction
from services.security import GLOBAL_SIGNER


class _FakeRedis:
    def __init__(self):
        self.values = {}
        self.cached_result = None

    async def get(self, key):
        if key.endswith(":result") and self.cached_result is not None:
            return self.cached_result
        return self.values.get(key)

    async def set(self, key, value, **_kwargs):
        self.values[key] = value
        return True

    async def delete(self, key):
        self.values.pop(key, None)
        return 1


@pytest.mark.asyncio
async def test_sensitive_action_persists_provider_reference_and_deduplicates():
    engine = create_engine("sqlite:///:memory:")
    User.__table__.create(engine)
    ExternalAction.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    session.add(User(email="u@example.com", hashed_password="hash", name="Test User"))
    session.commit()

    calls = 0

    async def fake_send(user_email, db, value):
        nonlocal calls
        calls += 1
        return {
            "success": True,
            "messageId": "gmail-message-123",
            "threadId": "gmail-thread-456",
            "value": value,
        }

    tool_name = "pytest_sensitive_provider_reference"
    _TOOL_REGISTRY[tool_name] = {
        "handler": fake_send,
        "description": "test sensitive provider",
        "parameters": {"type": "object", "properties": {"value": {"type": "string"}}},
        "provider": "google",
        "approval_required": True,
    }
    tool_input = {"value": "send-it"}
    signed = GLOBAL_SIGNER.generate_token(
        tool_name,
        GLOBAL_SIGNER.canonical_params(tool_input),
        "u@example.com",
    )

    redis = _FakeRedis()
    # Simulate a stale result left by a legacy queue-only execution. A
    # task-backed call must still create/read its durable ExternalAction.
    redis.cached_result = json.dumps({"success": True, "messageId": "stale-result"})
    try:
        with patch("services.redis_service.get_redis", return_value=redis), patch(
            "mcp_servers.core.mcp_tools._fire_log"
        ):
            first = await execute_tool(
                tool_name,
                {**tool_input, "_security_signature": signed},
                "u@example.com",
                session,
                agent_task_id=44,
            )
            second = await execute_tool(
                tool_name,
                {**tool_input, "_security_signature": signed},
                "u@example.com",
                session,
                agent_task_id=45,
            )

        action = session.query(ExternalAction).one()
        assert first["external_action_status"] == "succeeded"
        assert action.provider_reference == "gmail-message-123"
        assert action.result_payload["threadId"] == "gmail-thread-456"
        assert second["external_action_id"] == action.id
        assert second["external_action_status"] == "succeeded"
        assert calls == 1
    finally:
        _TOOL_REGISTRY.pop(tool_name, None)
        session.close()
        engine.dispose()
