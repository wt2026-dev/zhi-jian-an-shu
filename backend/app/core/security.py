import os
import time
import json
import base64
import hmac
import hashlib
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

SECRET_KEY = os.getenv("JWT_SECRET", os.getenv("SECRET_KEY", "industrial-maintenance-super-secret-jwt-key-2026-safe-production"))
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

def get_password_hash(password: str) -> str:
    """生成安全盐值哈希 (SHA-256 + 固定盐值)"""
    salt = "industrial_salt_2026_secure"
    salted = f"{salt}${password}${salt}".encode("utf-8")
    return hashlib.sha256(salted).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """校验密码"""
    return get_password_hash(plain_password) == hashed_password

def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

def _base64url_decode(data: str) -> bytes:
    padding = 4 - (len(data) % 4)
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """生成标准 HS256 JWT Token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({
        "exp": int(expire.timestamp()),
        "iat": int(datetime.utcnow().timestamp())
    })
    
    header = {"alg": "HS256", "typ": "JWT"}
    encoded_header = _base64url_encode(json.dumps(header).encode("utf-8"))
    encoded_payload = _base64url_encode(json.dumps(to_encode).encode("utf-8"))
    
    message = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    signature = hmac.new(SECRET_KEY.encode("utf-8"), message, hashlib.sha256).digest()
    encoded_signature = _base64url_encode(signature)
    
    return f"{encoded_header}.{encoded_payload}.{encoded_signature}"

def decode_access_token(token: str) -> Dict[str, Any]:
    """验证并解码 JWT Token，若过期或签名无效则抛出 ValueError"""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token format")
    
    encoded_header, encoded_payload, encoded_signature = parts
    message = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    expected_signature = _base64url_encode(hmac.new(SECRET_KEY.encode("utf-8"), message, hashlib.sha256).digest())
    
    if not hmac.compare_digest(encoded_signature, expected_signature):
        raise ValueError("Invalid token signature")
    
    payload = json.loads(_base64url_decode(encoded_payload).decode("utf-8"))
    exp = payload.get("exp")
    if exp and exp < time.time():
        raise ValueError("Token has expired")
    
    return payload
