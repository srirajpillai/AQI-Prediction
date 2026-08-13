"""
AirFlow AI v3 — Shared Auth Utilities
Centralised token verification and auth decorator for all routes.
"""
from __future__ import annotations
import logging
from functools import wraps
from flask import request, jsonify, g

logger = logging.getLogger(__name__)


def get_uid_from_request() -> str | None:
    """
    Extract and verify Firebase ID token from Authorization header.
    Returns uid on success, None on failure.
    """
    header = request.headers.get('Authorization', '')
    if not header.startswith('Bearer '):
        return None
    token = header[7:].strip()
    if not token:
        return None
    try:
        from services.firebase_service import verify_id_token
        claims = verify_id_token(token)
        return claims.get('uid')
    except Exception as e:
        logger.debug(f"Token verification failed: {type(e).__name__}")
        return None


def require_auth(f):
    """
    Decorator: verify Firebase Auth token and inject g.uid.
    Returns 401 if missing or invalid.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = get_uid_from_request()
        if not uid:
            return jsonify({'error': 'Unauthorised — valid Bearer token required'}), 401
        g.uid = uid
        return f(*args, **kwargs)
    return decorated


def validate_lat_lon(lat_str: str | None, lon_str: str | None) -> tuple[float, float] | None:
    """
    Validate and parse lat/lon strings with geographic range checking.
    Returns (lat, lon) tuple or None on error.
    """
    try:
        lat = float(lat_str)
        lon = float(lon_str)
    except (TypeError, ValueError):
        return None
    # Strict geographic bounds
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        return None
    return lat, lon


def sanitize_string(value: str, max_len: int = 100) -> str:
    """Strip and truncate a string input to prevent DoS and injection."""
    if not isinstance(value, str):
        return ''
    return value.strip()[:max_len]
