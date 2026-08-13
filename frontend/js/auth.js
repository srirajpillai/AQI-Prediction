/**
 * AirFlow AI v3 — Firebase Auth Client (auth.js)
 * Handles sign-in, sign-up, sign-out, and auth state management.
 */

// Firebase config — replace with your actual values
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const API_BASE = '/api';

// ── Firebase Initialisation ───────────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const app      = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
const provider    = new GoogleAuthProvider();

// ── Auth State ────────────────────────────────────────────────────────────
let _currentUser  = null;
let _idToken      = null;
const _listeners  = [];

export function onAuthChange(callback) { _listeners.push(callback); }

export function getCurrentUser()  { return _currentUser; }
export function getIdToken()      { return _idToken; }

onAuthStateChanged(auth, async (user) => {
  _currentUser = user;
  if (user) {
    _idToken = await user.getIdToken();
    await _syncWithBackend(user, _idToken);
    _updateNavUI(user);
  } else {
    _idToken = null;
    _updateNavUI(null);
  }
  _listeners.forEach(cb => cb(user));
});

// ── Backend Sync ──────────────────────────────────────────────────────────
async function _syncWithBackend(user, token) {
  try {
    await fetch(`${API_BASE}/auth/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ idToken: token }),
    });
  } catch (e) {
    console.warn('[Auth] Backend sync failed:', e);
  }
}

// ── Auth Actions ──────────────────────────────────────────────────────────
export async function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred;
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}

export async function signOut() {
  await fbSignOut(auth);
}

// ── Authenticated API Fetch ───────────────────────────────────────────────
export async function authFetch(url, options = {}) {
  const user  = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

// ── Navbar UI Update ──────────────────────────────────────────────────────
function _updateNavUI(user) {
  const authBtn   = document.getElementById('nav-auth-btn');
  const avatarBtn = document.getElementById('nav-avatar');
  const signOutBtn = document.getElementById('nav-signout-btn');

  if (!authBtn) return;

  if (user) {
    authBtn.classList.add('hidden');
    if (avatarBtn) {
      avatarBtn.classList.remove('hidden');
      const initials = (user.displayName || user.email || 'U')
        .split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
      avatarBtn.textContent = initials;
    }
    if (signOutBtn) signOutBtn.classList.remove('hidden');
  } else {
    authBtn.classList.remove('hidden');
    if (avatarBtn) avatarBtn.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.add('hidden');
  }
}

// ── Auth Modal ─────────────────────────────────────────────────────────────
export function openAuthModal(mode = 'signin') {
  const overlay = document.getElementById('auth-modal-overlay');
  if (overlay) {
    overlay.classList.add('visible');
    setAuthMode(mode);
  }
}

export function closeAuthModal() {
  const overlay = document.getElementById('auth-modal-overlay');
  if (overlay) overlay.classList.remove('visible');
}

export function setAuthMode(mode) {
  const signin = document.getElementById('auth-signin-panel');
  const signup = document.getElementById('auth-signup-panel');
  if (!signin || !signup) return;
  if (mode === 'signin') {
    signin.classList.remove('hidden');
    signup.classList.add('hidden');
  } else {
    signin.classList.add('hidden');
    signup.classList.remove('hidden');
  }
}

// ── DOM Ready: Wire Up Auth Modal ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Auth button
  document.getElementById('nav-auth-btn')?.addEventListener('click', () => openAuthModal('signin'));
  document.getElementById('nav-avatar')?.addEventListener('click', () => {
    window.location.href = '/dashboard';
  });

  // Sign out
  document.getElementById('nav-signout-btn')?.addEventListener('click', async () => {
    await signOut();
    window.location.href = '/';
  });

  // Close overlay on background click
  document.getElementById('auth-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'auth-modal-overlay') closeAuthModal();
  });

  // Switch mode links
  document.getElementById('switch-to-signup')?.addEventListener('click', () => setAuthMode('signup'));
  document.getElementById('switch-to-signin')?.addEventListener('click', () => setAuthMode('signin'));

  // Google sign-in
  document.querySelectorAll('.btn-google').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await signInWithGoogle();
        closeAuthModal();
        showToast('Signed in with Google!', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });

  // Email sign-in form
  document.getElementById('signin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('signin-email')?.value;
    const password = document.getElementById('signin-password')?.value;
    try {
      await signInWithEmail(email, password);
      closeAuthModal();
      showToast('Welcome back!', 'success');
    } catch (err) {
      showToast(err.message.replace('Firebase: ', ''), 'error');
    }
  });

  // Email sign-up form
  document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name     = document.getElementById('signup-name')?.value;
    const email    = document.getElementById('signup-email')?.value;
    const password = document.getElementById('signup-password')?.value;
    try {
      await signUpWithEmail(email, password, name);
      closeAuthModal();
      showToast('Account created! Let\'s set up your health profile.', 'success');
      setTimeout(() => window.location.href = '/profile', 1500);
    } catch (err) {
      showToast(err.message.replace('Firebase: ', ''), 'error');
    }
  });
});

// ── Toast Utility ─────────────────────────────────────────────────────────
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
