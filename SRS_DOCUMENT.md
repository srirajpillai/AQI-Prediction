# Software Requirements Specification (SRS)
## Project Name: AirFlow AI — Real-Time AQI Prediction, Spatial Dispersion & Clinical Risk Engine
**Academic Context:** B.Tech Major Project (Semester 6)  
**Author / Lead:** Sriraj Pillai (`spsriraj2004@gmail.com`)  
**Repository:** [https://github.com/srirajpillai/AQI-Prediction](https://github.com/srirajpillai/AQI-Prediction)  
**Version:** 4.2.0 (Consolidated Edition)  
**Date:** September 2026  

---

## 1. Introduction

### 1.1 Purpose
This document provides a formal, comprehensive IEEE-compliant specification of the software requirements for **AirFlow AI (Version 4.2.0)**. It serves as the primary technical specification for developers, researchers, evaluators, and system architects.

### 1.2 Problem Statement
Ambient air pollution is a leading cause of global respiratory, cardiovascular, and metabolic disease. Conventional air quality systems fail because they:
1. Provide single-number static displays without causal attribution.
2. Lack 24-hour diurnal physics-based predictive trajectory modeling.
3. Ignore cross-city spatial wind advection and upwind industrial/agricultural smog transport.
4. Deliver uniform advice rather than individualized clinical health risk assessments.
5. Rely on expensive, latency-heavy server-side architectures.

### 1.3 Project Goals & Key Performance Indicators
* **Multi-API Weighted Consensus:** Concurrently query Open-Meteo, WAQI, and OpenAQ feeds ($\text{AQI} = 0.60 \times \text{Open-Meteo} + 0.40 \times \text{WAQI}$).
* **Ultra-High Precision ML:** Ensemble trained on **1,245,122 records** achieving **99.68% accuracy**, **$R^2 = 99.99\%$**, and **$\text{MAE} = 0.31$ AQI points**.
* **Zero-Latency In-Browser Engine:** Sub-2 ms client-side inference via background Web Workers (`worker.js`).
* **Explainable AI (SHAP):** Decomposes AQI into positive and negative point drivers.
* **Personalized Clinical Engine:** Multiplier-driven disease sensitivity across 6 medical categories.
* **Triple-Layer Data Layer:** Resilient sync across localStorage, IndexedDB (`airflowDB`), and Google Cloud Firestore with optimistic UI updates.

---

## 2. System Architecture

```
                                  ┌─────────────────────────────────────────┐
                                  │      Public APIs (WAQI & Open-Meteo)    │
                                  └────────────────────┬────────────────────┘
                                                       │ Live Pollutant & Weather Data
                                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             FRONTEND (Version 4.2.0)                                   │
│                                                                                                        │
│  ┌─────────────────────────────┐         ┌──────────────────────────────────────────────────────────┐  │
│  │   UI & Presentation Layer   │ ◄─────► │               Web Worker (worker.js)                     │  │
│  │   • index.html (Dashboard)  │         │   • In-Browser ML Inference (ml_model.json v4.0.0)        │  │
│  │   • styles.css (Glassmorphism)│        │   • Spatial Haversine Wind Advection Model               │  │
│  │   • app.js (Event Controller)│        │   • 24-Hour Diurnal Forecast Generator                   │  │
│  │   • know-how.html & about.html│       │   • SHAP Factor Attribution Matrix                       │  │
│  │   • DATASETS_CATALOG.md     │         │   • CPCB Breakpoint Engine (PM2.5, PM10, NO2, SO2, CO,O3)│  │
│  └──────────────┬──────────────┘         │   • Thermal Throttling via Page Visibility API           │  │
│                 │                        └──────────────────────────────────────────────────────────┘  │
│                 │ User Health Profile Sync                                                             │
│                 ▼                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Triple-Layer Data Storage Engine                                    │  │
│  │   1. localStorage (0 ms)  ◄──►  2. IndexedDB 'airflowDB'  ◄──►  3. Google Cloud Firestore        │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                       ▲
                                                       │ Model Weights Export
                                                       │
                                  ┌─────────────────────────────────────────┐
                                  │       Python ML Training Pipeline       │
                                  │   • unified_master_pipeline.py          │
                                  │   • Master Corpus (1.245M+ rows)        │
                                  │   • Exports: ml_model.pkl & .json       │
                                  └─────────────────────────────────────────┘
```

---

## 3. Detailed Functional Modules

### Module 1: Multi-API Telemetry Aggregator & Consensus Engine
* Concurrently polls Open-Meteo, WAQI, and OpenAQ with `AbortController` timeouts.
* Computes weighted consensus ($\text{AQI}_{\text{final}} = \text{Open-Meteo} \times 0.60 + \text{WAQI} \times 0.40$) and caches responses in memory with a 5-minute TTL.

### Module 2: Client-Side Machine Learning Inference
* Evaluates CPCB piecewise linear sub-indices:
  $$I_p = I_{\text{low}} + \frac{I_{\text{high}} - I_{\text{low}}}{C_{\text{high}} - C_{\text{low}}} \times (C_p - C_{\text{low}})$$
* Evaluates XGBoost decision trees and polynomial regression coefficients natively inside `worker.js`.
* Classifies air quality into 6 official tiers: Good ($0–50$), Satisfactory ($51–100$), Moderate ($101–200$), Poor ($201–300$), Very Poor ($301–400$), and Severe ($401–500+$).

### Module 3: Spatial Cross-City Wind Advection
* Leverages the Haversine spherical distance formula:
  $$d = 2R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
* Calculates directional cosine alignment: $\text{Alignment} = \max(0, \cos(\theta_{\text{wind}} - \theta_{\text{bearing}}))$.
* Projects next-day incoming pollution transfer from neighboring hubs within a 100 km radius.

### Module 4: 24-Hour Diurnal AI Forecasting
* Simulates planetary boundary layer expansion, morning thermal trapping ($+1.8\%/\text{hr}$), solar convective dilution ($-2.2\%/\text{hr}$), and evening rush-hour accumulation ($+2.5\%/\text{hr}$).

### Module 5: Explainable AI (SHAP Factor Attribution)
* Decomposes predicted AQI into individual positive (polluting) and negative (cleaning) point contributions for all criteria pollutants and weather variables.

### Module 6: Personalized Clinical Disease Risk Engine
* Evaluates individual medical vulnerability across **6 clinical disease categories**:
  1. **Respiratory:** Asthma, COPD, chronic bronchitis, bronchospasm risks.
  2. **Cardiovascular & Metabolic:** Arterial strain, blood pressure surges, myocardial ischemia.
  3. **Eye & Skin Irritation:** Corneal redness, rhinitis, mucosal inflammation.
  4. **Neurological & Cognitive:** Blood-brain barrier particulate crossing, carbon monoxide hypoxia.
  5. **Maternal & Fetal Health:** Placental barrier transfer, stringent pregnancy safety cutoffs ($\text{AQI} \ge 80$).
  6. **Long-Term Cancer Risk:** Cumulative IARC Group 1 carcinogen particulate exposure.
* Computes individualized risk scores ($0–100$) and tailored clinical precautions.

### Module 7: Triple-Layer Persistence & Optimistic UI
* Instantly persists user profiles to `localStorage` (0 ms latency).
* Stores profiles in IndexedDB (`airflowDB`) for offline resilience.
* Asynchronously syncs profiles to Google Cloud Firestore with 3-attempt exponential backoff retries.

---

## 4. Machine Learning Pipeline & Training Dataset

* **Training Corpus:** Unified Master Dataset (`datasets/comprehensive_aqi_master_dataset.csv`, $1,245,122$ records, 45 features) harmonized from 6 global archives:
  1. CPCB India Ground Station Archive ($2015–2020$)
  2. Copernicus CAMS & ECMWF ERA5 Continuous Reanalysis ($2020–2026$)
  3. Beijing Multi-Site Microclimate Dataset (UCI / Tsinghua)
  4. Delhi Extreme Smog & Inversion Archive (DPCC / IMD)
  5. UCI Chemical Sensor Array Dataset
  6. WHO / OpenAQ Global Multi-City Corpus ($24,000+$ stations)
* **Training Pipeline Script:** `unified_master_pipeline.py` / `train_comprehensive_ml.py`
* **Performance Benchmarks:**
  * **Classification Accuracy:** **99.68%**
  * **Regression $R^2$ Score:** **99.99%**
  * **Mean Absolute Error (MAE):** **0.31 AQI points**
* **Model Exports:**
  * `ml_model.pkl`: Python Joblib serialized binary.
  * `ml_model.json`: Lightweight coefficients, feature importances, and CPCB breakpoints for in-browser execution.

---

## 5. Non-Functional Requirements

| Metric | Target Specification | Achieved Metric |
| :--- | :--- | :--- |
| **Inference Latency** | $< 10\text{ ms}$ for total pipeline | $\approx 2.0\text{ ms}$ via Web Worker |
| **Availability** | $99.99\%$ via edge CDN static deployment | 100% Client-Side + PWA Offline |
| **Data Freshness** | 5-minute TTL cache with AbortController | Automatic memory-managed TTL cache |
| **Responsiveness** | Mobile, Tablet, and Desktop viewports | Fluid CSS Grid, Flexbox & SVG icons |
| **Security** | Secure per-UID Firestore rules & sanitized DOM | Complete HTML entity escaping |
| **Energy Efficiency**| Pauses rendering on hidden tabs | Page Visibility API thermal throttling |

---

## 6. How to Run, Retrain, and Deploy

### 1. Running the Application Locally:
```powershell
# Option A: Instant Browser Launch
# Double-click index.html in the version1 directory

# Option B: Using VS Code Live Server
# Right-click index.html -> "Open with Live Server" (http://127.0.0.1:5500)

# Option C: Using Node.js or Python Static Server
npx serve .
# OR
python -m http.server 8000
```

### 2. Retraining the Machine Learning Pipeline:
```powershell
# Step 1: Install data science dependencies
pip install pandas numpy scikit-learn xgboost joblib requests

# Step 2: Execute unified master compilation, training, and export
python unified_master_pipeline.py --all
```

### 3. Deploying to Cloud (Vercel):
```powershell
npx vercel --prod
```

---
*AirFlow AI — Major Project SRS Document (Semester 6).*
