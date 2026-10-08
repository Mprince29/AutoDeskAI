"""Explicit reconciliation for durable external side effects.

Reconciliation is intentionally separate from execution: it may inspect a
provider for evidence of a prior action, but it never sends or retries one.
"""

import hashlib
from datetime import datetime, timezone


def action_marker_for_idempotency_key(idempotency_key: str) -> str:
    """Return the deterministic marker embedded in an AutoDeskAI email."""
    return hashlib.sha256(idempotency_key.encode()).hexdigest()[:32]


async def reconcile_external_action(*, action_id: int, user_id: int, db_session):
    """Try to resolve one unknown Gmail send from provider-side evidence.

    Returns ``(action, reconciled)``. A missing Gmail result is inconclusive,
    so the action remains ``unknown`` and callers must not retry it blindly.
    """
    from auth.models import User
    from models import ExternalAction

    action = db_session.query(ExternalAction).filter(
        ExternalAction.id == action_id,
        ExternalAction.user_id == user_id,
    ).first()
    if action is None:
        raise ValueError("External action not found")

    if action.status != "unknown":
        return action, False

    if action.tool_name != "send_email" or action.provider != "google":
        return action, False

    user = db_session.query(User).filter(User.id == user_id).first()
    if user is None:
        raise ValueError("User not found")

    marker = action_marker_for_idempotency_key(action.idempotency_key)
    try:
        from mcp_servers.tools.gmail_tools import find_email_by_action_marker
        provider_result = await find_email_by_action_marker(user.email, marker)
    except Exception as exc:
        # Keep the original unknown state. Provider lookup failure is not
        # evidence that the email was not sent.
        action.unknown_reason = f"Reconciliation lookup failed: {exc}"
        db_session.commit()
        return action, False

    if not provider_result:
        return action, False

    action.status = "succeeded"
    action.provider_reference = provider_result.get("messageId")
    action.result_payload = {
        "success": True,
        **provider_result,
        "reconciled": True,
    }
    action.error_message = None
    action.unknown_reason = None
    action.completed_at = datetime.now(timezone.utc)
    db_session.commit()
    return action, True
