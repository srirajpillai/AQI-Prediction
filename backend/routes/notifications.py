"""
AirFlow AI v3 — Notifications Routes (secured & optimised)
All routes require Firebase Auth token via @require_auth.
"""
from __future__ import annotations
import logging
from flask import Blueprint, request, jsonify, g

from auth_utils import require_auth
from services.firebase_service import (
    get_notifications, mark_notification_read,
    send_push_notification, get_health_profile, get_user_doc,
    save_notification,
)
from services.aqi_service import fetch_aqi
from models.risk_engine import compute_risk_score
from models.notification import build_alert_notification

logger = logging.getLogger(__name__)
notifications_bp = Blueprint('notifications', __name__)

_MAX_NOTIF_LIMIT = 50   # Hard cap on notification history query
_DEFAULT_LIMIT   = 20


@notifications_bp.route('/', methods=['GET'])
@require_auth
def list_notifications():
    """GET /api/notifications/?limit=20 — Get notification history."""
    try:
        limit = min(int(request.args.get('limit', _DEFAULT_LIMIT)), _MAX_NOTIF_LIMIT)
        limit = max(1, limit)   # Also enforce lower bound
    except (ValueError, TypeError):
        limit = _DEFAULT_LIMIT

    items = get_notifications(g.uid, limit=limit)
    return jsonify({'notifications': items, 'count': len(items)})


@notifications_bp.route('/<notif_id>/read', methods=['PATCH'])
@require_auth
def mark_read(notif_id: str):
    """PATCH /api/notifications/<id>/read — Mark a notification as read."""
    # Validate notif_id is alphanumeric (Firestore auto-ID format)
    if not notif_id or not notif_id.replace('-', '').replace('_', '').isalnum():
        return jsonify({'error': 'Invalid notification ID'}), 400
    if len(notif_id) > 128:
        return jsonify({'error': 'Invalid notification ID'}), 400

    mark_notification_read(g.uid, notif_id)
    return jsonify({'success': True})


@notifications_bp.route('/test', methods=['POST'])
@require_auth
def test_notification():
    """POST /api/notifications/test — Send test push to verify FCM pipeline."""
    user   = get_user_doc(g.uid)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    tokens = user.get('fcm_tokens', [])
    if not tokens:
        return jsonify({
            'error': 'No FCM tokens registered. Enable notifications in your browser first.'
        }), 400

    profile = get_health_profile(g.uid)
    loc     = (profile or {}).get('home_location') or user.get('home_location')
    city    = (loc or {}).get('city', 'your location') if loc else 'your location'

    result  = send_push_notification(
        tokens,
        title='🔔 AirFlow AI — Test Notification',
        body=(f'Push notifications are working! '
              f'You will be alerted when AQI at {city} reaches your risk threshold.'),
        data={'type': 'test'}
    )
    return jsonify({'success': True, 'sent': result})


@notifications_bp.route('/trigger-manual', methods=['POST'])
@require_auth
def trigger_manual():
    """
    POST /api/notifications/trigger-manual
    Manually triggers the risk check for the current user and sends
    a notification if warranted. Useful for testing the full pipeline.
    """
    user    = get_user_doc(g.uid)
    profile = get_health_profile(g.uid)
    if not profile:
        return jsonify({'error': 'Health profile not set'}), 404

    loc = profile.get('home_location') or (user or {}).get('home_location')
    if not loc or not isinstance(loc, dict):
        return jsonify({'error': 'No home location configured'}), 400

    from auth_utils import validate_lat_lon
    coords = validate_lat_lon(str(loc.get('lat', '')), str(loc.get('lon', '')))
    if not coords:
        return jsonify({'error': 'Invalid home location in profile'}), 422

    lat, lon  = coords
    aqi_data  = fetch_aqi(lat, lon)
    if not aqi_data:
        return jsonify({'error': 'Could not fetch AQI data'}), 503

    aqi     = int(aqi_data.get('aqi', 0))
    iaqi    = aqi_data.get('iaqi') or {}
    pollutants = {
        'pm25': (iaqi.get('pm25') or {}).get('v', 0),
        'no2':  (iaqi.get('no2')  or {}).get('v', 0),
        'o3':   (iaqi.get('o3')   or {}).get('v', 0),
    }

    result     = compute_risk_score(aqi, profile, pollutants)
    score      = result['score']
    category   = result['category']
    recs       = result['recommendations']
    conditions = [k for k, v in profile.get('conditions', {}).items() if v]

    notif  = build_alert_notification(
        g.uid, aqi, category['code'], loc.get('city', 'Your area'), conditions, recs
    )

    tokens  = (user or {}).get('fcm_tokens', [])
    sent    = False
    if tokens:
        res  = send_push_notification(
            tokens, notif.title, notif.message,
            data={'risk_level': category['code'], 'aqi': str(aqi)}
        )
        sent = res.get('success', 0) > 0

    save_notification(g.uid, notif.to_firestore())

    return jsonify({
        'success':   True,
        'aqi':       aqi,
        'score':     score,
        'riskLevel': category['code'],
        'notifSent': sent,
        'title':     notif.title,
        'message':   notif.message,
    })
