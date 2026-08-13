"""
AirFlow AI v3 — Health Profile Routes (secured & optimised)
All routes require Firebase Auth token via @require_auth decorator.
"""
from __future__ import annotations
import logging
import re
from datetime import datetime
from flask import Blueprint, request, jsonify, g

from auth_utils import require_auth, validate_lat_lon, sanitize_string
from services.firebase_service import (
    get_health_profile, save_health_profile,
    save_user_doc, add_fcm_token, remove_fcm_token,
)
from models.user import HealthProfile

logger    = logging.getLogger(__name__)
profile_bp = Blueprint('profile', __name__)

# FCM token validation: ~152-char base64url string
_FCM_TOKEN_RE = re.compile(r'^[A-Za-z0-9\-_:]{100,512}$')


@profile_bp.route('/', methods=['GET'])
@require_auth
def get_profile():
    """GET /api/profile/ — Fetch the user's health profile."""
    profile = get_health_profile(g.uid)
    if not profile:
        return jsonify({'exists': False, 'profile': None}), 200
    # Strip any internal fields before returning
    profile.pop('__v', None)
    return jsonify({'exists': True, 'profile': profile})


@profile_bp.route('/', methods=['POST', 'PUT'])
@require_auth
def save_profile():
    """POST/PUT /api/profile/ — Create or update the user's health profile."""
    body = request.get_json(silent=True, force=True)
    if not body or not isinstance(body, dict):
        return jsonify({'error': 'Request body must be a JSON object'}), 400

    # Sanitise string fields before Pydantic validation
    for field in ('biological_sex', 'bmi_category', 'activity_level',
                  'smoking_status', 'alert_threshold'):
        if field in body:
            body[field] = sanitize_string(str(body[field]), max_len=50)

    try:
        profile = HealthProfile(**body)
        data    = profile.to_firestore()
    except Exception as e:
        # Return a safe validation error (not internal traceback)
        safe_msg = str(e).split('\n')[0][:200]
        return jsonify({'error': f'Validation failed: {safe_msg}'}), 400

    save_health_profile(g.uid, data)

    # Sync home_location + notifications_enabled to top-level user doc
    user_update: dict = {'notifications_enabled': profile.notifications_enabled}
    if profile.home_location:
        user_update['home_location'] = profile.home_location.model_dump()
    save_user_doc(g.uid, user_update)

    logger.info(f"Health profile saved for uid={g.uid[:8]}***")
    return jsonify({'success': True, 'profile': data})


@profile_bp.route('/location', methods=['POST'])
@require_auth
def update_location():
    """POST /api/profile/location — Update home location only."""
    body = request.get_json(silent=True, force=True) or {}

    coords = validate_lat_lon(str(body.get('lat', '')), str(body.get('lon', '')))
    if not coords:
        return jsonify({'error': 'lat and lon must be valid geographic coordinates'}), 400
    lat, lon = coords

    city  = sanitize_string(body.get('city', ''), max_len=100)
    state = sanitize_string(body.get('state', ''), max_len=100)

    location = {'lat': lat, 'lon': lon, 'city': city, 'state': state}
    save_user_doc(g.uid, {'home_location': location})
    save_health_profile(g.uid, {
        'home_location': location,
        'updated_at':    datetime.utcnow().isoformat(),
    })

    return jsonify({'success': True, 'location': location})


@profile_bp.route('/fcm-token', methods=['POST'])
@require_auth
def register_fcm_token():
    """POST /api/profile/fcm-token — Register a new FCM device token."""
    body  = request.get_json(silent=True, force=True) or {}
    token = body.get('token', '')

    if not token or not isinstance(token, str):
        return jsonify({'error': 'token is required'}), 400

    # Validate FCM token format to prevent garbage storage
    if not _FCM_TOKEN_RE.match(token):
        return jsonify({'error': 'Invalid FCM token format'}), 400

    add_fcm_token(g.uid, token)
    return jsonify({'success': True})


@profile_bp.route('/fcm-token', methods=['DELETE'])
@require_auth
def remove_token():
    """DELETE /api/profile/fcm-token — Remove an FCM device token."""
    body  = request.get_json(silent=True, force=True) or {}
    token = body.get('token', '')

    if not token or not isinstance(token, str):
        return jsonify({'error': 'token is required'}), 400

    remove_fcm_token(g.uid, token)
    return jsonify({'success': True})
