"""
AirFlow AI v3 — Auth Routes (secured & optimised)
Handles Firebase ID token verification and user creation in Firestore.
"""
from __future__ import annotations
import logging
from flask import Blueprint, request, jsonify, g

from auth_utils import require_auth
from services.firebase_service import verify_id_token, get_user_doc, save_user_doc

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/verify', methods=['POST'])
def verify():
    """
    POST /api/auth/verify
    Body: { "idToken": "<firebase-id-token>" }
    Creates the user document in Firestore on first login.
    Returns: { uid, email, displayName, isNewUser }
    """
    body = request.get_json(silent=True, force=True) or {}
    id_token = body.get('idToken')
    if not id_token:
        return jsonify({'error': 'idToken is required'}), 400

    try:
        claims = verify_id_token(id_token)
    except Exception as e:
        logger.warning(f"Failed to verify ID token: {e}")
        return jsonify({'error': 'Invalid token'}), 401

    uid   = claims.get('uid')
    email = claims.get('email', '')
    name  = claims.get('name', '')
    
    if not uid:
        return jsonify({'error': 'Invalid token payload'}), 401

    existing = get_user_doc(uid)
    is_new = existing is None

    if is_new:
        user_data = {
            'uid':                   uid,
            'email':                 email,
            'display_name':          name,
            'fcm_tokens':            [],
            'notifications_enabled': True,
            'home_location':         None,
        }
        save_user_doc(uid, user_data)
        logger.info(f"New user created: uid={uid[:8]}***, email={email}")

    return jsonify({
        'uid':         uid,
        'email':       email,
        'displayName': name,
        'isNewUser':   is_new,
    })


@auth_bp.route('/me', methods=['GET'])
@require_auth
def me():
    """GET /api/auth/me — Return current user document."""
    user = get_user_doc(g.uid)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify(user)
