/**
 * AirFlow AI v3 — Service Worker
 * Handles background push notifications from Firebase Cloud Messaging.
 * This file MUST be served from the root path of the domain.
 */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase config is injected by the frontend build step (or hardcoded here for simplicity)
// Replace these placeholders with your actual Firebase project values
firebase.initializeApp({
  apiKey:            '__FIREBASE_API_KEY__',
  authDomain:        '__FIREBASE_AUTH_DOMAIN__',
  projectId:         '__FIREBASE_PROJECT_ID__',
  storageBucket:     '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId:             '__FIREBASE_APP_ID__',
});

const messaging = firebase.messaging();

// ── Background Message Handler ─────────────────────────────────────────────
// Handles notifications when the app is in the background or closed.
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);

  const notification = payload.notification || {};
  const data         = payload.data || {};

  const riskLevel = data.risk_level || 'moderate';
  const riskColors = {
    low:      '#00e676',
    moderate: '#ffeb3b',
    high:     '#ff9800',
    severe:   '#f44336',
  };

  const notificationTitle = notification.title || '🌬️ AirFlow AI Alert';
  const notificationOptions = {
    body:    notification.body || 'Check your personalized air quality advisory.',
    icon:    '/images/icon-192.png',
    badge:   '/images/badge-72.png',
    tag:     'airflow-aqi-alert',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url:       '/dashboard',
      riskLevel: riskLevel,
      aqi:       data.aqi || '—',
    },
    actions: [
      { action: 'view',    title: '📊 View Advisory' },
      { action: 'dismiss', title: 'Dismiss'          },
    ],
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ── Notification Click Handler ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing tab if open
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// ── Cache Strategy (Cache-First for static assets) ─────────────────────────
const CACHE_NAME = 'airflow-v3-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/profile',
  '/styles/main.css',
  '/styles/dashboard.css',
  '/styles/profile.css',
  '/js/app.js',
  '/js/dashboard.js',
  '/js/profile.js',
  '/js/auth.js',
  '/js/notifications.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests for our own origin
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  // Don't cache API calls
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
