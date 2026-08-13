"""
AirFlow AI v3 — AQI Data Routes
Wraps Open-Meteo + weather services. Public endpoints (no auth required).
Personalized advisory lives in advisory.py.
"""
from __future__ import annotations
import logging
import math
from flask import Blueprint, request, jsonify

from auth_utils import validate_lat_lon, sanitize_string
from services.aqi_service import fetch_aqi, fetch_pm25_forecast, fetch_neighbor_aqi
from services.weather_service import fetch_weather
from services.geocode_service import search_cities, find_nearby_cities
from worker.compute_worker import compute_worker

logger = logging.getLogger(__name__)
aqi_bp = Blueprint('aqi', __name__)

_MAX_SEARCH_LEN = 80
_MAX_NEIGHBORS  = 6
_WORKER_TIMEOUT = 8.0   # seconds


@aqi_bp.route('/search', methods=['GET'])
def search():
    """GET /api/aqi/search?q=<city> — City search with input sanitisation."""
    q = sanitize_string(request.args.get('q', ''), max_len=_MAX_SEARCH_LEN)
    if not q or len(q) < 2:
        return jsonify({'error': 'q must be at least 2 characters'}), 400

    # Block obvious injection patterns
    if any(c in q for c in ['<', '>', '{', '}', '|', '\\', ';']):
        return jsonify({'error': 'Invalid characters in search query'}), 400

    results = search_cities(q)
    return jsonify({'results': results or []})


@aqi_bp.route('/current', methods=['GET'])
def current():
    """
    GET /api/aqi/current?lat=<lat>&lon=<lon>
    Returns AQI + weather + impact factors + hourly forecast + neighbor transfer.
    All inputs are validated and sanitised.
    """
    coords = validate_lat_lon(request.args.get('lat'), request.args.get('lon'))
    if not coords:
        return jsonify({'error': 'lat and lon must be valid geographic coordinates'}), 400

    lat, lon = coords
    city = sanitize_string(request.args.get('city', ''), max_len=80)

    # Fetch AQI & weather
    aqi_data     = fetch_aqi(lat, lon)
    weather_data = fetch_weather(lat, lon)

    if not aqi_data:
        return jsonify({'error': 'Unable to fetch AQI data for this location'}), 503

    aqi = int(aqi_data.get('aqi', 0))
    iaqi = aqi_data.get('iaqi') or {}
    pollutants = {
        'aqi':  aqi,
        'pm25': _safe_pollutant(iaqi, 'pm25'),
        'pm10': _safe_pollutant(iaqi, 'pm10'),
        'no2':  _safe_pollutant(iaqi, 'no2'),
        'so2':  _safe_pollutant(iaqi, 'so2'),
        'o3':   _safe_pollutant(iaqi, 'o3'),
        'co':   _safe_pollutant(iaqi, 'co'),
    }

    wx = weather_data or {}

    # Background compute (with timeout guards)
    factors = _safe_compute('DETECT_FACTORS', {
        'weather': wx, 'pollutants': pollutants,
    }, fallback=[])

    hourly_forecast = _safe_compute('GENERATE_FORECAST', {
        'baseAqi':          aqi,
        'hourlyAqi':        aqi_data.get('_hourlyAqi', []),
        'hourlyTimes':      aqi_data.get('_hourlyTimes', []),
        'currentHourIndex': 0,
        'timezone':         aqi_data.get('timezone', 'UTC'),
    }, fallback=[])

    pm25_raw = fetch_pm25_forecast(lat, lon)
    daily_pm25 = _safe_compute('AGGREGATE_PM25', {
        'pm25Array':  (pm25_raw or {}).get('pm2_5', []),
        'timesArray': (pm25_raw or {}).get('time', []),
    }, fallback=[])

    # Neighbors (limit to avoid slow serial fetches)
    neighbors_raw = find_nearby_cities(lat, lon, city)[:_MAX_NEIGHBORS]
    neighbors = []
    for n in neighbors_raw:
        n_aqi = fetch_neighbor_aqi(n['lat'], n['lon'])
        if n_aqi is not None:
            neighbors.append({
                **n,
                'aqi':     n_aqi,
                'dist':    _haversine(lat, lon, n['lat'], n['lon']),
                'bearing': _bearing(lat, lon, n['lat'], n['lon']),
            })

    transfer = _safe_compute('COMPUTE_TRANSFER', {
        'centerAqi': aqi,
        'neighbors': neighbors,
        'windSpeed': wx.get('windSpeed', 0),
        'windDir':   wx.get('windDir', 0),
    }, fallback={'predictedAqi': aqi, 'confidence': 0, 'breakdown': []})

    scale_pct = _safe_compute('COMPUTE_SCALE', {'aqi': aqi}, fallback=0.0)

    return jsonify({
        'aqi':            aqi,
        'level':          _get_level(aqi),
        'pollutants':     pollutants,
        'weather':        wx,
        'factors':        factors,
        'hourlyForecast': hourly_forecast,
        'dailyPm25':      daily_pm25,
        'transfer':       transfer,
        'neighbors':      neighbors,
        'scalePct':       scale_pct,
        'timezone':       aqi_data.get('timezone', 'UTC'),
        'time':           (aqi_data.get('time') or {}).get('s', ''),
    })


# ── Helpers ────────────────────────────────────────────────────────────────────

def _safe_pollutant(iaqi: dict, key: str) -> float:
    """Safely extract a pollutant value, defaulting to 0."""
    val = (iaqi.get(key) or {}).get('v', 0)
    return round(float(val), 2) if val is not None else 0.0


def _safe_compute(task: str, payload: dict, fallback):
    """Call compute_worker with error isolation — never crash the endpoint."""
    try:
        return compute_worker.call(task, payload)
    except Exception as e:
        logger.warning(f"compute_worker.{task} failed: {e}")
        return fallback


def _get_level(aqi: float) -> str:
    if aqi <= 50:  return 'Good'
    if aqi <= 100: return 'Moderate'
    if aqi <= 150: return 'Unhealthy for Sensitive Groups'
    if aqi <= 200: return 'Unhealthy'
    if aqi <= 300: return 'Very Unhealthy'
    return 'Hazardous'


def _haversine(lat1, lon1, lat2, lon2) -> float:
    R    = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a    = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return round(R * 2 * math.asin(math.sqrt(a)), 1)


def _bearing(lat1, lon1, lat2, lon2) -> float:
    dlon = math.radians(lon2 - lon1)
    x    = math.sin(dlon) * math.cos(math.radians(lat2))
    y    = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - \
           math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360
