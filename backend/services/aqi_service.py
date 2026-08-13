"""
AirFlow AI v3 — AQI Service (ported from version2/services/aqi_service.py)
Fetches real-time AQI and pollutant data from Open-Meteo Air Quality API.
"""
import logging
import requests
from cache import cache

logger = logging.getLogger(__name__)

METEO_AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'


def fetch_aqi(lat: float, lon: float) -> dict | None:
    """Fetch current AQI and pollutant concentrations for a location."""
    cache_key = f"aqi:{lat:.4f},{lon:.4f}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    params = {
        'latitude':  lat,
        'longitude': lon,
        'current':   'us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone',
        'hourly':    'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide',
        'timezone':  'auto',
        'forecast_days': 2
    }

    try:
        resp = requests.get(METEO_AIR_QUALITY_URL, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error(f"AQI fetch failed for ({lat},{lon}): {e}")
        return None

    current = data.get('current')
    if not current or current.get('us_aqi') is None:
        return None

    co_raw = current.get('carbon_monoxide') or 0
    result = {
        'aqi':      round(current['us_aqi']),
        'timezone': data.get('timezone', 'UTC'),
        'iaqi': {
            'pm25': {'v': current.get('pm2_5')},
            'pm10': {'v': current.get('pm10')},
            'o3':   {'v': current.get('ozone')},
            'no2':  {'v': current.get('nitrogen_dioxide')},
            'so2':  {'v': current.get('sulphur_dioxide')},
            'co':   {'v': round(co_raw / 1000, 1)},
        },
        'time':         {'s': current.get('time', '').replace('T', ' ')},
        '_source':      'open-meteo',
        '_hourlyAqi':   data.get('hourly', {}).get('us_aqi'),
        '_hourlyTimes': data.get('hourly', {}).get('time'),
        '_hourlyPm25':  data.get('hourly', {}).get('pm2_5'),
    }

    cache.set(cache_key, result)
    return result


def fetch_pm25_forecast(lat: float, lon: float) -> dict | None:
    """Fetch 7-day hourly PM2.5 data for the forecast chart."""
    cache_key = f"pm25_forecast:{lat:.4f},{lon:.4f}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    params = {
        'latitude':  lat,
        'longitude': lon,
        'hourly':    'pm2_5',
        'timezone':  'auto',
        'forecast_days': 7
    }

    try:
        resp = requests.get(METEO_AIR_QUALITY_URL, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        hourly = data.get('hourly')
        if hourly and hourly.get('pm2_5'):
            cache.set(cache_key, hourly)
            return hourly
    except Exception as e:
        logger.error(f"PM2.5 forecast fetch failed: {e}")

    return None


def fetch_neighbor_aqi(lat: float, lon: float) -> int | None:
    """Fetch just the current AQI for a neighboring city (lightweight)."""
    cache_key = f"neighbor_aqi:{lat:.4f},{lon:.4f}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    params = {'latitude': lat, 'longitude': lon, 'current': 'us_aqi', 'timezone': 'auto'}
    try:
        resp = requests.get(METEO_AIR_QUALITY_URL, params=params, timeout=8)
        resp.raise_for_status()
        aqi_val = resp.json().get('current', {}).get('us_aqi')
        if aqi_val is not None:
            result = round(aqi_val)
            cache.set(cache_key, result)
            return result
    except Exception as e:
        logger.warning(f"Neighbor AQI fetch failed ({lat},{lon}): {e}")
    return None
