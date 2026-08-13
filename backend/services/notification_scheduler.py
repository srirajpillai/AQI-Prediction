"""
AirFlow AI — Background Notification Scheduler
================================================
Uses APScheduler to check AQI for every opted-in user on a fixed
interval and send FCM push notifications when personal risk exceeds
their configured alert threshold.

Cooldown: a user is not re-notified within NOTIFICATION_COOLDOWN_HOURS
even if their risk stays high, preventing notification fatigue.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from config import config

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None

THRESHOLD_SCORES = {
    'low':      26,   # notify when score > 25
    'moderate': 51,   # notify when score > 50
    'high':     76,   # notify when score > 75
    'severe':   90,   # notify only when score > 90
}


def _check_and_notify():
    """Main job executed by APScheduler every N minutes."""
    # Import here to avoid circular imports at module load
    from services.firebase_service import (
        get_all_notifiable_users, get_health_profile,
        get_last_notification_time, send_push_notification,
        save_notification,
    )
    from services.aqi_service import fetch_aqi
    from models.risk_engine import compute_risk_score, get_risk_category
    from models.notification import build_alert_notification

    logger.info("Scheduler: starting AQI check for all users...")
    users = get_all_notifiable_users()
    logger.info(f"Scheduler: found {len(users)} notifiable users")

    cooldown_delta = timedelta(hours=config.NOTIFICATION_COOLDOWN_HOURS)
    now_utc = datetime.now(timezone.utc)

    sent_count = 0
    for user in users:
        uid = user['uid']
        loc = user.get('home_location', {})
        lat, lon = loc.get('lat'), loc.get('lon')
        if not lat or not lon:
            continue

        # Check cooldown
        last_sent_str = get_last_notification_time(uid)
        if last_sent_str:
            try:
                last_sent = datetime.fromisoformat(last_sent_str).replace(tzinfo=timezone.utc)
                if (now_utc - last_sent) < cooldown_delta:
                    logger.debug(f"Scheduler: skipping uid={uid} (cooldown active)")
                    continue
            except Exception:
                pass

        # Fetch current AQI
        aqi_data = fetch_aqi(lat, lon)
        if not aqi_data:
            logger.warning(f"Scheduler: AQI fetch failed for uid={uid}")
            continue

        aqi = aqi_data.get('aqi', 0)
        pollutants = {
            'pm25': (aqi_data.get('iaqi') or {}).get('pm25', {}).get('v', 0),
            'pm10': (aqi_data.get('iaqi') or {}).get('pm10', {}).get('v', 0),
            'no2':  (aqi_data.get('iaqi') or {}).get('no2',  {}).get('v', 0),
            'o3':   (aqi_data.get('iaqi') or {}).get('o3',   {}).get('v', 0),
            'so2':  (aqi_data.get('iaqi') or {}).get('so2',  {}).get('v', 0),
            'co':   (aqi_data.get('iaqi') or {}).get('co',   {}).get('v', 0),
        }

        # Get health profile
        profile = get_health_profile(uid)
        if not profile:
            continue

        # Compute personalized risk
        result     = compute_risk_score(aqi, profile, pollutants)
        score      = result['score']
        category   = result['category']
        risk_level = category['code']
        recs       = result['recommendations']
        conditions = profile.get('conditions', {})
        active_conditions = [k for k, v in conditions.items() if v]

        # Check alert threshold
        alert_threshold = profile.get('alert_threshold', 'moderate')
        threshold_score  = THRESHOLD_SCORES.get(alert_threshold, 51)

        if score < threshold_score:
            logger.debug(f"Scheduler: uid={uid} score={score} below threshold={threshold_score}, skip")
            continue

        # Build and send notification
        location = loc.get('city', 'Your location')
        notif = build_alert_notification(uid, aqi, risk_level, location, active_conditions, recs)

        tokens = user.get('fcm_tokens', [])
        if tokens:
            send_push_notification(
                tokens, notif.title, notif.message,
                data={'risk_level': risk_level, 'aqi': str(aqi), 'uid': uid}
            )
            sent_count += 1

        # Save to Firestore
        save_notification(uid, notif.to_firestore())
        logger.info(f"Scheduler: sent notification to uid={uid} (aqi={aqi}, score={score:.1f}, risk={risk_level})")

    logger.info(f"Scheduler: cycle complete. Sent {sent_count}/{len(users)} notifications.")


def start_scheduler(app=None) -> None:
    """Start the APScheduler background scheduler."""
    global _scheduler
    if _scheduler and _scheduler.running:
        return

    _scheduler = BackgroundScheduler(timezone='UTC')
    _scheduler.add_job(
        func=_check_and_notify,
        trigger='interval',
        minutes=config.SCHEDULER_INTERVAL_MINUTES,
        id='aqi_notification_job',
        name='AQI Notification Checker',
        replace_existing=True,
        misfire_grace_time=60,
    )
    _scheduler.start()
    logger.info(
        f"APScheduler started — job runs every {config.SCHEDULER_INTERVAL_MINUTES} minutes"
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
