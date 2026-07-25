import hmac
import hashlib
import os
import json
from typing import Dict, Any, Optional
from loguru import logger

# Phase 10: Cryptographic Scoping Secret
# In production, this would be a rotated secret from a KMS.
SECURITY_SECRET = os.getenv("AGENT_SECURITY_SECRET", "super-secret-agent-key-2026")

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
