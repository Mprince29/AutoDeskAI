"""
Minimum-viable regression net for the JWT auth fix.

Covers: token creation/decoding round-trips through a real signature (not the old
literal "mock-jwt-token" string), get_current_user rejects missing/invalid/expired
tokens, accepts valid ones, and signup/login issue real, decodable tokens.
"""
import time
from datetime import timedelta, timezone, datetime
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from jose import jwt

from auth.routes import (
    router,
    create_access_token,
    decode_access_token,
    get_current_user,
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
    hash_password,
    verify_password,
)
from auth.models import User


# ── Pure JWT helpers ──────────────────────────────────────────────────────────

def test_create_access_token_is_not_the_old_mock_string():
    token = create_access_token("user@example.com")
    assert token != "mock-jwt-token"
    assert token.count(".") == 2  # header.payload.signature


def test_create_and_decode_access_token_round_trip():
    token = create_access_token("user@example.com")
    assert decode_access_token(token) == "user@example.com"


def test_decode_access_token_rejects_garbage():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        decode_access_token("not-a-real-token")
    assert exc_info.value.status_code == 401


def test_decode_access_token_rejects_expired_token():
    from fastapi import HTTPException
    expired_payload = {
        "sub": "user@example.com",
        "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
    }
    expired_token = jwt.encode(expired_payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    with pytest.raises(HTTPException) as exc_info:
        decode_access_token(expired_token)
    assert exc_info.value.status_code == 401


def test_decode_access_token_rejects_wrong_signature():
    from fastapi import HTTPException
    forged = jwt.encode({"sub": "user@example.com", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                         "a-completely-different-secret", algorithm=JWT_ALGORITHM)
    with pytest.raises(HTTPException) as exc_info:
        decode_access_token(forged)
    assert exc_info.value.status_code == 401


# ── Password hashing (unchanged, sanity check) ────────────────────────────────

def test_password_hash_and_verify():
    hashed = hash_password("correct-horse-battery-staple")
    assert verify_password("correct-horse-battery-staple", hashed)
    assert not verify_password("wrong-password", hashed)


# ── get_current_user via a minimal test app ──────────────────────────────────

def _make_fake_user(email="user@example.com"):
    user = MagicMock(spec=User)
    user.email = email
    user.id = 1
    user.name = "Test User"
    return user


@pytest.fixture
def app_with_protected_route():
    app = FastAPI()

    @app.get("/protected")
    def protected(user: User = Depends(get_current_user)):
        return {"email": user.email}

    return app


@pytest.fixture
def fake_db_session():
    db = MagicMock()
    return db


def test_protected_route_rejects_missing_token(app_with_protected_route):
    client = TestClient(app_with_protected_route)
    resp = client.get("/protected")
    assert resp.status_code == 401


def test_protected_route_rejects_invalid_token(app_with_protected_route):
    client = TestClient(app_with_protected_route)
    resp = client.get("/protected", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_protected_route_accepts_valid_token(app_with_protected_route, fake_db_session, monkeypatch):
    from auth import routes as auth_routes_module
    auth_routes_module._USER_CACHE.clear()

    email = "user@example.com"
    fake_user = _make_fake_user(email)
    fake_db_session.query.return_value.filter.return_value.first.return_value = fake_user
    fake_db_session.merge.return_value = fake_user

    from auth.database import get_db
    app_with_protected_route.dependency_overrides[get_db] = lambda: fake_db_session

    token = create_access_token(email)
    client = TestClient(app_with_protected_route)
    resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == email


# ── signup / login issue real tokens ─────────────────────────────────────────

@pytest.fixture
def auth_app(fake_db_session):
    from auth import routes as auth_routes_module
    from auth.database import get_db

    auth_routes_module._USER_CACHE.clear()

    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: fake_db_session
    return app


def test_signup_returns_real_jwt_not_mock_string(auth_app, fake_db_session):
    # No existing user with this email.
    fake_db_session.query.return_value.filter.return_value.first.return_value = None

    client = TestClient(auth_app)
    resp = client.post("/api/auth/signup", json={
        "name": "New User",
        "email": "new@example.com",
        "password": "supersecret123",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] != "mock-jwt-token"
    assert decode_access_token(body["access_token"]) == "new@example.com"


def test_login_rejects_wrong_password(auth_app, fake_db_session):
    existing_user = _make_fake_user("existing@example.com")
    existing_user.hashed_password = hash_password("correct-password")
    fake_db_session.query.return_value.filter.return_value.first.return_value = existing_user

    client = TestClient(auth_app)
    resp = client.post("/api/auth/login", json={
        "email": "existing@example.com",
        "password": "wrong-password",
    })
    assert resp.status_code == 401


def test_login_success_returns_real_jwt(auth_app, fake_db_session):
    existing_user = _make_fake_user("existing@example.com")
    existing_user.hashed_password = hash_password("correct-password")
    fake_db_session.query.return_value.filter.return_value.first.return_value = existing_user

    client = TestClient(auth_app)
    resp = client.post("/api/auth/login", json={
        "email": "existing@example.com",
        "password": "correct-password",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] != "mock-jwt-token"
    assert decode_access_token(body["access_token"]) == "existing@example.com"
