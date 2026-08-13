/**
 * AirFlow AI v3 — Profile Form Logic (profile.js)
 * Multi-step health profile wizard with validation and API save.
 */

import { onAuthChange, authFetch, showToast, getCurrentUser } from './auth.js';

const API_BASE = '/api';
let currentStep = 1;
const TOTAL_STEPS = 4;

const formData = {
  age: 25,
  biological_sex: 'prefer_not_to_say',
  bmi_category: 'normal',
  height_cm: null,
  weight_kg: null,
  activity_level: 'moderate',
  outdoor_worker: false,
  smoking_status: 'never',
  conditions: {
    asthma: false, copd: false, cardiovascular: false,
    hypertension: false, diabetes: false, pregnancy: false,
    immunocompromised: false, allergies: false, kidney_disease: false,
  },
  medications: {
    inhaler: false, beta_blockers: false, blood_thinners: false,
  },
  alert_threshold: 'moderate',
  notifications_enabled: true,
  home_location: null,
};

// ── Auth Guard ────────────────────────────────────────────────────────────
onAuthChange((user) => {
  if (!user && document.readyState === 'complete') {
    document.getElementById('auth-required-banner')?.classList.remove('hidden');
    document.getElementById('profile-card')?.classList.add('hidden');
  } else if (user) {
    document.getElementById('auth-required-banner')?.classList.add('hidden');
    document.getElementById('profile-card')?.classList.remove('hidden');
    loadExistingProfile();
  }
});

// ── Load Existing Profile ─────────────────────────────────────────────────
async function loadExistingProfile() {
  try {
    const resp = await authFetch(`${API_BASE}/profile/`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.exists && data.profile) {
      Object.assign(formData, data.profile);
      if (data.profile.conditions) Object.assign(formData.conditions, data.profile.conditions);
      if (data.profile.medications) Object.assign(formData.medications, data.profile.medications);
      populateFormFromData();
    }
  } catch (e) {
    console.warn('[Profile] Could not load existing profile:', e);
  }
}

function populateFormFromData() {
  const ageInput = document.getElementById('age-input');
  if (ageInput) {
    ageInput.value = formData.age;
    document.getElementById('age-display').textContent = formData.age;
  }

  // Sex selection
  document.querySelectorAll('[data-sex]').forEach(el => {
    el.classList.toggle('selected', el.dataset.sex === formData.biological_sex);
  });

  // BMI category
  document.querySelectorAll('[data-bmi]').forEach(el => {
    el.classList.toggle('selected', el.dataset.bmi === formData.bmi_category);
  });

  // Activity level
  document.querySelectorAll('[data-activity]').forEach(el => {
    el.classList.toggle('selected', el.dataset.activity === formData.activity_level);
  });

  // Smoking
  document.querySelectorAll('[data-smoking]').forEach(el => {
    el.classList.toggle('selected', el.dataset.smoking === formData.smoking_status);
  });

  // Conditions
  Object.entries(formData.conditions).forEach(([key, val]) => {
    const el = document.querySelector(`[data-condition="${key}"]`);
    if (el) el.classList.toggle('checked', val);
  });

  // Alert threshold
  document.querySelectorAll('[data-value]').forEach(el => {
    el.classList.toggle('selected', el.dataset.value === formData.alert_threshold);
  });

  // Toggles
  const outdoorToggle = document.getElementById('toggle-outdoor');
  if (outdoorToggle) outdoorToggle.checked = formData.outdoor_worker;

  const notifToggle = document.getElementById('toggle-notifications');
  if (notifToggle) notifToggle.checked = formData.notifications_enabled;
}

// ── Step Navigation ───────────────────────────────────────────────────────
function goToStep(step) {
  if (step < 1 || step > TOTAL_STEPS) return;

  document.querySelectorAll('.step-panel').forEach((p, i) => {
    p.classList.toggle('active', i + 1 === step);
  });

  document.querySelectorAll('.step-item').forEach((item, i) => {
    item.classList.toggle('active', i + 1 === step);
    item.classList.toggle('done',   i + 1 < step);
  });

  document.getElementById('step-counter').textContent = `Step ${step} of ${TOTAL_STEPS}`;

  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  const saveBtn = document.getElementById('btn-save');

  if (prevBtn) prevBtn.classList.toggle('hidden', step === 1);
  if (nextBtn) nextBtn.classList.toggle('hidden', step === TOTAL_STEPS);
  if (saveBtn) saveBtn.classList.toggle('hidden', step !== TOTAL_STEPS);

  currentStep = step;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Form Validation per Step ──────────────────────────────────────────────
function validateStep(step) {
  if (step === 1) {
    const age = parseInt(document.getElementById('age-input')?.value || 0);
    if (age < 1 || age > 120) {
      showToast('Please enter a valid age (1–120)', 'error');
      return false;
    }
    formData.age = age;
  }
  return true;
}

// ── DOM Ready ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  goToStep(1);
  populateFormFromData(); // Ensure default values (like age slider) are rendered first

  // Prev / Next buttons
  document.getElementById('btn-next')?.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    collectStepData(currentStep);
    goToStep(currentStep + 1);
  });

  document.getElementById('btn-prev')?.addEventListener('click', () => {
    goToStep(currentStep - 1);
  });

  // Save button
  document.getElementById('btn-save')?.addEventListener('click', async () => {
    collectStepData(currentStep);
    await saveProfile();
  });

  // Age slider
  document.getElementById('age-input')?.addEventListener('input', function() {
    document.getElementById('age-display').textContent = this.value;
    formData.age = parseInt(this.value);
  });

  // Sex option cards
  document.querySelectorAll('[data-sex]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('[data-sex]').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      formData.biological_sex = el.dataset.sex;
    });
  });

  // BMI option cards
  document.querySelectorAll('[data-bmi]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('[data-bmi]').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      formData.bmi_category = el.dataset.bmi;
    });
  });

  // Activity level
  document.querySelectorAll('[data-activity]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('[data-activity]').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      formData.activity_level = el.dataset.activity;
    });
  });

  // Smoking status
  document.querySelectorAll('[data-smoking]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('[data-smoking]').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      formData.smoking_status = el.dataset.smoking;
    });
  });

  // Medical conditions
  document.querySelectorAll('[data-condition]').forEach(el => {
    el.addEventListener('click', () => {
      el.classList.toggle('checked');
      const key = el.dataset.condition;
      formData.conditions[key] = el.classList.contains('checked');
    });
  });

  // Medications toggles
  document.getElementById('toggle-inhaler')?.addEventListener('change', function() {
    formData.medications.inhaler = this.checked;
  });
  document.getElementById('toggle-beta-blockers')?.addEventListener('change', function() {
    formData.medications.beta_blockers = this.checked;
  });
  document.getElementById('toggle-blood-thinners')?.addEventListener('change', function() {
    formData.medications.blood_thinners = this.checked;
  });

  // Outdoor worker toggle
  document.getElementById('toggle-outdoor')?.addEventListener('change', function() {
    formData.outdoor_worker = this.checked;
  });

  // Alert threshold
  document.querySelectorAll('[data-value]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('[data-value]').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      formData.alert_threshold = el.dataset.value;
    });
  });

  // Notifications toggle
  document.getElementById('toggle-notifications')?.addEventListener('change', function() {
    formData.notifications_enabled = this.checked;
  });

  // Location search
  const locSearch = document.getElementById('location-search');
  const locResults = document.getElementById('location-results');
  let locDebounce;

  locSearch?.addEventListener('input', () => {
    clearTimeout(locDebounce);
    const q = locSearch.value.trim();
    if (q.length < 2) { locResults.innerHTML = ''; locResults.classList.remove('visible'); return; }
    locDebounce = setTimeout(() => searchLocation(q), 350);
  });

  async function searchLocation(q) {
    try {
      const resp = await fetch(`${API_BASE}/aqi/search?q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      locResults.innerHTML = '';
      (data.results || []).slice(0, 6).forEach(r => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
          <i class="fas fa-location-dot" style="color: var(--clr-primary)"></i>
          <div>
            <div>${r.name}</div>
            <div class="region">${r.region}</div>
          </div>
        `;
        item.addEventListener('click', () => {
          formData.home_location = { lat: r.lat, lon: r.lon, city: r.name, state: r.region };
          locSearch.value = `${r.name}, ${r.region}`;
          locResults.classList.remove('visible');
          document.getElementById('loc-lat').textContent = r.lat.toFixed(4) + '° N';
          document.getElementById('loc-lon').textContent = r.lon.toFixed(4) + '° E';
          document.getElementById('location-coords').classList.remove('hidden');
        });
        locResults.appendChild(item);
      });
      if (data.results?.length) locResults.classList.add('visible');
    } catch (e) {
      console.error('[Profile] Location search failed:', e);
    }
  }

  // Use current location
  document.getElementById('btn-use-location')?.addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      formData.home_location = { lat, lon, city: 'Current Location', state: '' };
      locSearch.value = `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
      document.getElementById('loc-lat').textContent = lat.toFixed(4) + '° N';
      document.getElementById('loc-lon').textContent = lon.toFixed(4) + '° E';
      document.getElementById('location-coords').classList.remove('hidden');
      showToast('Location detected!', 'success');
    }, () => showToast('Could not get location. Please search manually.', 'error'));
  });
});

function collectStepData(step) {
  // Data is collected inline via event listeners — no-op needed
}

// ── Save Profile ──────────────────────────────────────────────────────────
async function saveProfile() {
  const user = getCurrentUser();
  if (!user) {
    showToast('Please sign in first', 'error');
    return;
  }

  const saveBtn = document.getElementById('btn-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block"></span> Saving...';
  }

  try {
    const resp = await authFetch(`${API_BASE}/profile/`, {
      method: 'POST',
      body: JSON.stringify(formData),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Save failed');
    }

    // Show success screen
    document.getElementById('profile-card').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');

    showToast('Health profile saved!', 'success');
    setTimeout(() => window.location.href = '/dashboard', 2000);
  } catch (e) {
    showToast(e.message, 'error');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-check"></i> Save Profile';
    }
  }
}
