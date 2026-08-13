"""
AirFlow AI — Personalized Health Risk Score Engine
====================================================
Computes a 0–100 personal risk score by combining the raw AQI level
with a user's specific health profile multipliers.

Risk Formula
------------
  Base AQI Risk       = AQI / 5               (maps 0–500 AQI → 0–100)
  Sensitivity         = product of active condition weights
  Activity Exposure   = 1.0 – 1.8 (sedentary → vigorous)
  Age Vulnerability   = 1.4 (child), 1.0 (teen/adult), 1.5 (senior)
  Smoking Factor      = 1.0 (never), 1.2 (former), 1.5 (current)
  Outdoor Worker      = × 1.3 if True

  Personal Risk Score = min(100, Base × Sensitivity × Activity × Age × Smoking × Outdoor)

Risk Category thresholds
  0 – 25  → LOW     (safe)
  26 – 50 → MODERATE
  51 – 75 → HIGH
  76 – 100 → SEVERE
"""
from __future__ import annotations
import math
from typing import Optional

# ──────────────────────────────────────────────────────────────────────────────
# Weight tables
# ──────────────────────────────────────────────────────────────────────────────

CONDITION_WEIGHTS: dict[str, float] = {
    'asthma':            2.5,
    'copd':              3.0,
    'cardiovascular':    2.0,
    'hypertension':      1.5,
    'diabetes':          1.4,
    'pregnancy':         2.2,
    'immunocompromised': 2.0,
    'allergies':         1.3,
    'kidney_disease':    1.5,
}

CONDITION_LABELS: dict[str, str] = {
    'asthma':            'Asthma',
    'copd':              'COPD / Emphysema',
    'cardiovascular':    'Cardiovascular Disease',
    'hypertension':      'Hypertension',
    'diabetes':          'Diabetes (Type 2)',
    'pregnancy':         'Pregnancy',
    'immunocompromised': 'Immunocompromised',
    'allergies':         'Seasonal Allergies',
    'kidney_disease':    'Kidney Disease',
}

ACTIVITY_MULTIPLIERS: dict[str, float] = {
    'sedentary': 1.0,
    'light':     1.2,
    'moderate':  1.4,
    'vigorous':  1.8,
}

AGE_MULTIPLIERS: dict[str, float] = {
    'child':  1.4,
    'teen':   1.0,
    'adult':  1.0,
    'senior': 1.5,
}

SMOKING_MULTIPLIERS: dict[str, float] = {
    'never':   1.0,
    'former':  1.2,
    'current': 1.5,
}

# Pollutant thresholds that drive specific condition warnings (µg/m³ or ppm)
POLLUTANT_CONDITION_MAP: dict[str, list[str]] = {
    'pm25': ['asthma', 'copd', 'cardiovascular', 'pregnancy'],
    'pm10': ['asthma', 'allergies'],
    'no2':  ['asthma', 'copd', 'hypertension'],
    'o3':   ['asthma', 'copd', 'cardiovascular'],
    'so2':  ['asthma', 'copd'],
    'co':   ['cardiovascular', 'pregnancy'],
}


# ──────────────────────────────────────────────────────────────────────────────
# Risk Category Helpers
# ──────────────────────────────────────────────────────────────────────────────

def get_risk_category(score: float) -> dict:
    if score <= 25:
        return {
            'level': 'Low', 'code': 'low',
            'color': '#00e676', 'emoji': '🟢',
            'headline': 'Air quality is safe for you today.',
        }
    if score <= 50:
        return {
            'level': 'Moderate', 'code': 'moderate',
            'color': '#ffeb3b', 'emoji': '🟡',
            'headline': 'Limit prolonged outdoor exertion if you feel symptoms.',
        }
    if score <= 75:
        return {
            'level': 'High', 'code': 'high',
            'color': '#ff9800', 'emoji': '🟠',
            'headline': 'Avoid outdoor exercise. Wear an N95 mask if going out.',
        }
    return {
        'level': 'Severe', 'code': 'severe',
        'color': '#f44336', 'emoji': '🔴',
        'headline': 'Stay indoors. Keep medications accessible.',
    }


# ──────────────────────────────────────────────────────────────────────────────
# Activity Window Generator
# ──────────────────────────────────────────────────────────────────────────────

def get_activity_windows(hourly_forecast: list, profile: dict) -> list:
    """
    Given the 24-hour AQI forecast and a health profile dict, return
    a list of hourly safety windows.

    Each entry:
        { 'hour': int, 'aqi': int, 'risk_score': float,
          'safe': bool, 'label': str, 'color': str }
    """
    windows = []
    for entry in hourly_forecast:
        hour_aqi = entry.get('hourAqi', 0)
        score = compute_risk_score(hour_aqi, profile)['score']
        category = get_risk_category(score)
        safe = score <= 40  # moderate-low boundary
        windows.append({
            'hour':       entry.get('i', 0),
            'aqi':        hour_aqi,
            'risk_score': round(score, 1),
            'safe':       safe,
            'label':      category['level'],
            'color':      category['color'],
        })
    return windows


# ──────────────────────────────────────────────────────────────────────────────
# Main Risk Score Computation
# ──────────────────────────────────────────────────────────────────────────────

def compute_risk_score(aqi: float, profile: dict,
                       pollutants: Optional[dict] = None) -> dict:
    """
    Compute the personalized risk score for a user given current AQI and
    their health profile dict (from Firestore / HealthProfile.to_firestore()).

    Returns
    -------
    {
        'score':        float,   # 0–100
        'category':     dict,    # { level, code, color, emoji, headline }
        'factors':      list,    # contributing factors with weight breakdown
        'recommendations': list, # personalised advisory strings
    }
    """
    conditions     = profile.get('conditions', {})
    activity_level = profile.get('activity_level', 'moderate')
    age_group      = profile.get('age_group', 'adult')
    smoking_status = profile.get('smoking_status', 'never')
    outdoor_worker = profile.get('outdoor_worker', False)
    medications    = profile.get('medications', {})

    # 1. Base AQI Risk (0–100)
    base = min(100.0, aqi / 5.0)

    # 2. Sensitivity from active medical conditions
    if isinstance(conditions, dict):
        active_conditions = [k for k, v in conditions.items() if v]
    elif isinstance(conditions, list):
        active_conditions = conditions
    else:
        active_conditions = []
        
    sensitivity = 1.0
    for cond in active_conditions:
        sensitivity *= CONDITION_WEIGHTS.get(cond, 1.0)
    # Cap sensitivity multiplier at 8.0 to avoid unreasonably large scores
    sensitivity = min(sensitivity, 8.0)

    # 3. Other multipliers
    activity_mult = ACTIVITY_MULTIPLIERS.get(activity_level, 1.4)
    age_mult      = AGE_MULTIPLIERS.get(age_group, 1.0)
    smoking_mult  = SMOKING_MULTIPLIERS.get(smoking_status, 1.0)
    outdoor_mult  = 1.3 if outdoor_worker else 1.0

    # 4. Final score
    raw_score = base * sensitivity * activity_mult * age_mult * smoking_mult * outdoor_mult
    score     = min(100.0, raw_score)

    category = get_risk_category(score)

    # 5. Build explainability factors list
    factors = _build_factors(
        aqi, base, active_conditions, sensitivity,
        activity_level, activity_mult,
        age_group, age_mult,
        smoking_status, smoking_mult,
        outdoor_worker, outdoor_mult,
        pollutants or {}
    )

    # 6. Personalised recommendations
    recommendations = _build_recommendations(
        score, active_conditions, medications, aqi, pollutants or {}
    )

    return {
        'score':           round(score, 1),
        'category':        category,
        'factors':         factors,
        'recommendations': recommendations,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Internal Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _build_factors(aqi, base, active_conditions, sensitivity,
                   activity_level, activity_mult,
                   age_group, age_mult,
                   smoking_status, smoking_mult,
                   outdoor_worker, outdoor_mult,
                   pollutants: dict) -> list:
    """Build an ordered list of contributing factors for the explainability panel."""
    factors = []

    # Raw AQI factor
    factors.append({
        'label':       f'Current AQI: {round(aqi)}',
        'icon':        'fa-wind',
        'multiplier':  round(base, 1),
        'description': f'Base risk from air pollution level ({round(aqi)} AQI → {round(base, 1)}/100)',
        'type':        'aqi',
    })

    # Medical conditions
    for cond in active_conditions:
        w = CONDITION_WEIGHTS.get(cond, 1.0)
        factors.append({
            'label':       CONDITION_LABELS.get(cond, cond.title()),
            'icon':        _condition_icon(cond),
            'multiplier':  w,
            'description': f'×{w} risk multiplier — you are more sensitive to this pollution level',
            'type':        'condition',
        })

    # Activity level
    if activity_mult > 1.0:
        factors.append({
            'label':       f'Activity Level: {activity_level.title()}',
            'icon':        'fa-person-running',
            'multiplier':  activity_mult,
            'description': f'×{activity_mult} — higher activity = more air inhaled per minute',
            'type':        'lifestyle',
        })

    # Age
    if age_mult != 1.0:
        factors.append({
            'label':       f'Age Group: {age_group.title()}',
            'icon':        'fa-user',
            'multiplier':  age_mult,
            'description': f'×{age_mult} — {age_group}s have higher vulnerability to air pollution',
            'type':        'demographic',
        })

    # Smoking
    if smoking_mult > 1.0:
        factors.append({
            'label':       f'Smoking: {smoking_status.title()}',
            'icon':        'fa-smoking',
            'multiplier':  smoking_mult,
            'description': f'×{smoking_mult} — compounded lung damage increases sensitivity',
            'type':        'lifestyle',
        })

    # Outdoor worker
    if outdoor_worker:
        factors.append({
            'label':       'Outdoor Worker',
            'icon':        'fa-hard-hat',
            'multiplier':  outdoor_mult,
            'description': '×1.3 — prolonged outdoor exposure raises baseline risk',
            'type':        'lifestyle',
        })

    # Sort by multiplier (highest impact first)
    factors.sort(key=lambda x: x['multiplier'], reverse=True)
    return factors


def _build_recommendations(score: float, active_conditions: list,
                            medications: dict, aqi: float,
                            pollutants: dict) -> list:
    """Generate a personalised set of action recommendations."""
    recs = []
    pm25 = pollutants.get('pm25', 0) or 0
    no2  = pollutants.get('no2', 0) or 0
    o3   = pollutants.get('o3', 0) or 0

    if score > 75:
        recs.append({'icon': '🏠', 'priority': 'critical',
                     'text': 'Stay indoors as much as possible. Keep windows and doors closed.'})
        recs.append({'icon': '💊', 'priority': 'critical',
                     'text': 'Keep all medications within reach. Check your emergency supply.'})
    elif score > 50:
        recs.append({'icon': '😷', 'priority': 'high',
                     'text': 'Wear an N95 or KN95 mask if you must go outdoors.'})
        recs.append({'icon': '🏃', 'priority': 'high',
                     'text': 'Avoid vigorous outdoor exercise until AQI improves.'})
    elif score > 25:
        recs.append({'icon': '⏱️', 'priority': 'moderate',
                     'text': 'Keep outdoor activity short. Avoid peak traffic hours.'})

    # Condition-specific
    if 'asthma' in active_conditions:
        if medications.get('inhaler'):
            recs.append({'icon': '💨', 'priority': 'high',
                         'text': 'Use your rescue inhaler before any outdoor activity today.'})
        if pm25 > 35:
            recs.append({'icon': '🌫️', 'priority': 'high',
                         'text': f'PM2.5 is elevated ({round(pm25)} µg/m³). This is a known asthma trigger.'})

    if 'cardiovascular' in active_conditions and (pm25 > 25 or no2 > 40):
        recs.append({'icon': '❤️', 'priority': 'high',
                     'text': 'Fine particles and NO₂ can trigger cardiac events. Rest indoors and monitor symptoms.'})

    if 'pregnancy' in active_conditions:
        recs.append({'icon': '🤰', 'priority': 'critical',
                     'text': 'Air pollution during pregnancy affects fetal development. Prioritise staying in clean, filtered indoor air.'})

    if 'hypertension' in active_conditions and no2 > 40:
        recs.append({'icon': '🩺', 'priority': 'moderate',
                     'text': f'NO₂ is {round(no2)} µg/m³ — this can spike blood pressure. Monitor regularly.'})

    if o3 > 100:
        recs.append({'icon': '☀️', 'priority': 'moderate',
                     'text': 'Ozone levels are high. Avoid outdoor activity in the afternoon (ozone peaks 12–6 PM).'})

    # Always include air purifier tip for high scores
    if score > 40:
        recs.append({'icon': '🌬️', 'priority': 'moderate',
                     'text': 'Run a HEPA air purifier indoors to reduce particle exposure.'})

    # Hydration
    recs.append({'icon': '💧', 'priority': 'low',
                 'text': 'Stay well-hydrated — proper hydration helps your body flush out inhaled pollutants.'})

    return recs[:8]  # Return top 8 most relevant


def _condition_icon(condition: str) -> str:
    icons = {
        'asthma':            'fa-lungs',
        'copd':              'fa-lungs-virus',
        'cardiovascular':    'fa-heart-pulse',
        'hypertension':      'fa-stethoscope',
        'diabetes':          'fa-droplet',
        'pregnancy':         'fa-person-pregnant',
        'immunocompromised': 'fa-shield-virus',
        'allergies':         'fa-seedling',
        'kidney_disease':    'fa-kidneys',
    }
    return icons.get(condition, 'fa-circle-exclamation')
