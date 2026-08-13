/**
 * AirFlow AI v3 — Personalized Dashboard (dashboard.js)
 * Loads advisory data, renders risk gauge, activity heatmap,
 * recommendations, 7-day forecast, and notification history.
 */

import { onAuthChange, authFetch, showToast } from './auth.js';
import { requestNotificationPermission } from './notifications.js';

const API_BASE = '/api';

let _userLocation = null;
let _refreshTimer = null;

// ── Auth Guard ─────────────────────────────────────────────────────────────
onAuthChange(async (user) => {
  if (!user) {
    window.location.href = '/?signin=1';
    return;
  }
  
  // Ensure DOM is ready before trying to render
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initDashboard());
  } else {
    await initDashboard();
  }
});

// ── Main Init ──────────────────────────────────────────────────────────────
async function initDashboard() {
  showSkeleton(true);
  try {
    const summary = await loadSummary();
    if (!summary) {
      showProfilePrompt();
      return;
    }
    _userLocation = summary.location;
    renderAll(summary);
    await loadNotificationHistory();

    // Auto-refresh every 10 minutes
    _refreshTimer = setInterval(async () => {
      try {
        const fresh = await loadSummary();
        if (fresh) renderAll(fresh);
      } catch (e) { /* silent */ }
    }, 10 * 60 * 1000);
  } catch (e) {
    console.error('[Dashboard] Init failed:', e);
    showToast('Failed to load advisory. Please refresh.', 'error');
  } finally {
    showSkeleton(false);
  }
}

async function loadSummary() {
  try {
    const resp = await authFetch(`${API_BASE}/advisory/summary`);
    if (resp.status === 404) return null; // no profile or no location
    if (!resp.ok) return null;
    return resp.json();
  } catch (e) {
    return null;
  }
}

// ── Render All ─────────────────────────────────────────────────────────────
function renderAll(data) {
  renderLocationBar(data);
  renderRiskScore(data);
  renderStatsRow(data);
  renderFactors(data.factors || []);
  renderRecommendations(data.recommendations || []);
  renderActivityWindows(data.activity_windows || []);
}

// ── Location Bar ───────────────────────────────────────────────────────────
function renderLocationBar(data) {
  const bar = document.getElementById('location-bar');
  if (!bar) return;
  const city  = data.location?.city || 'Your Location';
  const level = getAQILevel(data.aqi);
  bar.innerHTML = `
    <i class="fas fa-location-dot"></i>
    <span class="location-city">${city}</span>
    <span class="location-aqi" style="color:${data.category?.color || '#fff'}">AQI ${data.aqi}</span>
    <span class="badge badge-${data.category?.code || 'moderate'}">${data.category?.level || 'Moderate'}</span>
  `;
}

// ── Risk Score Gauge ───────────────────────────────────────────────────────
function renderRiskScore(data) {
  const score    = data.score || 0;
  const category = data.category || {};
  const color    = category.color || '#3b82f6';

  // Set CSS variable for the glow and fill
  const card = document.getElementById('risk-score-card');
  if (card) card.style.setProperty('--risk-color', color);

  // Gauge fill animation
  const fill = document.getElementById('risk-gauge-fill');
  if (fill) {
    const circumference = 440;
    const offset = circumference - (score / 100) * circumference;
    fill.style.stroke = color;
    fill.style.strokeDashoffset = offset;
    fill.style.filter = `drop-shadow(0 0 10px ${color})`;
  }

  const el = (id) => document.getElementById(id);
  if (el('risk-score-number'))  el('risk-score-number').textContent  = Math.round(score);
  if (el('risk-level-badge')) {
    const b = el('risk-level-badge');
    b.textContent = category.level || 'Moderate';
    b.style.color = color;
    b.style.borderColor = color;
    b.style.background  = `${color}22`;
  }
  if (el('risk-headline'))  el('risk-headline').textContent  = category.headline || '';
}

// ── Stats Row ──────────────────────────────────────────────────────────────
function renderStatsRow(data) {
  const p = data.pollutants || {};
  const stats = [
    { id: 'stat-pm25',  label: 'PM2.5',      value: p.pm25  ?? '—', unit: 'µg/m³', color: getPollutantColor('pm25', p.pm25) },
    { id: 'stat-pm10',  label: 'PM10',       value: p.pm10  ?? '—', unit: 'µg/m³', color: getPollutantColor('pm10', p.pm10) },
    { id: 'stat-no2',   label: 'NO₂',        value: p.no2   ?? '—', unit: 'µg/m³', color: getPollutantColor('no2', p.no2) },
    { id: 'stat-o3',    label: 'Ozone (O₃)',  value: p.o3    ?? '—', unit: 'ppb',   color: getPollutantColor('o3', p.o3) },
  ];

  stats.forEach(({ id, label, value, unit, color }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `
      <div class="stat-label">${label}</div>
      <div class="stat-value" style="color:${color}">${typeof value === 'number' ? Math.round(value) : value}</div>
      <div class="stat-sub">${unit}</div>
    `;
  });
}

// ── Explainability Factors ─────────────────────────────────────────────────
function renderFactors(factors) {
  const list = document.getElementById('factors-list');
  if (!list) return;
  if (!factors.length) {
    list.innerHTML = '<p class="text-muted text-sm">No risk factors detected at current pollution levels.</p>';
    return;
  }
  list.innerHTML = factors.map(f => `
    <div class="factor-item fade-in">
      <div class="factor-icon ${f.type || 'aqi'}">
        <i class="fas ${f.icon || 'fa-circle-exclamation'}"></i>
      </div>
      <div class="factor-content">
        <div class="factor-label">${f.label}</div>
        <div class="factor-desc">${f.description}</div>
      </div>
      <div class="factor-multiplier">×${f.multiplier?.toFixed(1) || '1.0'}</div>
    </div>
  `).join('');
}

// ── Recommendations ────────────────────────────────────────────────────────
function renderRecommendations(recs) {
  const grid = document.getElementById('recommendations-grid');
  if (!grid) return;
  grid.innerHTML = recs.map(r => `
    <div class="rec-card ${r.priority} fade-in">
      <div class="rec-emoji">${r.icon}</div>
      <div class="rec-text">${r.text}</div>
    </div>
  `).join('');
}

// ── Activity Windows ───────────────────────────────────────────────────────
function renderActivityWindows(windows) {
  const heatmap = document.getElementById('activity-heatmap');
  const labels  = document.getElementById('activity-hour-labels');
  if (!heatmap) return;

  const best = windows.filter(w => w.safe).map(w => w.hour);
  const bestMsg = best.length
    ? `Best outdoor hours today: ${_formatHours(best)}`
    : 'No safe outdoor windows today — stay indoors.';
  const msgEl = document.getElementById('activity-summary-msg');
  if (msgEl) msgEl.textContent = bestMsg;

  heatmap.innerHTML = windows.map(w => {
    const cls = w.risk_score <= 25 ? 'safe' : w.risk_score <= 50 ? 'moderate' : w.risk_score <= 75 ? 'high' : 'severe';
    const h12 = w.hour === 0 ? '12am' : w.hour < 12 ? `${w.hour}am` : w.hour === 12 ? '12pm' : `${w.hour-12}pm`;
    return `
      <div class="hour-block ${cls}" title="${h12}: AQI ${w.aqi}, Risk ${w.risk_score}">
        <div class="hour-block-tooltip">${h12}<br>AQI ${w.aqi}<br>${w.label}</div>
      </div>`;
  }).join('');

  if (labels) {
    labels.innerHTML = [0,3,6,9,12,15,18,21,''].map((h, i) => {
      const label = h === '' ? '' : (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`);
      return `<div class="hour-label" style="grid-column: ${i * 3 + 1} / span 3">${label}</div>`;
    }).join('');
  }
}

function _formatHours(hours) {
  const ranges = [];
  let start = hours[0], end = hours[0];
  for (let i = 1; i < hours.length; i++) {
    if (hours[i] === end + 1) { end = hours[i]; }
    else {
      ranges.push(start === end ? _h12(start) : `${_h12(start)}–${_h12(end)}`);
      start = end = hours[i];
    }
  }
  ranges.push(start === end ? _h12(start) : `${_h12(start)}–${_h12(end)}`);
  return ranges.join(', ');
}

function _h12(h) {
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`;
}

// ── Notification History ────────────────────────────────────────────────────
async function loadNotificationHistory() {
  try {
    const resp  = await authFetch(`${API_BASE}/notifications/?limit=10`);
    const data  = await resp.json();
    const list  = document.getElementById('notif-list');
    if (!list) return;

    if (!data.notifications?.length) {
      list.innerHTML = '<p class="text-muted text-sm text-center" style="padding:24px">No notifications yet. They\'ll appear here when alerts are sent.</p>';
      return;
    }

    list.innerHTML = data.notifications.map(n => {
      const icons = { low: '🟢', moderate: '🟡', high: '🟠', severe: '🔴' };
      const ago   = _timeAgo(n.sent_at);
      return `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" onclick="markRead(this, '${n.id}')">
          <div class="notif-icon">${icons[n.risk_level] || '🔔'}</div>
          <div class="notif-content">
            <div class="notif-title">${n.title || n.location}</div>
            <div class="notif-msg">${n.message}</div>
          </div>
          <div class="notif-time">${ago}</div>
        </div>`;
    }).join('');
  } catch (e) {
    console.warn('[Dashboard] Notifications load failed:', e);
  }
}

window.markRead = async (el, id) => {
  el.classList.remove('unread');
  try {
    await authFetch(`${API_BASE}/notifications/${id}/read`, { method: 'PATCH' });
  } catch (e) { /* silent */ }
};

// ── Notification Permission Button ──────────────────────────────────────────
document.getElementById('btn-enable-notifs')?.addEventListener('click', async () => {
  const token = await requestNotificationPermission();
  if (token) showToast('Push notifications enabled!', 'success');
});

// ── Test Notification Button ────────────────────────────────────────────────
document.getElementById('btn-test-notif')?.addEventListener('click', async () => {
  try {
    const resp = await authFetch(`${API_BASE}/notifications/test`, { method: 'POST' });
    const data = await resp.json();
    if (resp.ok) showToast('Test notification sent! Check your browser.', 'success');
    else showToast(data.error || 'Test failed', 'error');
  } catch (e) {
    showToast('Test failed: ' + e.message, 'error');
  }
});

// ── Manual Refresh Button ───────────────────────────────────────────────────
document.getElementById('btn-refresh')?.addEventListener('click', async () => {
  showSkeleton(true);
  const fresh = await loadSummary();
  if (fresh) { renderAll(fresh); showToast('Advisory updated', 'success'); }
  showSkeleton(false);
});

// ── Helpers ────────────────────────────────────────────────────────────────
function showSkeleton(show) {
  document.getElementById('dashboard-skeleton')?.classList.toggle('hidden', !show);
  document.getElementById('dashboard-content')?.classList.toggle('hidden', show);
}

function showProfilePrompt() {
  document.getElementById('dashboard-skeleton')?.classList.add('hidden');
  document.getElementById('dashboard-content')?.classList.add('hidden');
  document.getElementById('profile-prompt')?.classList.remove('hidden');
}

function getAQILevel(aqi) {
  if (aqi <= 50)  return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

function getPollutantColor(pollutant, value) {
  if (!value) return 'var(--clr-text-400)';
  const thresholds = { pm25: [12,35,55,150], pm10: [54,154,254], no2: [53,100,360], o3: [54,70,85] };
  const t = thresholds[pollutant] || [50, 100, 200];
  if (value <= t[0]) return 'var(--clr-good)';
  if (value <= t[1]) return 'var(--clr-moderate)';
  if (value <= (t[2] || 200)) return 'var(--clr-high)';
  return 'var(--clr-severe)';
}

function _timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
