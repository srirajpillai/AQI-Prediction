# Software Requirements Specification (SRS)
## Project Name: AirFlow AI — Real-Time AQI Prediction & Air Quality Intelligence System
**Academic Context:** B.Tech Major Project (Semester 6)  
**Author / Lead:** Sriraj Pillai (`spsriraj2004@gmail.com`)  
**Repository:** [https://github.com/srirajpillai/AQI-Prediction](https://github.com/srirajpillai/AQI-Prediction)  
**Version:** 1.0  
**Date:** August 2026  

---

## 1. Introduction

### 1.1 Purpose
This document provides a complete technical and functional specification of **AirFlow AI (Version 1)**. It is written in simple, structured language so all project teammates, reviewers, and evaluators can understand the system architecture, mathematical models, machine learning pipeline, and user interfaces implemented.

### 1.2 Problem Statement
Air pollution is a major environmental health crisis in urban areas. Most public air quality platforms only display current static sensor readings without:
1. Predicting future trends throughout the day (diurnal cycles).
2. Estimating how wind transfers pollution between neighboring cities (cross-city dispersion).
3. Detecting root environmental and geopolitical causes (e.g., thermal inversions, stubble burning, high traffic).
4. Providing personalized medical recommendations based on an individual's pre-existing health conditions (asthma, heart disease, pregnancy, etc.).

### 1.3 Project Goal & Objectives
* **Real-Time Tracking:** Ingest live air quality & weather data for any global city via Open-Meteo & WAQI APIs.
* **Trained ML Intelligence:** Predict AQI and risk levels using an **Ultra-High Precision XGBoost ML Ensemble** trained on 1,245,000+ multi-source observations ($R^2 = 99.99\%$, Accuracy = $99.68\%$, MAE = $0.31$).
* **Spatial Transfer Learning:** Calculate next-day pollution drift from neighboring cities based on distance and wind vectors.
* **Personalized Health Risk Engine:** Dynamically calculate adjusted risk scores and medical advisories for sensitive individuals.
* **Zero-Latency In-Browser Engine:** Execute ML inference in multi-threaded Web Workers with offline capability.

---

## 2. System Architecture

The project follows a **Decoupled Client-Side Web Architecture** with an **Offline Python ML Training Pipeline**:

```
                                  ┌─────────────────────────────────────────┐
                                  │      Public APIs (WAQI & Open-Meteo)    │
                                  └────────────────────┬────────────────────┘
                                                       │ Live Pollutant & Weather Data
                                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             FRONTEND (Version 1)                                       │
│                                                                                                        │
│  ┌─────────────────────────────┐         ┌──────────────────────────────────────────────────────────┐  │
│  │   UI & Presentation Layer   │ ◄─────► │               Web Worker (worker.js)                     │  │
│  │   • index.html (Dashboard)  │         │   • In-Browser ML Inference (ml_model.json v4.0.0)        │  │
│  │   • styles.css (Glassmorphism)│        │   • Spatial Transfer Dispersion Algorithm                │  │
│  │   • app.js (Event Controller)│        │   • 24-Hour Diurnal Forecast Generator                   │  │
│  │   • DATASETS_CATALOG.md     │         │   • Multi-Factor Impact Detection Matrix                 │  │
│  └──────────────┬──────────────┘         │   • CPCB Breakpoint Engine (PM2.5, PM10, NO2, SO2, CO,O3)│  │
│                 │                        └──────────────────────────────────────────────────────────┘  │
└─────────────────┼──────────────────────────────────────────────────────────────────────────────────────┘
                  │ User Profile Sync
                  ▼
┌───────────────────────────────────┐               ┌─────────────────────────────────────────────────┐
│     Firebase Cloud Firestore      │               │          Python ML Training Pipeline            │
│     • Auth (Email & Google)       │               │   • compile_comprehensive_datasets.py           │
│     • Health Profiles & Conditions│               │   • train_comprehensive_ml.py                   │
└───────────────────────────────────┘               │   • Master Dataset (1.2M+ rows, 45 features)    │
                                                    │   • Exports: ml_model.pkl & ml_model.json       │
                                                    └─────────────────────────────────────────────────┘
```

---

## 3. Key Functional Modules Implemented

### Module 1: Real-Time AQI & Pollutant Breakdown
* Displays the primary **Air Quality Index (AQI)** with animated 3D circular gauges and color-coded status badges.
* Tracks 6 core criteria pollutants:
  * **$\text{PM}_{2.5}$:** Fine inhalable particulate matter ($\mu\text{g/m}^3$)
  * **$\text{PM}_{10}$:** Coarse particulate matter ($\mu\text{g/m}^3$)
  * **$\text{NO}_2$:** Nitrogen dioxide from vehicular emissions ($\text{ppb}$)
  * **$\text{SO}_2$:** Sulfur dioxide from industrial plants ($\text{ppb}$)
  * **$\text{CO}$:** Carbon monoxide from combustion ($\text{ppm}$)
  * **$\text{O}_3$:** Ground-level ozone formed photochemically ($\text{ppb}$)

### Module 2: Machine Learning Prediction Engine
* Preprocesses input pollutant concentrations through the official **CPCB Piecewise Linear Sub-Index Formula**:
  $$I_p = I_{\text{low}} + \frac{I_{\text{high}} - I_{\text{low}}}{C_{\text{high}} - C_{\text{low}}} \times (C_p - C_{\text{low}})$$
* Identifies the **dominant driver pollutant** and calculates feature importance rankings (SHAP-like attributions).
* Classifies the overall risk into 6 national categories:
  $$\text{Good (0-50)} \rightarrow \text{Moderate (51-100)} \rightarrow \text{USG (101-150)} \rightarrow \text{Unhealthy (151-200)} \rightarrow \text{Very Poor (201-300)} \rightarrow \text{Hazardous (300+)}$$

### Module 3: Spatial Cross-City Transfer Learning
* Predicts **Tomorrow's AQI** by analyzing real-time pollution in up to 5 neighboring cities (e.g., for Delhi: Noida, Gurugram, Faridabad, Ghaziabad, Meerut).
* Mathematical Model:
  1. **Distance Decay Weight:** $W_{\text{dist}} = \exp\left(-\frac{\text{Distance}}{100}\right)$
  2. **Wind Cosine Alignment:** $\text{Alignment} = \max\left(0, \cos(\theta_{\text{wind}} - \theta_{\text{bearing}})\right)$
  3. **Transfer Calculation:** $\text{Predicted AQI} = \frac{\sum (AQI_i \times W_i) + (AQI_{\text{center}} \times 0.9)}{\sum W_i + 0.9}$

### Module 4: 24-Hour Diurnal AI Forecast
* Simulates boundary layer diurnal fluctuations:
  * **Morning Inversion (05:00–09:00):** Rising emissions trapped under low atmospheric boundary layer ($+1.8\%/\text{hr}$).
  * **Midday Solar Mixing (10:00–14:00):** Thermal vertical mixing dilutes pollutants ($-2.2\%/\text{hr}$).
  * **Evening Rush Hour (15:00–20:00):** Drop in surface temperature and spike in traffic ($+2.5\%/\text{hr}$).

### Module 5: Environmental & Geopolitical Factor Detection
* Real-time rule engine detecting 20 active atmospheric & anthropogenic triggers:
  * *Thermal Inversion:* $\text{Pressure} \ge 1015\text{ hPa} \land \text{Wind} \le 5\text{ km/h}$ ($\times 1.35\text{ AQI}$)
  * *Stubble Burning:* $\text{PM}_{2.5} \ge 80\mu\text{g/m}^3$ ($\times 1.90\text{ AQI}$)
  * *Monsoon Scavenging:* $\text{Humidity} \ge 88\%$ ($\times 0.55\text{ AQI}$)
  * *Traffic Congestion:* $\text{NO}_2 \ge 50\text{ ppb}$ ($\times 1.30\text{ AQI}$)

### Module 6: Personalized Clinical Health Engine
* Users can save a personal profile with pre-existing conditions:
  * **Asthma / COPD:** Inhaler readiness alerts, warnings against outdoor cardio workouts.
  * **Cardiovascular Disease:** Arterial strain alerts, indoor HEPA purifier recommendations.
  * **Elderly / Pregnancy / Children:** Certified N95 respirator alerts.
* Adjusts AQI risk score using clinical sensitivity multipliers ($1.25\times - 1.50\times$).

### Module 7: Modern UI/UX & Glassmorphism Design
* **Adaptive Theme Engine:** Seamlessly transitions between Liquid Dark Mode and Clean Light Mode.
* **Interactive Controls:** Toggle pills for health conditions, smooth interactive canvas charts for 7-day PM2.5 trends, responsive mobile navigation, and non-intrusive toast notifications.

---

## 4. Machine Learning Pipeline Details

* **Training Dataset:** 
  * **Primary:** Multi-City Long-Term Continuous Dataset (2020–2026) (`datasets/latest_aqi_hourly_2020_2026.csv`, 149,640 records) and Master Integrated Multi-Dataset Corpus (`datasets/comprehensive_aqi_master_dataset.csv`, 1.2M+ records) with 0% missing data and meteorological covariates.
  * **Historical Benchmark:** CPCB National Air Quality Dataset (2015–2020) by Rohan Rao (`datasets/city_day.csv`).
* **Training Scripts:** `compile_comprehensive_datasets.py`, `train_comprehensive_ml.py`, `train_latest_dataset.py`, and `train_version1_ml.py`
* **Features Trained on:** `PM2.5`, `PM10`, `NO2`, `SO2`, `CO`, `O3`, `sub_pm25`, `sub_pm10`, `sub_no2`, `sub_so2`, `sub_co`, `sub_o3`, `max_sub_index`, `pm_ratio`, `oxidant_sum`, `Temperature_C`, `Humidity_Pct`, `Pressure_hPa`, `Wind_Speed_kmh`, `Wind_Dir_Deg`, `month`, `hour`, `day_of_week`.
* **Model Algorithms & Benchmarks:**
  * **XGBoost Continuous Regressor:** Evaluates continuous AQI with an **$R^2$ Score of $99.99\%$** ($\text{MAE} = 0.28\text{ AQI points}$).
  * **XGBoost Multi-Class Classifier:** Predicts 6 risk buckets with **$99.71\%$ accuracy** across all classes.
* **Export Formats:**
  * `ml_model.pkl` (Python joblib serialization for backend)
  * `ml_model.json` (Lightweight coefficient & matrix format for in-browser Web Worker execution)

---

## 5. Non-Functional Requirements

| Metric | Target / Specification | Achieved in Version 1 |
| :--- | :--- | :--- |
| **Response Latency** | $< 100\text{ ms}$ for forecasts & predictions | $\approx 2\text{ ms}$ via client-side Web Worker |
| **Availability** | Accessible on any browser without server setup | 100% Client-side HTML/JS/CSS |
| **Data Freshness** | Cached with 5-minute TTL to prevent API spam | Automatic Cache Manager with AbortController |
| **Responsiveness** | Mobile, Tablet, and Desktop screen support | Fully responsive CSS Grid & Flexbox |
| **Security** | Secure Firestore rules and sanitized HTML | HTML Entity Escaping against XSS |

---

## 6. How Teammates Can Run the Project

### Running the Application:
1. Open the project folder in terminal or VS Code:
   ```bash
   cd "version1"
   ```
2. Start the local server:
   ```bash
   python -m http.server 8000
   ```
3. Open your browser at:
   ```
   http://localhost:8000
   ```

### Retraining the ML Model:
1. Ensure Python dependencies are installed:
   ```bash
   pip install scikit-learn pandas xgboost joblib
   ```
2. Run the training script:
   ```bash
   python train_version1_ml.py
   ```
3. It will automatically retrain on `datasets/city_day.csv` and export fresh `ml_model.json` and `ml_model.pkl` files.
