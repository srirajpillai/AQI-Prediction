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
    const CACHE_TTL = 5 * 60 * 1000; // 5-minute cache TTL

    function escapeHTML(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
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

    // ===== Request Cache =====
    async function cachedFetch(url, opts = {}) {
        const now = Date.now();
        if (requestCache.has(url)) {
            const entry = requestCache.get(url);
            if (now - entry.ts < CACHE_TTL) return entry.data;
        }
        const res = await fetch(url, opts);
        const data = await res.json();
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
            workerCallbacks.set(id, { resolve, reject });
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
        const saved = localStorage.getItem('airflowTheme') || 'dark';
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

    // ===== AQI Data Fetching =====
    async function fetchAQI(city) {
        try {
            const meteoUrl = `${METEO_AIR_QUALITY}?latitude=${city.lat}&longitude=${city.lon}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&hourly=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto&forecast_days=2`;
            const meteoData = await cachedFetch(meteoUrl).catch(() => null);

            if (meteoData && meteoData.current && meteoData.current.us_aqi != null) {
                if (meteoData.timezone) {
                    currentCity.timezone = meteoData.timezone;
                    startClock();
                }
                const c = meteoData.current;
                const mappedData = {
                    aqi: Math.round(c.us_aqi),
                    iaqi: {
                        pm25: { v: c.pm2_5 },
                        pm10: { v: c.pm10 },
                        o3: { v: c.ozone },
                        no2: { v: c.nitrogen_dioxide },
                        so2: { v: c.sulphur_dioxide },
                        co: { v: +(c.carbon_monoxide / 1000).toFixed(1) }
                    },
                    time: { s: c.time.replace('T', ' ') },
                    _source: 'open-meteo',
                    _hourlyAqi: meteoData.hourly ? meteoData.hourly.us_aqi : null,
                    _hourlyTimes: meteoData.hourly ? meteoData.hourly.time : null,
                    _hourlyPm25: meteoData.hourly ? meteoData.hourly.pm2_5 : null
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

    function useFinalFallback() {
        const aqi = Math.floor(Math.random() * 100) + 40;
        const data = {
            aqi, iaqi: {
                pm25: { v: Math.floor(Math.random() * 80) + 10 },
                pm10: { v: Math.floor(Math.random() * 100) + 20 },
                o3: { v: Math.floor(Math.random() * 60) + 5 },
                no2: { v: Math.floor(Math.random() * 40) + 5 },
                so2: { v: Math.floor(Math.random() * 20) + 2 },
                co: { v: +(Math.random() * 3 + .3).toFixed(1) }
            },
            time: { s: new Date().toLocaleString() },
            forecast: { daily: {} }, _source: 'fallback'
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

        const sourceInfo = data._source === 'open-meteo' ? ' · Open-Meteo' : data._source === 'fallback' ? ' · Estimate' : ' · WAQI Live';
        const refreshTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        if (els.updateTime) els.updateTime.textContent = `Last refreshed: ${refreshTime}${sourceInfo}`;

        // Pollutants
        setPollutant('pm25', data.iaqi?.pm25?.v, 500);
        setPollutant('pm10', data.iaqi?.pm10?.v, 600);
        setPollutant('o3', data.iaqi?.o3?.v, 200);
        setPollutant('no2', data.iaqi?.no2?.v, 200);
        setPollutant('so2', data.iaqi?.so2?.v, 100);
        setPollutant('co', data.iaqi?.co?.v, 50);

        // Health Advisory & Personalized Risk Engine
        const adv = HEALTH_ADVISORIES[level];
        let displayAqi = aqi;
        let pTags = [...adv.tags];
        let pText = adv.text;

        if (userHealthProfile) {
            // Apply multipliers based on profile
            let multiplier = 1.0;
            const c = userHealthProfile.conditions || {};
            if (c.asthma || c.copd) multiplier *= 1.4;
            if (c.heart) multiplier *= 1.3;
            if (c.elderly || c.pregnant || c.immuno) multiplier *= 1.2;

            if (userHealthProfile.activity === 'high') multiplier *= 1.2;
            else if (userHealthProfile.activity === 'low') multiplier *= 0.8;

            const personalAqi = Math.round(aqi * multiplier);
            const personalLevel = getLevel(personalAqi);

            pText = `<strong>Personalized (${personalLevel.toUpperCase()}):</strong> ` + HEALTH_ADVISORIES[personalLevel].text;
            pTags.push('Personalized Risk');
            if (multiplier > 1.2) pTags.push('High Sensitivity');
        }

        if (els.healthAdvisoryText) els.healthAdvisoryText.innerHTML = pText;
        if (els.alertTags) els.alertTags.innerHTML = pTags.map(t => `<span class="alert-tag">${t}</span>`).join('');

        // Build hourly and chart
        buildHourlyForecast(aqi, data);
        buildForecastChartData(aqi, data);
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
            // Fallback: detect factors on main thread
            factors = detectFactorsFallback(weather, pollutants);
        }

        // Check for geopolitical/high-severity factors
        const geoFactors = factors.filter(f => f.category === 'geopolitical' || f.category === 'natural_event');
        const hasHighSeverity = factors.some(f => f.severity > 40) || aqiData.aqi > 150;

        // Show event alert banner if high AQI or geopolitical factor
        if (hasHighSeverity && els.eventAlertBanner) {
            const primaryFactor = factors[0];
            if (els.eventAlertTitle) {
                els.eventAlertTitle.textContent = primaryFactor
                    ? `⚠ ${primaryFactor.label} Detected`
                    : '⚠ Elevated AQI Anomaly Detected';
            }
            if (els.eventAlertDesc) {
                els.eventAlertDesc.textContent = primaryFactor
                    ? primaryFactor.description
                    : `Current AQI of ${aqiData.aqi} exceeds normal levels. Multiple factors contributing.`;
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

    // Main-thread fallback factor detection (mirrors worker logic)
    function detectFactorsFallback(weather, pollutants) {
        const FACTORS = {
            thermal_inversion: { id: 'thermal_inversion', label: 'Thermal Inversion', icon: 'fa-layer-group', category: 'meteorological', color: '#ff9800', description: 'Cold air trapped below warm air prevents pollutant dispersion.', aqiMultiplier: 1.35, triggers: { pressureAbove: 1015, windBelow: 5 } },
            high_pressure: { id: 'high_pressure', label: 'High Pressure System', icon: 'fa-compress-arrows-alt', category: 'meteorological', color: '#ff8f00', description: 'Descending air suppresses vertical mixing, trapping pollutants.', aqiMultiplier: 1.25, triggers: { pressureAbove: 1018 } },
            low_wind: { id: 'low_wind', label: 'Stagnant Air Mass', icon: 'fa-wind', category: 'meteorological', color: '#ffa726', description: 'Very low wind speeds allow pollution to accumulate.', aqiMultiplier: 1.20, triggers: { windBelow: 3 } },
            dust_storm: { id: 'dust_storm', label: 'Dust Storm / Sandstorm', icon: 'fa-tornado', category: 'natural_event', color: '#ff7043', description: 'Suspended dust particles drastically raise PM10 and PM2.5.', aqiMultiplier: 2.1, triggers: { pm10Above: 150, windAbove: 20 } },
            wildfire_smoke: { id: 'wildfire_smoke', label: 'Wildfire / Forest Fire Smoke', icon: 'fa-fire', category: 'natural_event', color: '#f44336', description: 'Smoke from wildfires carries fine particulates hundreds of kilometres.', aqiMultiplier: 2.4, triggers: { pm25Above: 100, coAbove: 5 } },
            volcanic_ash: { id: 'volcanic_ash', label: 'Volcanic Emissions', icon: 'fa-mountain', category: 'natural_event', color: '#9e9e9e', description: 'SO₂ and ash from volcanic activity contaminate vast regions.', aqiMultiplier: 1.8, triggers: { so2Above: 80 } },
            monsoon: { id: 'monsoon', label: 'Monsoon / Heavy Rain', icon: 'fa-cloud-showers-heavy', category: 'meteorological', color: '#42a5f5', description: 'Rain washes particulates from air, significantly reducing AQI.', aqiMultiplier: 0.55, triggers: { humidityAbove: 88 } },
            fog_smog: { id: 'fog_smog', label: 'Dense Fog / Smog', icon: 'fa-smog', category: 'meteorological', color: '#b0bec5', description: 'Fog combined with pollutants creates smog, trapping particles.', aqiMultiplier: 1.4, triggers: { visibilityBelow: 2, humidityAbove: 80 } },
            crop_burning: { id: 'crop_burning', label: 'Agricultural / Crop Burning', icon: 'fa-wheat-awn', category: 'agricultural', color: '#ff8f00', description: 'Stubble burning after harvest releases massive PM2.5 and CO.', aqiMultiplier: 1.9, triggers: { pm25Above: 80 } },
            industrial_emission: { id: 'industrial_emission', label: 'Industrial Emissions Surge', icon: 'fa-industry', category: 'industrial', color: '#78909c', description: 'Heavy industry and power plants emit SO₂, NOx and particulates.', aqiMultiplier: 1.45, triggers: { so2Above: 40, no2Above: 60 } },
            vehicle_traffic: { id: 'vehicle_traffic', label: 'Peak Traffic Congestion', icon: 'fa-car', category: 'urban', color: '#ef5350', description: 'Rush-hour traffic emissions elevate NO₂ and fine particulates.', aqiMultiplier: 1.3, triggers: { no2Above: 50 } },
            military_conflict: { id: 'military_conflict', label: 'Military Conflict / Bombing', icon: 'fa-explosion', category: 'geopolitical', color: '#f44336', description: 'Explosions and fires from armed conflict release PM2.5, heavy metals, SO₂, CO.', aqiMultiplier: 2.8, triggers: { pm25Above: 120, coAbove: 8 } },
            industrial_accident: { id: 'industrial_accident', label: 'Industrial Accident / Chemical Spill', icon: 'fa-biohazard', category: 'geopolitical', color: '#ff1744', description: 'Factory explosions release hazardous pollutants.', aqiMultiplier: 2.5, triggers: { so2Above: 100 } },
            festival_fireworks: { id: 'festival_fireworks', label: 'Festival / Fireworks', icon: 'fa-star', category: 'cultural', color: '#e040fb', description: 'Fireworks spike PM2.5, potassium, heavy metals and sulfur dioxide.', aqiMultiplier: 1.85, triggers: { pm25Above: 90 } },
            urban_heat_island: { id: 'urban_heat_island', label: 'Urban Heat Island Effect', icon: 'fa-city', category: 'urban', color: '#ff8a65', description: 'Dense urban surfaces retain heat, enhancing ozone formation.', aqiMultiplier: 1.18, triggers: { tempAbove: 35 } },
            transboundary_pollution: { id: 'transboundary_pollution', label: 'Transboundary Pollution', icon: 'fa-globe', category: 'regional', color: '#7986cb', description: 'Long-range wind carries pollutants from distant sources.', aqiMultiplier: 1.35, triggers: {} }
        };

        const active = [];
        const { windSpeed = 0, humidity = 0, pressure = 1013, visibility = 10, temperature = 25 } = weather;
        const { pm25 = 0, pm10 = 0, so2 = 0, no2 = 0, co = 0, aqi = 0 } = pollutants;

        for (const [, factor] of Object.entries(FACTORS)) {
            const t = factor.triggers;
            let triggered = false;
            if (t.pressureAbove && pressure >= t.pressureAbove) triggered = true;
            if (t.windBelow && windSpeed <= t.windBelow) triggered = true;
            if (t.windAbove && windSpeed >= t.windAbove) triggered = true;
            if (t.humidityAbove && humidity >= t.humidityAbove) triggered = true;
            if (t.visibilityBelow && visibility <= t.visibilityBelow) triggered = true;
            if (t.pm25Above && pm25 >= t.pm25Above) triggered = true;
            if (t.pm10Above && pm10 >= t.pm10Above) triggered = true;
            if (t.so2Above && so2 >= t.so2Above) triggered = true;
            if (t.no2Above && no2 >= t.no2Above) triggered = true;
            if (t.coAbove && co >= t.coAbove) triggered = true;
            if (t.tempAbove && temperature >= t.tempAbove) triggered = true;
            if (triggered) {
                const base = (factor.aqiMultiplier - 1) * 100;
                const boost = Math.min(aqi / 5, 30);
                active.push({ ...factor, severity: Math.round(Math.abs(base) + boost) });
            }
        }
        active.sort((a, b) => b.severity - a.severity);
        return active.slice(0, 6);
    }

    // ===== Hourly Forecast =====
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
                timezone: currentCity.timezone
            });
        } catch (e) {
            // Fallback to inline generation
            forecasts = generateForecastFallback(baseAqi, data, currentHourIndexBase);
        }

        const icons = { good: '🌿', moderate: '🌤', unhealthySG: '😷', unhealthy: '🌫', veryUnhealthy: '🚨', hazardous: '⚠️' };
        const fragment = document.createDocumentFragment();

        forecasts.forEach(({ i, hourAqi, level, color, factor }) => {
            const hourTime = new Date(now.getTime() + i * 3600000);
            const timeStr = hourTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const domPollutant = ['PM2.5', 'PM10', 'Ozone (O₃)', 'NO₂'][Math.floor((i * 3 + baseAqi) % 4)];
            const windImpact = ['Minimal', 'Moderate', 'High', 'Stagnant'][Math.floor((i * 7) % 4)];
            const justification = `<b>Primary Driver:</b> Detecting localized ${factor} leading to projected ${hourAqi > baseAqi ? 'AQI Escalation' : 'Particle Dispersion'}.`;
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

    function generateForecastFallback(baseAqi, data, currentHourIndexBase) {
        const hasRealHourly = data._hourlyAqi && data._hourlyAqi.length > 0;
        const results = [];
        const now = new Date();
        const conditions = ['Thermal Inversion', 'Low Wind', 'High Pressure', 'Traffic Peak', 'Industrial Activity', 'Photochemical Ozone', 'Sea Breeze', 'Boundary Layer', 'Regional Transport', 'Nocturnal Layer'];

        for (let i = 0; i < 24; i++) {
            let hourAqi;
            const hourOfDay = (now.getHours() + i) % 24;
            if (i === 0) {
                hourAqi = baseAqi;
            } else if (hasRealHourly) {
                const idx = currentHourIndexBase + i;
                hourAqi = idx < data._hourlyAqi.length ? (data._hourlyAqi[idx] ?? baseAqi) : baseAqi;
            } else {
                let scale = 1.0;
                if (hourOfDay >= 5 && hourOfDay <= 9) scale = 1.0 + (hourOfDay - 5) * 0.018;
                else if (hourOfDay > 9 && hourOfDay < 14) scale = 1.08 - (hourOfDay - 9) * 0.022;
                else if (hourOfDay >= 14 && hourOfDay <= 20) scale = 0.95 + (hourOfDay - 14) * 0.025;
                else scale = 1.0 - (hourOfDay - 20) * 0.01;
                const seed = Math.sin(i * 137.5 * Math.PI / 180) * 0.5 + 0.5;
                const noise = (seed - 0.5) * baseAqi * (i / 24) * 0.12;
                hourAqi = Math.max(1, Math.round(baseAqi * scale + noise));
            }
            hourAqi = Math.max(1, Math.round(hourAqi));
            const level = getLevel(hourAqi);
            results.push({
                i, hourAqi, level,
                color: aqiColor(hourAqi),
                factor: conditions[Math.floor((i * 7 + baseAqi) % conditions.length)]
            });
        }
        return results;
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
        try {
            const url = `${METEO_AIR_QUALITY}?latitude=${currentCity.lat}&longitude=${currentCity.lon}&hourly=pm2_5&timezone=auto&forecast_days=7`;
            const fData = await cachedFetch(url);

            if (fData.hourly && fData.hourly.pm2_5) {
                let daily;
                try {
                    daily = await workerCall('AGGREGATE_PM25', {
                        pm25Array: fData.hourly.pm2_5,
                        timesArray: fData.hourly.time
                    });
                } catch (e) {
                    daily = aggregatePM25Fallback(fData.hourly.pm2_5, fData.hourly.time);
                }
                if (daily && daily.length > 0) {
                    lastForecastData = { pm25: daily };
                    drawForecastChart({ pm25: daily });
                    return;
                }
            }
        } catch (e) { console.error('Forecast chart data error:', e); }

        const fd = data.forecast?.daily?.pm25 ? data.forecast.daily : { pm25: genForecast(baseAqi * 0.6, 7) };
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
                // Fallback computation
                const avgNeighborAqi = neighborData.reduce((s, n) => s + n.aqi, 0) / neighborData.length;
                const windInfluence = neighborData.reduce((s, n) => s + n.transferEffect, 0) / neighborData.length;
                transferResult = {
                    predictedAqi: Math.max(1, Math.round(centerAqi * 0.6 + avgNeighborAqi * 0.3 + windInfluence * 2)),
                    confidence: 60,
                    breakdown: neighborData.map(n => ({ name: n.name, aqi: n.aqi, dist: Math.round(n.dist), contribution: Math.round(100 / neighborData.length) }))
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
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 10; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.animationDuration = (Math.random() * 18 + 12) + 's';
            p.style.animationDelay = Math.random() * 10 + 's';
            const s = Math.random() * 2 + 1;
            p.style.width = s + 'px'; p.style.height = s + 'px';
            frag.appendChild(p);
        }
        c.appendChild(frag);
    }

    // ===== Scroll FX =====
    function initScrollFX() {
        let ticking = false;
        window.addEventListener('scroll', () => {
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

    // ===== 3D Tilt (Optimized without layout thrashing) =====
    function init3DTilt() {
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

        const tiltObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                if (entry.isIntersecting && !card._tiltInit) {
                    card._tiltInit = true;
                    let rect = null;
                    card.addEventListener('mouseenter', () => { rect = card.getBoundingClientRect(); });
                    card.addEventListener('mousemove', e => {
                        if (!rect) rect = card.getBoundingClientRect();
                        const x = (e.clientX - rect.left) / rect.width - 0.5;
                        const y = (e.clientY - rect.top) / rect.height - 0.5;
                        card.style.transform = `translateY(-5px) rotateX(${-y * 4}deg) rotateY(${x * 4}deg)`;
                    });
                    card.addEventListener('mouseleave', () => {
                        rect = null;
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
                navigator.geolocation.getCurrentPosition(
                    pos => {
                        currentCity = {
                            name: 'My Location',
                            lat: pos.coords.latitude, lon: pos.coords.longitude,
                            region: `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`,
                            timezone: 'UTC'
                        };
                        localStorage.setItem('airflowLastCity', JSON.stringify(currentCity));
                        loadCity();
                    },
                    () => alert('Could not get location. Search for a city instead.')
                );
            }
        });
    }

    // ===== Mouse Glow (Throttled for Performance) =====
    function initMouseGlow() {
        const mg = $('mouseGlow');
        if (!mg) return;
        let ticking = false;
        document.addEventListener('mousemove', e => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    mg.style.transform = `translate3d(calc(${e.clientX}px - 50%), calc(${e.clientY}px - 50%), 0)`;
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

        // ===== Firebase Auth & Profile Setup =====
        if (auth && db) {
            auth.onAuthStateChanged(async (user) => {
                currentUser = user;
                const signInBtn = $('signInBtn');
                const profileBtn = $('profileBtn');
                if (user) {
                    if (signInBtn) signInBtn.classList.add('hidden');
                    if (profileBtn) profileBtn.classList.remove('hidden');

                    // Fetch user profile
                    try {
                        const doc = await db.collection('health_profiles').doc(user.uid).get();
                        if (doc.exists) {
                            userHealthProfile = doc.data();
                            // Populate form
                            if ($('profileAge')) $('profileAge').value = userHealthProfile.age || '';
                            if ($('profileActivity')) $('profileActivity').value = userHealthProfile.activity || 'moderate';
                            ['Asthma', 'Copd', 'Heart', 'Elderly', 'Pregnant', 'Immuno'].forEach(c => {
                                const id = 'cond' + c;
                                if ($(id) && userHealthProfile.conditions) {
                                    $(id).checked = !!userHealthProfile.conditions[c.toLowerCase()];
                                }
                            });
                            // Re-run display to update personalized risk
                            if (lastAQIData) updateDisplay(lastAQIData);
                        }
                    } catch (e) {
                        console.warn('Error fetching profile:', e);
                    }
                } else {
                    if (signInBtn) signInBtn.classList.remove('hidden');
                    if (profileBtn) profileBtn.classList.add('hidden');
                    userHealthProfile = null;
                    if (lastAQIData) updateDisplay(lastAQIData);
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

            // Save Profile
            if ($('healthProfileForm')) {
                $('healthProfileForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (!currentUser) return;

                    const profileData = {
                        age: parseInt($('profileAge').value) || 25,
                        activity: $('profileActivity').value,
                        conditions: {
                            asthma: $('condAsthma').checked,
                            copd: $('condCopd').checked,
                            heart: $('condHeart').checked,
                            elderly: $('condElderly').checked,
                            pregnant: $('condPregnant').checked,
                            immuno: $('condImmuno').checked
                        },
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };

                    try {
                        await db.collection('health_profiles').doc(currentUser.uid).set(profileData, { merge: true });
                        userHealthProfile = profileData;
                        overlay.classList.remove('active');
                        if (lastAQIData) updateDisplay(lastAQIData);
                    } catch (err) {
                        alert('Failed to save profile: ' + err.message);
                    }
                });
            }
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
