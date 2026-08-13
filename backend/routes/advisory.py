"""
AirFlow AI v3 — Advisory Routes (secured & optimised)
Personalized advisory: risk score, activity windows, recommendations.
Requires Firebase Auth token.
"""
from __future__ import annotations
import logging
from flask import Blueprint, jsonify, request, g

from auth_utils import require_auth, validate_lat_lon
from services.firebase_service import get_health_profile
from services.aqi_service import fetch_aqi
from models.risk_engine import compute_risk_score, get_activity_windows

logger = logging.getLogger(__name__)
advisory_bp = Blueprint('advisory', __name__)

_WORKER_TIMEOUT = 8.0

def _extract_pollutants(aqi_data: dict) -> dict:
    """Extract and sanitise pollutant values from AQI response."""
    iaqi = aqi_data.get('iaqi') or {}
    def _val(key):
        v = (iaqi.get(key) or {}).get('v', 0)
        return round(float(v), 2) if v is not None else 0.0
    return {
        'pm25': _val('pm25'), 'pm10': _val('pm10'),
        'no2':  _val('no2'),  'o3':   _val('o3'),
        'so2':  _val('so2'),  'co':   _val('co'),
    }


def _get_hourly(aqi_data: dict, aqi: int) -> list:
    """Get hourly forecast from compute worker with safe fallback."""
    from worker.compute_worker import compute_worker
    try:
        return compute_worker.call('GENERATE_FORECAST', {
            'baseAqi':          aqi,
            'hourlyAqi':        aqi_data.get('_hourlyAqi', []),
            'hourlyTimes':      aqi_data.get('_hourlyTimes', []),
            'currentHourIndex': 0,
            'timezone':         aqi_data.get('timezone', 'UTC'),
        })
    except Exception:
        return [{'i': i, 'hourAqi': aqi} for i in range(24)]


@advisory_bp.route('/risk', methods=['GET'])
@require_auth
def personal_risk():
    """
    GET /api/advisory/risk?lat=<lat>&lon=<lon>
    Computes the personalized risk score for the authenticated user.
    """
    coords = validate_lat_lon(request.args.get('lat'), request.args.get('lon'))
    if not coords:
        return jsonify({'error': 'lat and lon must be valid geographic coordinates'}), 400
    lat, lon = coords

    profile = get_health_profile(g.uid)
    if not profile:
        return jsonify({'error': 'Health profile not found. Complete your profile first.'}), 404

    aqi_data = fetch_aqi(lat, lon)
    if not aqi_data:
        return jsonify({'error': 'Unable to fetch AQI data — please try again.'}), 503

    aqi        = int(aqi_data.get('aqi', 0))
    pollutants = _extract_pollutants(aqi_data)
    result     = compute_risk_score(aqi, profile, pollutants)

    return jsonify({
        'aqi':             aqi,
        'location':        {'lat': lat, 'lon': lon},
        'score':           result['score'],
        'category':        result['category'],
        'factors':         result['factors'],
        'recommendations': result['recommendations'],
        'pollutants':      pollutants,
    })


@advisory_bp.route('/activity-windows', methods=['GET'])
@require_auth
def activity_windows():
    """GET /api/advisory/activity-windows?lat=<lat>&lon=<lon>"""
    coords = validate_lat_lon(request.args.get('lat'), request.args.get('lon'))
    if not coords:
        return jsonify({'error': 'lat and lon must be valid geographic coordinates'}), 400
    lat, lon = coords

    profile = get_health_profile(g.uid)
    if not profile:
        return jsonify({'error': 'Health profile not found'}), 404

    aqi_data = fetch_aqi(lat, lon)
    if not aqi_data:
        return jsonify({'error': 'Unable to fetch AQI data'}), 503

    aqi     = int(aqi_data.get('aqi', 0))
    hourly  = _get_hourly(aqi_data, aqi)
    windows = get_activity_windows(hourly, profile)

    return jsonify({'windows': windows, 'baseAqi': aqi})


@advisory_bp.route('/summary', methods=['GET'])
@require_auth
def daily_summary():
    """
    GET /api/advisory/summary
    Full daily summary for the user's saved home location.
    """
    profile = get_health_profile(g.uid)
    if not profile:
        return jsonify({'error': 'Health profile not found'}), 404

    loc = profile.get('home_location')
    if not loc or not isinstance(loc, dict):
        return jsonify({'error': 'No home location set in your profile'}), 404

    # Validate stored location values
    coords = validate_lat_lon(str(loc.get('lat')), str(loc.get('lon')))
    if not coords:
        return jsonify({'error': 'Invalid home location — please update your profile'}), 422
    lat, lon = coords

    aqi_data = fetch_aqi(lat, lon)
    if not aqi_data:
        return jsonify({'error': 'Unable to fetch AQI data for your home location'}), 503

    aqi        = int(aqi_data.get('aqi', 0))
    pollutants = _extract_pollutants(aqi_data)
    risk_result = compute_risk_score(aqi, profile, pollutants)

    hourly  = _get_hourly(aqi_data, aqi)
    windows = get_activity_windows(hourly, profile)

    return jsonify({
        'aqi':              aqi,
        'location':         loc,
        'score':            risk_result['score'],
        'category':         risk_result['category'],
        'factors':          risk_result['factors'],
        'recommendations':  risk_result['recommendations'],
        'activity_windows': windows,
        'pollutants':       pollutants,
    })
