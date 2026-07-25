import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import google.auth.transport.requests
from google.auth.exceptions import RefreshError
from fastapi import HTTPException
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from loguru import logger

from auth.database import get_db
from auth.models import User
from utils.token_encryption import TokenEncryption

token_encryption = TokenEncryption()

# Google OAuth scopes (the exact set authorized during the consent screen)
_SCOPES: List[str] = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/forms",
    "https://www.googleapis.com/auth/forms.responses.readonly",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/tasks",
]


class GoogleAuthManager:
    """Centralized Google Authentication Manager for unified MCP tools."""

    # ── Internal helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _create_credentials(
        access_token: str, refresh_token: str, expiry: Optional[datetime] = None
    ) -> Credentials:
        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.getenv("GOOGLE_CLIENT_ID"),
            client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
            scopes=_SCOPES,
        )
        if expiry:
            # google-auth compares expiry using datetime.utcnow() (naive UTC) internally,
            # so expiry must be stored as naive UTC — strip tzinfo if present.
            if expiry.tzinfo is not None:
                expiry = expiry.replace(tzinfo=None)
            creds.expiry = expiry
        return creds

    @staticmethod
    def get_user_tokens(user_email: str, api_type: str = "all"):
        """Fetch and decrypt user tokens from the database (sync)."""
        db = next(get_db())
        try:
            user = db.query(User).filter(User.email == user_email).first()
            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            tokens: Dict[str, Any] = {}
            if api_type in ("gmail", "all"):
                if not user.gmail_access_token:
                    raise HTTPException(
                        status_code=400, detail="Gmail not connected. Please reconnect your Google account in Settings → Connected Apps."
                    )
                tokens["gmail_access"] = token_encryption.decrypt_token(
                    user.gmail_access_token
                )
                tokens["gmail_refresh"] = token_encryption.decrypt_token(
                    user.gmail_refresh_token
                ) if user.gmail_refresh_token else None
                tokens["gmail_expiry"] = user.gmail_token_expires_at

            if api_type in ("calendar", "all"):
                if not user.calendar_access_token:
                    raise HTTPException(
                        status_code=400, detail="Google Calendar not connected. Please reconnect your Google account in Settings → Connected Apps."
                    )
                tokens["calendar_access"] = token_encryption.decrypt_token(
                    user.calendar_access_token
                )
                tokens["calendar_refresh"] = token_encryption.decrypt_token(
                    user.calendar_refresh_token
                ) if user.calendar_refresh_token else None
                tokens["calendar_expiry"] = user.calendar_token_expires_at

            return tokens, getattr(user, "timezone", "UTC")
        finally:
            db.close()

    # ── Core service builder (sync, runs on a thread) ────────────────────────

    @classmethod
    def _get_service_sync(
        cls, service_name: str, version: str, user_email: str
    ) -> Tuple[Any, str]:
        """Build and cache an authenticated Google API service (synchronous).

        Returns (service_object, timezone_string).
        """
        # All services share one unified OAuth token (all scopes authorized together).
        # Non-gmail/calendar services (sheets, forms, slides, drive, docs) use
        # the gmail token bucket, which already holds all required scopes.
        token_type = service_name if service_name in ("gmail", "calendar") else "gmail"

        try:
            tokens, user_timezone = cls.get_user_tokens(user_email, api_type=token_type)
            creds = cls._create_credentials(
                tokens[f"{token_type}_access"],
                tokens[f"{token_type}_refresh"],
                expiry=tokens.get(f"{token_type}_expiry"),
            )

            # Auto-refresh when token is expired or within 60 seconds of expiry
            needs_refresh = creds.expired or (
                creds.expiry is not None and
                creds.expiry <= datetime.utcnow() + timedelta(seconds=60)
            )
            if needs_refresh:
                if not creds.refresh_token:
                    raise HTTPException(
                        status_code=401,
                        detail=(
                            f"Google {service_name.title()} token is expired and no refresh token is available. "
                            "Please reconnect your Google account in Settings → Connected Apps."
                        ),
                    )
                try:
                    creds.refresh(google.auth.transport.requests.Request())
                    logger.info(f"Refreshed {service_name} token for {user_email}")

                    # Persist the new access token + expiry back to the DB
                    db = next(get_db())
                    try:
                        user = db.query(User).filter(User.email == user_email).first()
                        if user:
                            encrypted = token_encryption.encrypt_token(creds.token)
                            new_expiry = creds.expiry or (
                                datetime.utcnow() + timedelta(hours=1)
                            )
                            user.gmail_access_token = encrypted
                            user.gmail_token_expires_at = new_expiry
                            user.calendar_access_token = encrypted
                            user.calendar_token_expires_at = new_expiry
                            db.commit()
                    finally:
                        db.close()

                except (RefreshError, Exception) as refresh_err:
                    logger.error(
                        f"Failed to refresh {service_name} token for "
                        f"{user_email}: {refresh_err}"
                    )
                    raise HTTPException(
                        status_code=401,
                        detail=(
                            f"Google {service_name.title()} access has expired or been revoked. "
                            "Please reconnect your Google account in Settings → Connected Apps."
                        ),
                    )

            service = build(service_name, version, credentials=creds, static_discovery=True)
            return service, user_timezone

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error building {service_name} service: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # ── Public API ───────────────────────────────────────────────────────────

    @classmethod
    async def get_service_async(
        cls, service_name: str, version: str, user_email: str
    ) -> Tuple[Any, str]:
        """Async wrapper - keeps the event loop free while doing sync I/O.

        All tool endpoints should call this instead of get_service().
        """
        return await asyncio.to_thread(
            cls._get_service_sync, service_name, version, user_email
        )

    @classmethod
    def get_service(cls, service_name: str, version: str, user_email: str):
        """Synchronous convenience accessor (backward-compatible).

        Prefer get_service_async() in async contexts.
        """
        return cls._get_service_sync(service_name, version, user_email)
