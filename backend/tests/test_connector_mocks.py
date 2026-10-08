import asyncio

import pytest
from services.resilience import retry_with_backoff

from mcp_servers.core.mcp_tools import _TOOL_REGISTRY, execute_tool, mcp_tool


@mcp_tool(
    name="pytest_connector_mock",
    description="test connector",
    parameters={"type": "object", "properties": {}},
    provider="all",
)
async def _pytest_connector_mock(user_email, db):
    return {"ok": True, "user": user_email}


@mcp_tool(
    name="pytest_connector_failure",
    description="test connector failure",
    parameters={"type": "object", "properties": {}},
    provider="all",
)
async def _pytest_connector_failure(user_email, db):
    raise TimeoutError("provider timeout")


@pytest.mark.asyncio
async def test_mock_connector_success_and_failure_are_normalized():
    success = await execute_tool("pytest_connector_mock", {}, "u@example.com", None)
    failure = await execute_tool("pytest_connector_failure", {}, "u@example.com", None)
    assert success["ok"] is True
    assert failure["error"].startswith("Tool 'pytest_connector_failure' failed:")


@pytest.mark.asyncio
async def test_mock_connector_timeout_is_bounded_by_caller():
    async def slow(user_email, db):
        await asyncio.sleep(1)

    _TOOL_REGISTRY["pytest_connector_slow"] = {
        "handler": slow,
        "description": "slow test connector",
        "parameters": {"type": "object", "properties": {}},
        "provider": "all",
        "approval_required": False,
    }
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(
            execute_tool("pytest_connector_slow", {}, "u@example.com", None),
            timeout=0.01,
        )


@pytest.mark.asyncio
async def test_retry_retries_async_timeout_and_max_retries_means_retries():
    calls = 0

    async def flaky():
        nonlocal calls
        calls += 1
        if calls <= 3:
            raise asyncio.TimeoutError()
        return "ok"

    result = await retry_with_backoff(flaky, max_retries=3, base_delay=0)
    assert result == "ok"
    assert calls == 4
