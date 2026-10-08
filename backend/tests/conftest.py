import os
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

# Ensure required env vars exist before any app module imports (auth/database.py
# raises at import time if DATABASE_URL is unset, and JWT routes require JWT_SECRET_KEY).
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-pytest-only")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("JWT_EXPIRE_MINUTES", "60")
