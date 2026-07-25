"""
Vault Service
Centralised encrypt/decrypt/revoke for all per-user platform credentials.
Wraps the existing token_encryption Fernet util - no new key material needed.

Usage:
    from services.vault_service import vault

    # OAuth platforms
    vault.store_oauth(user_id, "slack", token_response, db)
    cred = vault.get(user_id, "slack", db)   # → {"access_token": "...", ...}

    # API-key platforms
    vault.store_api_key(user_id, "trello", {"api_key": "...", "token": "..."}, db)

    # Status
    vault.list_connected(user_id, db)        # → [{"platform": "slack", "status": "connected"}, …]
    vault.revoke(user_id, "slack", db)       # deletes the row
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

# In-memory credential cache: key → {"cred": ..., "ts": float}
# 5-minute TTL keeps tokens fresh while eliminating repeat decryptions within
# a single agent workflow (which may call resolve_credential 5-10x per run).
_CRED_CACHE: Dict[str, Dict] = {}
_CRED_CACHE_TTL = 300  # seconds


def _cache_get(key: str) -> Optional[Any]:
    entry = _CRED_CACHE.get(key)
    if entry and (time.monotonic() - entry["ts"]) < _CRED_CACHE_TTL:
        return entry["cred"]
    return None


def _cache_set(key: str, cred: Any) -> None:
    _CRED_CACHE[key] = {"cred": cred, "ts": time.monotonic()}
    # Evict stale entries when cache grows large (>500 keys)
    if len(_CRED_CACHE) > 500:
        cutoff = time.monotonic() - _CRED_CACHE_TTL
        stale = [k for k, v in _CRED_CACHE.items() if v["ts"] < cutoff]
        for k in stale:
            _CRED_CACHE.pop(k, None)


def _cache_invalidate(user_email: str, platform: str) -> None:
    _CRED_CACHE.pop(f"{user_email}:{platform}", None)


class VaultService:
    """Thin layer over token_encryption for structured credential storage."""

    # ── Internal helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _enc(value: str) -> str:
        from utils.token_encryption import token_encryption
        return token_encryption.encrypt_token(value)

    @staticmethod
    def _dec(value: str) -> str:
        if not value:
            return ""
        from utils.token_encryption import token_encryption
        return token_encryption.decrypt_token(value)

    # ── Store ─────────────────────────────────────────────────────────────────

    def store_oauth(
        self,
        user_id: int,
        platform: str,
        token_response: Dict[str, Any],
        db,
        metadata: Optional[Dict] = None,
    ) -> None:
        """Persist an OAuth token response for a platform."""
        from auth.models import UserIntegration

        access_token = token_response.get("access_token", "")
        refresh_token = token_response.get("refresh_token", "")
        expires_in = token_response.get("expires_in")

        expiry = None
        if expires_in:
            expiry = datetime.now(tz=timezone.utc) + timedelta(seconds=int(expires_in))

        row = db.query(UserIntegration).filter(
            UserIntegration.user_id == user_id,
            UserIntegration.platform == platform,
        ).first()

        if row:
            row.encrypted_token = self._enc(access_token) if access_token else row.encrypted_token
            row.encrypted_refresh_token = self._enc(refresh_token) if refresh_token else row.encrypted_refresh_token
            row.token_expiry = expiry or row.token_expiry
            row.metadata_json = metadata or row.metadata_json
            row.status = "connected"
        else:
            row = UserIntegration(
                user_id=user_id,
                platform=platform,
                auth_type="oauth2",
                encrypted_token=self._enc(access_token),
                encrypted_refresh_token=self._enc(refresh_token) if refresh_token else None,
                token_expiry=expiry,
                metadata_json=metadata,
                status="connected",
            )
            db.add(row)

        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
        logger.info(f"vault: stored oauth for user={user_id} platform={platform}")

    def store_api_key(
        self,
        user_id: int,
        platform: str,
        fields: Dict[str, str],
        db,
        auth_type: str = "api_key",
    ) -> None:
        """Persist an API-key-style credential (stored as JSON, encrypted as one blob)."""
        from auth.models import UserIntegration

        payload = json.dumps(fields)

        row = db.query(UserIntegration).filter(
            UserIntegration.user_id == user_id,
            UserIntegration.platform == platform,
        ).first()

        if row:
            row.encrypted_token = self._enc(payload)
            row.auth_type = auth_type
            row.status = "connected"
        else:
            row = UserIntegration(
                user_id=user_id,
                platform=platform,
                auth_type=auth_type,
                encrypted_token=self._enc(payload),
                status="connected",
            )
            db.add(row)

        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
        logger.info(f"vault: stored api_key for user={user_id} platform={platform}")

    # ── Retrieve ──────────────────────────────────────────────────────────────

    def get(self, user_id: int, platform: str, db) -> Optional[Dict[str, Any]]:
        """
        Return decrypted credential dict or None.
        For oauth2: {"access_token": "...", "refresh_token": "...", "expiry": ...}
        For api_key/bot_token: the original fields dict
        """
        from auth.models import UserIntegration

        row = db.query(UserIntegration).filter(
            UserIntegration.user_id == user_id,
            UserIntegration.platform == platform,
            UserIntegration.status == "connected",
        ).first()

        if not row:
            logger.debug(f"vault.get() | user_id={user_id} | platform={platform} | status=connected | result=NOT_FOUND (no row)")
            return None

        logger.debug(f"vault.get() | user_id={user_id} | platform={platform} | auth_type={row.auth_type} | attempting decrypt")
        try:
            decrypted = self._dec(row.encrypted_token)
            logger.debug(f"vault.get() | user_id={user_id} | platform={platform} | decrypt=SUCCESS")

            if row.auth_type == "oauth2":
                refresh = self._dec(row.encrypted_refresh_token) if row.encrypted_refresh_token else ""
                return {
                    "access_token": decrypted,
                    "refresh_token": refresh,
                    "expiry": row.token_expiry.isoformat() if row.token_expiry else None,
                    "metadata": row.metadata_json or {},
                }
            else:
                # api_key / bot_token stored as JSON
                parsed = json.loads(decrypted)
                logger.debug(f"vault.get() | user_id={user_id} | platform={platform} | parsed_keys={list(parsed.keys())}")
                return parsed
        except Exception as e:
            logger.error(f"vault.get() DECRYPT_FAILED | user_id={user_id} | platform={platform} | auth_type={row.auth_type if row else 'N/A'} | error={type(e).__name__}: {e}")
            return None

    def get_access_token(self, user_id: int, platform: str, db) -> Optional[str]:
        """Convenience: return just the access token string."""
        cred = self.get(user_id, platform, db)
        if not cred:
            return None
        return cred.get("access_token") or cred.get("bot_token") or cred.get("token") or cred.get("api_key") or cred.get("api_token")

    # ── Revoke ────────────────────────────────────────────────────────────────

    def revoke(self, user_id: int, platform: str, db) -> bool:
        """
        Disconnect a platform. 
        Instead of deleting, we set status='disconnected' to allow 'opt-out' 
        of company-managed keys.
        """
        from auth.models import UserIntegration

        row = db.query(UserIntegration).filter(
            UserIntegration.user_id == user_id,
            UserIntegration.platform == platform,
        ).first()
        
        if row:
            row.status = "disconnected"
            # Clear tokens for security if they were personal
            row.encrypted_token = None
            row.encrypted_refresh_token = None
        else:
            # Create an explicit 'opt-out' row
            row = UserIntegration(
                user_id=user_id,
                platform=platform,
                auth_type="api_key", # placeholder
                status="disconnected"
            )
            db.add(row)
            
        db.commit()
        logger.info(f"vault: revoked user={user_id} platform={platform} (opt-out persisted)")
        return True

    # ── Status ────────────────────────────────────────────────────────────────

    def list_connected(self, user_id: int, db) -> List[Dict]:
        from auth.models import UserIntegration

        rows = db.query(UserIntegration).filter(
            UserIntegration.user_id == user_id
        ).all()
        return [
            {
                "platform": r.platform,
                "status": r.status,
                "auth_type": r.auth_type,
                "metadata": r.metadata_json or {},
            }
            for r in rows
        ]

    def is_connected(self, user_id: int, platform: str, db) -> bool:
        from auth.models import UserIntegration

        return db.query(UserIntegration).filter(
            UserIntegration.user_id == user_id,
            UserIntegration.platform == platform,
            UserIntegration.status == "connected",
        ).first() is not None

    # ── Company / Personal Key Resolution ────────────────────────────────────

    COMPANY_DOMAIN = "example.com"

    # Maps platform name → env-var names for each credential field.
    # Used when a company-domain user chooses "Use company keys".
    _ENV_CRED_MAP: Dict[str, Dict[str, str]] = {
        "slack":    {"access_token": "SLACK_BOT_TOKEN"},
        "github":   {"access_token": "GITHUB_TOKEN"},
        # "jira":   {"access_token": "JIRA_API_TOKEN", "jira_server": "JIRA_SERVER_URL", "jira_email": "JIRA_USER_EMAIL"},  # Jira integration disabled
        "notion":   {"access_token": "NOTION_TOKEN"},
        "trello":   {"api_key": "TRELLO_API_KEY", "token": "TRELLO_TOKEN"},
        "discord":  {"access_token": "DISCORD_BOT_TOKEN"},
        "telegram": {"bot_token": "TELEGRAM_BOT_TOKEN"},
        "openai":   {"api_key": "OPENAI_API_KEY"},
        "anthropic":{"api_key": "ANTHROPIC_API_KEY"},
        "gemini":   {"api_key": "GEMINI_API_KEY"},
        "groq":     {"api_key": "GROQ_API_KEY"},
        "mistral":  {"api_key": "MISTRAL_API_KEY"},
        "deepseek": {"api_key": "DEEPSEEK_API_KEY"},
        "ollama":   {"base_url": "OLLAMA_BASE_URL"},
        "local_llm": {"api_base": "LOCAL_LLM_BASE_URL"},
    }

    def _get_env_creds(self, platform: str) -> Optional[Dict[str, str]]:
        """Return company-managed credentials from environment variables, or None if not configured."""
        import os
        mapping = self._ENV_CRED_MAP.get(platform, {})
        creds = {field: os.getenv(env_var, "") for field, env_var in mapping.items()}
        # Only return if at least one value is set
        return creds if any(creds.values()) else None

    def resolve_credential(self, user_email: str, platform: str, db) -> Optional[Dict[str, Any]]:
        """
        The single entry point for all tool credential lookups.

        Resolution order:
          1. If user is a company account AND use_company_keys is True (or unset) →
             return company-managed env-var credentials.
          2. Otherwise → return the user's personal vault credential.
             (No env-var fallback for non-company users - they must connect their own.)
        """
        from auth.models import User as UserModel

        if not user_email or not db:
            # No user context — return nothing rather than leaking company env creds.
            # Script callers that genuinely need env creds should call _get_env_creds() directly.
            return None

        # Fast path: return cached credential, avoiding DB + decrypt on every tool call
        cache_key = f"{user_email}:{platform}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        user = db.query(UserModel).filter(UserModel.email == user_email).first()

        # Hard security guard: non-company users must NEVER receive company env creds,
        # even if their DB row has use_company_keys=True due to data corruption or migration.
        is_company = user_email.lower().endswith(f"@{self.COMPANY_DOMAIN}")
        if user and not is_company and user.use_company_keys:
            import logging as _log
            _log.getLogger(__name__).warning(
                f"Non-company user {user_email} had use_company_keys=True - resetting to False."
            )
            user.use_company_keys = False
            try:
                db.commit()
            except Exception:
                db.rollback()

        if user and is_company:
            # NULL means not yet chosen - default True (use company keys) for company users
            use_company = user.use_company_keys if user.use_company_keys is not None else True
            if use_company:
                from auth.models import UserIntegration
                # Check for an explicit opt-out row first
                opt_out = db.query(UserIntegration).filter(
                    UserIntegration.user_id == user.id,
                    UserIntegration.platform == platform,
                    UserIntegration.status == "disconnected"
                ).first()
                
                if opt_out:
                    return None # User explicitly disconnected this platform

                env_creds = self._get_env_creds(platform)
                if env_creds:
                    _cache_set(cache_key, env_creds)
                    return env_creds

        if not user:
            return None
        cred = self.get(user.id, platform, db)
        if cred is not None:
            _cache_set(cache_key, cred)
        return cred

    # ── Connection Test ───────────────────────────────────────────────────────

    async def test_connection(self, user_id: int, platform: str, db) -> Dict[str, Any]:
        """
        Call the platform's test endpoint to verify the credential is still valid.
        Returns {"ok": bool, "detail": str}.
        """
        from services.integration_registry import INTEGRATION_REGISTRY
        import httpx

        config = INTEGRATION_REGISTRY.get(platform)
        if not config:
            return {"ok": False, "detail": "Unknown platform"}

        cred = self.get(user_id, platform, db)
        if not cred:
            return {"ok": False, "detail": "No credential stored"}

        test_url = config.get("test_endpoint")
        if not test_url:
            return {"ok": True, "detail": "No test endpoint - assumed connected"}

        token = cred.get("access_token") or cred.get("bot_token") or cred.get("token") or cred.get("api_key") or cred.get("api_token") or ""

        # Build test URL (replace {token} / {api_base} placeholders)
        api_base = cred.get("api_base", "").rstrip("/")
        test_url = test_url.replace("{token}", token).replace("{api_base}", api_base)

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                if config.get("test_auth") == "query_params":
                    # Platforms like Trello that use ?key=&token= instead of Bearer
                    # Use param mapping if available (e.g. "api_key" field → "key" query param)
                    param_map = config.get("test_query_param_map", {})
                    params = {}
                    for field_name in config.get("test_query_params", []):
                        api_param_name = param_map.get(field_name, field_name)  # Use mapping or fallback to field name
                        params[api_param_name] = cred.get(field_name, "")
                    resp = await client.get(test_url, params=params)
                elif config.get("auth_type") == "bot_token":
                    resp = await client.get(test_url)
                else:
                    extra_headers = config.get("test_headers", {})
                    resp = await client.get(test_url, headers={"Authorization": f"Bearer {token}", **extra_headers})
            if resp.status_code < 400:
                return {"ok": True, "detail": "Connection verified"}
            
            # Enhanced error response with Trello-specific debugging
            error_detail = f"HTTP {resp.status_code}"
            if platform == "trello":
                # Add Trello-specific debugging info
                try:
                    error_data = resp.json()
                    if isinstance(error_data, dict) and "error" in error_data:
                        error_detail += f": {error_data['error']}"
                except:
                    pass
                error_detail += " - Check that API Key and Token are current and from the same account"
            
            return {"ok": False, "detail": error_detail}
        except Exception as e:
            return {"ok": False, "detail": str(e)}


# Global singleton
vault = VaultService()
