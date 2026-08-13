"""
AirFlow AI — Geocode Service
City search using Open-Meteo geocoding + Nominatim fallback + Photon (Komoot).
Mirrors the triple-API search logic from app.js.
"""
import logging
import requests
import math
from cache import cache

logger = logging.getLogger(__name__)

GEOCODE_URL   = 'https://geocoding-api.open-meteo.com/v1/search'
NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
PHOTON_URL    = 'https://photon.komoot.io/api/'
NOMINATIM_REV = 'https://nominatim.openstreetmap.org/reverse'

HEADERS = {'User-Agent': 'AirFlowAI/1.0 (academic project)'}


def search_cities(query: str) -> list[dict]:
    """
    Multi-source city search with deduplication.
    Returns list of {name, lat, lon, region, timezone}.
    """
    cache_key = f"search:{query.lower()}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    seen = set()
    merged = []

    # --- Open-Meteo geocoding ---
    try:
        resp = requests.get(GEOCODE_URL, params={'name': query, 'count': 8, 'language': 'en'}, timeout=6)
        for r in resp.json().get('results', []):
            key = f"{round(float(r['latitude']), 2)},{round(float(r['longitude']), 2)}"
            if key not in seen:
                seen.add(key)
                region = ', '.join(filter(None, [r.get('admin1'), r.get('country')]))
                merged.append({
                    'name':     r.get('name', ''),
                    'lat':      float(r['latitude']),
                    'lon':      float(r['longitude']),
                    'region':   region,
                    'timezone': r.get('timezone', 'UTC')
                })
    except Exception as e:
        logger.warning(f"Open-Meteo geocoding failed: {e}")

    # --- Nominatim ---
    try:
        resp = requests.get(NOMINATIM_URL, params={
            'q': query, 'format': 'json', 'limit': 10,
            'addressdetails': 1, 'dedupe': 1
        }, headers=HEADERS, timeout=6)
        for r in resp.json():
            key = f"{round(float(r['lat']), 2)},{round(float(r['lon']), 2)}"
            if key not in seen:
                seen.add(key)
                addr = r.get('address', {})
                name = (addr.get('suburb') or addr.get('village') or addr.get('town') or
                        addr.get('city') or addr.get('hamlet') or r.get('display_name', '').split(',')[0])
                region = ', '.join(filter(None, [
                    addr.get('state_district'), addr.get('state'), addr.get('country')
                ]))
                merged.append({
                    'name':     name,
                    'lat':      float(r['lat']),
                    'lon':      float(r['lon']),
                    'region':   region,
                    'timezone': 'UTC'
                })
    except Exception as e:
        logger.warning(f"Nominatim search failed: {e}")

    # --- Photon (Komoot) ---
    try:
        resp = requests.get(PHOTON_URL, params={'q': query, 'limit': 8, 'lang': 'en'}, timeout=6)
        for f in resp.json().get('features', []):
            coords = f.get('geometry', {}).get('coordinates')
            if not coords:
                continue
            lon, lat = coords[0], coords[1]
            key = f"{round(lat, 2)},{round(lon, 2)}"
            if key not in seen:
                seen.add(key)
                p = f.get('properties', {})
                name = p.get('name') or p.get('locality') or p.get('district') or 'Unknown'
                region = ', '.join(filter(None, [p.get('county'), p.get('state'), p.get('country')]))
                merged.append({
                    'name':     name,
                    'lat':      lat,
                    'lon':      lon,
                    'region':   region,
                    'timezone': 'UTC'
                })
    except Exception as e:
        logger.warning(f"Photon search failed: {e}")

    result = merged[:12]
    cache.set(cache_key, result)
    return result


def find_nearby_cities(lat: float, lon: float, exclude: str) -> list[dict]:
    """
    Reverse geocode 5 positions around a center to find neighboring cities.
    Mirrors findNearbyCities() from app.js.
    """
    radius_deg = 0.35
    angles = [0, 72, 144, 216, 288]
    results = []
    used_names = {exclude.lower()}

    for deg in angles:
        rad = math.radians(deg)
        t_lat = lat + radius_deg * math.cos(rad)
        t_lon = lon + (radius_deg / math.cos(math.radians(lat))) * math.sin(rad)
        try:
            resp = requests.get(NOMINATIM_REV, params={
                'lat': t_lat, 'lon': t_lon, 'format': 'json', 'zoom': 10
            }, headers=HEADERS, timeout=6)
            data = resp.json()
            addr = data.get('address', {})
            name = (addr.get('city') or addr.get('town') or
                    addr.get('county') or addr.get('state_district'))
            if name and name.lower() not in used_names:
                used_names.add(name.lower())
                results.append({
                    'name':    name,
                    'lat':     float(data.get('lat', t_lat)),
                    'lon':     float(data.get('lon', t_lon)),
                    'country': addr.get('country', '')
                })
        except Exception:
            pass

    return results[:5]
