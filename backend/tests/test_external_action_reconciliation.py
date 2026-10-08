import base64
from email import policy
from email.parser import BytesParser
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from auth.database import Base
from auth.models import User
from mcp_servers.tools.gmail_tools import _build_raw_message
from models import ExternalAction
from services.external_action_service import (
    action_marker_for_idempotency_key,
    reconcile_external_action,
)


def _session():
    engine = create_engine("sqlite:///:memory:")
    User.__table__.create(engine)
    ExternalAction.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    session.add(User(email="u@example.com", hashed_password="hash", name="Test User"))
    session.commit()
    return engine, session


def test_email_marker_is_deterministic_and_embedded_in_message_id():
    marker = action_marker_for_idempotency_key("tool-idem:v1:u@example.com:send_email:abc")
    raw = _build_raw_message(
        "to@example.com",
        "Subject",
        "Body",
        action_marker=marker,
    )
    message = BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(raw))

    assert message["X-AutoDeskAI-Action"] == marker
    assert message["Message-ID"] == f"<autodeskai-{marker}@autodeskai.local>"


@pytest.mark.asyncio
async def test_reconciliation_marks_unknown_send_succeeded_only_when_gmail_finds_it():
    engine, session = _session()
    action = ExternalAction(
        user_id=1,
        tool_name="send_email",
        provider="google",
        idempotency_key="tool-idem:v1:u@example.com:send_email:abc",
        request_hash="abc",
        status="unknown",
        unknown_reason="Local execution cancelled while provider outcome was unresolved.",
    )
    session.add(action)
    session.commit()

    found = {"messageId": "gmail-message-999", "threadId": "gmail-thread-888"}
    lookup = AsyncMock(return_value=found)
    try:
        with patch("mcp_servers.tools.gmail_tools.find_email_by_action_marker", lookup):
            resolved, reconciled = await reconcile_external_action(
                action_id=action.id,
                user_id=1,
                db_session=session,
            )

        assert reconciled is True
        assert resolved.status == "succeeded"
        assert resolved.provider_reference == "gmail-message-999"
        assert resolved.result_payload["reconciled"] is True
        lookup.assert_awaited_once_with(
            "u@example.com",
            action_marker_for_idempotency_key(action.idempotency_key),
        )
    finally:
        session.close()
        engine.dispose()


@pytest.mark.asyncio
async def test_reconciliation_keeps_unknown_when_gmail_has_no_match():
    engine, session = _session()
    action = ExternalAction(
        user_id=1,
        tool_name="send_email",
        provider="google",
        idempotency_key="tool-idem:v1:u@example.com:send_email:no-match",
        request_hash="no-match",
        status="unknown",
    )
    session.add(action)
    session.commit()

    try:
        with patch(
            "mcp_servers.tools.gmail_tools.find_email_by_action_marker",
            AsyncMock(return_value=None),
        ):
            resolved, reconciled = await reconcile_external_action(
                action_id=action.id,
                user_id=1,
                db_session=session,
            )

        assert reconciled is False
        assert resolved.status == "unknown"
        assert resolved.provider_reference is None
    finally:
        session.close()
        engine.dispose()
