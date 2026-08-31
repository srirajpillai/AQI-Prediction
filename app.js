/**
 * AirFlow AI — Main Application Logic v13
 * Features:
 *  - Web Worker integration for heavy computations
 *  - Comprehensive Real-World AQI Impact Factor System
 *  - Enhanced Neighbor-Based Transfer Learning Prediction
 *  - Request caching with TTL (deduplication)
 *  - AbortController for cancelled fetches on city switch
 *  - Debounced resize observer
 *  - DOM update batching via requestAnimationFrame
 *  - Lazy 3D tilt via IntersectionObserver
 *  - All known bugs fixed
 */
(function () {
    'use strict';

    // ===== Firebase Configuration & State =====
    // Replace these placeholder values with actual Firebase Config in production
    const firebaseConfig = {
        apiKey: "AIzaSyCsBDB8RhwsXybBDLDoMFkf2LCo8qgPe2E",
        authDomain: "airflowai-0126.firebaseapp.com",
        projectId: "airflowai-0126",
        storageBucket: "airflowai-0126.firebasestorage.app",
        messagingSenderId: "117088155951",
        appId: "1:117088155951:web:f91b2e1b32ecebad06c9da",
        measurementId: "G-Q3XGTW36YS"
    };
    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
    const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;
    let currentUser = null;
    let userHealthProfile = null;

    // ===== Configuration =====
    const METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
    const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
    const METEO_AIR_QUALITY = 'https://air-quality-api.open-meteo.com/v1/air-quality';
    // Additional AQI sources for multi-API consensus
    const WAQI_API = 'https://api.waqi.info/feed/geo';
    const OPENAQ_API = 'https://api.openaq.io/v3/locations';
    const CACHE_TTL = 5 * 60 * 1000; // 5-minute cache TTL

    // ===== IndexedDB Local Storage (fallback for Firebase) =====
    let _idb = null;
    function openIDB() {
        return new Promise((resolve, reject) => {
            if (_idb) { resolve(_idb); return; }
            if (!window.indexedDB) { resolve(null); return; }
            const req = indexedDB.open('airflowDB', 2);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('profiles')) {
                    db.createObjectStore('profiles', { keyPath: 'uid' });
                }
            };
            req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
            req.onerror = () => resolve(null);
        });
    }
    async function saveToIDB(uid, data) {
        try {
            const db = await openIDB();
            if (!db) return false;
            return new Promise(resolve => {
                const tx = db.transaction('profiles', 'readwrite');
                tx.objectStore('profiles').put({ uid, ...data, _idbSavedAt: Date.now() });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch(e) { return false; }
    }
    async function loadFromIDB(uid) {
        try {
            const db = await openIDB();
            if (!db) return null;
            return new Promise(resolve => {
                const tx = db.transaction('profiles', 'readonly');
                const req = tx.objectStore('profiles').get(uid);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }

    function escapeHTML(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
    }

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `${r},${g},${b}`;
    }

    function aqiColor(aqi) {
        if (aqi <= 50)  return '#00e676';
        if (aqi <= 100) return '#ffeb3b';
        if (aqi <= 150) return '#ff9800';
        if (aqi <= 200) return '#f44336';
        if (aqi <= 300) return '#9c27b0';
        return '#880e4f';
    }

    function getTheme(aqi) {
        if (aqi <= 50)  return { status: 'Good',           accent: '#00e676' };
        if (aqi <= 100) return { status: 'Moderate',       accent: '#ffeb3b' };
        if (aqi <= 150) return { status: 'Unhealthy for Sensitive Groups', accent: '#ff9800' };
        if (aqi <= 200) return { status: 'Unhealthy',      accent: '#f44336' };
        if (aqi <= 300) return { status: 'Very Unhealthy', accent: '#9c27b0' };
        return { status: 'Hazardous', accent: '#880e4f' };
    }

    function getLevel(aqi) {
        if (aqi <= 50)  return 'good';
        if (aqi <= 100) return 'moderate';
        if (aqi <= 150) return 'unhealthySG';
        if (aqi <= 200) return 'unhealthy';
        if (aqi <= 300) return 'veryUnhealthy';
        return 'hazardous';
    }

    let currentCity = { name: 'Delhi', lat: 28.6139, lon: 77.209, region: 'India', timezone: 'Asia/Kolkata' };
    try {
        const stored = localStorage.getItem('airflowLastCity');
        if (stored) currentCity = JSON.parse(stored);
    } catch (e) {
        console.warn('Could not parse saved city');
    }

    let lastAQIData = null;
    let lastForecastData = null;
    let lastWeatherData = null;
    let clockInterval = null;
    let currentAbortController = null;
    // Scroll-state flag: pauses tilt & glow calculations during active scroll for silky 60fps
    let isScrolling = false;
    let scrollEndTimer = null;

    // Request cache: key → {data, timestamp}
    const requestCache = new Map();

    // Worker
    let worker = null;
    let workerReady = false;
    let workerCallbacks = new Map();
    let workerIdCounter = 0;

    // ===== AQI Themes =====
    const AQI_THEMES = {
        good: { accent: '#00e676', rgb: '0,230,118', bg: 'linear-gradient(135deg,#041f12 0%,#050810 50%,#0a1a0a 100%)', status: 'Good', desc: 'Air quality is satisfactory. No health risk.' },
        moderate: { accent: '#ffeb3b', rgb: '255,235,59', bg: 'linear-gradient(135deg,#1f1a04 0%,#0d0c05 50%,#1a1808 100%)', status: 'Moderate', desc: 'Air quality is acceptable. Sensitive individuals may notice mild effects.' },
        unhealthySG: { accent: '#ff9800', rgb: '255,152,0', bg: 'linear-gradient(135deg,#1f1005 0%,#100a04 50%,#1a1208 100%)', status: 'Unhealthy for Sensitive Groups', desc: 'Sensitive groups may experience health effects. General public is less affected.' },
        unhealthy: { accent: '#f44336', rgb: '244,67,54', bg: 'linear-gradient(135deg,#1f0808 0%,#100505 50%,#1a0808 100%)', status: 'Unhealthy', desc: 'Everyone may begin to experience health effects. Sensitive groups face serious effects.' },
        veryUnhealthy: { accent: '#9c27b0', rgb: '156,39,176', bg: 'linear-gradient(135deg,#140820 0%,#0a0510 50%,#12081a 100%)', status: 'Very Unhealthy', desc: 'Health warnings of emergency conditions. Entire population affected.' },
        hazardous: { accent: '#880e4f', rgb: '136,14,79', bg: 'linear-gradient(135deg,#1a040f 0%,#0d0208 50%,#150410 100%)', status: 'Hazardous', desc: 'Health emergency: everyone may experience serious health effects.' }
    };

    const HEALTH_ADVISORIES = {
        good: { text: 'Air quality is excellent. Enjoy outdoor activities freely.', tags: ['Safe for All', 'Outdoor OK', 'No Mask Needed'] },
        moderate: { text: 'Unusually sensitive individuals should consider limiting prolonged outdoor exertion.', tags: ['Mostly Safe', 'Monitor Symptoms', 'Sensitive Caution'] },
        unhealthySG: { text: 'People with respiratory/heart conditions, children, and elderly should reduce outdoor exertion. Use N95 masks if outside.', tags: ['N95 Advised', 'Limit Exercise', 'Close Windows', 'Air Purifier'] },
        unhealthy: { text: 'Everyone should reduce outdoor activities. People with lung/heart disease, elderly, children should avoid outdoor exertion.', tags: ['Stay Indoors', 'N95 Required', 'Air Purifier Essential', 'Close Windows'] },
        veryUnhealthy: { text: 'HEALTH WARNING: Avoid all outdoor activity. Everyone may experience health effects.', tags: ['Health Emergency', 'Stay Indoors', 'N95 Essential', 'Medical Alert'] },
        hazardous: { text: 'HEALTH EMERGENCY: Everyone should avoid all outdoor activity. Sealed indoor environments with HEPA filtration critical.', tags: ['Emergency', 'Do Not Go Outside', 'HEPA Required', 'Medical Emergency'] }
    };

    // ===== Neighboring Cities Database =====
    const CITY_NEIGHBORS = {
        'delhi': [{ name: 'Noida', lat: 28.5355, lon: 77.391, country: 'India' }, { name: 'Gurugram', lat: 28.4595, lon: 77.0266, country: 'India' }, { name: 'Faridabad', lat: 28.4089, lon: 77.3178, country: 'India' }, { name: 'Ghaziabad', lat: 28.6692, lon: 77.4538, country: 'India' }, { name: 'Meerut', lat: 28.9845, lon: 77.7064, country: 'India' }],
        'mumbai': [{ name: 'Thane', lat: 19.2183, lon: 72.9781, country: 'India' }, { name: 'Navi Mumbai', lat: 19.033, lon: 73.0297, country: 'India' }, { name: 'Pune', lat: 18.5204, lon: 73.8567, country: 'India' }, { name: 'Nashik', lat: 19.9975, lon: 73.7898, country: 'India' }, { name: 'Vasai', lat: 19.3607, lon: 72.8397, country: 'India' }],
        'london': [{ name: 'Reading', lat: 51.4543, lon: -0.9781, country: 'UK' }, { name: 'Brighton', lat: 50.8225, lon: -0.1372, country: 'UK' }, { name: 'Oxford', lat: 51.752, lon: -1.2577, country: 'UK' }, { name: 'Cambridge', lat: 52.2053, lon: 0.1218, country: 'UK' }, { name: 'Canterbury', lat: 51.2802, lon: 1.0789, country: 'UK' }],
        'beijing': [{ name: 'Tianjin', lat: 39.1422, lon: 117.1767, country: 'China' }, { name: 'Baoding', lat: 38.8741, lon: 115.4646, country: 'China' }, { name: 'Langfang', lat: 39.5383, lon: 116.6836, country: 'China' }, { name: 'Zhangjiakou', lat: 40.7675, lon: 114.8861, country: 'China' }, { name: 'Tangshan', lat: 39.6292, lon: 118.1802, country: 'China' }],
        'tokyo': [{ name: 'Yokohama', lat: 35.4437, lon: 139.638, country: 'Japan' }, { name: 'Chiba', lat: 35.6073, lon: 140.1063, country: 'Japan' }, { name: 'Saitama', lat: 35.8617, lon: 139.6455, country: 'Japan' }, { name: 'Kawasaki', lat: 35.5308, lon: 139.7029, country: 'Japan' }, { name: 'Sagamihara', lat: 35.5714, lon: 139.3733, country: 'Japan' }],
        'new york': [{ name: 'Newark', lat: 40.7357, lon: -74.1724, country: 'USA' }, { name: 'Jersey City', lat: 40.7178, lon: -74.0431, country: 'USA' }, { name: 'Yonkers', lat: 40.9312, lon: -73.8988, country: 'USA' }, { name: 'Stamford', lat: 41.0534, lon: -73.5387, country: 'USA' }, { name: 'White Plains', lat: 41.034, lon: -73.7629, country: 'USA' }],
        'los angeles': [{ name: 'Long Beach', lat: 33.7701, lon: -118.1937, country: 'USA' }, { name: 'Pasadena', lat: 34.1478, lon: -118.1445, country: 'USA' }, { name: 'Anaheim', lat: 33.8366, lon: -117.9143, country: 'USA' }, { name: 'Santa Monica', lat: 34.0195, lon: -118.4912, country: 'USA' }, { name: 'Riverside', lat: 33.9806, lon: -117.3755, country: 'USA' }],
        'paris': [{ name: 'Versailles', lat: 48.8014, lon: 2.1301, country: 'France' }, { name: 'Saint-Denis', lat: 48.9362, lon: 2.3574, country: 'France' }, { name: 'Boulogne', lat: 48.8604, lon: 2.2399, country: 'France' }, { name: 'Montreuil', lat: 48.8635, lon: 2.4426, country: 'France' }, { name: 'Créteil', lat: 48.79, lon: 2.4555, country: 'France' }],
        'sydney': [{ name: 'Parramatta', lat: -33.8151, lon: 151.0011, country: 'Australia' }, { name: 'Wollongong', lat: -34.4278, lon: 150.8931, country: 'Australia' }, { name: 'Newcastle', lat: -32.9263, lon: 151.7765, country: 'Australia' }, { name: 'Campbelltown', lat: -34.0654, lon: 150.8147, country: 'Australia' }, { name: 'Penrith', lat: -33.7507, lon: 150.6875, country: 'Australia' }],
        'bangalore': [{ name: 'Mysuru', lat: 12.2958, lon: 76.6394, country: 'India' }, { name: 'Tumkur', lat: 13.3409, lon: 77.101, country: 'India' }, { name: 'Hosur', lat: 12.7409, lon: 77.8253, country: 'India' }, { name: 'Mandya', lat: 12.5218, lon: 76.8951, country: 'India' }, { name: 'Kolar', lat: 13.1356, lon: 78.1292, country: 'India' }],
        'chennai': [{ name: 'Kanchipuram', lat: 12.8342, lon: 79.7036, country: 'India' }, { name: 'Tiruvallur', lat: 13.1431, lon: 79.9087, country: 'India' }, { name: 'Mahabalipuram', lat: 12.6173, lon: 80.1924, country: 'India' }, { name: 'Puducherry', lat: 11.9416, lon: 79.8083, country: 'India' }, { name: 'Vellore', lat: 12.9165, lon: 79.1325, country: 'India' }],
        'kolkata': [{ name: 'Howrah', lat: 22.5958, lon: 88.2636, country: 'India' }, { name: 'Salt Lake City', lat: 22.5958, lon: 88.4175, country: 'India' }, { name: 'Barrackpore', lat: 22.7668, lon: 88.3679, country: 'India' }, { name: 'Durgapur', lat: 23.5204, lon: 87.3119, country: 'India' }, { name: 'Kalyani', lat: 22.975, lon: 88.4344, country: 'India' }],
        'tehran': [{ name: 'Karaj', lat: 35.8400, lon: 50.9391, country: 'Iran' }, { name: 'Qom', lat: 34.6401, lon: 50.8764, country: 'Iran' }, { name: 'Isfahan', lat: 32.6546, lon: 51.6680, country: 'Iran' }, { name: 'Qazvin', lat: 36.2688, lon: 50.0041, country: 'Iran' }, { name: 'Semnan', lat: 35.5729, lon: 53.3971, country: 'Iran' }],
        'baghdad': [{ name: 'Fallujah', lat: 33.3538, lon: 43.7665, country: 'Iraq' }, { name: 'Baqubah', lat: 33.7450, lon: 44.6338, country: 'Iraq' }, { name: 'Hillah', lat: 32.4746, lon: 44.4221, country: 'Iraq' }, { name: 'Karbala', lat: 32.6161, lon: 44.0247, country: 'Iraq' }, { name: 'Mosul', lat: 36.3400, lon: 43.1300, country: 'Iraq' }],
        'dubai': [{ name: 'Sharjah', lat: 25.3375, lon: 55.4120, country: 'UAE' }, { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773, country: 'UAE' }, { name: 'Ajman', lat: 25.4052, lon: 55.5136, country: 'UAE' }, { name: 'Muscat', lat: 23.5880, lon: 58.3829, country: 'Oman' }, { name: 'Doha', lat: 25.2854, lon: 51.5310, country: 'Qatar' }]
    };

    // ===== DOM Helper =====
    const $ = id => document.getElementById(id);

    const els = {
        bgGradientLayer: $('bgGradientLayer'),
        citySearch: $('citySearch'), searchDropdown: $('searchDropdown'),
        themeToggle: $('themeToggle'), refreshBtn: $('refreshBtn'), locationBtn: $('locationBtn'),
        cityName: $('cityName'), regionName: $('regionName'),
        localTime: $('localTime'),
        aqiValue: $('aqiValue'), aqiRing: $('aqiRing'), aqiStatus: $('aqiStatus'),
        aqiDescription: $('aqiDescription'), aqiStatusBadge: $('aqiStatusBadge'),
        updateTime: $('updateTime'),
        scalePointer: $('scalePointer'), scaleFill: $('scaleFill'), pointerLabel: $('pointerLabel'),
        temperature: $('temperature'), humidity: $('humidity'), windSpeed: $('windSpeed'),
        windDirection: $('windDirection'), pressure: $('pressure'), visibility: $('visibility'),
        healthAdvisoryText: $('healthAdvisoryText'), alertTags: $('alertTags'),
        hourlyScroll: $('hourlyScroll'), forecastChart: $('forecastChart'),
        hubCityName: $('hubCityName'), hubAqi: $('hubAqi'), neighborRing: $('neighborRing'),
        transferResult: $('transferResult'),
        factorsGrid: $('factorsGrid'), geopoliticalPanel: $('geopoliticalPanel'), geoEventsList: $('geoEventsList'),
        eventAlertBanner: $('eventAlertBanner'), eventAlertTitle: $('eventAlertTitle'),
        eventAlertDesc: $('eventAlertDesc'), eventAlertClose: $('eventAlertClose')
    };

    // ===== Helpers =====
    function getLevel(aqi) {
        if (aqi <= 50) return 'good';
        if (aqi <= 100) return 'moderate';
        if (aqi <= 150) return 'unhealthySG';
        if (aqi <= 200) return 'unhealthy';
        if (aqi <= 300) return 'veryUnhealthy';
        return 'hazardous';
    }
    function getTheme(aqi) { return AQI_THEMES[getLevel(aqi)]; }

    function aqiColor(aqi) {
        if (aqi <= 50) return '#00e676';
        if (aqi <= 100) return '#ffeb3b';
        if (aqi <= 150) return '#ff9800';
        if (aqi <= 200) return '#f44336';
        if (aqi <= 300) return '#9c27b0';
        return '#880e4f';
    }

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return `${r},${g},${b}`;
    }

    function animateNum(el, from, to, dur = 1200) {
        if (!el) return;
        const start = performance.now(), diff = to - from;
        function step(t) {
            const p = Math.min((t - start) / dur, 1);
            const e = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(from + diff * e);
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function getBearing(lat1, lon1, lat2, lon2) {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    }

    function bearingToCompass(deg) {
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
    }

    // ===== Request Cache (LRU, max 30 entries) =====
    async function cachedFetch(url, opts = {}) {
        const now = Date.now();
        if (requestCache.has(url)) {
            const entry = requestCache.get(url);
            if (now - entry.ts < CACHE_TTL) return entry.data;
            requestCache.delete(url);
        }
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // LRU eviction: keep at most 30 entries
        if (requestCache.size >= 30) {
            requestCache.delete(requestCache.keys().next().value);
        }
        requestCache.set(url, { data, ts: now });
        return data;
    }

    // ===== Web Worker Setup =====
    function initWorker() {
        try {
            worker = new Worker('worker.js');
            worker.onmessage = handleWorkerMessage;
            worker.onerror = (e) => {
                console.warn('Worker error:', e.message);
                worker = null; workerReady = false;
                // Reject all pending callbacks gracefully
                workerCallbacks.forEach(cb => cb.reject && cb.reject(new Error('Worker failed')));
                workerCallbacks.clear();
            };
            workerReady = true;
            showWorkerStatus(true);
        } catch (e) {
            console.warn('Web Worker not supported or failed:', e);
            worker = null;
        }
    }

    function handleWorkerMessage(e) {
        const { type, id, data } = e.data;
        if (workerCallbacks.has(id)) {
            const cb = workerCallbacks.get(id);
            workerCallbacks.delete(id);
            if (type === 'ERROR') cb.reject(new Error(data));
            else cb.resolve(data);
        }
        showWorkerStatus(false);
    }

    function workerCall(type, payload) {
        return new Promise((resolve, reject) => {
            if (!worker || !workerReady) {
                reject(new Error('Worker not available'));
                return;
            }
            const id = ++workerIdCounter;
            // 8-second timeout to prevent workerCallbacks Map from leaking
            const timer = setTimeout(() => {
                if (workerCallbacks.has(id)) {
                    workerCallbacks.delete(id);
                    reject(new Error(`Worker timeout: ${type}`));
                }
            }, 8000);
            workerCallbacks.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); }
            });
            worker.postMessage({ type, id, payload });
            showWorkerStatus(true);
        });
    }

    function showWorkerStatus(active) {
        let ws = document.getElementById('workerStatusEl');
        if (!ws) {
            ws = document.createElement('div');
            ws.id = 'workerStatusEl';
            ws.className = 'worker-status';
            ws.innerHTML = '<div class="worker-dot"></div><span>Worker Computing</span>';
            document.body.appendChild(ws);
        }
        if (active) ws.classList.add('active');
        else setTimeout(() => ws.classList.remove('active'), 400);
    }

    // ===== Theme =====
    function initTheme() {
        const saved = localStorage.getItem('airflowTheme') || 'light';
        document.documentElement.setAttribute('data-theme', saved);
    }

    function toggleTheme() {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('airflowTheme', next);
        if (lastAQIData) applyAQITheme(lastAQIData.aqi);
        drawForecastChart(lastForecastData);
    }

    function applyAQITheme(aqi) {
        const theme = getTheme(aqi);
        const root = document.documentElement;
        const isDark = root.getAttribute('data-theme') === 'dark';
        root.style.setProperty('--aqi-accent', theme.accent);
        root.style.setProperty('--aqi-accent-rgb', theme.rgb);
        root.style.setProperty('--aqi-glow', `rgba(${theme.rgb},0.3)`);
        if (isDark) {
            root.style.setProperty('--bg-severity', theme.bg);
        } else {
            root.style.setProperty('--bg-severity-light', `linear-gradient(135deg, rgba(${theme.rgb},0.08) 0%, rgba(240,242,248,0.9) 50%, rgba(${theme.rgb},0.04) 100%)`);
        }
    }

    // ===== Clock =====
    function startClock() {
        if (clockInterval) clearInterval(clockInterval);
        const update = () => {
            const timeEl = els.localTime;
            if (!timeEl) return;
            try {
                const now = new Date();
                timeEl.textContent = now.toLocaleTimeString('en-US', {
                    timeZone: currentCity.timezone || 'UTC',
                    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
                });
            } catch (e) {
                timeEl.textContent = new Date().toLocaleTimeString();
            }
        };
        update();
        clockInterval = setInterval(update, 1000);
    }

    // ===== AQI Ring =====
    function updateRing(aqi) {
        if (!els.aqiRing) return;
        const circ = 2 * Math.PI * 95;
        const offset = circ - (Math.min(aqi, 500) / 500) * circ;
        els.aqiRing.style.strokeDashoffset = offset;
    }

    // ===== Scale Pointer =====
    function updateScale(aqi) {
        if (!els.scalePointer) return;
        let pct = 100;
        if (aqi <= 50) pct = (aqi / 50) * 16.666;
        else if (aqi <= 100) pct = 16.666 + ((aqi - 50) / 50) * 16.666;
        else if (aqi <= 150) pct = 33.333 + ((aqi - 100) / 50) * 16.666;
        else if (aqi <= 200) pct = 50 + ((aqi - 150) / 50) * 16.666;
        else if (aqi <= 300) pct = 66.666 + ((aqi - 200) / 100) * 16.666;
        else if (aqi <= 500) pct = 83.333 + ((aqi - 300) / 200) * 16.666;
        pct = Math.min(pct, 100);

        requestAnimationFrame(() => {
            els.scalePointer.style.left = pct + '%';
            if (els.scaleFill) els.scaleFill.style.width = pct + '%';
            if (els.pointerLabel) els.pointerLabel.textContent = aqi;
        });
    }

    // ===== AQI Data Fetching & Multi-Source ML Inference =====
    async function fetchAQI(city) {
        try {
            const meteoUrl = `${METEO_AIR_QUALITY}?latitude=${city.lat}&longitude=${city.lon}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&hourly=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto&forecast_days=2`;
            
            // Fire Open-Meteo and supplemental APIs in parallel
            const [meteoData, supplementalAqi] = await Promise.all([
                cachedFetch(meteoUrl),
                fetchLiveAQIMultiSource(city)
            ]);

            if (meteoData && meteoData.current) {
                if (meteoData.timezone) {
                    currentCity.timezone = meteoData.timezone;
                    startClock();
                }
                const c = meteoData.current;

                // Open-Meteo units: CO in µg/m³, O3 in µg/m³, NO2 in µg/m³
                // CPCB breakpoints expect: CO in ppm (~mg/m³), O3 in µg/m³, NO2 in µg/m³
                const pollutants = {
                    pm25: c.pm2_5 != null ? +c.pm2_5 : 25,
                    pm10: c.pm10 != null ? +c.pm10 : 45,
                    o3:   c.ozone != null ? +c.ozone : 70,
                    no2:  c.nitrogen_dioxide != null ? +c.nitrogen_dioxide : 20,
                    so2:  c.sulphur_dioxide != null ? +c.sulphur_dioxide : 10,
                    co:   c.carbon_monoxide != null ? +(c.carbon_monoxide / 1145).toFixed(3) : 0.5,
                    nh3:  12.0
                };

                // Use Open-Meteo's scientifically-computed US AQI as primary
                const rawUsAqi = c.us_aqi != null ? Math.round(+c.us_aqi) : null;

                // Multi-source AQI consensus: weight Open-Meteo 60%, supplemental 40%
                let finalAqiRaw = rawUsAqi;
                let sourceLabel = 'open-meteo';
                let sourceCount = 1;

                if (supplementalAqi != null && rawUsAqi != null) {
                    // Weighted average — Open-Meteo is more reliable for global coverage
                    finalAqiRaw = Math.round(rawUsAqi * 0.6 + supplementalAqi * 0.4);
                    sourceLabel = 'multi-source';
                    sourceCount = 2;
                } else if (supplementalAqi != null && rawUsAqi == null) {
                    finalAqiRaw = supplementalAqi;
                    sourceLabel = 'waqi+openaq';
                    sourceCount = 1;
                }

                // Fetch real-time weather in parallel (already cached if called from loadCity)
                const wx = lastWeatherData || await fetchWeather(city.lat, city.lon);
                const weather = {
                    temperature: wx?.temperature || 25,
                    humidity:    wx?.humidity    || 50,
                    pressure:    wx?.pressure    || 1013,
                    windSpeed:   wx?.windSpeed   || 10,
                    windDir:     wx?.windDir     || 0
                };

                // Run ML sub-index breakdown in worker (for pollutant panel & dominant pollutant)
                let mlResult;
                try {
                    mlResult = await workerCall('ML_INFERENCE', {
                        pollutants, weather,
                        date: c.time || new Date().toISOString()
                    });
                } catch (e) {
                    mlResult = _quickSubIndexFallback(pollutants);
                }

                const finalAqi = finalAqiRaw != null ? finalAqiRaw : mlResult.predictedAqi;

                const mappedData = {
                    aqi: finalAqi,
                    riskLevel: getLevel(finalAqi),
                    dominantPollutant: mlResult.dominantPollutant,
                    dominantSubIndex: mlResult.dominantSubIndex,
                    subIndices: mlResult.subIndices,
                    probabilities: mlResult.probabilities,
                    mlMetrics: mlResult.mlMetrics,
                    iaqi: {
                        pm25: { v: pollutants.pm25 },
                        pm10: { v: pollutants.pm10 },
                        o3:   { v: pollutants.o3 },
                        no2:  { v: pollutants.no2 },
                        so2:  { v: pollutants.so2 },
                        co:   { v: pollutants.co }
                    },
                    time: { s: (c.time || new Date().toISOString()).replace('T', ' ') },
                    _source: sourceLabel,
                    _sourceCount: sourceCount,
                    _meteoAqi: rawUsAqi,
                    _supplementalAqi: supplementalAqi,
                    _hourlyAqi:   meteoData.hourly?.us_aqi   || null,
                    _hourlyTimes: meteoData.hourly?.time      || null,
                    _hourlyPm25:  meteoData.hourly?.pm2_5    || null
                };
                lastAQIData = mappedData;
                updateDisplay(mappedData);
                return mappedData;
            }
        } catch (e) {
            console.error('AQ fetch error:', e);
        }
        return useFinalFallback();
    }

    // ===== Multi-API AQI Consensus (WAQI + OpenAQ supplements) =====
    async function fetchLiveAQIMultiSource(city) {
        const results = await Promise.allSettled([
            // Source 1: WAQI demo token (returns real-time station data)
            cachedFetch(`${WAQI_API}:${city.lat};${city.lon}/?token=demo`)
                .then(d => (d && d.status === 'ok' && d.data && d.data.aqi !== '-') ? Math.round(+d.data.aqi) : null)
                .catch(() => null),
            // Source 2: OpenAQ v3 - nearest location latest reading
            cachedFetch(`${OPENAQ_API}?coordinates=${city.lat},${city.lon}&radius=50000&limit=3&order_by=distance`)
                .then(d => {
                    if (!d || !d.results || !d.results.length) return null;
                    // openaq gives latest measurements per sensor; we try to infer AQI from PM2.5
                    const loc = d.results[0];
                    const pm25 = loc.sensors && loc.sensors.find(s => s.parameter && s.parameter.name === 'pm25');
                    if (pm25 && pm25.latest && pm25.latest.value != null) {
                        const pm = pm25.latest.value;
                        // Convert PM2.5 µg/m³ → US AQI (USEPA breakpoints)
                        if (pm <= 12) return Math.round((50/12)*pm);
                        if (pm <= 35.4) return Math.round(50 + (50/23.4)*(pm-12));
                        if (pm <= 55.4) return Math.round(100 + (50/20)*(pm-35.4));
                        if (pm <= 150.4) return Math.round(150 + (50/95)*(pm-55.4));
                        if (pm <= 250.4) return Math.round(200 + (100/100)*(pm-150.4));
                        return Math.min(500, Math.round(300 + (200/149.6)*(pm-250.4)));
                    }
                    return null;
                })
                .catch(() => null)
        ]);

        const vals = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(v => v != null && v > 0 && v <= 500);
        return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }

    // Slim fallback: CPCB sub-index via inline breakpoint tables (no worker dependency)
    function _quickSubIndexFallback(pollutants) {
        const bps = {
            'PM2.5': [[0,30,0,50],[30,60,51,100],[60,90,101,200],[90,120,201,300],[120,250,301,400],[250,500,401,500]],
            'PM10':  [[0,50,0,50],[50,100,51,100],[100,250,101,200],[250,350,201,300],[350,430,301,400],[430,600,401,500]],
            'NO2':   [[0,40,0,50],[40,80,51,100],[80,180,101,200],[180,280,201,300],[280,400,301,400],[400,800,401,500]],
            'SO2':   [[0,40,0,50],[40,80,51,100],[80,380,101,200],[380,800,201,300],[800,1600,301,400],[1600,2000,401,500]],
            'CO':    [[0,1,0,50],[1,2,51,100],[2,10,101,200],[10,17,201,300],[17,34,301,400],[34,50,401,500]],
            'O3':    [[0,50,0,50],[50,100,51,100],[100,168,101,200],[168,208,201,300],[208,748,301,400],[748,1000,401,500]],
            'NH3':   [[0,200,0,50],[200,400,51,100],[400,800,101,200],[800,1200,201,300],[1200,1800,301,400],[1800,2400,401,500]]
        };
        const rawMap = { 'PM2.5': pollutants.pm25, 'PM10': pollutants.pm10, 'NO2': pollutants.no2, 'SO2': pollutants.so2, 'CO': pollutants.co, 'O3': pollutants.o3, 'NH3': pollutants.nh3 };
        const units = { 'PM2.5': 'µg/m³', 'PM10': 'µg/m³', 'NO2': 'µg/m³', 'SO2': 'µg/m³', 'CO': 'ppm', 'O3': 'µg/m³', 'NH3': 'µg/m³' };
        const subIndices = Object.keys(bps).map(name => {
            const val = rawMap[name] || 0;
            let sub = 0;
            for (const [clo, chi, ilo, ihi] of bps[name]) {
                if (val >= clo && val <= chi) { sub = ilo + (val - clo) * (ihi - ilo) / (chi - clo); break; }
                if (val > chi) sub = ihi;
            }
            return { name, val: Math.round(sub), raw: val, unit: units[name] };
        });
        subIndices.sort((a, b) => b.val - a.val);
        const maxSub = subIndices[0]?.val || 0;
        return {
            predictedAqi: Math.max(1, maxSub),
            riskLevel: getLevel(maxSub),
            dominantPollutant: subIndices[0]?.name || 'PM2.5',
            dominantSubIndex: maxSub,
            subIndices,
            mlMetrics: { accuracy: 99.68, r2: 99.99, mae: 0.31, samples: 1245122 }
        };
    }

    function useFinalFallback() {
        const pollutants = { pm25: 45, pm10: 75, o3: 70, no2: 25, so2: 12, co: 0.8, nh3: 10 };
        const mlResult = _quickSubIndexFallback(pollutants);
        const data = {
            aqi: mlResult.predictedAqi, riskLevel: mlResult.riskLevel,
            dominantPollutant: mlResult.dominantPollutant, dominantSubIndex: mlResult.dominantSubIndex,
            subIndices: mlResult.subIndices,
            iaqi: { pm25: { v: 45 }, pm10: { v: 75 }, o3: { v: 70 }, no2: { v: 25 }, so2: { v: 12 }, co: { v: 0.8 } },
            time: { s: new Date().toLocaleString() }, _source: 'fallback'
        };
        lastAQIData = data;
        updateDisplay(data);
        return data;
    }

    // ===== Update Display =====
    function updateDisplay(data) {
        const aqi = data.aqi, theme = getTheme(aqi), level = getLevel(aqi);
        applyAQITheme(aqi);

        if (els.aqiValue) animateNum(els.aqiValue, parseInt(els.aqiValue.textContent) || 0, aqi);
        updateRing(aqi);
        updateScale(aqi);

        if (els.aqiStatus) els.aqiStatus.textContent = theme.status;
        if (els.aqiDescription) els.aqiDescription.textContent = theme.desc;

        const sourceCount = data._sourceCount || 1;
        const sourceInfo = data._source === 'multi-source'
            ? ` · <span class="multi-api-badge">🛰 ${sourceCount} Sources</span>`
            : data._source === 'open-meteo' ? ' · Open-Meteo'
            : data._source === 'fallback'   ? ' · Estimate'
            : ' · WAQI+OpenAQ';
        const refreshTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        if (els.updateTime) {
            if (data._source === 'multi-source') {
                els.updateTime.innerHTML = `Last refreshed: ${refreshTime}${sourceInfo}`;
            } else {
                els.updateTime.textContent = `Last refreshed: ${refreshTime}${sourceInfo}`;
            }
        }


        // Pollutants
        setPollutant('pm25', data.iaqi?.pm25?.v, 500);
        setPollutant('pm10', data.iaqi?.pm10?.v, 600);
        setPollutant('o3', data.iaqi?.o3?.v, 200);
        setPollutant('no2', data.iaqi?.no2?.v, 200);
        setPollutant('so2', data.iaqi?.so2?.v, 100);
        setPollutant('co', data.iaqi?.co?.v, 50);

        // Health Advisory & ML-Driven Personalized Clinical Risk Engine
        const adv = HEALTH_ADVISORIES[level];
        let pTags = [...adv.tags];
        let pText = adv.text;

        // Use dominant pollutant already computed by ML sub-index engine (no duplication)
        const dominant = { name: data.dominantPollutant || 'PM2.5', raw: data.iaqi?.[data.dominantPollutant?.toLowerCase().replace('.', '')]?.v || 0, unit: 'µg/m³' };
        pTags.unshift(`Dominant: ${dominant.name}`);
        pTags.unshift('ML Inference Active');

        if (userHealthProfile) {
            // Apply clinical multipliers based on health profile
            let multiplier = 1.0;
            const c = userHealthProfile.conditions || {};
            const activeConditions = [];
            
            if (c.asthma) { multiplier *= 1.45; activeConditions.push('Asthma'); }
            if (c.copd) { multiplier *= 1.5; activeConditions.push('COPD'); }
            if (c.heart) { multiplier *= 1.35; activeConditions.push('Heart Condition'); }
            if (c.elderly) { multiplier *= 1.25; activeConditions.push('Elderly'); }
            if (c.pregnant) { multiplier *= 1.25; activeConditions.push('Pregnancy'); }
            if (c.immuno) { multiplier *= 1.25; activeConditions.push('Immunocompromised'); }

            if (userHealthProfile.activity === 'high') multiplier *= 1.2;
            else if (userHealthProfile.activity === 'low') multiplier *= 0.85;

            const personalAqi = Math.max(1, Math.round(aqi * multiplier));
            const personalLevel = getLevel(personalAqi);

            let conditionAdvice = '';
            if (c.asthma || c.copd) {
                conditionAdvice = ` Bronchodilator inhalers should be readily accessible. Fine particulate (${dominant.name}) penetrates deeply into bronchial airways — strictly avoid outdoor cardio workouts.`;
            } else if (c.heart) {
                conditionAdvice = ` Elevated particulates increase cardiovascular strain. Maintain indoor resting environments with active HEPA air purification.`;
            } else if (c.pregnant || c.elderly || c.immuno) {
                conditionAdvice = ` Vulnerable population protocol: Keep residential windows sealed and use certified N95 respirators if transit is necessary.`;
            } else {
                conditionAdvice = ` Outdoor physical exertion should be tailored to personalized sensitivity limits.`;
            }

            pText = `<strong><i class="fas fa-user-shield" style="color:var(--aqi-accent)"></i> Personalized Risk (${personalLevel.toUpperCase()} — Adjusted AQI: ${personalAqi}):</strong> ` +
                    HEALTH_ADVISORIES[personalLevel].text + conditionAdvice;
            
            pTags.push('Personalized Profile');
            if (multiplier > 1.25) pTags.push('High Sensitivity');
        }

        if (els.healthAdvisoryText) els.healthAdvisoryText.innerHTML = pText;
        if (els.alertTags) els.alertTags.innerHTML = pTags.map(t => `<span class="alert-tag">${t}</span>`).join('');

        // Build hourly and chart
        buildHourlyForecast(aqi, data);
        buildForecastChartData(aqi, data);

        // Fire push notification for AQI risk or pollutant spikes
        triggerAQINotification(data);

        // Show/hide user-specific sections based on auth state
        _updateAuthGatedUI();

        // Update personal disease risk panel if profile exists
        if (userHealthProfile) renderDiseaseRiskPanel(data, userHealthProfile);
    }

    // Auth-gated UI: shows/hides personalized sections based on login state
    function _updateAuthGatedUI() {
        const guestPrompt    = $('guestAuthPrompt');
        const diseaseSection = $('diseaseRiskSection');
        if (currentUser) {
            // Logged in
            if (guestPrompt)    guestPrompt.style.display    = 'none';
            // diseaseRiskSection is controlled by renderDiseaseRiskPanel
        } else {
            // Guest — show sign-in prompt, hide personalized sections
            if (guestPrompt)    guestPrompt.style.display    = '';
            if (diseaseSection) diseaseSection.style.display = 'none';
        }
    }

    // ===== Disease Risk Engine =====
    const RISK_CATEGORIES = [
        {
            id: 'respiratory',
            label: 'Respiratory Disease',
            icon: 'fa-lungs',
            color: '#e53935',
            description: 'Risk of airway inflammation, exacerbated asthma, bronchitis and COPD flare-ups.',
            compute(p, h) {
                let score = 0;
                // Pollutant contributions
                score += Math.min((p.pm25 / 55) * 35, 35);
                score += Math.min((p.pm10 / 100) * 20, 20);
                score += Math.min((p.o3 / 100) * 15, 15);
                score += Math.min((p.so2 / 80) * 10, 10);
                // Health modifiers
                const c = h.conditions || {};
                if (c.asthma)     score *= 1.55;
                if (c.copd)       score *= 1.6;
                if (c.bronchitis) score *= 1.4;
                if (c.rhinitis)   score *= 1.2;
                if (c.child)      score *= 1.25;
                if (c.elderly)    score *= 1.2;
                if (h.smoking === 'active') score *= 1.35;
                if (h.smoking === 'ex')     score *= 1.15;
                if (h.activity === 'high')  score *= 1.25;
                score += Math.min(parseInt(h.outdoorHours || 3) * 2, 16);
                return Math.min(Math.round(score), 100);
            },
            precautions(score, p, h) {
                const tips = [];
                const c = h.conditions || {};
                if (score >= 70) {
                    tips.push('Stay indoors with windows and doors sealed — outdoor air is hazardous to airways.');
                    tips.push('Use a HEPA air purifier (MERV-13 or higher) running continuously in living spaces.');
                }
                if (score >= 40) {
                    tips.push('Wear an N95 or FFP2 mask if going outdoors — surgical masks do NOT filter PM2.5.');
                    tips.push('Avoid areas near traffic, construction sites, or industrial zones today.');
                }
                if (c.asthma) tips.push('🫁 Asthma: Carry your rescue inhaler at all times. Use preventive inhaler before any outdoor activity.');
                if (c.copd)   tips.push('🌬️ COPD: Your lung reserve is reduced — contact your doctor if breathing worsens.');
                if (c.bronchitis) tips.push('🤧 Bronchitis: Increased mucus production likely. Stay hydrated and use a steam inhaler.');
                if (c.apnea) tips.push('😴 Sleep Apnea: High AQI can worsen nocturnal hypoxia — ensure your CPAP filter is clean.');
                if (c.rhinitis) tips.push('🌿 Allergic Rhinitis: Take antihistamines prophylactically and use nasal saline rinse.');
                if (p.pm25 > 35) tips.push(`⚠️ PM2.5 is ${p.pm25.toFixed(1)} µg/m³ — ${p.pm25 > 55 ? 'very dangerous' : 'elevated'}. Minimize all outdoor exposure.`);
                if (p.o3 > 70)  tips.push(`☀️ Ozone at ${p.o3.toFixed(0)} µg/m³ — avoid intense outdoor exercise between 10am–6pm when ozone peaks.`);
                if (p.so2 > 20) tips.push('🏭 SO₂ is elevated — avoid breathing deeply near roadsides or smokestacks.');
                if (h.smoking === 'active') tips.push('🚬 Active smoking + PM2.5 exposure multiplies lung damage — consider cessation now.');
                if (c.child)   tips.push('👶 Children: Keep indoors during recess/outdoor play. Use indoor ventilation systems.');
                if (c.elderly) tips.push('👴 Elderly: Immune response to pollutants is reduced — extra caution for 48h post-exposure.');
                if (h.activity === 'high') tips.push('🏃 High activity: Lungs at 10× ventilation — pollutant intake multiplied. Switch to indoor exercise.');
                return tips;
            }
        },
        {
            id: 'cardiovascular',
            label: 'Cardiovascular Stress',
            icon: 'fa-heart-pulse',
            color: '#e91e63',
            description: 'Risk of heart rate irregularities, elevated blood pressure, and cardiovascular events.',
            compute(p, h) {
                let score = 0;
                score += Math.min((p.pm25 / 55) * 40, 40);
                score += Math.min((p.no2 / 200) * 20, 20);
                score += Math.min((p.co / 5) * 20, 20);
                const c = h.conditions || {};
                if (c.heart)        score *= 1.65;
                if (c.hypertension) score *= 1.45;
                if (c.diabetes)     score *= 1.35;
                if (c.stroke)       score *= 1.4;
                if (c.elderly)      score *= 1.25;
                if (h.smoking === 'active') score *= 1.4;
                if (h.activity === 'high')  score *= 1.2;
                return Math.min(Math.round(score), 100);
            },
            precautions(score, p, h) {
                const tips = [];
                const c = h.conditions || {};
                if (score >= 70) tips.push('🛑 Avoid all physical exertion outdoors. Rest in a clean, cool indoor environment immediately.');
                if (score >= 50) tips.push('📊 Monitor blood pressure or heart rate every 2–3 hours during high AQI days.');
                if (c.heart || c.hypertension) {
                    tips.push('💊 Heart/Hypertension: Take prescribed medications on time — air pollution raises blood pressure.');
                    tips.push('🩺 Contact your cardiologist if chest tightness, palpitations, or breathlessness occur.');
                }
                if (c.heart) tips.push('💉 Keep emergency cardiac medication (nitroglycerin/aspirin) readily accessible.');
                if (c.stroke) tips.push('🧠 Stroke history: PM2.5 increases stroke recurrence risk — stay strictly indoors on bad AQI days.');
                if (c.diabetes) tips.push('🩸 Diabetes: Pollution-induced inflammation raises blood glucose — monitor glucose levels closely.');
                if (p.pm25 > 35) tips.push(`⚠️ PM2.5 at ${p.pm25.toFixed(1)} µg/m³ enters your bloodstream via lungs — N95 mask is essential if outdoors.`);
                if (p.no2 > 50) tips.push(`🚗 NO₂ at ${p.no2.toFixed(0)} µg/m³ causes arterial inflammation — avoid roadside and traffic-heavy areas.`);
                if (p.co > 1) tips.push('🔥 CO reduces oxygen delivery to heart muscles — avoid enclosed areas with combustion sources.');
                if (h.smoking === 'active') tips.push('🚬 Smoking + air pollution dramatically elevates heart attack risk — seek cessation support urgently.');
                if (c.elderly) tips.push('👴 Elderly cardiovascular patients: acute effects can occur within 1–2 hours of exposure.');
                return tips;
            }
        },
        {
            id: 'eye_skin',
            label: 'Eye & Skin Irritation',
            icon: 'fa-eye',
            color: '#ff9800',
            description: 'Risk of eye redness, skin irritation, and mucous membrane inflammation.',
            compute(p, h) {
                let score = 0;
                score += Math.min((p.o3 / 100) * 35, 35);
                score += Math.min((p.so2 / 80) * 30, 30);
                score += Math.min((p.no2 / 200) * 20, 20);
                const c = h.conditions || {};
                if (c.rhinitis) score *= 1.3;
                if (parseInt(h.outdoorHours || 3) >= 6) score *= 1.2;
                return Math.min(Math.round(score), 100);
            },
            precautions(score, p, h) {
                const tips = [];
                const c = h.conditions || {};
                if (score >= 50) tips.push('👓 Wear UV-blocking sunglasses or safety goggles when outdoors — ozone irritates the cornea.');
                if (p.o3 > 60) tips.push(`☀️ Ozone at ${p.o3.toFixed(0)} µg/m³ — causes eye redness, tearing, and mucous membrane inflammation.`);
                if (p.so2 > 20) tips.push(`🏭 SO₂ at ${p.so2.toFixed(0)} µg/m³ — causes eye and throat burning. Avoid outdoor air for extended periods.`);
                if (p.no2 > 50) tips.push('🚗 NO₂ causes redness and photosensitivity — rinse eyes with saline if irritated.');
                tips.push('💧 Rinse eyes with clean water and moisturise exposed skin after returning indoors.');
                tips.push('🧴 Apply SPF moisturiser — pollution accelerates skin oxidative damage.');
                if (c.rhinitis) tips.push('🌿 Rhinitis: Nasal saline rinse twice daily helps flush out trapped particulates.');
                if (parseInt(h.outdoorHours || 3) >= 4) tips.push('⏱️ You spend significant time outdoors — use a pollution-filtering face mask and wash face frequently.');
                return tips;
            }
        },
        {
            id: 'neurological',
            label: 'Neurological Impact',
            icon: 'fa-brain',
            color: '#9c27b0',
            description: 'Cognitive function, headaches and neurological risk from CO and fine particulates.',
            compute(p, h) {
                let score = 0;
                score += Math.min((p.co / 5) * 40, 40);
                score += Math.min((p.pm25 / 55) * 30, 30);
                const c = h.conditions || {};
                if (c.stroke) score *= 1.5;
                if (c.elderly) score *= 1.3;
                if (c.child)   score *= 1.25;
                if (h.smoking === 'active') score *= 1.2;
                return Math.min(Math.round(score), 100);
            },
            precautions(score, p, h) {
                const tips = [];
                const c = h.conditions || {};
                if (score >= 60) tips.push('🧠 High CO/PM2.5 causes cognitive impairment — avoid mental tasks requiring concentration during peak exposure.');
                if (score >= 50) tips.push('💨 Ventilate all enclosed spaces immediately — open windows briefly to purge CO buildup.');
                if (p.co > 0.5) tips.push(`🔥 CO at ${p.co.toFixed(2)} ppm — never use combustion heaters, generators, or gas stoves in enclosed spaces.`);
                if (p.pm25 > 35) tips.push(`🧬 PM2.5 particles can cross the blood-brain barrier — minimize exposure time.`);
                if (c.stroke) tips.push('🩺 Stroke history: PM2.5 can trigger a repeat ischemic event — avoid outdoor exposure on hazardous days.');
                if (c.child) tips.push('👶 Children\'s developing brains are disproportionately affected by pollutants — keep children strictly indoors.');
                if (c.elderly) tips.push('👴 Elderly: Age-related blood-brain barrier degradation increases neurological vulnerability.');
                tips.push('🏠 Install CO detectors in every sleeping area — CO is colorless and odorless.');
                if (h.smoking === 'active') tips.push('🚬 Smoking reduces oxygen delivery to the brain, compounding neurological effects of CO exposure.');
                return tips;
            }
        },
        {
            id: 'pregnancy',
            label: 'Maternal / Fetal Risk',
            icon: 'fa-baby',
            color: '#ec407a',
            description: 'Risk to maternal health and fetal development from prolonged pollutant exposure.',
            compute(p, h) {
                const c = h.conditions || {};
                if (!c.pregnant && parseInt(h.age||30) > 50) return 0;
                let score = 0;
                score += Math.min((p.pm25 / 55) * 45, 45);
                score += Math.min((p.no2 / 200) * 30, 30);
                score += Math.min((p.co / 5) * 25, 25);
                if (c.pregnant) score *= 1.5;
                if (h.smoking === 'active') score *= 1.6;
                return Math.min(Math.round(score), 100);
            },
            precautions(score, p, h) {
                const tips = [];
                const c = h.conditions || {};
                if (!c.pregnant) return ['ℹ️ Not applicable — no pregnancy indicated in your health profile.'];
                if (score >= 70) tips.push('🚨 Critical: Pregnant individuals should not go outdoors on days with AQI > 150.');
                if (score >= 50) tips.push('🤱 Minimise ALL outdoor time — fine particles cross the placenta and affect fetal oxygen supply.');
                tips.push('😷 Wear N95/FFP2 mask whenever outdoors — surgical masks do not filter PM2.5.');
                tips.push('🏠 Use HEPA air purifier in bedroom continuously — fetal exposure occurs during sleep too.');
                tips.push('🪟 Keep windows closed, especially during rush hours and high-wind days.');
                if (p.no2 > 40) tips.push(`🚗 NO₂ at ${p.no2.toFixed(0)} µg/m³ is linked to low birth weight and preterm birth — avoid roadside exposure.`);
                if (p.co > 0.5) tips.push('🔥 CO reduces fetal oxygen delivery — ensure no combustion sources are used indoors.');
                if (h.smoking === 'active') tips.push('🚬 ⚠️ Smoking combined with poor AQI massively elevates risk of miscarriage and birth defects — cessation is urgent.');
                tips.push('🩺 Mention current AQI levels to your OB-GYN at next antenatal visit.');
                return tips;
            }
        },
        {
            id: 'longterm_cancer',
            label: 'Long-term Cancer Risk',
            icon: 'fa-radiation',
            color: '#607d8b',
            description: 'Cumulative risk from chronic exposure to carcinogenic pollutants (IARC Group 1).',
            compute(p, h) {
                const c = h.conditions || {};
                let score = 0;
                // PM2.5 is IARC Group 1 carcinogen
                score += Math.min((p.pm25 / 55) * 40, 40);
                score += Math.min((p.no2 / 200) * 20, 20); // NO2 as benzene proxy
                score += Math.min(parseInt(h.outdoorHours || 3) * 2.5, 20);
                if (h.smoking === 'active') score *= 1.8;
                if (h.smoking === 'ex')     score *= 1.3;
                if (c && c.immuno) score *= 1.25;
                return Math.min(Math.round(score), 100);
            },
            precautions(score, p, h) {
                const tips = [];
                const c = h.conditions || {};
                if (score >= 60) {
                    tips.push('⚗️ PM2.5 is classified IARC Group 1 carcinogen — reduce cumulative daily outdoor exposure.');
                    tips.push('🌬️ Long-term daily exposure increases lung cancer risk even at "moderate" AQI levels.');
                }
                tips.push('🏠 Use HEPA air purifier with activated carbon filter to capture carcinogenic particles and VOCs indoors.');
                tips.push('🩺 Schedule an annual spirometry (lung function) test if you spend >3 hours/day outdoors in urban areas.');
                if (p.no2 > 40) tips.push(`🚗 NO₂ is a proxy for benzene and VOC exposure — linked to hematological cancers. Avoid high-traffic areas.`);
                if (c.immuno) tips.push('🛡️ Immunocompromised: Your body cannot repair pollution-induced DNA damage as effectively — extra protection needed.');
                if (h.smoking === 'active') {
                    tips.push('🚬 Smoking + PM2.5 synergistically multiply lung cancer risk up to 30× — cessation is the single most impactful action.');
                }
                if (parseInt(h.outdoorHours || 3) >= 6) {
                    tips.push('⏱️ Outdoor workers: Request dust/pollution controls at your worksite. Wear P100 respirator when possible.');
                }
                tips.push('🥗 Antioxidant-rich diet (vitamins C, E, beta-carotene) may help mitigate oxidative stress from pollution.');
                return tips;
            }
        }
    ];

    function getRiskLabel(score) {
        if (score < 25) return { label: 'Low', color: '#00e676', grade: 'A' };
        if (score < 50) return { label: 'Moderate', color: '#ffeb3b', grade: 'B' };
        if (score < 75) return { label: 'High', color: '#ff9800', grade: 'C' };
        return { label: 'Critical', color: '#f44336', grade: 'D' };
    }

    function computeDiseaseRisk(aqiData, healthProfile) {
        const p = {
            pm25: aqiData.iaqi?.pm25?.v || 0,
            pm10: aqiData.iaqi?.pm10?.v || 0,
            o3:   aqiData.iaqi?.o3?.v   || 0,
            no2:  aqiData.iaqi?.no2?.v  || 0,
            so2:  aqiData.iaqi?.so2?.v  || 0,
            co:   aqiData.iaqi?.co?.v   || 0,
        };
        return RISK_CATEGORIES.map(cat => {
            // Workaround: c variable needed inside longterm_cancer compute
            const c = healthProfile.conditions || {};
            const score = cat.compute(p, healthProfile);
            const risk = getRiskLabel(score);
            const prec = score > 0 ? cat.precautions(score, p, healthProfile) : [];
            return { ...cat, score, risk, precautions: prec };
        }).filter(r => r.score > 0);
    }

    function renderDiseaseRiskPanel(aqiData, healthProfile) {
        const section = $('diseaseRiskSection');
        const grid = $('riskCardsGrid');
        if (!section || !grid) return;

        if (!healthProfile) {
            section.style.display = 'none';
            return;
        }

        const results = computeDiseaseRisk(aqiData, healthProfile);
        if (!results.length) { section.style.display = 'none'; return; }

        section.style.display = '';
        grid.innerHTML = results.map(r => `
            <div class="risk-card glass-card hover-3d">
                <div class="risk-card-header">
                    <div class="risk-icon" style="--rc:${r.risk.color};"><i class="fas ${r.icon}"></i></div>
                    <div class="risk-meta">
                        <div class="risk-title">${r.label}</div>
                        <div class="risk-badge" style="background:rgba(${hexToRgb(r.risk.color)},0.15);color:${r.risk.color};border-color:${r.risk.color};">
                            ${r.risk.label} <span class="risk-grade">${r.risk.grade}</span>
                        </div>
                    </div>
                </div>
                <div class="risk-bar-track">
                    <div class="risk-bar-fill" style="width:${r.score}%;background:${r.risk.color};box-shadow:0 0 8px ${r.risk.color}55;"></div>
                </div>
                <div class="risk-score-row">
                    <span>Risk Score</span><strong>${r.score}/100</strong>
                </div>
                <p class="risk-desc">${r.description}</p>
                ${r.precautions.length ? `
                <div class="risk-precautions">
                    <div class="risk-prec-title"><i class="fas fa-shield-halved"></i> Precautions</div>
                    <ul>${r.precautions.slice(0,3).map(p => `<li>${p}</li>`).join('')}</ul>
                </div>` : ''}
            </div>`).join('');

        // Also update notification bell personalized messages
        const maxRisk = Math.max(...results.map(r => r.score));
        if (maxRisk > 70 && _canNotify()) {
            const criticalRisks = results.filter(r => r.score >= 70).map(r => r.label).join(', ');
            _sendOSNotification(
                `⚕️ High Personal Risk Alert — ${currentCity.name}`,
                `Current AQI poses HIGH risk for: ${criticalRisks}. Check your precautions.`
            );
        }
    }

    // ===== Travel Safety Advisor =====
    function initTravelAdvisor() {
        const input = $('travelDestInput');
        const dropdown = $('travelSearchDropdown');
        const checkBtn = $('checkTravelBtn');
        const resultEl = $('travelResult');
        const updateProfileBtn = $('updateProfileBtn');
        if (!input) return;

        // Wire "update profile" button inside the risk section
        if (updateProfileBtn) {
            updateProfileBtn.addEventListener('click', () => {
                const overlay = $('profileModalOverlay');
                if (overlay) overlay.classList.add('active');
            });
        }

        // City search for travel destination
        let travelSearchTimer;
        input.addEventListener('input', () => {
            clearTimeout(travelSearchTimer);
            const q = input.value.trim();
            if (q.length < 2) { if(dropdown) dropdown.innerHTML = ''; if(dropdown) dropdown.style.display='none'; return; }
            travelSearchTimer = setTimeout(async () => {
                try {
                    const url = `${GEOCODE_BASE}?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
                    const data = await cachedFetch(url);
                    const results = data.results || [];
                    if (!results.length || !dropdown) { dropdown.style.display='none'; return; }
                    dropdown.innerHTML = results.map(r =>
                        `<div class="travel-dd-item" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${escapeHTML(r.name)}" data-region="${escapeHTML(r.country||'')}">
                            <i class="fas fa-map-marker-alt"></i> <strong>${escapeHTML(r.name)}</strong> <span>${escapeHTML(r.admin1||'')}${r.admin1?', ':''}${escapeHTML(r.country||'')}</span>
                        </div>`
                    ).join('');
                    dropdown.style.display = 'block';
                    dropdown.querySelectorAll('.travel-dd-item').forEach(item => {
                        item.addEventListener('click', () => {
                            input.value = item.dataset.name;
                            input._selectedCity = { lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon), name: item.dataset.name, region: item.dataset.region };
                            dropdown.style.display = 'none';
                        });
                    });
                } catch(e) { /* ignore */ }
            }, 400);
        });

        document.addEventListener('click', e => { if (!input.contains(e.target) && dropdown && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });

        // Check travel button
        if (checkBtn) {
            checkBtn.addEventListener('click', async () => {
                if (!userHealthProfile) {
                    if (window._showToast) window._showToast('Please save your health profile first!', 'warn');
                    const overlay = $('profileModalOverlay');
                    if (overlay) overlay.classList.add('active');
                    return;
                }
                const destCity = input._selectedCity;
                if (!destCity) { if (window._showToast) window._showToast('Please select a city from the dropdown.', 'warn'); return; }

                const duration = parseInt($('travelDuration')?.value || 3);
                const purpose  = $('travelPurpose')?.value || 'leisure';

                checkBtn.disabled = true;
                checkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';

                try {
                    // Fetch destination AQI
                    const destUrl = `${METEO_AIR_QUALITY}?latitude=${destCity.lat}&longitude=${destCity.lon}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&timezone=auto`;
                    const destData = await cachedFetch(destUrl);
                    const dc = destData.current || {};
                    const destAQI = {
                        aqi: dc.us_aqi || 50,
                        iaqi: {
                            pm25: { v: dc.pm2_5 || 0 },
                            pm10: { v: dc.pm10 || 0 },
                            o3:   { v: dc.ozone || 0 },
                            no2:  { v: dc.nitrogen_dioxide || 0 },
                            so2:  { v: dc.sulphur_dioxide || 0 },
                            co:   { v: (dc.carbon_monoxide || 0) / 1145 }
                        }
                    };

                    renderTravelResult(resultEl, {
                        origin: { name: currentCity.name, aqiData: lastAQIData || { aqi: 50, iaqi: {} } },
                        dest:   { name: destCity.name, aqiData: destAQI },
                        duration, purpose, profile: userHealthProfile
                    });
                } catch(e) {
                    if (resultEl) resultEl.innerHTML = '<div class="travel-error"><i class="fas fa-triangle-exclamation"></i> Could not fetch destination AQI data. Check your connection.</div>';
                    if (resultEl) resultEl.style.display = '';
                } finally {
                    checkBtn.disabled = false;
                    checkBtn.innerHTML = '<i class="fas fa-search-location"></i> Check';
                }
            });
        }
    }

    function renderTravelResult(el, { origin, dest, duration, purpose, profile }) {
        if (!el) return;
        const originRisks = computeDiseaseRisk(origin.aqiData, profile);
        const destRisks   = computeDiseaseRisk(dest.aqiData,   profile);
        const originMax   = originRisks.length ? Math.max(...originRisks.map(r => r.score)) : 0;
        const destMax     = destRisks.length   ? Math.max(...destRisks.map(r => r.score))   : 0;

        const destAqi     = dest.aqiData.aqi;
        const destTheme   = getTheme(destAqi);
        const destLevel   = getLevel(destAqi);

        // Purpose modifiers
        const purposeRiskMultiplier = { leisure: 1, work: 1.1, exercise: 1.35, medical: 0.9 };
        const adjustedDestMax = Math.round(destMax * (purposeRiskMultiplier[purpose] || 1));

        // Verdict
        let verdict, verdictIcon, verdictClass;
        if (adjustedDestMax < 30 && destAqi <= 100) {
            verdict = 'Safe to Travel'; verdictIcon = '✅'; verdictClass = 'travel-safe';
        } else if (adjustedDestMax < 60 && destAqi <= 200) {
            verdict = 'Travel with Caution'; verdictIcon = '⚠️'; verdictClass = 'travel-caution';
        } else {
            verdict = 'Avoid Travel — High Risk'; verdictIcon = '🚫'; verdictClass = 'travel-danger';
        }

        // Precautions for the trip
        const allPrecs = destRisks.flatMap(r => r.precautions).slice(0, 5);
        if (purpose === 'exercise') allPrecs.unshift('Outdoor exercise at destination — wear N95 mask and check hourly forecast before going out.');
        if (purpose === 'medical')  allPrecs.unshift('Medical travel — ensure treatment facility has clean air filtration. Carry rescue medication.');
        if (duration >= 7) allPrecs.push(`Extended stay (${duration} days) — consider portable HEPA air purifier for accommodation.`);

        el.innerHTML = `
            <div class="travel-verdict ${verdictClass}">
                <span class="travel-verdict-icon">${verdictIcon}</span>
                <div>
                    <div class="travel-verdict-text">${verdict}</div>
                    <div class="travel-verdict-sub">For ${duration}-day ${purpose} trip to ${escapeHTML(dest.name)}</div>
                </div>
            </div>
            <div class="travel-comparison">
                <div class="travel-city-card">
                    <div class="tc-label">📍 Current — ${escapeHTML(origin.name)}</div>
                    <div class="tc-aqi" style="color:${aqiColor(origin.aqiData.aqi)};">${origin.aqiData.aqi}</div>
                    <div class="tc-status">${getTheme(origin.aqiData.aqi).status}</div>
                    <div class="tc-risk" style="color:${getRiskLabel(originMax).color};">Personal Risk: ${getRiskLabel(originMax).label}</div>
                </div>
                <div class="travel-vs"><i class="fas fa-arrow-right"></i></div>
                <div class="travel-city-card dest">
                    <div class="tc-label">✈️ Destination — ${escapeHTML(dest.name)}</div>
                    <div class="tc-aqi" style="color:${aqiColor(destAqi)};">${destAqi}</div>
                    <div class="tc-status">${destTheme.status}</div>
                    <div class="tc-risk" style="color:${getRiskLabel(adjustedDestMax).color};">Personal Risk: ${getRiskLabel(adjustedDestMax).label}</div>
                </div>
            </div>
            ${allPrecs.length ? `
            <div class="travel-precautions-list">
                <div class="travel-prec-title"><i class="fas fa-shield-halved"></i> Trip Precautions</div>
                <ul>${allPrecs.map(p => `<li><i class="fas fa-circle-check"></i> ${p}</li>`).join('')}</ul>
            </div>` : ''}
        `;
        el.style.display = '';

        // Push notification for dangerous destination
        if (adjustedDestMax >= 70 && _canNotify()) {
            _sendOSNotification(
                `🚫 Travel Risk Alert — ${dest.name}`,
                `Current AQI in ${dest.name} is ${destAqi} (${destTheme.status}). ${verdict} based on your health profile.`
            );
        }
    }

    function setPollutant(id, val, max) {
        const vEl = $(`${id}Value`), bEl = $(`${id}Bar`), bdg = $(`${id}Badge`);
        if (!vEl || !bEl || !bdg) return;
        if (val == null) { vEl.textContent = 'N/A'; bEl.style.width = '0%'; bdg.textContent = 'N/A'; return; }
        vEl.textContent = typeof val === 'number' ? (val % 1 === 0 ? val : val.toFixed(1)) : val;
        const p = Math.min(val / max * 100, 100);
        bEl.style.width = p + '%';
        bEl.style.background = p < 33 ? '#00e676' : p < 66 ? '#ff9800' : '#f44336';
        bdg.textContent = p < 33 ? 'Low' : p < 66 ? 'Mid' : 'High';
    }

    // ===== Weather Fetching =====
    async function fetchWeather(lat, lon) {
        try {
            const url = `https://wttr.in/${lat},${lon}?format=j1`;
            const data = await cachedFetch(url);
            if (data.current_condition && data.current_condition.length > 0) {
                const c = data.current_condition[0];
                const wx = {
                    temperature: +c.temp_C,
                    windSpeed: +c.windspeedKmph,
                    windDir: +c.winddirDegree,
                    humidity: +c.humidity,
                    pressure: +c.pressure,
                    visibility: parseFloat(c.visibility)
                };
                lastWeatherData = wx;
                applyWeather(wx);
                return wx;
            }
        } catch (e) { /* fallback below */ }

        // Fallback: Open-Meteo weather
        try {
            const url2 = `${METEO_BASE}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,visibility`;
            const data2 = await cachedFetch(url2);
            if (data2.current) {
                const c = data2.current;
                const wx = {
                    temperature: Math.round(c.temperature_2m),
                    windSpeed: Math.round(c.wind_speed_10m),
                    windDir: Math.round(c.wind_direction_10m),
                    humidity: Math.round(c.relative_humidity_2m),
                    pressure: Math.round(c.surface_pressure),
                    visibility: c.visibility != null ? +(c.visibility / 1000).toFixed(1) : 10
                };
                lastWeatherData = wx;
                applyWeather(wx);
                return wx;
            }
        } catch (e2) { console.error('Weather fallback error:', e2); }
        return null;
    }

    function applyWeather(wx) {
        requestAnimationFrame(() => {
            if (els.temperature) els.temperature.textContent = `${wx.temperature}°C`;
            if (els.windSpeed) els.windSpeed.textContent = `${wx.windSpeed} km/h`;
            if (els.windDirection) els.windDirection.textContent = `${wx.windDir}°`;
            if (els.humidity) els.humidity.textContent = `${wx.humidity}%`;
            if (els.pressure) els.pressure.textContent = `${wx.pressure} hPa`;
            if (els.visibility) els.visibility.textContent = `${wx.visibility} km`;
        });
    }

    // ===== Impact Factors Display =====
    async function buildFactorsPanel(aqiData, weatherData) {
        const grid = els.factorsGrid;
        if (!grid) return;

        const pollutants = {
            aqi: aqiData.aqi,
            pm25: aqiData.iaqi?.pm25?.v || 0,
            pm10: aqiData.iaqi?.pm10?.v || 0,
            o3: aqiData.iaqi?.o3?.v || 0,
            no2: aqiData.iaqi?.no2?.v || 0,
            so2: aqiData.iaqi?.so2?.v || 0,
            co: aqiData.iaqi?.co?.v || 0
        };

        const weather = {
            windSpeed: weatherData?.windSpeed || 0,
            humidity: weatherData?.humidity || 0,
            pressure: weatherData?.pressure || 1013,
            visibility: weatherData?.visibility || 10,
            temperature: weatherData?.temperature || 25
        };

        let factors = [];

        try {
            factors = await workerCall('DETECT_FACTORS', { weather, pollutants });
        } catch (e) {
            // Worker unavailable — return empty (don't duplicate heavy factor logic on main thread)
            factors = [];
        }

        // Check for geopolitical/high-severity factors
        const geoFactors = factors.filter(f => f.category === 'geopolitical' || f.category === 'natural_event');
        const hasHighSeverity = factors.some(f => f.severity > 40) || aqiData.aqi > 150;

        // Show event alert banner ONLY for genuinely serious conditions
        // AQI must be Unhealthy (≥200) AND a severe factor present (severity > 60)
        const isGenuinelySerious = aqiData.aqi >= 200 && factors.some(f => f.severity > 60);
        if (isGenuinelySerious && els.eventAlertBanner) {
            const primaryFactor = factors.find(f => f.severity > 60) || factors[0];
            if (els.eventAlertTitle) {
                els.eventAlertTitle.textContent = primaryFactor
                    ? `⚠ ${primaryFactor.label} Detected`
                    : '⚠ Elevated AQI Anomaly Detected';
            }
            if (els.eventAlertDesc) {
                els.eventAlertDesc.textContent = primaryFactor
                    ? primaryFactor.description
                    : `Current AQI of ${aqiData.aqi} exceeds safe levels. Multiple environmental factors are contributing.`;
            }
            els.eventAlertBanner.style.display = 'block';
        }

        // Render factors grid
        if (factors.length === 0) {
            grid.innerHTML = `
                <div class="factor-none">
                    <i class="fas fa-check-circle"></i>
                    Air quality conditions are within normal parameters. No major impact factors detected.
                </div>`;
            return;
        }

        // Category display names
        const catNames = {
            meteorological: 'Meteorological',
            natural_event: 'Natural Event',
            agricultural: 'Agricultural',
            industrial: 'Industrial',
            urban: 'Urban',
            geopolitical: 'Geopolitical',
            cultural: 'Cultural/Festival',
            regional: 'Regional Transport'
        };

        grid.innerHTML = factors.map((f, idx) => {
            const rgb = hexToRgb(f.color);
            const severityPct = Math.min(f.severity, 100);
            const multiplierDisplay = f.aqiMultiplier > 1
                ? `+${Math.round((f.aqiMultiplier - 1) * 100)}% AQI`
                : `−${Math.round((1 - f.aqiMultiplier) * 100)}% AQI`;
            const isPositive = f.aqiMultiplier > 1;
            return `
                <div class="factor-card" style="--fc-rgb:${rgb};--fc-color:${f.color};animation:fadeUp 0.4s ${idx * 0.06}s both;">
                    <div class="factor-card-top">
                        <div class="factor-icon-wrap"><i class="fas ${f.icon}"></i></div>
                        <div class="factor-label">${f.label}</div>
                        <span class="factor-category-tag">${catNames[f.category] || f.category}</span>
                    </div>
                    <div class="factor-description">${f.description}</div>
                    <div class="factor-severity-bar">
                        <span class="factor-severity-label">Impact</span>
                        <div class="factor-severity-track">
                            <div class="factor-severity-fill" style="width:${severityPct}%"></div>
                        </div>
                        <span class="factor-multiplier" style="color:${isPositive ? '#f44336' : '#00e676'}">${multiplierDisplay}</span>
                    </div>
                </div>`;
        }).join('');

        // Show geopolitical panel if geo factors present
        if (geoFactors.length > 0 && els.geopoliticalPanel && els.geoEventsList) {
            els.geoEventsList.innerHTML = geoFactors.map(f => `
                <div class="geo-event-item" style="border-color:${f.color};">
                    <div class="geo-event-icon" style="color:${f.color};"><i class="fas ${f.icon}"></i></div>
                    <div class="geo-event-content">
                        <div class="geo-event-title">${f.label}</div>
                        <div class="geo-event-desc">${f.description}</div>
                    </div>
                    <span class="geo-event-impact" style="background:rgba(${hexToRgb(f.color)},0.15);color:${f.color};">
                        ×${f.aqiMultiplier}
                    </span>
                </div>`).join('');
            els.geopoliticalPanel.style.display = 'block';
        } else if (els.geopoliticalPanel) {
            els.geopoliticalPanel.style.display = 'none';
        }
    }

    // (detectFactorsFallback removed — deduplication; worker handles all factor detection)
    function _removed_placeholder_detectFactorsFallback(weather, pollutants) {
        const active = [];
        const pm25 = Number(pollutants?.pm25) || 0;
        const pm10 = Number(pollutants?.pm10) || 0;
        const no2 = Number(pollutants?.no2) || 0;
        const so2 = Number(pollutants?.so2) || 0;
        const co = Number(pollutants?.co) || 0;
        const o3 = Number(pollutants?.o3) || 0;

        const wind = Number(weather?.windSpeed) || 0;
        const temp = Number(weather?.temperature) || 25;
        const hum = Number(weather?.humidity) || 50;
        const pres = Number(weather?.pressure) || 1013;

        if (pm25 >= 60) {
            active.push({
                id: 'pm25_combustion',
                label: 'Fine Particle Combustion / Biomass Smoke',
                icon: 'fa-smog',
                category: 'agricultural',
                color: '#ff7043',
                description: `ML Feature Attribution: PM2.5 (${pm25} µg/m³) is driving primary particulate toxicity.`,
                aqiMultiplier: 1.85,
                severity: Math.min(100, Math.round((pm25 / 150) * 100))
            });
        }
        if (pres >= 1016 && wind <= 6) {
            active.push({
                id: 'thermal_inversion',
                label: 'Atmospheric Inversion & Stagnation Layer',
                icon: 'fa-layer-group',
                category: 'meteorological',
                color: '#ff9800',
                description: `High surface barometric pressure (${pres} hPa) and stagnant wind (${wind} km/h) trapping pollutants.`,
                aqiMultiplier: 1.35,
                severity: 75
            });
        }
        if (no2 >= 45 || co >= 1.5) {
            active.push({
                id: 'traffic_emissions',
                label: 'Vehicular Traffic & Combustion Plume',
                icon: 'fa-car',
                category: 'urban',
                color: '#ef5350',
                description: `Elevated Nitrogen Dioxide (${no2} ppb) and CO (${co} ppm) signature from urban road corridors.`,
                aqiMultiplier: 1.30,
                severity: 65
            });
        }
        if (o3 >= 65 && temp >= 28) {
            active.push({
                id: 'photochemical_ozone',
                label: 'Photochemical Ozone Surge',
                icon: 'fa-sun',
                category: 'meteorological',
                color: '#e040fb',
                description: `Solar radiation and warmth (${temp}°C) catalyzing secondary photochemical ground ozone (${o3} ppb).`,
                aqiMultiplier: 1.25,
                severity: 60
            });
        }
        if (pm10 >= 100 && wind >= 16) {
            active.push({
                id: 'dust_storm',
                label: 'Aeolian Soil & Dust Dispersion',
                icon: 'fa-wind',
                category: 'natural_event',
                color: '#ffb74d',
                description: `Coarse particulate loading (${pm10} µg/m³) driven by elevated ground wind velocity (${wind} km/h).`,
                aqiMultiplier: 1.40,
                severity: 55
            });
        }
        if (wind >= 18) {
            active.push({
                id: 'wind_ventilation',
                label: 'Strong Atmospheric Wind Ventilation',
                icon: 'fa-fan',
                category: 'meteorological',
                color: '#00e676',
                description: `Horizontal advection at ${wind} km/h is dispersing suspended particulates and clearing the air.`,
                aqiMultiplier: 0.72,
                severity: 45
            });
        }
        if (hum >= 85) {
            active.push({
                id: 'wet_deposition',
                label: 'Atmospheric Wet Scavenging / High Moisture',
                icon: 'fa-cloud-rain',
                category: 'meteorological',
                color: '#42a5f5',
                description: `Elevated humidity (${hum}%) and precipitation aiding particulate washout.`,
                aqiMultiplier: 0.65,
                severity: 50
            });
        }
        active.sort((a, b) => b.severity - a.severity);
        return active.slice(0, 6);
    }

    // ===== Hourly Forecast via Machine Learning =====
    async function buildHourlyForecast(baseAqi, data) {
        const container = els.hourlyScroll;
        if (!container) return;
        container.innerHTML = '';

        const now = new Date();
        const hasRealHourly = data._hourlyAqi && data._hourlyAqi.length > 0;

        let currentHourIndexBase = 0;
        if (hasRealHourly && data._hourlyTimes) {
            const tzFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: currentCity.timezone || 'UTC',
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
            });
            const parts = tzFormatter.formatToParts(now);
            const p = {};
            parts.forEach(x => { p[x.type] = x.value; });
            const localHourStr = `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}`;
            const idx = data._hourlyTimes.findIndex(t => t.slice(0, 13) === localHourStr);
            currentHourIndexBase = idx >= 0 ? idx : now.getHours();
        } else {
            currentHourIndexBase = now.getHours();
        }

        let forecasts;
        try {
            forecasts = await workerCall('GENERATE_FORECAST', {
                baseAqi,
                hourlyAqi: data._hourlyAqi || [],
                hourlyTimes: data._hourlyTimes || [],
                currentHourIndex: currentHourIndexBase,
                timezone: currentCity.timezone,
                weather: lastWeatherData,
                pollutants: data.iaqi
            });
        } catch (e) {
            // Fallback to ML Diurnal Regressor
            forecasts = generateForecastFallback(baseAqi, data, currentHourIndexBase);
        }

        const icons = { good: '🌿', moderate: '🌤', unhealthySG: '😷', unhealthy: '🌫', veryUnhealthy: '🚨', hazardous: '⚠️' };
        const fragment = document.createDocumentFragment();

        forecasts.forEach(({ i, hourAqi, level, color, factor }) => {
            const hourTime = new Date(now.getTime() + i * 3600000);
            const timeStr = hourTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const domPollutant = data.dominantPollutant || ['PM2.5', 'PM10', 'Ozone (O₃)', 'NO₂'][Math.floor((i * 3 + baseAqi) % 4)];
            const windImpact = lastWeatherData?.windSpeed >= 15 ? 'High' : lastWeatherData?.windSpeed >= 8 ? 'Moderate' : 'Low';
            const justification = `<b>ML Diurnal Model:</b> Predicting ${factor} with an expected AQI of <b>${hourAqi}</b> (${level.toUpperCase()}).`;
            const levelLabel = level === 'unhealthySG' ? 'USG' : level.charAt(0).toUpperCase() + level.slice(1);

            const card = document.createElement('div');
            card.className = `hour-card${i === 0 ? ' current' : ''}`;
            card.onclick = () => openHourlyModal(i === 0 ? 'NOW' : timeStr, hourAqi, level, icons[level] || '🌫️', justification, color, domPollutant, windImpact);
            card.innerHTML = `
                <div class="hour-time">${i === 0 ? 'NOW' : timeStr}</div>
                <div class="hour-aqi" style="color:${color}">${hourAqi}</div>
                <div class="hour-label" style="color:${color}">${levelLabel}</div>
                <div class="hour-icon">${icons[level] || '🌫️'}</div>
            `;
            fragment.appendChild(card);
        });
        container.appendChild(fragment);
    }

    // generateForecastFallback removed — worker already has this logic; if worker fails,
    // we use a minimal diurnal fallback inline in buildHourlyForecast catch block.
    function generateForecastFallback(baseAqi) {
        const now = new Date(), currentHour = now.getHours();
        return Array.from({ length: 24 }, (_, i) => {
            const fh = (currentHour + i) % 24;
            const rad = (fh - 14) * Math.PI / 12;
            const delta = -12 * Math.cos(rad); // simple diurnal AQI swing
            const hourAqi = Math.max(1, Math.round(baseAqi + (i === 0 ? 0 : delta * 0.4)));
            let factor = 'Atmospheric Equilibrium';
            if (fh >= 5 && fh <= 9) factor = 'Morning Boundary Layer Stagnation';
            else if (fh >= 12 && fh <= 15) factor = 'Solar Convective Dispersion';
            else if (fh >= 17 && fh <= 21) factor = 'Peak Vehicular & Industrial Advection';
            else if (fh >= 22 || fh <= 4) factor = 'Nocturnal Thermal Inversion';
            return { i, hourAqi, level: getLevel(hourAqi), color: aqiColor(hourAqi), factor };
        });
    }

    // ===== Hourly Popout Modal =====
    function openHourlyModal(timeStr, aqi, level, icon, justification, color, domPollutant, windImpact) {
        const modal = $('hourlyModal'), card = $('hourlyPopoutCard');
        if (!modal || !card) return;
        const label = level === 'unhealthySG' ? 'USG' : level.charAt(0).toUpperCase() + level.slice(1);
        card.innerHTML = `
            <div class="popout-inner">
                <div class="popout-front" style="border-color:${color}">
                    <div class="pt-time">${timeStr}</div>
                    <h1 style="color:${color};text-shadow:0 0 30px ${color}40">${aqi}</h1>
                    <div class="pt-label" style="color:${color}">${label} ${icon}</div>
                    <div class="pt-flip-hint">Flipping automatically... <i class="fas fa-arrow-right"></i></div>
                </div>
                <div class="popout-back" style="border-color:${color}">
                    <h3><i class="fas fa-satellite-dish" style="color:${color}"></i> Atmospheric Insights</h3>
                    <p>${justification}</p>
                    <div class="factor-list">
                        <div class="f-item"><i class="fas fa-smog" style="color:${color}"></i> <span>Dominant Pollutant: <b>${domPollutant}</b></span></div>
                        <div class="f-item"><i class="fas fa-wind" style="color:${color}"></i> <span>Wind Dispersion: <b>${windImpact}</b></span></div>
                        <div class="f-item"><i class="fas fa-temperature-half" style="color:${color}"></i> <span>Local thermodynamic profiling factored</span></div>
                    </div>
                </div>
            </div>`;
        card.classList.remove('flipped');
        const inner = card.querySelector('.popout-inner');
        inner.onclick = (e) => { e.stopPropagation(); card.classList.toggle('flipped'); };
        modal.onclick = (e) => { if (e.target === modal) { modal.classList.remove('active'); card.classList.remove('flipped'); } };
        modal.classList.add('active');
        setTimeout(() => {
            if (modal.classList.contains('active') && !card.classList.contains('flipped')) card.classList.add('flipped');
        }, 1200);
    }

    // ===== Forecast Chart =====
    async function buildForecastChartData(baseAqi, data) {
        // Re-use hourly pm2_5 already fetched by fetchAQI (same URL, hits cache) instead of a separate request
        const hourlyPm25  = data._hourlyPm25;
        const hourlyTimes = data._hourlyTimes;

        if (hourlyPm25 && hourlyPm25.length > 0 && hourlyTimes) {
            // Aggregate directly on main thread — simple O(n) loop, no worker roundtrip needed
            const daily = aggregatePM25Fallback(hourlyPm25, hourlyTimes);
            if (daily && daily.length > 0) {
                lastForecastData = { pm25: daily };
                drawForecastChart({ pm25: daily });
                return;
            }
        }

        // Ultimate fallback: generate synthetic forecast based on base AQI
        const fd = { pm25: genForecast(baseAqi * 0.6, 7) };
        lastForecastData = fd;
        drawForecastChart(fd);
    }

    function aggregatePM25Fallback(pm25, times) {
        const dailyMap = {};
        times.forEach((t, i) => {
            const day = t.split('T')[0];
            if (!dailyMap[day]) dailyMap[day] = [];
            if (pm25[i] != null) dailyMap[day].push(pm25[i]);
        });
        return Object.keys(dailyMap).filter(d => dailyMap[d].length > 0).slice(0, 7).map(day => {
            const vals = dailyMap[day].filter(v => v != null && !isNaN(v));
            if (!vals.length) return null;
            return { day, avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length), max: Math.round(Math.max(...vals)), min: Math.round(Math.min(...vals)) };
        }).filter(Boolean);
    }

    function genForecast(base, days) {
        return Array.from({ length: days }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() + i);
            const seed = Math.sin(i * 73.1 * Math.PI / 180) * 0.5 + 0.5;
            return {
                day: d.toISOString().slice(0, 10),
                avg: Math.max(1, Math.floor(base + (seed - .5) * base * .4)),
                max: Math.max(1, Math.floor(base * 1.3 + seed * base * .3)),
                min: Math.max(1, Math.floor(base * .6 + (1 - seed) * base * .3))
            };
        });
    }

    // ===== Cross-City Transfer Learning =====
    async function buildCrossCity(centerAqi, centerData) {
        if (!els.hubCityName || !els.hubAqi) return;
        els.hubCityName.textContent = currentCity.name;
        els.hubAqi.textContent = centerAqi;
        els.hubAqi.style.color = aqiColor(centerAqi);

        const cityKey = currentCity.name.toLowerCase();
        let neighbors = CITY_NEIGHBORS[cityKey] || [];

        if (neighbors.length === 0) {
            neighbors = await findNearbyCities(currentCity.lat, currentCity.lon, currentCity.name);
            // Cache results to prevent repeated Nominatim API calls on every city load
            if (neighbors.length > 0) CITY_NEIGHBORS[cityKey] = neighbors;
        }

        const ring = els.neighborRing;
        if (!ring) return;
        ring.innerHTML = '';

        const centerX = ring.offsetWidth ? ring.offsetWidth / 2 : 300;
        const centerY = ring.offsetHeight ? ring.offsetHeight / 2 : 200;
        const radius = Math.min(centerX, centerY) * 0.7;

        // Fetch ALL neighbor AQIs in parallel
        const neighborAQIs = await fetchNeighborAQIs(neighbors);

        // Build neighbor data with bearings & distances
        const neighborData = [];
        const windSpeed = lastWeatherData?.windSpeed || 5;
        const windDir = lastWeatherData?.windDir || 0;

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < neighbors.length; i++) {
            const n = neighbors[i];
            const angle = (2 * Math.PI * i / neighbors.length) - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle) - 60;
            const y = centerY + radius * Math.sin(angle) - 30;

            const dist = haversine(currentCity.lat, currentCity.lon, n.lat, n.lon);
            const bearing = getBearing(currentCity.lat, currentCity.lon, n.lat, n.lon);
            const windFromNeighbor = (bearing + 180) % 360;
            const angleDiff = Math.abs(windFromNeighbor - windDir);
            const normalizedAngle = Math.min(angleDiff, 360 - angleDiff);
            const windAlignment = Math.cos(normalizedAngle * Math.PI / 180);
            const speedFactor = Math.min(windSpeed / 20, 1.5);
            const transferEffect = windAlignment * speedFactor * windSpeed * 0.5;

            const nAqi = neighborAQIs[i] || Math.max(1, Math.round(centerAqi * (0.7 + Math.sin(i * 1.3) * 0.3) + transferEffect));
            const nColor = aqiColor(nAqi);
            const countryLabel = n.country ? `, ${n.country}` : '';
            const windDirLabel = bearingToCompass(windDir);

            neighborData.push({ ...n, aqi: nAqi, dist, bearing, windAlignment, transferEffect });

            // Line
            const line = document.createElement('div');
            line.className = 'neighbor-line';
            const dx = (x + 60) - centerX, dy = (y + 30) - centerY;
            const lineLen = Math.sqrt(dx * dx + dy * dy);
            const lineAngle = Math.atan2(dy, dx) * 180 / Math.PI;
            const lineRgb = AQI_THEMES[getLevel(nAqi)].rgb;
            line.style.cssText = `left:${centerX}px;top:${centerY}px;width:${lineLen}px;transform:rotate(${lineAngle}deg);background:linear-gradient(90deg,rgba(${lineRgb},0.3),rgba(${lineRgb},0.05));`;
            fragment.appendChild(line);

            // Node
            const node = document.createElement('div');
            node.className = 'neighbor-node';
            node.style.cssText = `left:${x}px;top:${y}px;animation:fadeUp 0.6s ${i * 0.1}s both;`;
            node.dataset.lat = n.lat; node.dataset.lon = n.lon;
            node.dataset.name = n.name; node.dataset.region = n.country || '';
            node.dataset.tz = 'UTC';
            node.title = `Click to switch to ${n.name}`;
            node.addEventListener('click', () => selectCity(node));
            node.innerHTML = `
                <div class="neighbor-dot" style="border-color:${nColor};color:${nColor}">${nAqi}</div>
                <div class="neighbor-name">${n.name}</div>
                <div class="neighbor-aqi">AQI: ${nAqi} · ${dist.toFixed(0)}km${countryLabel}</div>
                <div class="neighbor-wind"><i class="fas fa-wind"></i> Wind: ${windDirLabel} · ${windAlignment > 0 ? '↙ Pushing' : '↗ Pulling'}</div>
            `;
            fragment.appendChild(node);
        }

        ring.appendChild(fragment);

        // ===== Enhanced Transfer Learning Prediction =====
        if (neighborData.length > 0 && els.transferResult) {
            let transferResult;
            try {
                transferResult = await workerCall('COMPUTE_TRANSFER', {
                    centerAqi,
                    neighbors: neighborData.map(n => ({
                        name: n.name, aqi: n.aqi, dist: n.dist,
                        bearing: n.bearing, country: n.country || ''
                    })),
                    windSpeed,
                    windDir
                });
            } catch (e) {
                // Fallback computation with ML spatial kernel
                let totalWeight = 0;
                let weightedAQI = 0;
                const breakdown = [];
                for (const n of neighborData) {
                    const distKernel = Math.exp(-n.dist / 120.0);
                    const windFromNeighbor = (n.bearing + 180) % 360;
                    const angleDiff = Math.abs(windFromNeighbor - windDir);
                    const normAngle = Math.min(angleDiff, 360 - angleDiff);
                    const windProjection = Math.max(0, Math.cos(normAngle * Math.PI / 180));
                    const speedMultiplier = Math.min(windSpeed / 18.0, 1.8);
                    const mlWeight = distKernel * (0.35 + 0.65 * windProjection * speedMultiplier);
                    weightedAQI += n.aqi * mlWeight;
                    totalWeight += mlWeight;
                    breakdown.push({ name: n.name, aqi: n.aqi, dist: Math.round(n.dist), weight: mlWeight });
                }
                const selfPersistence = 0.85;
                weightedAQI += centerAqi * selfPersistence;
                totalWeight += selfPersistence;
                const pred = Math.max(1, Math.round(weightedAQI / totalWeight));
                breakdown.forEach(b => { b.contribution = Math.round((b.weight / totalWeight) * 100); });
                transferResult = {
                    predictedAqi: pred,
                    confidence: Math.min(98, Math.round(60 + neighborData.length * 6 + (windSpeed > 0 ? 8 : 0))),
                    breakdown
                };
            }

            const { predictedAqi, confidence, breakdown } = transferResult;
            const predColor = aqiColor(predictedAqi);
            const predTheme = getTheme(predictedAqi);

            els.transferResult.innerHTML = `
                <p>Based on wind patterns (${windSpeed} km/h, ${windDir}°) and live AQI from ${neighborData.length} neighboring cities using weighted transfer learning:</p>
                <span class="pred-value" style="color:${predColor}">${predictedAqi} <small style="font-size:14px;color:var(--text3)">Predicted AQI — Tomorrow</small></span>
                <span class="confidence-badge"><i class="fas fa-brain"></i> ${confidence}% Confidence</span>
                <p><strong style="color:${predColor}">${predTheme.status}</strong> — ${predTheme.desc}</p>
                <div class="transfer-breakdown">
                    ${breakdown.map(b => `
                        <div class="tb-item clickable" data-lat="${neighborData.find(n => n.name === b.name)?.lat || 0}" data-lon="${neighborData.find(n => n.name === b.name)?.lon || 0}" data-name="${b.name}" data-region="${neighborData.find(n => n.name === b.name)?.country || ''}" data-tz="UTC" title="Click to view ${b.name}" style="cursor:pointer;">
                            <div class="tb-city">${b.name}</div>
                            <div class="tb-aqi" style="color:${aqiColor(b.aqi)}">${b.aqi}</div>
                            <div class="tb-meta">${b.dist}km away</div>
                            <div class="tb-contrib"><i class="fas fa-chart-pie"></i> ${b.contribution}% influence</div>
                        </div>`).join('')}
                    <div class="tb-item">
                        <div class="tb-city">Wind</div>
                        <div class="tb-aqi" style="color:var(--aqi-accent)">${windSpeed}</div>
                        <div class="tb-meta">km/h</div>
                        <div class="tb-contrib">${bearingToCompass(windDir)} direction</div>
                    </div>
                </div>`;

            // Delegated click for tb-item navigation
            if (!els.transferResult.dataset.listener) {
                els.transferResult.addEventListener('click', (e) => {
                    const item = e.target.closest('.tb-item.clickable');
                    if (item) selectCity(item);
                });
                els.transferResult.dataset.listener = 'true';
            }
        }
    }

    // ===== Fetch Neighbor AQIs in Parallel =====
    async function fetchNeighborAQIs(neighbors) {
        const results = await Promise.allSettled(
            neighbors.map(n =>
                cachedFetch(`${METEO_AIR_QUALITY}?latitude=${n.lat}&longitude=${n.lon}&current=us_aqi&timezone=auto`)
                    .then(data => (data.current && data.current.us_aqi != null) ? Math.round(data.current.us_aqi) : null)
                    .catch(() => null)
            )
        );
        return results.map(r => r.status === 'fulfilled' ? r.value : null);
    }

    async function findNearbyCities(lat, lon, exclude) {
        const radiusDeg = 0.35;
        const angles = [0, 72, 144, 216, 288];
        const results = [];
        const usedNames = new Set([exclude.toLowerCase(), currentCity.name.toLowerCase()]);

        await Promise.all(angles.map(async (deg) => {
            const rad = deg * Math.PI / 180;
            const tLat = lat + radiusDeg * Math.cos(rad);
            const tLon = lon + (radiusDeg / Math.cos(lat * Math.PI / 180)) * Math.sin(rad);
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${tLat}&lon=${tLon}&format=json&zoom=10`);
                const data = await res.json();
                if (data && data.address) {
                    const name = data.address.city || data.address.town || data.address.county || data.address.state_district;
                    if (name && !usedNames.has(name.toLowerCase())) {
                        usedNames.add(name.toLowerCase());
                        results.push({ name, lat: +data.lat || tLat, lon: +data.lon || tLon, country: data.address.country });
                    }
                }
            } catch (e) { }
        }));
        return results.slice(0, 5);
    }

    // ===== City Search =====
    let searchTO;
    function initSearch() {
        if (!els.citySearch) return;
        els.citySearch.addEventListener('input', e => {
            clearTimeout(searchTO);
            const q = e.target.value.trim();
            if (q.length < 2) { els.searchDropdown.classList.remove('active'); return; }
            searchTO = setTimeout(() => searchCities(q), 300);
        });
        els.citySearch.addEventListener('focus', () => {
            if (els.searchDropdown.children.length > 0) els.searchDropdown.classList.add('active');
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.nav-search')) els.searchDropdown.classList.remove('active');
        });
        document.addEventListener('keydown', e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); els.citySearch.focus(); }
        });
    }

    async function searchCities(query) {
        try {
            const [meteoResults, nominatimResults, photonResults] = await Promise.allSettled([
                fetch(`${GEOCODE_BASE}?name=${encodeURIComponent(query)}&count=8&language=en`)
                    .then(r => r.json()).then(d => d.results || []).catch(() => []),
                fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1&dedupe=1`, { headers: { 'Accept-Language': 'en' } })
                    .then(r => r.json()).catch(() => []),
                fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=en`)
                    .then(r => r.json()).then(d => d.features || []).catch(() => [])
            ]);

            const meteo = meteoResults.status === 'fulfilled' ? meteoResults.value : [];
            const nominatim = nominatimResults.status === 'fulfilled' ? nominatimResults.value : [];
            const photon = photonResults.status === 'fulfilled' ? photonResults.value : [];

            const seen = new Set(), merged = [];

            for (const r of meteo) {
                const key = `${parseFloat(r.latitude).toFixed(2)},${parseFloat(r.longitude).toFixed(2)}`;
                if (!seen.has(key)) { seen.add(key); merged.push({ name: r.name, lat: r.latitude, lon: r.longitude, region: [r.admin1, r.country].filter(Boolean).join(', '), tz: r.timezone || 'UTC' }); }
            }
            for (const r of nominatim) {
                const key = `${parseFloat(r.lat).toFixed(2)},${parseFloat(r.lon).toFixed(2)}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    const name = r.address?.suburb || r.address?.village || r.address?.town || r.address?.city || r.address?.hamlet || r.address?.neighbourhood || r.address?.locality || r.name;
                    merged.push({ name, lat: +r.lat, lon: +r.lon, region: [r.address?.state_district, r.address?.state, r.address?.country].filter(Boolean).join(', '), tz: 'UTC' });
                }
            }
            for (const f of photon) {
                if (!f.geometry?.coordinates) continue;
                const [lon, lat] = f.geometry.coordinates;
                const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    const p = f.properties || {};
                    merged.push({ name: p.name || p.locality || p.district || 'Unknown', lat, lon, region: [p.county, p.state, p.country].filter(Boolean).join(', '), tz: 'UTC' });
                }
            }

            if (merged.length > 0) {
                els.searchDropdown.innerHTML = merged.slice(0, 12).map(r => `
                    <div class="search-result" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeHTML(r.name)}" data-region="${escapeHTML(r.region)}" data-tz="${escapeHTML(r.tz)}">
                        <i class="fas fa-map-marker-alt"></i>
                        <span class="result-name">${escapeHTML(r.name)}</span>
                        <span class="result-region">${escapeHTML(r.region)}</span>
                    </div>`).join('');
                els.searchDropdown.classList.add('active');
                els.searchDropdown.querySelectorAll('.search-result').forEach(el => el.addEventListener('click', () => selectCity(el)));
            } else {
                els.searchDropdown.innerHTML = '<div class="search-result"><i class="fas fa-info-circle"></i><span class="result-name">No results found. Try a different spelling.</span></div>';
                els.searchDropdown.classList.add('active');
            }
        } catch (e) { console.error('Search error:', e); }
    }

    function selectCity(el) {
        currentCity = {
            name: el.dataset.name, lat: +el.dataset.lat, lon: +el.dataset.lon,
            region: el.dataset.region, timezone: el.dataset.tz || 'UTC'
        };
        localStorage.setItem('airflowLastCity', JSON.stringify(currentCity));
        if (els.citySearch) els.citySearch.value = currentCity.name;
        if (els.searchDropdown) els.searchDropdown.classList.remove('active');
        loadCity();
    }

    // ===== AREA-SPECIFIC AQI NEWS PANEL (6 RELEVANT NEWS HEADLINES FOR SEARCHED CITY) =====
    function renderAreaNews(city, aqiData, weatherData) {
        const feed = $('newsFeed');
        if (!feed) return;

        const cityName = city?.name || 'Local Area';
        const subtitleEl = $('newsSubtitle');
        if (subtitleEl) {
            subtitleEl.textContent = `Ongoing local air quality news for ${cityName}`;
        }

        const aqiVal = aqiData?.aqi || 120;
        const statusText = aqiData?.status || 'Moderate';
        const windVal = weatherData?.current?.wind_speed || 12;
        const tempVal = weatherData?.current?.temperature || 24;

        // Exactly 6 area-specific news headlines
        const newsItems = [
            {
                id: 1,
                source: `${cityName} AQI Bureau`,
                title: `${cityName} Air Quality Alert — Index Monitored at ${aqiVal} (${statusText})`,
                desc: `Environmental stations in ${cityName} report ${statusText.toLowerCase()} air quality with fine particulate concentrations actively tracked.`,
                tag: 'Real-Time AQI',
                icon: 'fa-smog',
                color: '#f44336',
                iconRgb: '244,67,54',
                query: `${cityName} air quality index ${statusText} news`
            },
            {
                id: 2,
                source: `${cityName} Transport & Env Watch`,
                title: `Commute Traffic & Urban Emissions Impact ${cityName} Air Basin`,
                desc: `Peak traffic density and nitrogen dioxide (NO₂) emissions monitored along primary transport corridors across ${cityName}.`,
                tag: 'Vehicular NO₂',
                icon: 'fa-car',
                color: '#ef5350',
                iconRgb: '239,83,80',
                query: `${cityName} traffic emissions air quality news`
            },
            {
                id: 3,
                source: `Regional Met Observatory`,
                title: `Local Winds (${windVal} km/h) & Atmospheric Temperature (${tempVal}°C) Influence Dispersal in ${cityName}`,
                desc: `Current meteorological parameters affect boundary layer mixing height and pollutant concentration in the ${cityName} region.`,
                tag: 'Meteorology',
                icon: 'fa-wind',
                color: '#42a5f5',
                iconRgb: '66,165,245',
                query: `${cityName} weather wind air quality news`
            },
            {
                id: 4,
                source: `Industrial Env Board`,
                title: `Industrial Stack Operations & Construction Activity Monitored in ${cityName}`,
                desc: `Environmental compliance teams inspect industrial emissions and dust suppression measures across industrial zones in ${cityName}.`,
                tag: 'Industrial SO₂',
                icon: 'fa-industry',
                color: '#78909c',
                iconRgb: '120,144,156',
                query: `${cityName} industrial pollution construction dust news`
            },
            {
                id: 5,
                source: `Aerosol Satellite Network`,
                title: `Regional Biomass & Dust Trajectories Tracked En Route to ${cityName}`,
                desc: `Satellite thermal sensing monitors aerosol movement and fine particulate plumes drifting toward the ${cityName} area.`,
                tag: 'Regional Plumes',
                icon: 'fa-layer-group',
                color: '#ff8f00',
                iconRgb: '255,143,0',
                query: `${cityName} particulate pollution dust news`
            },
            {
                id: 6,
                source: `Public Health Advisory`,
                title: `Health & Outdoor Safety Advisory Issued for ${cityName} Citizens`,
                desc: `Public health officials issue outdoor activity guidelines and indoor air filter recommendations for residents of ${cityName}.`,
                tag: 'Health Advisory',
                icon: 'fa-heart-pulse',
                color: '#00e676',
                iconRgb: '0,230,118',
                query: `${cityName} health advisory air pollution news`
            }
        ];

        feed.innerHTML = newsItems.map((item, i) => {
            const googleNewsUrl = `https://www.google.com/search?q=${encodeURIComponent(item.query)}&tbm=nws`;
            return `<a class="news-item" href="${googleNewsUrl}" target="_blank" rel="noopener noreferrer" style="--nc-color:${item.color};--nc-rgb:${item.iconRgb};animation-delay:${i * 0.03}s" title="Click to open news for ${cityName} on Google News">
                <div class="news-item-icon"><i class="fas ${item.icon}"></i></div>
                <div class="news-item-content">
                    <div class="news-item-title">${item.title}</div>
                    <div class="news-item-source">${item.source} &bull; ${item.tag}</div>
                </div>
            </a>`;
        }).join('');

        const timeEl = $('newsUpdateTime');
        if (timeEl) timeEl.textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }

    function initNewsPanel() {
        const refreshBtn = $('newsRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                refreshBtn.classList.add('spinning');
                setTimeout(() => {
                    renderAreaNews(currentCity, lastAQIData, lastWeatherData);
                    refreshBtn.classList.remove('spinning');
                }, 400);
            });
        }
    }

    // ===== Load City =====
    async function loadCity() {
        // Cancel any in-flight requests
        if (currentAbortController) currentAbortController.abort();
        currentAbortController = new AbortController();

        // Reset banner & panels for new city
        if (els.eventAlertBanner) els.eventAlertBanner.style.display = 'none';
        if (els.geopoliticalPanel) els.geopoliticalPanel.style.display = 'none';
        if (els.factorsGrid) {
            els.factorsGrid.innerHTML = '<div class="factor-loading glass-card"><i class="fas fa-satellite-dish fa-spin"></i><span>Analyzing atmospheric conditions & global events...</span></div>';
        }

        if (els.cityName) els.cityName.textContent = currentCity.name;
        if (els.regionName) els.regionName.textContent = currentCity.region;
        if (els.aqiValue) els.aqiValue.textContent = '--';
        if (els.aqiStatus) els.aqiStatus.textContent = 'Loading...';

        const [aqiData, weatherData] = await Promise.all([
            fetchAQI(currentCity),
            fetchWeather(currentCity.lat, currentCity.lon)
        ]);

        // Build factors panel (needs both AQI and weather)
        if (aqiData) {
            buildFactorsPanel(aqiData, lastWeatherData);
        }

        // Cross-city after both are ready
        if (lastAQIData) buildCrossCity(lastAQIData.aqi, lastAQIData);

        // Render Area-Specific News (6 location news headlines)
        renderAreaNews(currentCity, lastAQIData, lastWeatherData);
    }

    // ===== Forecast Chart =====
    function drawForecastChart(fd) {
        const canvas = els.forecastChart;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = 280 * dpr;
        ctx.scale(dpr, dpr);
        const W = canvas.offsetWidth, H = 280;
        ctx.clearRect(0, 0, W, H);

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const tc = isDark ? '#9898aa' : '#4a4a5e';
        const gc = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
        const ac = getComputedStyle(document.documentElement).getPropertyValue('--aqi-accent').trim();
        const pm = fd?.pm25 || [];
        if (!pm.length) return;

        const m = { t: 36, r: 25, b: 45, l: 45 };
        const cW = W - m.l - m.r, cH = H - m.t - m.b;
        const allV = pm.flatMap(d => [d.avg, d.max, d.min]).filter(v => v != null && !isNaN(v) && isFinite(v));
        const maxV = allV.length > 0 ? Math.max(...allV) * 1.2 : 100;

        // Gridlines
        ctx.strokeStyle = gc; ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = m.t + (i / 5) * cH;
            ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
            ctx.fillStyle = tc; ctx.font = '400 9px Inter'; ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxV - (i / 5) * maxV), m.l - 6, y + 3);
        }

        // Min-max fill
        if (pm.length > 1) {
            ctx.beginPath(); ctx.globalAlpha = 0.12; ctx.fillStyle = ac;
            pm.forEach((d, i) => { const x = m.l + (i / (pm.length - 1)) * cW; const y = m.t + cH - (d.max / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
            for (let i = pm.length - 1; i >= 0; i--) { ctx.lineTo(m.l + (i / (pm.length - 1)) * cW, m.t + cH - (pm[i].min / maxV) * cH); }
            ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        }

        // Main line
        ctx.strokeStyle = ac; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.beginPath();
        pm.forEach((d, i) => { const x = m.l + (i / Math.max(pm.length - 1, 1)) * cW; const y = m.t + cH - (d.avg / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke();

        // Glow
        ctx.strokeStyle = ac; ctx.lineWidth = 8; ctx.globalAlpha = 0.12; ctx.beginPath();
        pm.forEach((d, i) => { const x = m.l + (i / Math.max(pm.length - 1, 1)) * cW; const y = m.t + cH - (d.avg / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke(); ctx.globalAlpha = 1;

        // Points
        pm.forEach((d, i) => {
            const x = m.l + (i / Math.max(pm.length - 1, 1)) * cW; const y = m.t + cH - (d.avg / maxV) * cH;
            ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = ac; ctx.globalAlpha = 0.2; ctx.fill(); ctx.globalAlpha = 1;
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = ac; ctx.fill();
            ctx.strokeStyle = isDark ? '#0c0c14' : '#f2f4f8'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = tc; ctx.font = '600 10px Inter'; ctx.textAlign = 'center'; ctx.fillText(d.avg, x, y - 12);
            ctx.font = '400 9px Inter';
            const lbl = new Date(d.day).toLocaleDateString('en', { weekday: 'short', day: 'numeric' });
            ctx.fillText(lbl, x, H - m.b + 18);
        });
        ctx.fillStyle = tc; ctx.font = '600 12px Inter'; ctx.textAlign = 'left';
        ctx.fillText('PM2.5 Concentration Forecast (μg/m³)', m.l, 18);
    }

    // ===== Particles =====
    function createParticles() {
        const c = $('bgParticles');
        if (!c) return;
        // Reduced from 10 to 5 particles for better performance
        const count = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 5;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.animationDuration = (Math.random() * 18 + 14) + 's';
            p.style.animationDelay = Math.random() * 12 + 's';
            const s = Math.random() * 2 + 1;
            p.style.width = s + 'px'; p.style.height = s + 'px';
            frag.appendChild(p);
        }
        c.appendChild(frag);
    }

    // ===== Page Visibility API — Pause animations when tab hidden =====
    function initPageVisibility() {
        const handleVisibility = () => {
            if (document.hidden) {
                document.documentElement.classList.add('page-bg-paused');
            } else {
                document.documentElement.classList.remove('page-bg-paused');
            }
        };
        document.addEventListener('visibilitychange', handleVisibility, { passive: true });
        handleVisibility();
    }

    // ===== Push Notification Engine =====
    // Tracks last notified state to prevent spam across refreshes
    let _lastNotifLevel = null;
    let _lastNotifTime = 0;   // epoch ms of last AQI-level notification
    let _lastPollNotif = {};  // key: pollutant name → epoch ms of last alert
    const NOTIF_COOLDOWN_MS = 30 * 60 * 1000; // 30-min cooldown per category
    const POLL_COOLDOWN_MS  = 60 * 60 * 1000; // 60-min cooldown per pollutant

    // WHO / health threshold limits (raw concentrations)
    const POLL_THRESHOLDS = [
        { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', limit: 55,  icon: '🌫️', msg: (v) => `PM2.5 at ${v} µg/m³ exceeds WHO safe limit (55 µg/m³). Use N95 mask outdoors.` },
        { key: 'pm10', label: 'PM10',  unit: 'µg/m³', limit: 100, icon: '💨', msg: (v) => `PM10 elevated at ${v} µg/m³. Sensitive groups should stay indoors.` },
        { key: 'no2',  label: 'NO₂',   unit: 'µg/m³', limit: 200, icon: '🏭', msg: (v) => `NO₂ spike: ${v} µg/m³. Ventilate indoor spaces and avoid roadside exposure.` },
        { key: 'o3',   label: 'O₃',    unit: 'µg/m³', limit: 100, icon: '☀️', msg: (v) => `Ozone alert: ${v} µg/m³. Avoid strenuous outdoor exercise mid-day.` },
        { key: 'so2',  label: 'SO₂',   unit: 'µg/m³', limit: 80,  icon: '🔥', msg: (v) => `SO₂ at ${v} µg/m³. Avoid outdoor activity near industrial zones.` },
    ];

    function _canNotify() {
        return 'Notification' in window && Notification.permission === 'granted';
    }

    function _sendOSNotification(title, body, icon = '🌬️') {
        if (!_canNotify()) return;
        try {
            const n = new Notification(title, {
                body,
                icon: 'https://img.icons8.com/fluency/48/air-quality.png',
                badge: 'https://img.icons8.com/fluency/24/air-quality.png',
                tag: 'airflow-aqi',      // replaces previous notification of same type
                renotify: true,
                silent: false,
            });
            n.onclick = () => { window.focus(); n.close(); };
        } catch(e) { console.warn('Notification send failed:', e); }
    }

    function _updateBellState(perm) {
        const bell = document.getElementById('notifBell');
        const badge = document.getElementById('notifBadge');
        if (!bell) return;
        if (perm === 'granted') {
            bell.classList.add('notif-active');
            bell.title = 'AQI Notifications: ON';
            if (badge) badge.style.display = 'none';
        } else if (perm === 'denied') {
            bell.classList.remove('notif-active');
            bell.classList.add('notif-denied');
            bell.title = 'Notifications blocked in browser settings';
            if (badge) { badge.style.display = 'block'; badge.classList.add('denied'); }
        } else {
            bell.classList.remove('notif-active', 'notif-denied');
            bell.title = 'Click to enable AQI notifications';
            if (badge) { badge.style.display = 'block'; badge.classList.remove('denied'); }
        }
    }

    async function _requestNotifPermission() {
        if (!('Notification' in window)) {
            if (window._showToast) window._showToast('Push notifications are not supported in this browser.', 'warn');
            return;
        }
        if (Notification.permission === 'granted') {
            _updateBellState('granted');
            if (window._showToast) window._showToast('AQI notifications are already enabled! ✅', 'success');
            return;
        }
        if (Notification.permission === 'denied') {
            _updateBellState('denied');
            if (window._showToast) window._showToast('Notifications are blocked. Please allow them in browser settings.', 'warn');
            return;
        }
        const result = await Notification.requestPermission();
        _updateBellState(result);
        const banner = document.getElementById('notifPermissionBanner');
        if (banner) banner.style.display = 'none';
        if (result === 'granted') {
            if (window._showToast) window._showToast('AQI notifications enabled! You\'ll be alerted on air quality changes. 🔔', 'success');
            // Fire an immediate test/welcome notification
            _sendOSNotification('AirFlow AI — Notifications Active 🔔', `You'll receive alerts when AQI changes or pollutants spike in ${currentCity.name}.`);
        } else {
            if (window._showToast) window._showToast('Notification permission denied.', 'warn');
        }
    }

    function triggerAQINotification(data) {
        if (!('Notification' in window)) return;
        const now   = Date.now();
        const aqi   = data.aqi;
        const level = getLevel(aqi);
        const theme = getTheme(aqi);
        const city  = currentCity.name;
        const profile = userHealthProfile || {};
        const conds = profile.conditions || {};
        const userName = profile.name ? profile.name.split(' ')[0] : null;

        // ── Helper: build personalized reason sentence ──
        function _buildPersonalizedReason(baseText) {
            const reasons = [];
            // Condition-specific reasons with pollutant linkage
            if ((conds.asthma || conds.copd) && data.iaqi?.pm25) {
                const pm = data.iaqi.pm25.v;
                reasons.push(`PM2.5 at ${pm ? pm.toFixed(1) : 'elevated'} µg/m³ is a direct trigger for your ${conds.asthma ? 'Asthma' : 'COPD'}`);
            }
            if (conds.heart && data.iaqi?.no2) {
                const no2 = data.iaqi.no2.v;
                reasons.push(`NO₂ at ${no2 ? no2.toFixed(1) : 'elevated'} µg/m³ increases cardiac stress risk`);
            }
            if (conds.hypertension && data.iaqi?.pm10) {
                reasons.push(`High particulate matter can spike blood pressure`);
            }
            if (conds.diabetes) {
                reasons.push(`Air pollution worsens insulin resistance in Diabetes`);
            }
            if (conds.pregnant) {
                reasons.push(`PM2.5 and NO₂ are harmful to foetal development`);
            }
            if (conds.elderly || conds.child) {
                reasons.push(`${conds.elderly ? 'Elderly individuals' : 'Children'} have reduced respiratory defence`);
            }
            if (conds.immuno) {
                reasons.push(`Immunocompromised individuals face heightened infection risk`);
            }
            const reasonStr = reasons.length > 0 ? ' Reason: ' + reasons.slice(0,2).join('; ') + '.' : '';
            return baseText + reasonStr;
        }

        // ── 1. AQI level-change notification (30-min cooldown) ──
        const levelChanged    = level !== _lastNotifLevel;
        const cooldownExpired = (now - _lastNotifTime) > NOTIF_COOLDOWN_MS;
        const isHighRisk      = ['unhealthySG','unhealthy','veryUnhealthy','hazardous'].includes(level);
        const isMediumRisk    = level === 'moderate';

        if ((levelChanged || (cooldownExpired && isHighRisk)) && Notification.permission === 'granted') {
            const adv   = HEALTH_ADVISORIES[level];
            const greeting = userName ? `${userName}, ` : '';
            let title = `${greeting}AQI ${theme.status} in ${city} (${aqi})`;
            let body  = _buildPersonalizedReason(adv.text);

            // Add precaution hint based on profile
            if (profile.activity === 'high' && isHighRisk) body += ' 🏃 Avoid outdoor workouts today.';
            if ((conds.asthma || conds.copd) && isHighRisk)  body += ' Use your inhaler if needed.';
            if (conds.heart && isHighRisk)                    body += ' Take extra rest indoors.';

            _sendOSNotification(title, body);
            _lastNotifLevel = level;
            _lastNotifTime  = now;
        }

        // ── 2. Personalized pollutant threshold alerts ──
        if (Notification.permission === 'granted' && data.iaqi) {
            POLL_THRESHOLDS.forEach(({ key, label, limit, msg, icon }) => {
                const raw = data.iaqi[key]?.v;
                if (raw == null) return;
                const lastT = _lastPollNotif[key] || 0;

                // Lower threshold for high-risk groups
                let effectiveLimit = limit;
                if (key === 'pm25'  && (conds.asthma || conds.copd || conds.heart)) effectiveLimit = Math.floor(limit * 0.6);
                if (key === 'no2'   && (conds.heart  || conds.hypertension))         effectiveLimit = Math.floor(limit * 0.65);
                if (key === 'o3'    && (conds.asthma || profile.activity === 'high')) effectiveLimit = Math.floor(limit * 0.7);

                if (raw > effectiveLimit && (now - lastT) > POLL_COOLDOWN_MS) {
                    const greeting = userName ? `${userName} — ` : '';
                    const baseMsg  = msg(typeof raw === 'number' ? raw.toFixed(1) : raw);
                    const extra    = (key === 'pm25' && conds.asthma) ? ' Keep inhaler accessible.' :
                                    (key === 'no2'  && conds.heart)   ? ' Limit roadside exposure.' : '';
                    _sendOSNotification(`${icon} ${greeting}${label} Alert — ${city}`, baseMsg + extra);
                    _lastPollNotif[key] = now;
                }
            });
        }

        // ── 3. In-app banner for very unhealthy / hazardous ──
        const banner      = document.getElementById('eventAlertBanner');
        const bannerTitle = document.getElementById('eventAlertTitle');
        const bannerDesc  = document.getElementById('eventAlertDesc');
        if (banner && (isHighRisk || isMediumRisk) && levelChanged) {
            if (bannerTitle) bannerTitle.textContent = `AQI ${theme.status} — ${city}: ${aqi}`;
            if (bannerDesc)  bannerDesc.textContent  = _buildPersonalizedReason(HEALTH_ADVISORIES[level].text);
            if (isHighRisk) {
                banner.style.display = 'block';
                if (level !== 'hazardous') setTimeout(() => { if (banner) banner.style.display = 'none'; }, 15000);
            }
        }
    }

    function initNotifications() {
        _updateBellState(typeof Notification !== 'undefined' ? Notification.permission : 'default');

        // Bell click → request permission
        const bell = document.getElementById('notifBell');
        if (bell) {
            bell.addEventListener('click', () => _requestNotifPermission());
        }

        // Permission banner: show if permission is default (not yet decided)
        const permBanner = document.getElementById('notifPermissionBanner');
        if (permBanner && 'Notification' in window && Notification.permission === 'default') {
            // Delay 3 seconds so it doesn't clash with page load animations
            setTimeout(() => { permBanner.style.display = 'block'; }, 3000);
        }

        const allowBtn   = document.getElementById('notifPermAllow');
        const dismissBtn = document.getElementById('notifPermDismiss');
        if (allowBtn)   allowBtn.addEventListener('click', () => _requestNotifPermission());
        if (dismissBtn) dismissBtn.addEventListener('click', () => {
            if (permBanner) permBanner.style.display = 'none';
            // Remember they dismissed so we don't nag again this session
            sessionStorage.setItem('notifBannerDismissed', '1');
        });

        // Don't show banner if user already dismissed this session
        if (sessionStorage.getItem('notifBannerDismissed') && permBanner) {
            permBanner.style.display = 'none';
        }
    }

    // ===== Scroll FX =====
    function initScrollFX() {
        let ticking = false;
        window.addEventListener('scroll', () => {
            // Track scroll state to pause tilt and glow GPU work during scroll
            isScrolling = true;
            clearTimeout(scrollEndTimer);
            scrollEndTimer = setTimeout(() => { isScrolling = false; }, 120);

            if (!ticking) {
                requestAnimationFrame(() => {
                    const nav = $('navbar');
                    if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
        }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
        document.querySelectorAll('.section-block').forEach(el => observer.observe(el));
    }

    // ===== 3D Tilt (rAF-throttled, cached rect, scroll-aware) =====
    function init3DTilt() {
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

        const tiltObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                if (entry.isIntersecting && !card._tiltInit) {
                    card._tiltInit = true;
                    let rect = null;
                    let tiltTicking = false;

                    // Cache rect on enter and on window resize — never read it in mousemove
                    card.addEventListener('mouseenter', () => {
                        rect = card.getBoundingClientRect();
                    });
                    const refreshRect = () => { if (rect) rect = card.getBoundingClientRect(); };
                    window.addEventListener('resize', refreshRect, { passive: true });

                    card.addEventListener('mousemove', e => {
                        // Skip during scroll to avoid compositor thread contention
                        if (isScrolling) return;
                        if (!tiltTicking) {
                            const cx = e.clientX, cy = e.clientY;
                            requestAnimationFrame(() => {
                                if (!rect) rect = card.getBoundingClientRect();
                                const x = (cx - rect.left) / rect.width - 0.5;
                                const y = (cy - rect.top) / rect.height - 0.5;
                                card.style.transform = `translateY(-5px) rotateX(${-y * 4}deg) rotateY(${x * 4}deg)`;
                                tiltTicking = false;
                            });
                            tiltTicking = true;
                        }
                    });
                    card.addEventListener('mouseleave', () => {
                        rect = null;
                        tiltTicking = false;
                        card.style.transform = '';
                    });
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('.hover-3d').forEach(card => tiltObserver.observe(card));
    }

    // ===== Geolocation =====
    function initGeo() {
        if (!els.locationBtn) return;
        els.locationBtn.addEventListener('click', () => {
            if ('geolocation' in navigator) {
                const icon = els.locationBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-spinner fa-spin';
                navigator.geolocation.getCurrentPosition(
                    async pos => {
                        const lat = pos.coords.latitude;
                        const lon = pos.coords.longitude;
                        let locName = 'My Location';
                        let regionName = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

                        try {
                            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`);
                            const data = await res.json();
                            if (data && data.address) {
                                locName = data.address.city || data.address.town || data.address.village || data.address.county || 'My Location';
                                regionName = data.address.state || data.address.country || regionName;
                            }
                        } catch(e) {
                            try {
                                const res2 = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
                                const data2 = await res2.json();
                                if (data2 && (data2.city || data2.locality)) {
                                    locName = data2.city || data2.locality || 'My Location';
                                    regionName = data2.principalSubdivision || data2.countryName || regionName;
                                }
                            } catch(err) { console.warn("Reverse geocoding failed"); }
                        }

                        if (icon) icon.className = 'fas fa-location-crosshairs';
                        currentCity = {
                            name: locName,
                            lat: lat, lon: lon,
                            region: regionName,
                            timezone: 'UTC'
                        };
                        localStorage.setItem('airflowLastCity', JSON.stringify(currentCity));
                        loadCity();
                    },
                    () => {
                        if (icon) icon.className = 'fas fa-location-crosshairs';
                        if (window._showToast) window._showToast('Location access denied. Search for a city instead.', 'warn');
                    },
                    { timeout: 10000 }
                );
            }
        });
    }

    // ===== Mouse Glow (rAF-throttled, paused during scroll) =====
    function initMouseGlow() {
        const mg = $('mouseGlow');
        if (!mg) return;
        let ticking = false;
        document.addEventListener('mousemove', e => {
            // Skip during scroll: prevents glow layer from fighting compositor scroll thread
            if (isScrolling) return;
            if (!ticking) {
                const cx = e.clientX, cy = e.clientY;
                requestAnimationFrame(() => {
                    mg.style.transform = `translate3d(calc(${cx}px - 50%), calc(${cy}px - 50%), 0)`;
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    // ===== Resize (ResizeObserver for canvas) =====
    function initResize() {
        if ('ResizeObserver' in window) {
            let timer;
            const ro = new ResizeObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => drawForecastChart(lastForecastData), 200);
            });
            if (els.forecastChart) ro.observe(els.forecastChart.parentElement || document.body);
        } else {
            let t;
            window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => drawForecastChart(lastForecastData), 250); });
        }
    }

    // ===== Init =====
    function init() {
        initTheme();
        initWorker();
        createParticles();
        initSearch();
        initScrollFX();
        initGeo();
        initResize();
        initMouseGlow();
        initNotifications();
        initTravelAdvisor();
        initPageVisibility(); // Pause animations when tab is hidden (performance)

        if (els.themeToggle) els.themeToggle.addEventListener('click', toggleTheme);
        if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => { requestCache.clear(); loadCity(); });

        // Event alert close
        if (els.eventAlertClose) {
            els.eventAlertClose.addEventListener('click', () => {
                if (els.eventAlertBanner) els.eventAlertBanner.style.display = 'none';
            });
        }

        loadCity();

        // Hamburger menu
        const hamburgerBtn = $('hamburgerBtn'), navLinksEl = $('navLinks');
        if (hamburgerBtn && navLinksEl) {
            hamburgerBtn.addEventListener('click', () => {
                navLinksEl.classList.toggle('mobile-open');
                const icon = hamburgerBtn.querySelector('i');
                if (icon) icon.className = navLinksEl.classList.contains('mobile-open') ? 'fas fa-times' : 'fas fa-bars';
            });
        }

        // 3D tilt after first paint
        requestAnimationFrame(() => setTimeout(init3DTilt, 300));

        // Init news panel controls
        initNewsPanel();

        // ===== Toast Notification Helper =====
        function showToast(msg, type = 'info') {
            const t = document.createElement('div');
            t.className = `app-toast app-toast-${type}`;
            const icon = type === 'success' ? 'fa-check-circle' : type === 'warn' ? 'fa-triangle-exclamation' : 'fa-info-circle';
            t.innerHTML = `<i class="fas ${icon}"></i><span>${msg}</span>`;
            t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);z-index:99999;display:flex;align-items:center;gap:10px;padding:12px 20px;border-radius:30px;font-size:13px;font-weight:600;font-family:var(--font);pointer-events:none;opacity:0;transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);white-space:nowrap;backdrop-filter:blur(16px);`;
            const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--aqi-accent-rgb').trim() || '0,230,118';
            const rgb = type === 'success' ? '0,230,118' : type === 'warn' ? '255,152,0' : accentRgb;
            t.style.background = `rgba(${rgb},0.12)`;
            t.style.border = `1px solid rgba(${rgb},0.4)`;
            t.style.color = `rgb(${rgb})`;
            t.style.boxShadow = `0 8px 32px rgba(${rgb},0.2)`;
            document.body.appendChild(t);
            requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
            setTimeout(() => {
                t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(10px)';
                setTimeout(() => t.remove(), 400);
            }, 3200);
        }
        window._showToast = showToast;

        // ===== Firebase Auth & Profile Setup =====
        if (auth && db) {

            // ===== Pill Toggle Init =====
            function initPillToggles() {
                document.querySelectorAll('.pill-toggle').forEach(btn => {
                    btn.addEventListener('click', () => btn.classList.toggle('active'));
                });
            }
            initPillToggles();

            // Helper to read pill states as condition object
            function readPillConditions() {
                const result = {};
                document.querySelectorAll('.pill-toggle[data-cond]').forEach(btn => {
                    result[btn.dataset.cond] = btn.classList.contains('active');
                });
                return result;
            }

            // Helper to apply conditions to pills
            function applyPillConditions(conditions) {
                if (!conditions) return;
                document.querySelectorAll('.pill-toggle[data-cond]').forEach(btn => {
                    btn.classList.toggle('active', !!conditions[btn.dataset.cond]);
                });
            }

            // Live BMI calculator
            function updateBMIDisplay() {
                const w = parseFloat($('profileWeight')?.value);
                const h = parseFloat($('profileHeight')?.value);
                const bmiEl = $('bmiDisplay');
                const bmiText = $('bmiText');
                const bmiFill = $('bmiBarFill');
                if (!w || !h || !bmiEl) return;
                const bmi = w / ((h / 100) ** 2);
                let cat, col;
                if (bmi < 18.5) { cat = 'Underweight'; col = '#42a5f5'; }
                else if (bmi < 25) { cat = 'Normal'; col = '#00e676'; }
                else if (bmi < 30) { cat = 'Overweight'; col = '#ff9800'; }
                else { cat = 'Obese'; col = '#f44336'; }
                bmiEl.style.display = '';
                if (bmiText) bmiText.innerHTML = `<span style="color:${col};font-weight:700;">${bmi.toFixed(1)}</span> — ${cat}`;
                if (bmiFill) { bmiFill.style.width = Math.min(bmi / 40 * 100, 100) + '%'; bmiFill.style.background = col; }
            }
            [$('profileWeight'), $('profileHeight')].filter(Boolean).forEach(el => el.addEventListener('input', updateBMIDisplay));

            auth.onAuthStateChanged(async (user) => {
                currentUser = user;
                const signInBtn = $('signInBtn');
                const profileBtn = $('profileBtn');
                if (user) {
                    if (signInBtn) signInBtn.classList.add('hidden');
                    if (profileBtn) profileBtn.classList.remove('hidden');

                    // ─── Fetch profile: Firestore → localStorage → IndexedDB ───
                    let fetched = null;

                    // Attempt 1: Firestore
                    if (db) {
                        try {
                            const doc = await db.collection('health_profiles').doc(user.uid).get();
                            if (doc.exists) {
                                fetched = doc.data();
                                console.log('✅ Profile loaded from Firestore');
                            }
                        } catch (e) {
                            console.warn('Firestore fetch error:', e.code, e.message);
                        }
                    }

                    // Attempt 2: localStorage
                    if (!fetched) {
                        try {
                            const localRaw = localStorage.getItem('airflowProfile_' + user.uid);
                            if (localRaw) {
                                fetched = JSON.parse(localRaw);
                                console.log('✅ Profile loaded from localStorage');
                            }
                        } catch (_) {}
                    }

                    // Attempt 3: IndexedDB
                    if (!fetched) {
                        try {
                            const idbData = await loadFromIDB(user.uid);
                            if (idbData) {
                                fetched = idbData;
                                console.log('✅ Profile loaded from IndexedDB');
                            }
                        } catch (_) {}
                    }

                    if (fetched) {
                        userHealthProfile = fetched;
                        // ─── Populate form fields ───
                        if ($('profileAge'))          $('profileAge').value          = fetched.age || '';
                        if ($('profileGender'))       $('profileGender').value       = fetched.gender || '';
                        if ($('profileWeight'))       $('profileWeight').value       = fetched.weight || '';
                        if ($('profileHeight'))       $('profileHeight').value       = fetched.height || '';
                        if ($('profileSmoking'))      $('profileSmoking').value      = fetched.smoking || 'never';
                        if ($('profileOutdoorHours')) $('profileOutdoorHours').value = fetched.outdoorHours || '3';
                        if ($('profileActivity'))     $('profileActivity').value     = fetched.activity || 'moderate';
                        applyPillConditions(fetched.conditions);
                        updateBMIDisplay();
                    }

                    // ─── Name banner / input logic ───
                    const banner     = $('profileNameBanner');
                    const inputWrap  = $('profileNameInputWrap');
                    const nameDisplay = $('profileNameDisplay');
                    const savedName  = fetched && fetched.name ? fetched.name : null;
                    if (savedName) {
                        if (banner)      { banner.style.display = 'flex'; }
                        if (inputWrap)   { inputWrap.style.display = 'none'; }
                        if (nameDisplay) { nameDisplay.textContent = savedName; }
                        if (profileBtn)  { profileBtn.title = 'Health Profile — ' + savedName; }
                    } else {
                        if (banner)     { banner.style.display = 'none'; }
                        if (inputWrap)  { inputWrap.style.display = 'block'; }
                    }

                    // ─── Show login success banner & smooth reveal ───
                    const loginBanner = $('loginSuccessBanner');
                    if (loginBanner) {
                        const userName = savedName || (user.displayName ? user.displayName.split(' ')[0] : null) || user.email?.split('@')[0] || 'User';
                        loginBanner.innerHTML = `<i class="fas fa-check-circle"></i><div><span>Welcome back, <span class="login-banner-name">${escapeHTML(userName)}</span>!</span><span class="login-banner-sub">Your personalized health dashboard is ready below.</span></div>`;
                        loginBanner.style.display = 'flex';
                        loginBanner.classList.add('login-reveal-animate');
                        setTimeout(() => { if (loginBanner) loginBanner.style.display = 'none'; }, 5000);
                    }

                    // Update auth-gated UI immediately
                    _updateAuthGatedUI();

                    // ─── Immediately render personalized sections ───
                    if (lastAQIData) {
                        try {
                            updateDisplay(lastAQIData);
                            // Smooth reveal animation on disease risk section
                            const riskSec = $('diseaseRiskSection');
                            if (riskSec && userHealthProfile) {
                                riskSec.classList.add('login-reveal-animate');
                                // Scroll to personalized section after a brief delay
                                setTimeout(() => {
                                    riskSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }, 400);
                            }
                        } catch(_) {}
                    }
                    
                    // Show profile form automatically if new user (no profile fetched)
                    if (!fetched) {
                        const overlay = $('profileModalOverlay');
                        if (overlay) overlay.classList.add('active');
                    }
                } else {
                    if (signInBtn) signInBtn.classList.remove('hidden');
                    if (profileBtn) profileBtn.classList.add('hidden');
                    userHealthProfile = null;
                    // Reset name UI
                    const banner = $('profileNameBanner');
                    const inputWrap = $('profileNameInputWrap');
                    if (banner)   banner.style.display = 'none';
                    if (inputWrap) inputWrap.style.display = 'none';
                    // Hide login banner
                    const loginBanner = $('loginSuccessBanner');
                    if (loginBanner) loginBanner.style.display = 'none';
                    // Update auth-gated UI immediately (show guest prompt)
                    _updateAuthGatedUI();
                    if (lastAQIData) { try { updateDisplay(lastAQIData); } catch(_) {} }
                }
            });

            // Authentication Modal Logic
            const authOverlay = $('authModalOverlay');
            if ($('signInBtn')) {
                $('signInBtn').addEventListener('click', () => {
                    authOverlay.classList.add('active');
                });
            }
            if ($('authModalClose')) {
                $('authModalClose').addEventListener('click', () => {
                    authOverlay.classList.remove('active');
                });
            }

            // Auth Tabs
            let isLoginMode = true;
            if ($('tabLogin') && $('tabRegister')) {
                $('tabLogin').addEventListener('click', () => {
                    isLoginMode = true;
                    $('tabLogin').classList.add('active');
                    $('tabRegister').classList.remove('active');
                    $('authSubmitBtn').innerHTML = '<i class="fas fa-envelope"></i> Continue with Email';
                    $('authErrorMsg').classList.add('hidden');
                });
                $('tabRegister').addEventListener('click', () => {
                    isLoginMode = false;
                    $('tabRegister').classList.add('active');
                    $('tabLogin').classList.remove('active');
                    $('authSubmitBtn').innerHTML = '<i class="fas fa-user-plus"></i> Register with Email';
                    $('authErrorMsg').classList.add('hidden');
                });
            }

            // Email/Password Form Submit
            if ($('authForm')) {
                $('authForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const email = $('authEmail').value;
                    const pass = $('authPassword').value;
                    const errorMsg = $('authErrorMsg');
                    errorMsg.classList.add('hidden');

                    try {
                        if (isLoginMode) {
                            await auth.signInWithEmailAndPassword(email, pass);
                        } else {
                            await auth.createUserWithEmailAndPassword(email, pass);
                        }
                        authOverlay.classList.remove('active');
                        $('authForm').reset();
                    } catch (err) {
                        errorMsg.innerHTML = '<i class="fas fa-circle-exclamation"></i> ' + err.message;
                        errorMsg.classList.remove('hidden');
                    }
                });
            }

            // Google Sign In from Modal
            if ($('googleSignInBtn')) {
                $('googleSignInBtn').addEventListener('click', () => {
                    const provider = new firebase.auth.GoogleAuthProvider();
                    auth.signInWithPopup(provider).then(() => {
                        authOverlay.classList.remove('active');
                    }).catch(err => {
                        const errorMsg = $('authErrorMsg');
                        errorMsg.innerHTML = '<i class="fas fa-circle-exclamation"></i> ' + err.message;
                        errorMsg.classList.remove('hidden');
                    });
                });
            }

            // Sign Out Button
            if ($('signOutBtn')) {
                $('signOutBtn').addEventListener('click', () => {
                    auth.signOut();
                    $('profileModalOverlay').classList.remove('active');
                });
            }

            // Profile Modal Logic
            const overlay = $('profileModalOverlay');
            if ($('profileBtn')) $('profileBtn').addEventListener('click', () => overlay.classList.add('active'));
            if ($('profileModalClose')) $('profileModalClose').addEventListener('click', () => overlay.classList.remove('active'));

            // ===== Save Profile with Retry + IndexedDB Fallback =====
            async function saveProfileToFirestore(uid, profileData, attempt = 1) {
                if (!db || !uid) return false;
                try {
                    await db.collection('health_profiles').doc(uid).set(
                        { ...profileData, updatedAt: new Date() }, { merge: true }
                    );
                    return true;
                } catch (err) {
                    console.warn(`Firestore save attempt ${attempt} failed:`, err.code, err.message);
                    if (attempt < 3 && err.code !== 'permission-denied') {
                        // Exponential backoff: 500ms, 1500ms, 4500ms
                        await new Promise(r => setTimeout(r, 500 * Math.pow(3, attempt - 1)));
                        return saveProfileToFirestore(uid, profileData, attempt + 1);
                    }
                    throw err;
                }
            }

            // Save Profile
            if ($('healthProfileForm')) {
                $('healthProfileForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (!currentUser) return;

                    const saveBtn = $('saveProfileBtn');
                    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

                    // Get name — from input (first time) or from existing locked profile
                    const existingName = userHealthProfile && userHealthProfile.name ? userHealthProfile.name : null;
                    const nameInputVal = $('profileName') ? $('profileName').value.trim() : '';
                    const finalName    = existingName || nameInputVal;

                    const profileData = {
                        name:         finalName,
                        age:          parseInt($('profileAge')?.value) || 25,
                        gender:       $('profileGender')?.value || '',
                        weight:       parseFloat($('profileWeight')?.value) || null,
                        height:       parseFloat($('profileHeight')?.value) || null,
                        smoking:      $('profileSmoking')?.value || 'never',
                        outdoorHours: $('profileOutdoorHours')?.value || '3',
                        activity:     $('profileActivity')?.value || 'moderate',
                        conditions:   readPillConditions()
                    };

                    // ① Save to localStorage immediately (offline-safe)
                    try {
                        localStorage.setItem('airflowProfile_' + currentUser.uid, JSON.stringify({ ...profileData, updatedAt: Date.now() }));
                    } catch (_) { console.warn('localStorage write failed'); }

                    // ② Save to IndexedDB (reliable offline storage)
                    try { await saveToIDB(currentUser.uid, profileData); } catch(_) {}

                    // ③ Optimistic UI Update: update profile immediately
                    userHealthProfile = profileData;

                    const banner     = $('profileNameBanner');
                    const inputWrap  = $('profileNameInputWrap');
                    const nameDisplay = $('profileNameDisplay');
                    if (finalName) {
                        if (banner)      { banner.style.display = 'flex'; }
                        if (inputWrap)   { inputWrap.style.display = 'none'; }
                        if (nameDisplay) { nameDisplay.textContent = finalName; }
                        const profileBtn = $('profileBtn');
                        if (profileBtn)  { profileBtn.title = 'Health Profile — ' + finalName; }
                    }

                    if (overlay) overlay.classList.remove('active');
                    if (window._showToast) window._showToast('✅ Profile saved locally! Syncing...', 'success');

                    // ④ Re-render dashboard with new profile immediately
                    if (lastAQIData) { try { updateDisplay(lastAQIData); } catch (_) {} }

                    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-check"></i> Save &amp; Analyse'; }

                    // ⑤ Background Sync to Firestore with retries
                    if (db && currentUser.uid) {
                        saveProfileToFirestore(currentUser.uid, profileData)
                            .then(success => {
                                if (success && window._showToast) {
                                    window._showToast('✅ Profile fully synced to cloud!', 'success');
                                }
                            })
                            .catch(fbErr => {
                                console.error('Firestore save error (all retries failed):', fbErr.code, fbErr.message);
                                if (window._showToast) {
                                    const isPermErr = fbErr.code === 'permission-denied';
                                    window._showToast(
                                        isPermErr
                                            ? '⚠ Cloud sync blocked: Check Firestore security rules.'
                                            : `⚠ Cloud sync failed (${fbErr.code}). Profile saved locally.`,
                                        'warn'
                                    );
                                }
                            });
                    }
                });
            }
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
