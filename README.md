# AirFlow AI — Version 3: Personalized Health Risk & Activity Advisory Platform

## What's New in Version 3

Version 3 transforms AirFlow AI from a general AQI viewer into a full-stack, personalized health advisory platform:

| Feature | Version 1 | Version 3 |
|---|---|---|
| AQI Display | ✅ | ✅ (enhanced) |
| User Accounts | ❌ | ✅ Firebase Auth |
| Health Profile | ❌ | ✅ 15+ fields |
| Personalized Risk Score | ❌ | ✅ 0–100 score |
| Explainability Panel | ❌ | ✅ Factor breakdown |
| Safe Activity Windows | ❌ | ✅ Hourly heatmap |
| Smart Recommendations | ❌ | ✅ Condition-specific |
| Push Notifications | ❌ | ✅ FCM background alerts |
| ML Model | ❌ | ✅ XGBoost (Kaggle dataset) |
| Hosting | Static file | Firebase Hosting |

---

## Project Structure

```
version3/
├── backend/                    # Python Flask API
│   ├── app.py                  # Flask application factory
│   ├── config.py               # Environment configuration
│   ├── requirements.txt        # Python dependencies
│   ├── cache.py                # In-memory TTL cache
│   ├── models/
│   │   ├── user.py             # Pydantic user & health profile models
│   │   ├── risk_engine.py      # Personalized risk score computation
│   │   └── notification.py     # Notification record model
│   ├── routes/
│   │   ├── auth.py             # POST /api/auth/verify
│   │   ├── profile.py          # GET/POST /api/profile/
│   │   ├── aqi.py              # GET /api/aqi/current
│   │   ├── advisory.py         # GET /api/advisory/summary
│   │   └── notifications.py    # GET /api/notifications/
│   ├── services/
│   │   ├── aqi_service.py      # Open-Meteo AQI data
│   │   ├── geocode_service.py  # City search (Open-Meteo + Nominatim + Photon)
│   │   ├── weather_service.py  # Weather data (wttr.in + Open-Meteo)
│   │   ├── firebase_service.py # Firestore + FCM push notifications
│   │   └── notification_scheduler.py  # APScheduler background job
│   ├── worker/
│   │   └── compute_worker.py   # Background thread compute worker
│   └── ml/
│       ├── train_model.py      # XGBoost training script
│       └── datasets/           # Place city_day.csv here
│
└── frontend/                   # Static web app
    ├── index.html              # Public AQI dashboard
    ├── dashboard.html          # Personalized advisory (auth-gated)
    ├── profile.html            # Health profile setup (4-step form)
    ├── sw.js                   # Service Worker (push notifications)
    ├── styles/
    │   ├── main.css            # Design system
    │   ├── dashboard.css       # Dashboard styles
    │   └── profile.css         # Profile form styles
    └── js/
        ├── auth.js             # Firebase Auth client
        ├── dashboard.js        # Dashboard logic
        ├── profile.js          # Profile form logic
        └── notifications.js    # FCM token management
```

---

## Setup Guide

### 1. Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project (e.g., `airflow-ai-v3`)
3. Enable **Firestore Database** (start in production mode)
4. Enable **Authentication** → Sign-in methods → Email/Password + Google
5. Enable **Cloud Messaging**
6. Go to **Project Settings → Service Accounts** → Generate new private key → save as `firebase-credentials.json` inside `backend/`
7. Go to **Project Settings → Your Apps → Web App** → Copy your config values

### 2. Configure Environment

```bash
cd version3/backend
cp ../.env.example .env
# Edit .env with your Firebase values
```

### 3. Install Python Dependencies

```bash
cd version3/backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

### 4. Train the ML Model (Optional)

Download `city_day.csv` from:
https://www.kaggle.com/datasets/rohanrao/air-quality-data-in-india

Place it in `backend/ml/datasets/city_day.csv`, then:

```bash
cd version3/backend
python ml/train_model.py --evaluate
```

### 5. Update Frontend Firebase Config

In `frontend/js/auth.js`, replace the `FIREBASE_CONFIG` object with your actual Firebase project values.

In `frontend/sw.js`, replace the `__FIREBASE_*__` placeholders with your values.

Set your VAPID key in `frontend/js/notifications.js`.

### 6. Run the Backend

```bash
cd version3/backend
python app.py
# API available at http://localhost:5000
```

### 7. Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init           # Select Hosting + Firestore
firebase deploy --only hosting,firestore
```

### 8. Deploy Backend to Cloud Run / Railway

For production, deploy the Flask backend to a cloud service:
- **Railway**: Connect your GitHub repo → auto-deploy
- **Google Cloud Run**: `gcloud run deploy airflow-backend --source .`

Update `API_BASE` in all frontend JS files to point to your deployed backend URL.

---

## Risk Score Formula

```
Personal Risk Score = min(100, Base × Sensitivity × Activity × Age × Smoking × Outdoor)

Base           = AQI / 5         (0-100 scale)
Sensitivity    = ∏ condition_weights  (capped at 8×)
Activity       = 1.0 (sedentary) → 1.8 (vigorous)
Age            = 1.4 (child), 1.0 (adult), 1.5 (senior)
Smoking        = 1.0 (never), 1.2 (former), 1.5 (current)
Outdoor Worker = × 1.3 if true
```

## Risk Categories

| Score | Level | Action |
|---|---|---|
| 0–25 | 🟢 Low | Safe to go outdoors |
| 26–50 | 🟡 Moderate | Limit prolonged outdoor activity |
| 51–75 | 🟠 High | Avoid outdoor exercise, wear N95 |
| 76–100 | 🔴 Severe | Stay indoors, keep medications ready |

---

## Push Notification Flow

1. User enables notifications → browser requests permission
2. FCM issues a device token → saved to `users/{uid}/fcm_tokens[]`
3. APScheduler runs every 30 minutes:
   - Fetches AQI for every user's home location
   - Computes personalized risk score
   - If score > threshold AND cooldown passed → sends FCM push
4. Service worker (`sw.js`) receives and displays the notification even when the app is closed
5. Clicking the notification opens `/dashboard`
