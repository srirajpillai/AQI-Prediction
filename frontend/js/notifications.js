/**
 * AirFlow AI v3 — Push Notifications Manager (notifications.js)
 * Handles FCM token registration, permission requests, and service worker setup.
 */

import { getMessaging, getToken, onMessage } from
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { authFetch, showToast } from './auth.js';

// VAPID key from Firebase Console → Project Settings → Cloud Messaging → Web push certificates
const VAPID_KEY  = 'YOUR_VAPID_KEY_HERE';
const API_BASE   = '/api';

let _messaging = null;

// ── Initialise Messaging ──────────────────────────────────────────────────
export function initMessaging(firebaseApp) {
  try {
    _messaging = getMessaging(firebaseApp);
    _listenForeground();
  } catch (e) {
    console.warn('[FCM] Messaging init failed:', e.message);
  }
}

// ── Request Permission & Get Token ────────────────────────────────────────
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('This browser does not support notifications.', 'warning');
    return null;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    showToast('Notification permission denied. You can enable it in browser settings.', 'warning');
    return null;
  }

  return await _registerToken();
}

async function _registerToken() {
  if (!_messaging) {
    console.warn('[FCM] Messaging not initialised');
    return null;
  }

  try {
    // Register service worker first
    const sw = await _registerServiceWorker();
    if (!sw) return null;

    const token = await getToken(_messaging, {
      vapidKey:           VAPID_KEY,
      serviceWorkerRegistration: sw,
    });

    if (token) {
      await _saveTokenToBackend(token);
      console.info('[FCM] Token registered:', token.substring(0, 20) + '...');
      return token;
    }
  } catch (e) {
    console.error('[FCM] Token registration failed:', e);
    showToast('Could not enable push notifications. Check console for details.', 'error');
  }
  return null;
}

async function _registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.info('[SW] Service Worker registered');
    return reg;
  } catch (e) {
    console.error('[SW] Registration failed:', e);
    return null;
  }
}

async function _saveTokenToBackend(token) {
  try {
    const resp = await authFetch(`${API_BASE}/profile/fcm-token`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    if (resp.ok) console.info('[FCM] Token saved to backend');
  } catch (e) {
    console.warn('[FCM] Could not save token to backend:', e);
  }
}

// ── Foreground Message Handler ─────────────────────────────────────────────
function _listenForeground() {
  if (!_messaging) return;
  onMessage(_messaging, (payload) => {
    console.info('[FCM] Foreground message:', payload);
    const { title, body } = payload.notification || {};
    if (title) {
      _showInAppBanner(title, body, payload.data);
    }
  });
}

function _showInAppBanner(title, body, data = {}) {
  const banner = document.createElement('div');
  banner.className = 'notif-banner fade-in';
  banner.innerHTML = `
    <div class="notif-banner-icon">🔔</div>
    <div class="notif-banner-content">
      <strong>${title}</strong>
      <p>${body}</p>
    </div>
    <a href="${data.link || '/dashboard'}" class="btn btn-sm btn-ghost">View</a>
    <button class="notif-banner-close">✕</button>
  `;
  banner.querySelector('.notif-banner-close').onclick = () => banner.remove();
  setTimeout(() => banner.remove(), 8000);
  document.body.appendChild(banner);
}
