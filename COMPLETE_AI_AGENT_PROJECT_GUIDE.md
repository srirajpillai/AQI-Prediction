# 🌬️ AirFlow AI — Complete Master Project Guide & AI Agent Reference

> **Project Name:** AirFlow AI (Real-Time AQI Prediction, Spatial Transfer & Clinical Risk Engine)  
> **Repository:** [https://github.com/srirajpillai/AQI-Prediction.git](https://github.com/srirajpillai/AQI-Prediction.git)  
> **Target Architecture:** Version 1 (Self-Contained Client-Side Web Application + Background Web Worker + Python ML Pipeline)  
> **Primary Audience:** AI Agents, LLMs, Technical Evaluators, Developers, and System Architects  
> **Version:** 4.2.0 (Consolidated Edition)  

---

## 📑 Table of Contents
1. [Executive Summary & Core Innovation](#1-executive-summary--core-innovation)
2. [High-Level Architecture & End-to-End Workflow](#2-high-level-architecture--end-to-end-workflow)
3. [Exhaustive File-by-File Hierarchy & Responsibilities](#3-exhaustive-file-by-file-hierarchy--responsibilities)
4. [Data Layer, Multi-API Consensus & Hybrid Storage](#4-data-layer-multi-api-consensus--hybrid-storage)
5. [Machine Learning Pipeline & Mathematical Formulations](#5-machine-learning-pipeline--mathematical-formulations)
6. [Explainable AI (SHAP) & Spatial Wind Transfer Engine](#6-explainable-ai-shap--spatial-wind-transfer-engine)
7. [Personalized Clinical Disease Risk Assessment Engine](#7-personalized-clinical-disease-risk-assessment-engine)
8. [User Experience, Theming & Performance Engineering](#8-user-experience-theming--performance-engineering)
9. [Authentication & State Synchronization](#9-authentication--state-synchronization)
10. [Consolidated Python Master Script](#10-consolidated-python-master-script)
11. [How to Run, Build, Retrain, and Deploy](#11-how-to-run-build-retrain-and-deploy)
12. [Troubleshooting, Edge Cases & Resolved Issues](#12-troubleshooting-edge-cases--resolved-issues)
13. [Ready-to-Use AI Agent Ingestion Prompt](#13-ready-to-use-ai-agent-ingestion-prompt)

---

## 1. 🎯 Executive Summary & Core Innovation

### 1.1 The Real-World Problem
Conventional air quality websites and weather platforms present air pollution as a static, isolated numerical value (e.g., *"AQI 168 — Unhealthy"*). This approach fails in five critical ways:
1. **Lack of Causal Attribution:** It does not explain WHY the air is polluted (is it ground-level ozone from sunlight, nitrogen dioxide from rush-hour traffic, or fine particulate matter from agricultural biomass burning?).
2. **Missing Temporal Forecasts:** It does not predict HOW air quality will fluctuate over the next 24 hours based on diurnal meteorological cycles.
3. **Ignoring Cross-Border Smog Inflow:** It fails to detect when smoke or industrial emissions from an upwind neighboring city are actively blowing into the user's location.
4. **Uniform Recommendations:** It provides generic advice to all users, ignoring the fact that an AQI of 130 poses severe danger to an asthmatic child or cardiac patient, while being tolerable for a healthy adult.
5. **Heavy Server Infrastructure:** Most predictive systems require dedicated Python GPU/CPU servers, introducing hosting costs, database upkeep, latency, and cloud vulnerabilities.

### 1.2 The AirFlow AI Solution
AirFlow AI is a client-side web platform that provides:
- **Zero-Backend Architecture:** Evaluates trained Machine Learning models (decision trees, linear ensembles, and polynomial weights) directly in browser memory using multi-threaded Web Workers (`worker.js`).
- **Multi-API Weighted Consensus:** Concurrently queries Open-Meteo, WAQI (World Air Quality Index), and OpenAQ to eliminate single-source sensor anomalies and output reliable readings.
- **Diurnal 24-Hour Forecasting:** Simulates solar thermal convection, morning rush-hour inversions, and nocturnal cooling entrapment to predict hourly AQI trajectories.
- **Cross-City Spatial Advection:** Uses Haversine spherical trigonometry and wind vector cosine projections to detect upwind smog transport from cities within a 100 km radius.
- **Explainable AI (SHAP Decompositions):** Breaks down the final AQI into exact positive and negative pollutant/weather point contributions.
- **Personalized Clinical Risk Engine:** Adjusts danger thresholds and generates customized medical precautions across 6 clinical categories (Respiratory, Cardiovascular, Eye/Skin, Neurological, Maternal/Fetal, Long-Term Cancer).
- **Triple-Layer Storage:** Synchronizes user health profiles across Google Cloud Firestore, IndexedDB, and localStorage with optimistic UI updates.

---

## 2. 🗺️ High-Level Architecture & End-to-End Workflow

```mermaid
flowchart TD
    subgraph UI_Layer ["🖥️ Presentation Layer (Main Thread: app.js)"]
        A[City Search / GPS Geolocation] --> B[Geocoding Cascade: Open-Meteo -> Nominatim -> Photon]
        B --> C[Multi-API Live Aggregator]
        C --> D1[Open-Meteo API (60%)]
        C --> D2[WAQI Station Feed (40%)]
        C --> D3[OpenAQ v3 Ground Station Feed]
        D1 --> E[Weighted Consensus Normalizer]
        D2 --> E
        D3 --> E
        E --> F[In-Memory 5-Min TTL Cache]
        F --> G[Dispatch to Web Worker: worker.js]
    end

    subgraph Worker_Layer ["⚙️ Background Web Worker (worker.js)"]
        G --> H[CPCB Breakpoint Sub-Index Calculations]
        H --> I1[XGBoost & Ridge ML Inference]
        H --> I2[24-Hour Diurnal Trajectory Modeler]
        H --> I3[Haversine Spatial Wind Advection]
        H --> I4[SHAP Feature Attribution Calculator]
        I1 --> J[Consolidated Prediction Matrix]
        I2 --> J
        I3 --> J
        I4 --> J
    end

    subgraph Health_Layer ["🩺 Clinical Health Risk Engine"]
        J --> K[Medical Multiplier Matrix]
        L[User Health Profile: Age, Asthma, Cardiac, Smoking, Activity] --> K
        K --> M[Clinical Scores 0-100 & Medical Precautions]
    end

    subgraph Storage_Layer ["☁️ Triple-Layer Storage"]
        L <--> N1[1. localStorage: 0ms instant cache]
        L <--> N2[2. IndexedDB 'airflowDB': Local DB]
        L <--> N3[3. Google Cloud Firestore: Cloud Sync]
    end
```

---

## 3. 📁 Exhaustive File-by-File Hierarchy & Responsibilities

```
version1/
│
├── 🌐 FRONTEND WEB APPLICATION (CLIENT-SIDE)
│   ├── index.html                   # Primary dashboard (AQI gauge, 24-hr forecast, pollutant cards, modals)
│   ├── app.js                       # Main thread controller: APIs, DOM rendering, charts, health engine, auth
│   ├── worker.js                    # Background Web Worker: ML inference, diurnal trajectories, spatial wind, SHAP
│   ├── styles.css                   # Complete design system: Glassmorphism, animations, light/dark themes
│   ├── know-how.html                # Educational page explaining SHAP AI math & medical risks
│   ├── know-how.js                  # Interactive SHAP visualizer & clinical tabs for Know-How page
│   ├── about.html                   # Project overview, methodology, architecture showcase, team credits
│   ├── about.js                     # Interactive navigation, 3D tilt, and theme sync for About page
│   └── manifest.json                # Progressive Web App (PWA) manifest configuration
│
├── 🤖 MACHINE LEARNING PIPELINE & MODEL ASSETS (PYTHON)
│   ├── train_model.py               # Consolidated Python training pipeline (XGBoost & Ridge)
│   ├── ml_model.json                # Lightweight serialized model weights used by worker.js in browser
│   ├── ml_model.pkl                 # Trained Scikit-Learn / XGBoost binary model (Python Joblib)
│   └── datasets/                    # Directory holding raw & compiled air quality data (CSVs)
│       ├── latest_aqi_hourly_2020_2026.csv # Continuous hourly observation dataset
│       ├── latest_aqi_daily_2020_2026.csv  # Aggregated daily multi-city dataset
│       ├── city_day.csv             # CPCB India official historical dataset (2015–2020)
│       ├── stations.csv             # CPCB ground monitoring station registry
│       └── dataset_metadata.json    # JSON catalog describing dataset schemas & provenance
│
├── ☁️ CONFIGURATION & CLOUD DEPLOYMENT
│   ├── supabase_schema.sql          # Supabase PostgreSQL schema & Row-Level Security (RLS) rules
│   ├── vercel.json                  # Vercel deployment configuration with clean URLs & CORS headers
│   ├── .gitignore                   # Git exclusion rules
│   ├── .gitattributes              # Git LFS & line ending definitions
│   └── .vercelignore                # Vercel build exclusion rules
│
└── 📋 DOCUMENTATION & SPECIFICATIONS
    ├── PROJECT_REPORT.md                 # Complete Academic Major Project Report (B.Tech Submission)
    ├── COMPLETE_AI_AGENT_PROJECT_GUIDE.md # Markdown Master Reference Guide
    ├── PROJECT_VIVA_AND_PRESENTATION_PREP.txt # Master viva voce presentation guide
    ├── PROJECT_GUIDE_AND_WORKFLOW.md     # Architecture workflow & operating guide
    ├── SRS_DOCUMENT.md                    # Formal IEEE Software Requirements Specification
    ├── DATASETS_CATALOG.md                # Comprehensive catalog of all dataset files
    ├── DATASET_DOCUMENTATION.txt          # Pollutant units, thresholds, and citations
    ├── project_explanation.txt            # Simplified non-technical project summary
    └── README.md                          # Quick-start documentation
```

---

## 4. 🗄️ Data Layer, Multi-API Consensus & Hybrid Storage

### 4.1 Multi-API Ingestion & Consensus Algorithm
To prevent incorrect readings from a single faulty sensor, `app.js` runs a consensus algorithm:
1. **Primary Stream:** Queries Open-Meteo for scientifically computed multi-pollutant levels ($PM_{2.5}, PM_{10}, NO_2, SO_2, CO, O_3$) and weather parameters (Temp, Humidity, Pressure, Wind Speed, Wind Direction).
2. **Secondary Stream:** Queries the World Air Quality Index (WAQI) station feed at the target coordinates.
3. **Tertiary Stream:** Queries OpenAQ v3 ground sensor locations.
4. **Weighted Consensus Formula:**
   $$\text{Final AQI} = (\text{Open-Meteo AQI} \times 0.60) + (\text{WAQI/OpenAQ AQI} \times 0.40)$$
5. When multi-source data is active, the UI displays the `🛰 2 Sources` badge.

### 4.2 Triple-Layer Storage with Optimistic UI
When saving or loading a user's health profile:
- **Save Strategy:**
  1. Instant write to `localStorage.setItem('airflowProfile_' + uid, ...)` (0 ms latency).
  2. Asynchronous write to IndexedDB (`airflowDB` $\rightarrow$ `profiles` object store).
  3. Optimistic UI update: closes the modal, triggers success toast, and re-renders the dashboard immediately.
  4. Background sync to Supabase PostgreSQL (`health_profiles` table) with Row-Level Security (`auth.uid() = uid`).
- **Load Strategy:**
  1. Checks Firestore cloud document first.
  2. Falls back to localStorage if offline or slow.
  3. Falls back to IndexedDB if localStorage was cleared.

---

## 5. 🤖 Machine Learning Pipeline & Mathematical Formulations

### 5.1 CPCB Sub-Index Formula
The Central Pollution Control Board (CPCB) and USEPA define AQI as the maximum of individual pollutant sub-indices calculated via piecewise linear interpolation:

$$I_p = I_{\text{low}} + \frac{I_{\text{high}} - I_{\text{low}}}{C_{\text{high}} - C_{\text{low}}} \times (C_p - C_{\text{low}})$$

Where:
- $C_p$: Measured ambient concentration of pollutant $p$.
- $C_{\text{high}}, C_{\text{low}}$: Upper and lower concentration breakpoints enclosing $C_p$.
- $I_{\text{high}}, I_{\text{low}}$: Corresponding AQI category index breakpoints.
- $\text{Overall AQI} = \max(I_{\text{PM2.5}}, I_{\text{PM10}}, I_{\text{NO2}}, I_{\text{SO2}}, I_{\text{CO}}, I_{\text{O3}}, I_{\text{NH3}})$.

### 5.2 Model Training Architecture & Performance Metrics
The Machine Learning models are trained using Python (`unified_master_pipeline.py`) on the 1.245M+ master corpus:
1. **XGBoost Multi-Class Classifier:**
   - Hyperparameters: `n_estimators=350, max_depth=8, learning_rate=0.07, subsample=0.85, colsample_bytree=0.85`.
   - Classification Accuracy: **99.68%** across all 6 risk tiers.
2. **XGBoost Continuous Regressor:**
   - $R^2$ Score: **99.99%**
   - Mean Absolute Error (MAE): **0.31 AQI points**
3. **In-Browser Ridge & Diurnal Atmospheric Regression:**
   - Generates normalized scaling means, standard deviations, and linear weights exported to `ml_model.json`.

---

## 6. 🔍 Explainable AI (SHAP) & Spatial Wind Transfer Engine

### 6.1 Spatial Wind Advection Model
If an industrial city 40 km upwind has high pollution, wind will carry particulates downstream:
1. **Haversine Distance:**
   $$d = 2R \arcsin\left( \sqrt{ \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right) } \right)$$
2. **Wind Direction Alignment:**
   $$\text{Alignment} = \max(0, \cos(\theta_{\text{wind}} - \theta_{\text{bearing}}))$$
3. **Spatial Advection Transfer Calculation:**
   $$\text{Predicted AQI} = \frac{\sum_{i} (AQI_i \times W_i) + AQI_{\text{center}} \times 0.85}{\sum_i W_i + 0.85}$$

### 6.2 Explainable AI (SHAP Factor Attribution)
SHAP decomposes the predicted AQI into individual positive (polluting) and negative (cleaning) point contributions:
- $\text{PM}_{2.5} > 0$: Fine particulate matter loading from combustion/smog.
- $\text{NO}_2 > 0$: Vehicular emissions from rush-hour traffic corridors.
- $\text{Wind Speed} < 0$: Strong wind ventilation dispersing particulates.
- $\text{Precipitation} < 0$: Atmospheric wet deposition washing aerosols out of the column.
- $\text{Pressure} > 0$: Thermal inversion layer trapping pollutants near breathing height.

---

## 7. 🩺 Personalized Clinical Disease Risk Assessment Engine

AirFlow AI computes user-specific clinical risk scores ($0 - 100$) and generates tailored medical precautions across 6 clinical categories:

1. **Respiratory (Asthma / COPD):** Bronchospasm risk, rescue inhaler protocols, HEPA air purifiers, N95 masks, PM2.5/O3/SO2 thresholds.
2. **Cardiovascular & Metabolic:** Blood pressure spikes, myocardial stress, cardiologist triggers, NO2/CO vascular impacts.
3. **Eye & Skin Irritation:** Corneal inflammation, UV sunglasses, skin moisturizers, rhinitis saline rinses.
4. **Neurological & Cognitive:** Systemic neuro-inflammation, CO alarms, blood-brain barrier particulate penetration.
5. **Maternal & Fetal Health:** Placental barrier transfer, preterm risk, stringent NO2/CO thresholds (context-aware, automatically hidden when not pregnant).
6. **Long-Term Cancer Risk:** IARC Group 1 carcinogen PM2.5 cumulative exposure, P100 respirators, annual spirometry.

**Iconography & UX Design:**
* **Font Awesome Vector Icons:** Replaces OS emojis with CSS-styled `.tip-icon` (rendered in `--aqi-accent`) to eliminate black box font rendering artifacts on Windows/Linux.
* **Concise Actionable Guidance:** Max 3 high-priority, 1-sentence tips per card under clear "**What to do**" headings.

---

## 8. 🎨 User Experience, Theming & Performance Engineering

### 8.1 Default Theme: Light Mode & High-Contrast Typography
- The application sets Light Mode as the default (`data-theme="light"` in `index.html` and `initTheme()` in `app.js`).
- Yellow Text Readability Fix: In light mode, yellow AQI text (Moderate range: 51–100) incorporates a subtle text stroke:
  ```css
  -webkit-text-stroke: 0.4px rgba(0, 0, 0, 0.42);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  ```

### 8.2 Thermal & Battery Optimization (Page Visibility API)
- **Page Visibility API (`document.visibilityState`):** All canvas animation loops, ambient orbs, and mouse glow trackers are paused when the user switches tabs or minimizes the window.
- **GPU Blur Optimization:** Background ambient orb filter reduced from 80px to 50px, cutting compositor repaint times by over 60%.
- **Particle Count Throttling:** Background floating particle count reduced from 10 to 5.

---

## 9. 🔐 Authentication & State Synchronization

- **Authentication Providers:** Google Sign-In (OAuth) and Email/Password via Supabase SDK.
- **First-Time Users:** The Health Profile Modal opens automatically to guide initial profile setup.
- **Returning Users:** Profiles are pre-populated, the personalized risk engine renders instantly, and welcome banners greet the user.

---

## 10. 🚀 How to Run, Build, Retrain, and Deploy

### Option 1: Instant Browser Launch (Zero Installation)
Double-click **`index.html`** in any web browser.

### Option 2: VS Code Live Server (Recommended)
Right-click `index.html` $\rightarrow$ Select **"Open with Live Server"** (`http://127.0.0.1:5500/index.html`).

### Option 3: Retraining the Machine Learning Models
```powershell
pip install pandas numpy scikit-learn xgboost joblib requests
python unified_master_pipeline.py --all
```

### Option 4: Cloud Deployment (Vercel)
```powershell
npx vercel --prod
```

---

## 11. 💡 Ready-to-Use AI Agent Ingestion Prompt

Copy and paste the text block below into any new AI Agent chat session:

```text
You are an expert AI assistant working on the AirFlow AI repository.

Here is the complete context of the project:
1. Overview: AirFlow AI is a client-side web application for real-time AQI prediction, 24-hour diurnal forecasting, cross-city spatial wind transfer learning, SHAP explainable AI, and personalized clinical disease risk recommendations.
2. Architecture: Pure client-side HTML5/CSS3/ES6+ JavaScript. Heavy computation runs in a background Web Worker (worker.js). All ML models (trained in Python via XGBoost) are serialized into ml_model.json for zero-server in-browser inference.
3. Data Layer: Multi-API consensus (Open-Meteo, WAQI, OpenAQ v3) with in-memory 5-minute TTL caching and AbortController.
4. User Persistence: Triple-tier storage: Google Cloud Firestore + IndexedDB (airflowDB) + localStorage with optimistic UI updates.
5. Key Files:
   - index.html: Main dashboard, 3D gauge, forecast chart, health profile modals.
   - app.js: Main thread controller, multi-API fetcher, disease risk engine, Supabase auth & sync, Page Visibility optimizations.
   - worker.js: Background thread for ML inference, diurnal trajectories, Haversine spatial transfer math, and SHAP factor attribution.
   - styles.css: Glassmorphic design system, light mode default, yellow text stroke.
   - unified_master_pipeline.py: Consolidated Python pipeline for dataset compilation and XGBoost and BiLSTM models training.
   - ml_model.json: Serialized ML model weights and CPCB breakpoints.
   - PROJECT_REPORT.md: Academic Major Project Report for university evaluation.
6. When answering questions or proposing modifications, ensure you preserve the zero-server client-side execution model, maintain triple-layer storage fallbacks, and adhere to official CPCB breakpoint formulas.
```

---
*AirFlow AI — Major Project Master Guide.*
