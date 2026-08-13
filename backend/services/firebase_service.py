"""
AirFlow AI — Firebase Admin SDK Service
Initialises the Firebase Admin app and exposes helper functions for
Firestore, Firebase Auth, and Cloud Messaging (FCM).
"""
from __future__ import annotations
import logging
import os

import firebase_admin
from firebase_admin import credentials, firestore, auth, messaging

from config import config

logger = logging.getLogger(__name__)
_db = None


def init_firebase() -> None:
    """Initialise Firebase Admin SDK (idempotent)."""
    global _db
    if firebase_admin._apps:
        return

    cred_path = config.FIREBASE_CREDENTIALS_PATH
    if os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
    else:
        # Fallback: use Application Default Credentials (e.g., on Cloud Run)
        logger.warning(
            f"Firebase credentials file '{cred_path}' not found. "
            "Falling back to Application Default Credentials."
        )
        cred = credentials.ApplicationDefault()

    firebase_admin.initialize_app(cred, {
        'projectId': config.FIREBASE_PROJECT_ID or None,
    })
    _db = firestore.client()
    logger.info("Firebase Admin initialised successfully")


def get_db() -> firestore.Client:
    """Return the Firestore client (lazy init)."""
    global _db
    if _db is None:
        _db = firestore.client()
    return _db


# ──────────────────────────────────────────────────────────────────────────────
# Auth Helpers
# ──────────────────────────────────────────────────────────────────────────────

def verify_id_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the decoded claims."""
    return auth.verify_id_token(id_token)


# ──────────────────────────────────────────────────────────────────────────────
# Firestore Helpers — Users
# ──────────────────────────────────────────────────────────────────────────────

def get_user_doc(uid: str) -> dict | None:
    db = get_db()
    doc = db.collection('users').document(uid).get()
    return doc.to_dict() if doc.exists else None


def save_user_doc(uid: str, data: dict) -> None:
    db = get_db()
    db.collection('users').document(uid).set(data, merge=True)


def get_health_profile(uid: str) -> dict | None:
    db = get_db()
    doc = db.collection('users').document(uid)\
             .collection('health_profile').document('profile').get()
    return doc.to_dict() if doc.exists else None


def save_health_profile(uid: str, data: dict) -> None:
    db = get_db()
    db.collection('users').document(uid)\
      .collection('health_profile').document('profile').set(data, merge=True)


def get_all_notifiable_users() -> list[dict]:
    """
    Return all user documents where notifications_enabled == True
    and home_location is set.
    """
    db = get_db()
    users_ref = db.collection('users')
    query = users_ref.where('notifications_enabled', '==', True)
    results = []
    for doc in query.stream():
        user = doc.to_dict()
        user['uid'] = doc.id
        if user.get('home_location'):
            results.append(user)
    return results


def add_fcm_token(uid: str, token: str) -> None:
    db = get_db()
    db.collection('users').document(uid).update({
        'fcm_tokens': firestore.ArrayUnion([token])
    })


def remove_fcm_token(uid: str, token: str) -> None:
    db = get_db()
    db.collection('users').document(uid).update({
        'fcm_tokens': firestore.ArrayRemove([token])
    })


# ──────────────────────────────────────────────────────────────────────────────
# Firestore Helpers — Notifications
# ──────────────────────────────────────────────────────────────────────────────

def save_notification(uid: str, notif_data: dict) -> str:
    """Save a notification record and return the document ID."""
    db = get_db()
    ref = db.collection('users').document(uid)\
             .collection('notifications').document()
    ref.set(notif_data)
    return ref.id


def get_notifications(uid: str, limit: int = 20) -> list[dict]:
    db = get_db()
    docs = db.collection('users').document(uid)\
              .collection('notifications')\
              .order_by('sent_at', direction=firestore.Query.DESCENDING)\
              .limit(limit).stream()
    results = []
    for d in docs:
        item = d.to_dict()
        item['id'] = d.id
        results.append(item)
    return results


def mark_notification_read(uid: str, notif_id: str) -> None:
    db = get_db()
    db.collection('users').document(uid)\
      .collection('notifications').document(notif_id)\
      .update({'read': True})


def get_last_notification_time(uid: str) -> str | None:
    """Return ISO timestamp of the most recent notification sent to this user."""
    db = get_db()
    docs = db.collection('users').document(uid)\
              .collection('notifications')\
              .order_by('sent_at', direction=firestore.Query.DESCENDING)\
              .limit(1).stream()
    for d in docs:
        return d.to_dict().get('sent_at')
    return None


# ──────────────────────────────────────────────────────────────────────────────
# FCM Push Notification
# ──────────────────────────────────────────────────────────────────────────────

def send_push_notification(tokens: list[str], title: str,
                            body: str, data: dict | None = None) -> dict:
    """
    Send a multicast FCM push notification to a list of device tokens.
    Returns a summary of successes and failures.
    """
    if not tokens:
        return {'success': 0, 'failure': 0}

    message = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in (data or {}).items()},
        tokens=tokens,
        android=messaging.AndroidConfig(priority='high'),
        webpush=messaging.WebpushConfig(
            notification=messaging.WebpushNotification(
                title=title,
                body=body,
                icon='/images/icon-192.png',
                badge='/images/badge-72.png',
                vibrate=[200, 100, 200],
                actions=[
                    messaging.WebpushNotificationAction(
                        action='view', title='View Advisory'
                    )
                ]
            ),
            fcm_options=messaging.WebpushFCMOptions(link='/dashboard')
        ),
    )

    try:
        response = messaging.send_each_for_multicast(message)
        logger.info(
            f"FCM multicast: {response.success_count} ok, "
            f"{response.failure_count} failed"
        )
        return {
            'success': response.success_count,
            'failure': response.failure_count,
        }
    except Exception as e:
        logger.error(f"FCM send failed: {e}")
        return {'success': 0, 'failure': len(tokens)}
