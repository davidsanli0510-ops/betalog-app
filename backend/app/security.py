"""Passwords (bcrypt) and login tokens (JWT, HS256)."""
import base64
import os
import secrets
import time
from pathlib import Path
from typing import Optional

import bcrypt
import jwt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("ascii")


# a real bcrypt hash of a random password, checked when the account doesn't exist (equal timing)
DUMMY_HASH = bcrypt.hashpw(secrets.token_bytes(16), bcrypt.gensalt()).decode("ascii")


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("ascii"))
    except ValueError:
        return False


def load_secret(configured: Optional[str], data_dir: str) -> str:
    """Use JWT_SECRET when set; otherwise create one and keep it in the data folder so logins survive restarts."""
    if configured:
        if len(configured) < 32:
            raise RuntimeError("JWT_SECRET must be at least 32 characters")
        return configured
    path = Path(data_dir) / "jwt.key"
    if path.exists():
        return path.read_text().strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    key = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode("ascii")
    path.write_text(key)
    os.chmod(path, 0o600)
    return key


class Tokens:
    def __init__(self, secret: str, days: int = 60):
        self.secret = secret
        self.ttl = days * 86400

    def issue(self, user_id: int) -> str:
        now = int(time.time())
        return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + self.ttl}, self.secret, algorithm="HS256")

    def verify(self, token: str) -> Optional[int]:
        """Returns the user id, or None when the token is missing, tampered with or expired."""
        try:
            return int(jwt.decode(token, self.secret, algorithms=["HS256"])["sub"])
        except (jwt.PyJWTError, KeyError, ValueError):
            return None
