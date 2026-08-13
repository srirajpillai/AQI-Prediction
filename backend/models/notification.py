"""
AirFlow AI — Notification Document Model
Defines the structure for notification records stored in Firestore.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class NotificationRecord(BaseModel):
    """Stored at users/{uid}/notifications/{notif_id}"""
    uid:        str
    sent_at:    str = ""
    type:       str = "health_alert"   # health_alert | forecast_warning | daily_summary
    risk_level: str = "moderate"       # low | moderate | high | severe
    aqi:        int = 0
    message:    str = ""
    title:      str = ""
    location:   str = ""
    read:       bool = False

    def to_firestore(self) -> dict:
        data = self.model_dump()
        data.pop('uid', None)
        if not data.get('sent_at'):
            data['sent_at'] = datetime.utcnow().isoformat()
        return data

    @classmethod
    def from_firestore(cls, uid: str, data: dict) -> 'NotificationRecord':
        return cls(uid=uid, **data)


def build_alert_notification(uid: str, aqi: int, risk_level: str,
                              location: str, conditions: list,
                              recommendations: list) -> NotificationRecord:
    """
    Build a push notification record from risk engine output.
    """
    level_emoji = {
        'low':      '🟢',
        'moderate': '🟡',
        'high':     '🟠',
        'severe':   '🔴',
    }.get(risk_level.lower(), '⚠️')

    cond_str = ', '.join(conditions[:3]) if conditions else 'your health profile'
    top_rec  = recommendations[0]['text'] if recommendations else 'Monitor air quality regularly.'

    title = f"{level_emoji} {risk_level.upper()} Air Quality Risk — {location}"
    msg   = (
        f"AQI is {aqi}. Given {cond_str}, you are at {risk_level} risk. "
        f"{top_rec}"
    )

    return NotificationRecord(
        uid=uid,
        type='health_alert',
        risk_level=risk_level.lower(),
        aqi=aqi,
        title=title,
        message=msg,
        location=location,
        sent_at=datetime.utcnow().isoformat(),
    )
