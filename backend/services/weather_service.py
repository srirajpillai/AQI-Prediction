"""
AirFlow AI — Weather Service
Fetches real-time weather conditions using wttr.in with Open-Meteo fallback.
"""
import logging
import requests
from cache import cache

logger = logging.getLogger(__name__)

METEO_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'


def fetch_weather(lat: float, lon: float) -> dict | None:
    """
    Fetch current weather conditions for a location.
    Primary: wttr.in JSON API
    Fallback: Open-Meteo weather API
    Returns normalized weather dict.
    """
    cache_key = f"weather:{lat:.4f},{lon:.4f}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    # --- Primary: wttr.in ---
    try:
        url = f"https://wttr.in/{lat},{lon}?format=j1"
        resp = requests.get(url, timeout=8, headers={'User-Agent': 'AirFlowAI/1.0'})
        resp.raise_for_status()
        data = resp.json()
        cond = data.get('current_condition', [])
        if cond:
            c = cond[0]
            wx = {
                'temperature': int(c.get('temp_C', 25)),
                'windSpeed':   int(c.get('windspeedKmph', 0)),
                'windDir':     int(c.get('winddirDegree', 0)),
                'humidity':    int(c.get('humidity', 50)),
                'pressure':    int(c.get('pressure', 1013)),
                'visibility':  float(c.get('visibility', 10)),
            }
            cache.set(cache_key, wx)
            return wx
    except Exception as e:
        logger.warning(f"wttr.in failed for ({lat},{lon}): {e}")

    # --- Fallback: Open-Meteo weather ---
    try:
        params = {
            'latitude':  lat,
            'longitude': lon,
            'current':   'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,visibility',
        }
        resp = requests.get(METEO_WEATHER_URL, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        c = data.get('current', {})
        if c:
            vis_raw = c.get('visibility')
            wx = {
                'temperature': round(c.get('temperature_2m', 25)),
                'windSpeed':   round(c.get('wind_speed_10m', 0)),
                'windDir':     round(c.get('wind_direction_10m', 0)),
                'humidity':    round(c.get('relative_humidity_2m', 50)),
                'pressure':    round(c.get('surface_pressure', 1013)),
                'visibility':  round(vis_raw / 1000, 1) if vis_raw else 10.0,
            }
            cache.set(cache_key, wx)
            return wx
    except Exception as e:
        logger.error(f"Open-Meteo weather fallback failed for ({lat},{lon}): {e}")

    return None
