import asyncio

import pytest

from services.mcp_client import _run_tool_with_cancellation


@pytest.mark.asyncio
async def test_tool_cancellation_returns_unknown_external_action():
    checks = 0

    async def cancellation_check():
        nonlocal checks
        checks += 1
        return checks >= 1

    result = await _run_tool_with_cancellation(
        asyncio.sleep(10, result={"sent": True}),
        cancellation_check,
        timeout=2,
    )

    assert result["cancelled"] is True
    assert result["external_action_status"] == "unknown"
    assert checks >= 1


@pytest.mark.asyncio
async def test_tool_completion_is_returned_when_not_cancelled():
    result = await _run_tool_with_cancellation(
        asyncio.sleep(0, result={"success": True}),
        lambda: False,
        timeout=2,
    )

    assert result == {"success": True}
