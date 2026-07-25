import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from loguru import logger

class TokenEncryption:
    def __init__(self):
        self.secret_key = os.getenv("ENCRYPTION_SECRET_KEY")
        if not self.secret_key:
            # Generate a new key if not provided (for development)
            self.secret_key = Fernet.generate_key()
            logger.warning("ENCRYPTION_SECRET_KEY not set. Generated new key for development.")
        
        # Convert string to bytes if needed
        if isinstance(self.secret_key, str):
            self.secret_key = self.secret_key.encode()
        
        self.cipher_suite = Fernet(self.secret_key)
    
    def encrypt_token(self, token: str) -> str:
        """Encrypt an OAuth token before storing in database."""
        if not token:
            return ""
        
        try:
            encrypted_token = self.cipher_suite.encrypt(token.encode())
            return base64.urlsafe_b64encode(encrypted_token).decode()
        except Exception as e:
            logger.error(f"Failed to encrypt token: {e}")
            raise
    
    def decrypt_token(self, encrypted_token: str) -> str:
        """Decrypt an OAuth token from database."""
        if not encrypted_token:
            return ""
        
        try:
            encrypted_bytes = base64.urlsafe_b64decode(encrypted_token.encode())
            decrypted_token = self.cipher_suite.decrypt(encrypted_bytes)
            return decrypted_token.decode()
        except Exception as e:
            logger.error(f"Failed to decrypt token: {e}")
            raise

# Global instance
token_encryption = TokenEncryption() 