import hmac
import hashlib
import os
import json
import base64
import time
from typing import Dict, Any, Optional
from loguru import logger

# Sensitive-action signing must never have a source-code fallback.
SECURITY_SECRET = os.getenv("AGENT_SECURITY_SECRET")
if not SECURITY_SECRET and os.getenv("ENVIRONMENT", "development").lower() == "production":
    raise RuntimeError("AGENT_SECURITY_SECRET is required in production")
SECURITY_SECRET = SECURITY_SECRET or "development-only-agent-key"

class ActionSigner:
    """
    Handles generation and verification of cryptographic tokens for sensitive agent actions.
    This ensures that even if an agent's 'loop' is compromised, it cannot execute 
    high-risk tools without a user-granted signature.
    """

    @staticmethod
    def generate_token(action: str, params: Dict[str, Any], user_email: str) -> str:
        """
        Generate an HMAC-SHA256 signature for a specific action and its parameters.
        The token is bound to the user and the exact payload.
        """
        # Canonicalize the payload to ensure consistent hashing
        payload = {
            "action": action,
            "params": params,
            "user_email": user_email
        }
        message = json.dumps(payload, sort_keys=True).encode("utf-8")
        
        signature = hmac.new(
            SECURITY_SECRET.encode("utf-8"),
            message,
            hashlib.sha256
        ).hexdigest()
        
        return signature

    @staticmethod
    def canonical_params(params: Dict[str, Any]) -> Dict[str, Any]:
        """Remove transport metadata before signing/verifying tool arguments."""
        return {k: v for k, v in params.items() if k != "_security_signature"}

    @staticmethod
    def verify_token(token: str, action: str, params: Dict[str, Any], user_email: str) -> bool:
        """
        Verify that a provided token matches the action/params/user.
        """
        if not token:
            return False
            
        expected = ActionSigner.generate_token(action, params, user_email)
        
        # Use hmac.compare_digest to prevent timing attacks
        is_valid = hmac.compare_digest(token, expected)
        
        if is_valid:
            logger.info(f"Cryptographic scope VERIFIED for action '{action}' (User: {user_email})")
        else:
            logger.warning(f"Cryptographic scope DENIED for action '{action}' (User: {user_email}) - Invalid Signature")
            
        return is_valid

# Global instance for easy access
GLOBAL_SIGNER = ActionSigner()


def create_oauth_state(user_email: str, platform: str) -> str:
    """Create a short-lived, tamper-evident OAuth state value."""
    payload = {"email": user_email, "platform": platform, "iat": int(time.time()), "nonce": os.urandom(16).hex()}
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(SECURITY_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def verify_oauth_state(state: str, platform: str, max_age: int = 600) -> Optional[str]:
    try:
        raw, sig = state.split(".", 1)
        expected = hmac.new(SECURITY_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padded = raw + "=" * (-len(raw) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        if payload.get("platform") != platform or int(time.time()) - int(payload.get("iat", 0)) > max_age:
            return None
        return payload.get("email")
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, OSError):
        return None


def oauth_state_platform(state: str) -> Optional[str]:
    try:
        raw = state.split(".", 1)[0]
        padded = raw + "=" * (-len(raw) % 4)
        return json.loads(base64.urlsafe_b64decode(padded).decode()).get("platform")
    except (ValueError, TypeError, json.JSONDecodeError, OSError):
        return None
