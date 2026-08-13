"""
AirFlow AI — Python Compute Worker
Mirrors the browser's worker.js using threading.Thread + queue.Queue.
Runs permanently in the background, processing heavy computation tasks
so Flask request threads remain non-blocking.

Tasks handled:
  - DETECT_FACTORS      → detect active AQI impact factors
  - COMPUTE_TRANSFER    → cross-city transfer learning prediction
  - GENERATE_FORECAST   → 24-hour hourly AQI forecast
  - AGGREGATE_PM25      → 7-day daily PM2.5 aggregation
  - COMPUTE_SCALE       → AQI scale pointer percentage
"""

import math
import queue
import threading
import logging

logger = logging.getLogger(__name__)

# =====================================================================
# AQI Helpers (mirrors worker.js)
# =====================================================================

def get_level(aqi: float) -> str:
    if aqi <= 50:  return 'good'
    if aqi <= 100: return 'moderate'
    if aqi <= 150: return 'unhealthySG'
    if aqi <= 200: return 'unhealthy'
    if aqi <= 300: return 'veryUnhealthy'
    return 'hazardous'


def aqi_color(aqi: float) -> str:
    if aqi <= 50:  return '#00e676'
    if aqi <= 100: return '#ffeb3b'
    if aqi <= 150: return '#ff9800'
    if aqi <= 200: return '#f44336'
    if aqi <= 300: return '#9c27b0'
    return '#880e4f'


# =====================================================================
# Impact Factors Database (mirrors worker.js IMPACT_FACTORS)
# =====================================================================

IMPACT_FACTORS = {
    'thermal_inversion': {
        'id': 'thermal_inversion', 'label': 'Thermal Inversion', 'icon': 'fa-layer-group',
        'category': 'meteorological', 'color': '#ff9800',
        'description': 'Cold air trapped below warm air prevents pollutant dispersion.',
        'aqiMultiplier': 1.35, 'triggers': {'pressureAbove': 1015, 'windBelow': 5}
    },
    'high_pressure': {
        'id': 'high_pressure', 'label': 'High Pressure System', 'icon': 'fa-compress-arrows-alt',
        'category': 'meteorological', 'color': '#ff8f00',
        'description': 'Descending air suppresses vertical mixing, trapping pollutants near ground.',
        'aqiMultiplier': 1.25, 'triggers': {'pressureAbove': 1018}
    },
    'low_wind': {
        'id': 'low_wind', 'label': 'Stagnant Air Mass', 'icon': 'fa-wind',
        'category': 'meteorological', 'color': '#ffa726',
        'description': 'Very low wind speeds allow pollution to accumulate.',
        'aqiMultiplier': 1.20, 'triggers': {'windBelow': 3}
    },
    'dust_storm': {
        'id': 'dust_storm', 'label': 'Dust Storm / Sandstorm', 'icon': 'fa-tornado',
        'category': 'natural_event', 'color': '#ff7043',
        'description': 'Suspended dust particles drastically raise PM10 and PM2.5.',
        'aqiMultiplier': 2.1, 'triggers': {'pm10Above': 150, 'windAbove': 20}
    },
    'wildfire_smoke': {
        'id': 'wildfire_smoke', 'label': 'Wildfire / Forest Fire Smoke', 'icon': 'fa-fire',
        'category': 'natural_event', 'color': '#f44336',
        'description': 'Smoke from wildfires carries fine particulates hundreds of kilometres.',
        'aqiMultiplier': 2.4, 'triggers': {'pm25Above': 100, 'coAbove': 5}
    },
    'volcanic_ash': {
        'id': 'volcanic_ash', 'label': 'Volcanic Emissions', 'icon': 'fa-mountain',
        'category': 'natural_event', 'color': '#9e9e9e',
        'description': 'SO₂ and ash from volcanic activity contaminate vast regions.',
        'aqiMultiplier': 1.8, 'triggers': {'so2Above': 80}
    },
    'monsoon': {
        'id': 'monsoon', 'label': 'Monsoon / Heavy Rain', 'icon': 'fa-cloud-showers-heavy',
        'category': 'meteorological', 'color': '#42a5f5',
        'description': 'Rain washes particulates from air, significantly reducing AQI.',
        'aqiMultiplier': 0.55, 'triggers': {'humidityAbove': 88}
    },
    'sea_breeze': {
        'id': 'sea_breeze', 'label': 'Sea Breeze Effect', 'icon': 'fa-water',
        'category': 'meteorological', 'color': '#26c6da',
        'description': 'Onshore wind disperses inland pollutants, improving coastal air quality.',
        'aqiMultiplier': 0.75, 'triggers': {}
    },
    'pollen_season': {
        'id': 'pollen_season', 'label': 'High Pollen Season', 'icon': 'fa-seedling',
        'category': 'natural_event', 'color': '#c6ff00',
        'description': 'Elevated natural biological particles contribute to poor air quality.',
        'aqiMultiplier': 1.12, 'triggers': {}
    },
    'fog_smog': {
        'id': 'fog_smog', 'label': 'Dense Fog / Smog', 'icon': 'fa-smog',
        'category': 'meteorological', 'color': '#b0bec5',
        'description': 'Fog combined with pollutants creates smog, trapping particles near surface.',
        'aqiMultiplier': 1.4, 'triggers': {'visibilityBelow': 2, 'humidityAbove': 80}
    },
    'crop_burning': {
        'id': 'crop_burning', 'label': 'Agricultural / Crop Burning', 'icon': 'fa-wheat-awn',
        'category': 'agricultural', 'color': '#ff8f00',
        'description': 'Stubble burning after harvest releases massive amounts of PM2.5 and CO.',
        'aqiMultiplier': 1.9, 'triggers': {'pm25Above': 80}
    },
    'industrial_emission': {
        'id': 'industrial_emission', 'label': 'Industrial Emissions Surge', 'icon': 'fa-industry',
        'category': 'industrial', 'color': '#78909c',
        'description': 'Heavy industry, power plants, and factories emit SO₂, NOx and particulates.',
        'aqiMultiplier': 1.45, 'triggers': {'so2Above': 40, 'no2Above': 60}
    },
    'vehicle_traffic': {
        'id': 'vehicle_traffic', 'label': 'Peak Traffic Congestion', 'icon': 'fa-car',
        'category': 'urban', 'color': '#ef5350',
        'description': 'Rush-hour traffic emissions elevate NO₂ and fine particulates.',
        'aqiMultiplier': 1.3, 'triggers': {'no2Above': 50}
    },
    'construction_dust': {
        'id': 'construction_dust', 'label': 'Construction Activity', 'icon': 'fa-hard-hat',
        'category': 'urban', 'color': '#a1887f',
        'description': 'Construction sites generate coarse dust particles (PM10).',
        'aqiMultiplier': 1.22, 'triggers': {'pm10Above': 80}
    },
    'military_conflict': {
        'id': 'military_conflict', 'label': 'Military Conflict / Bombing', 'icon': 'fa-explosion',
        'category': 'geopolitical', 'color': '#f44336',
        'description': 'Explosions, fires and destruction from armed conflict release toxic compounds: PM2.5, heavy metals, SO₂, CO and carcinogens.',
        'aqiMultiplier': 2.8, 'triggers': {'pm25Above': 120, 'coAbove': 8}
    },
    'industrial_accident': {
        'id': 'industrial_accident', 'label': 'Industrial Accident / Chemical Spill', 'icon': 'fa-biohazard',
        'category': 'geopolitical', 'color': '#ff1744',
        'description': 'Factory explosions or chemical plant accidents release hazardous pollutants.',
        'aqiMultiplier': 2.5, 'triggers': {'so2Above': 100}
    },
    'festival_fireworks': {
        'id': 'festival_fireworks', 'label': 'Festival / Fireworks (Diwali, NYE)', 'icon': 'fa-star',
        'category': 'cultural', 'color': '#e040fb',
        'description': 'Fireworks spike PM2.5, potassium, heavy metals and sulfur dioxide.',
        'aqiMultiplier': 1.85, 'triggers': {'pm25Above': 90}
    },
    'mass_incineration': {
        'id': 'mass_incineration', 'label': 'Waste / Landfill Burning', 'icon': 'fa-trash-can',
        'category': 'urban', 'color': '#ff6f00',
        'description': 'Open burning of solid waste releases black carbon and toxic gases.',
        'aqiMultiplier': 1.6, 'triggers': {'coAbove': 3, 'pm25Above': 60}
    },
    'transboundary_pollution': {
        'id': 'transboundary_pollution', 'label': 'Transboundary Pollution Transport', 'icon': 'fa-globe',
        'category': 'regional', 'color': '#7986cb',
        'description': 'Long-range wind transport carries pollutants from distant sources.',
        'aqiMultiplier': 1.35, 'triggers': {}
    },
    'urban_heat_island': {
        'id': 'urban_heat_island', 'label': 'Urban Heat Island Effect', 'icon': 'fa-city',
        'category': 'urban', 'color': '#ff8a65',
        'description': 'Dense urban surfaces retain heat, enhancing ozone formation.',
        'aqiMultiplier': 1.18, 'triggers': {'tempAbove': 35}
    },
}


# =====================================================================
# Computation Functions (mirrors worker.js logic exactly)
# =====================================================================

def _calculate_severity(factor: dict, data: dict) -> int:
    aqi = data.get('aqi', 0)
    base = (factor['aqiMultiplier'] - 1) * 100
    pollutant_boost = min(aqi / 5, 30)
    return round(abs(base) + pollutant_boost)


def detect_active_factors(weather_data: dict, pollutant_data: dict) -> list:
    """
    Detect which AQI impact factors are currently active based on
    real-time weather and pollutant readings.
    Only triggers based on actual measured data — no hardcoding.
    """
    wind_speed  = weather_data.get('windSpeed', 0)
    humidity    = weather_data.get('humidity', 0)
    pressure    = weather_data.get('pressure', 1013)
    visibility  = weather_data.get('visibility', 10)
    temperature = weather_data.get('temperature', 25)

    pm25 = pollutant_data.get('pm25', 0)
    pm10 = pollutant_data.get('pm10', 0)
    so2  = pollutant_data.get('so2', 0)
    no2  = pollutant_data.get('no2', 0)
    co   = pollutant_data.get('co', 0)
    aqi  = pollutant_data.get('aqi', 0)

    active = []
    for factor in IMPACT_FACTORS.values():
        t = factor['triggers']
        triggered = False

        if t.get('pressureAbove')   and pressure   >= t['pressureAbove']:   triggered = True
        if t.get('windBelow')       and wind_speed  <= t['windBelow']:       triggered = True
        if t.get('windAbove')       and wind_speed  >= t['windAbove']:       triggered = True
        if t.get('humidityAbove')   and humidity   >= t['humidityAbove']:   triggered = True
        if t.get('visibilityBelow') and visibility  <= t['visibilityBelow']: triggered = True
        if t.get('pm25Above')       and pm25        >= t['pm25Above']:       triggered = True
        if t.get('pm10Above')       and pm10        >= t['pm10Above']:       triggered = True
        if t.get('so2Above')        and so2         >= t['so2Above']:        triggered = True
        if t.get('no2Above')        and no2         >= t['no2Above']:        triggered = True
        if t.get('coAbove')         and co          >= t['coAbove']:         triggered = True
        if t.get('tempAbove')       and temperature >= t['tempAbove']:       triggered = True

        if triggered:
            entry = dict(factor)
            entry['severity'] = _calculate_severity(
                factor,
                {'aqi': aqi, 'pm25': pm25, 'pm10': pm10, 'so2': so2, 'no2': no2, 'co': co}
            )
            active.append(entry)

    active.sort(key=lambda x: x['severity'], reverse=True)
    return active[:6]  # max 6 factors


def compute_transfer_prediction(center_aqi: float, neighbors: list,
                                 wind_speed: float, wind_dir: float) -> dict:
    """
    Cross-city transfer learning: weighted prediction of tomorrow's AQI
    using neighboring city data, wind alignment, and distance decay.
    Mirrors computeTransferPrediction() in worker.js exactly.
    """
    if not neighbors:
        return {'predictedAqi': int(center_aqi), 'confidence': 0, 'breakdown': []}

    total_weight = 0.0
    weighted_aqi_sum = 0.0
    breakdown = []

    for n in neighbors:
        dist    = n.get('dist', 1) or 1
        bearing = n.get('bearing', 0)
        n_aqi   = n.get('aqi', center_aqi)

        # Distance weight: exponential decay
        dist_weight = math.exp(-dist / 100)

        # Wind alignment: how much wind blows FROM this neighbor toward center
        wind_from_neighbor = (bearing + 180) % 360
        angle_diff = abs(wind_from_neighbor - wind_dir)
        normalized_angle = min(angle_diff, 360 - angle_diff)
        wind_alignment = max(0.0, math.cos(math.radians(normalized_angle)))

        # Speed factor
        speed_factor = min(wind_speed / 20, 1.5)

        weight = dist_weight * (0.4 + 0.6 * wind_alignment * speed_factor)

        weighted_aqi_sum += n_aqi * weight
        total_weight += weight

        breakdown.append({
            'name':          n.get('name', ''),
            'aqi':           n_aqi,
            'dist':          round(dist),
            'weight':        round(weight * 100) / 100,
            'windAlignment': round(wind_alignment * 100),
            'contribution':  0  # filled below
        })

    # Self-persistence (~60% self-weight)
    self_weight = 0.9
    weighted_aqi_sum += center_aqi * self_weight
    total_weight += self_weight

    predicted_aqi = max(1, round(weighted_aqi_sum / total_weight))

    for b in breakdown:
        b['contribution'] = round((b['weight'] / total_weight) * 100)

    confidence = min(95, 50 + len(neighbors) * 8 + (10 if wind_speed > 0 else 0))

    return {
        'predictedAqi': predicted_aqi,
        'confidence':   confidence,
        'breakdown':    breakdown
    }


def generate_hourly_forecast(base_aqi: float, hourly_aqi: list,
                              hourly_times: list, current_hour_index: int,
                              timezone: str = 'UTC') -> list:
    """
    Generate 24-hour hourly AQI forecast.
    Uses real Open-Meteo data when available, otherwise uses diurnal pattern model.
    Mirrors generateHourlyForecast() in worker.js exactly.
    """
    import datetime
    forecasts = []
    has_real = bool(hourly_aqi)
    conditions = [
        'Thermal Inversion Layer', 'Low Surface Wind', 'High Pressure Trap',
        'Traffic Emission Peak', 'Industrial Activity', 'Photochemical Ozone',
        'Sea Breeze Onset', 'Boundary Layer Mixing', 'Regional Transport',
        'Nocturnal Boundary Layer'
    ]

    now_hour = datetime.datetime.now().hour

    for i in range(24):
        hour_of_day = (now_hour + i) % 24

        if i == 0:
            hour_aqi = base_aqi
        elif has_real:
            idx = current_hour_index + i
            if idx < len(hourly_aqi) and hourly_aqi[idx] is not None:
                hour_aqi = hourly_aqi[idx]
            else:
                hour_aqi = base_aqi
        else:
            # Advanced diurnal pattern
            if 5 <= hour_of_day <= 9:
                scale = 1.0 + (hour_of_day - 5) * 0.018
            elif 9 < hour_of_day < 14:
                scale = 1.08 - (hour_of_day - 9) * 0.022
            elif 14 <= hour_of_day <= 20:
                scale = 0.95 + (hour_of_day - 14) * 0.025
            else:
                scale = 1.0 - (hour_of_day - 20) * 0.01

            progression = (i / 24) * 0.12
            # Deterministic pseudo-random (same as JS: sin-based seed)
            seed = math.sin(i * 137.5 * math.pi / 180) * 0.5 + 0.5
            noise = (seed - 0.5) * base_aqi * progression
            hour_aqi = max(1.0, base_aqi * scale + noise)

        hour_aqi = max(1, round(hour_aqi))
        level = get_level(hour_aqi)
        color = aqi_color(hour_aqi)
        factor = conditions[int((i * 7 + base_aqi) % len(conditions))]

        forecasts.append({
            'i':       i,
            'hourAqi': hour_aqi,
            'level':   level,
            'color':   color,
            'factor':  factor
        })

    return forecasts


def aggregate_daily_pm25(pm25_array: list, times_array: list) -> list:
    """
    Aggregate hourly PM2.5 readings into daily averages (7-day window).
    Mirrors aggregateDailyPM25() in worker.js.
    """
    if not pm25_array or not times_array:
        return []

    daily_map: dict = {}
    for i, t in enumerate(times_array):
        day = t.split('T')[0]
        if day not in daily_map:
            daily_map[day] = []
        val = pm25_array[i]
        if val is not None:
            daily_map[day].append(val)

    result = []
    for day in list(daily_map.keys())[:7]:
        vals = [v for v in daily_map[day] if v is not None and not math.isnan(v)]
        if not vals:
            continue
        result.append({
            'day': day,
            'avg': round(sum(vals) / len(vals)),
            'max': round(max(vals)),
            'min': round(min(vals))
        })
    return result


def compute_scale_percent(aqi: float) -> float:
    """
    Compute the AQI scale pointer percentage position.
    Mirrors computeScalePercent() in worker.js.
    """
    if aqi <= 50:  return (aqi / 50) * 16.666
    if aqi <= 100: return 16.666 + ((aqi - 50)  / 50)  * 16.666
    if aqi <= 150: return 33.333 + ((aqi - 100) / 50)  * 16.666
    if aqi <= 200: return 50     + ((aqi - 150) / 50)  * 16.666
    if aqi <= 300: return 66.666 + ((aqi - 200) / 100) * 16.666
    return min(100.0, 83.333 + ((aqi - 300) / 200) * 16.666)


# =====================================================================
# Worker Thread (mirrors JS Web Worker architecture)
# =====================================================================

class ComputeWorker:
    """
    Background worker thread that processes heavy computation tasks
    from a queue, returning results via per-task result queues.

    Usage:
        worker = ComputeWorker()
        worker.start()
        result = worker.call('DETECT_FACTORS', {'weather': ..., 'pollutants': ...})
    """

    def __init__(self):
        self._task_queue: queue.Queue = queue.Queue()
        self._thread: threading.Thread = threading.Thread(
            target=self._run, daemon=True, name='ComputeWorker'
        )
        self._running = False

    def start(self) -> None:
        self._running = True
        self._thread.start()
        logger.info("ComputeWorker started")

    def stop(self) -> None:
        self._running = False
        self._task_queue.put(None)  # sentinel to unblock the loop

    def call(self, task_type: str, payload: dict, timeout: float = 10.0):
        """
        Submit a task and block until result is ready (or timeout).
        Raises RuntimeError on worker error or TimeoutError on timeout.
        """
        result_q: queue.Queue = queue.Queue()
        self._task_queue.put({
            'type':      task_type,
            'payload':   payload,
            'result_q':  result_q
        })
        try:
            result = result_q.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError(f"ComputeWorker timed out on task: {task_type}")

        if isinstance(result, Exception):
            raise result
        return result

    def _run(self) -> None:
        """Main worker loop — processes tasks sequentially."""
        while self._running:
            task = self._task_queue.get()
            if task is None:
                break  # sentinel received
            try:
                result = self._dispatch(task['type'], task['payload'])
                task['result_q'].put(result)
            except Exception as e:
                logger.exception(f"Worker error on task {task['type']}: {e}")
                task['result_q'].put(e)

    def _dispatch(self, task_type: str, payload: dict):
        if task_type == 'DETECT_FACTORS':
            return detect_active_factors(
                payload.get('weather', {}),
                payload.get('pollutants', {})
            )
        elif task_type == 'COMPUTE_TRANSFER':
            return compute_transfer_prediction(
                payload['centerAqi'],
                payload.get('neighbors', []),
                payload.get('windSpeed', 0),
                payload.get('windDir', 0)
            )
        elif task_type == 'GENERATE_FORECAST':
            return generate_hourly_forecast(
                payload['baseAqi'],
                payload.get('hourlyAqi', []),
                payload.get('hourlyTimes', []),
                payload.get('currentHourIndex', 0),
                payload.get('timezone', 'UTC')
            )
        elif task_type == 'AGGREGATE_PM25':
            return aggregate_daily_pm25(
                payload.get('pm25Array', []),
                payload.get('timesArray', [])
            )
        elif task_type == 'COMPUTE_SCALE':
            return compute_scale_percent(payload['aqi'])
        else:
            raise ValueError(f"Unknown task type: {task_type}")


# Global singleton worker instance
compute_worker = ComputeWorker()
