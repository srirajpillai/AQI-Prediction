# AirFlow AI — Version 1: Web / Browser Interface

**AirFlow AI (Version 1)** is a 100% client-side web platform built with Vanilla **HTML5, CSS3, and JavaScript (ES6+)** with a multi-threaded browser **Web Worker (`worker.js`)** for client-side AI computations.

No Python or backend server is required — it connects directly to open environmental APIs from the browser.

---

## 🌟 Key Features
- **Real-Time AQI Tracking:** Dynamic 3D animated circular gauge with real-time severity styling.
- **24-Hour AI Forecast:** Hourly AQI prediction trajectory with environmental factor justifications calculated in the browser Web Worker.
- **Cross-City Transfer Learning:** Analyzes wind vectors and upwind neighboring cities (40km radius) to assess atmospheric dispersion using Haversine formulas.
- **Pollutant Breakdown Grid:** Dedicated progress bars and health descriptors for **PM2.5, PM10, O3, NO2, SO2, and CO**.
- **Explainable AI (SHAP):** Visual feature importance charts using Chart.js.
- **Global Search:** Multi-API fallback (Open-Meteo, Nominatim, Photon).
- **Glassmorphism Design:** Modern UI with Dark/Light theme switching, mouse-glow tracking, and responsive layout.

---

## 📁 File Structure
```
version1/
├── index.html          # Main dashboard interface
├── know-how.html       # Explainable AI (SHAP) & medical encyclopedia
├── about.html          # Project methodology & team info
├── styles.css          # Glassmorphism design system & animations
├── styles_backup.css   # Backup stylesheet
├── news_addon.css      # Addon styles
├── addon.txt           # Notes & addon definitions
├── app.js              # Dashboard client logic & API integrations
├── know-how.js         # Know-how page logic
├── about.js            # About page logic
├── worker.js           # Browser Web Worker for AI computations
└── README.md           # This documentation
```

---

## 🚀 How to Run

### Option 1: Direct Browser Launch
Simply double-click **`index.html`** or right-click and choose **"Open with Chrome / Edge / Firefox"**.

### Option 2: Using Any Static Web Server
You can serve the folder using any lightweight web server:

**VS Code Live Server:**
- Right-click `index.html` → **"Open with Live Server"**

**Node.js `serve` / `http-server` / `npx live-server`:**
```bash
npx serve .
# or
npx live-server
```
