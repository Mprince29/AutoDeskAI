import os
import sys
import time

os.environ.setdefault("AGENT_SECURITY_SECRET", "pytest-security-secret")

from services.security import (  # noqa: E402
    GLOBAL_SIGNER,
    create_oauth_state,
    oauth_state_platform,
    verify_oauth_state,
)


def test_action_signature_is_bound_to_exact_payload():
    payload = {"to": "a@example.com", "body": "hello"}
    signature = GLOBAL_SIGNER.generate_token("send_email", payload, "u@example.com")
    assert GLOBAL_SIGNER.verify_token(signature, "send_email", payload, "u@example.com")
    assert not GLOBAL_SIGNER.verify_token(
        signature, "send_email", {**payload, "to": "b@example.com"}, "u@example.com"
    )


def test_oauth_state_is_signed_and_platform_bound():
    state = create_oauth_state("u@example.com", "google")
    assert oauth_state_platform(state) == "google"
    assert verify_oauth_state(state, "google") == "u@example.com"
    assert verify_oauth_state(state, "microsoft") is None


def test_oauth_state_rejects_tampering():
    state = create_oauth_state("u@example.com", "google")
    raw, signature = state.split(".", 1)
    tampered = raw[:-1] + ("A" if raw[-1] != "A" else "B") + "." + signature
    assert verify_oauth_state(tampered, "google") is None
