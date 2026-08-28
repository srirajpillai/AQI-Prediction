"""
AirFlow AI — Comprehensive Multi-Source Machine Learning Ensemble Trainer
==========================================================================
Trains high-precision XGBoost Multi-Class Classifier, Continuous Regressor,
Diurnal Hourly Forecasting Weights, and Spatial Transfer ML models
across all air quality criteria pollutants, VOCs, and meteorological parameters.

Inputs:
    - version1/datasets/comprehensive_aqi_master_dataset.csv

Exports:
    - version1/ml_model.pkl   (Python Joblib Pipeline)
    - version1/ml_model.json  (Web-worker & browser inference model)
"""

import os
import sys
import json
import time
import numpy as np
import pandas as pd

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix, r2_score, mean_absolute_error
from sklearn.linear_model import Ridge, LinearRegression
import xgboost as xgb
import joblib

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(SCRIPT_DIR, 'datasets', 'comprehensive_aqi_master_dataset.csv')

OUTPUT_PKL = os.path.join(SCRIPT_DIR, 'ml_model.pkl')
OUTPUT_JSON = os.path.join(SCRIPT_DIR, 'ml_model.json')

RISK_LABELS = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe']
LABEL_MAP = {lbl: i for i, lbl in enumerate(RISK_LABELS)}
INV_LABEL_MAP = {i: lbl for i, lbl in enumerate(RISK_LABELS)}

CPCB_BREAKPOINTS = {
    'PM2.5': [(0, 30, 0, 50), (30, 60, 51, 100), (60, 90, 101, 200), (90, 120, 201, 300), (120, 250, 301, 400), (250, 500, 401, 500)],
    'PM10':  [(0, 50, 0, 50), (50, 100, 51, 100), (100, 250, 101, 200), (250, 350, 201, 300), (350, 430, 301, 400), (430, 600, 401, 500)],
    'NO2':   [(0, 40, 0, 50), (40, 80, 51, 100), (80, 180, 101, 200), (180, 280, 201, 300), (280, 400, 301, 400), (400, 800, 401, 500)],
    'SO2':   [(0, 40, 0, 50), (40, 80, 51, 100), (80, 380, 101, 200), (380, 800, 201, 300), (800, 1600, 301, 400), (1600, 2000, 401, 500)],
    'CO':    [(0, 1.0, 0, 50), (1.0, 2.0, 51, 100), (2.0, 10.0, 101, 200), (10.0, 17.0, 201, 300), (17.0, 34.0, 301, 400), (34.0, 50.0, 401, 500)],
    'O3':    [(0, 50, 0, 50), (50, 100, 51, 100), (100, 168, 101, 200), (168, 208, 201, 300), (208, 748, 301, 400), (748, 1000, 401, 500)],
    'NH3':   [(0, 200, 0, 50), (200, 400, 51, 100), (400, 800, 101, 200), (800, 1200, 201, 300), (1200, 1800, 301, 400), (1800, 2400, 401, 500)]
}

FEATURE_COLS = [
    # Criteria Pollutants & Chemical Precursors
    'PM2.5', 'PM10', 'NO2', 'SO2', 'CO', 'O3', 'NH3', 'NO', 'NOx',
    # Volatile Organics & Aerosols
    'Benzene', 'Toluene', 'Xylene', 'Dust', 'UV_Index',
    # CPCB Domain Sub-indices
    'sub_pm25', 'sub_pm10', 'sub_no2', 'sub_so2', 'sub_co', 'sub_o3', 'sub_nh3',
    'max_sub_index',
    # Complex Chemical Interaction Ratios
    'pm_ratio', 'oxidant_sum',
    # Meteorological Drivers
    'Temperature_C', 'Humidity_Pct', 'Pressure_hPa', 'Wind_Speed_kmh', 'Wind_Dir_Deg', 'Precipitation_mm',
    # Temporal & Seasonal Indicators
    'month', 'hour', 'day_of_week'
]

def load_data():
    dataset_path = DATASET_PATH
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"No master dataset found at {dataset_path}. Please run compile_comprehensive_datasets.py first.")
        
    print(f"[*] Loading Master Multi-Dataset Corpus from: {dataset_path}...")
    df = pd.read_csv(dataset_path, low_memory=False)
    print(f"    [+] Total dataset shape: {df.shape[0]:,} rows x {df.shape[1]} columns")
    
    # Filter valid AQI labels
    df = df.dropna(subset=['AQI', 'AQI_Bucket'])
    df = df[df['AQI_Bucket'].isin(RISK_LABELS)].copy()
    
    # Ensure all feature columns exist and are numeric
    for col in FEATURE_COLS:
        if col not in df.columns:
            df[col] = 0.0
        else:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
            
    return df

def train_and_evaluate():
    print("="*75)
    print("  AirFlow AI — Training Master Multi-Source XGBoost ML Ensemble")
    print("="*75)
    
    df = load_data()
    
    X = df[FEATURE_COLS].copy()
    y_cat = df['AQI_Bucket'].map(LABEL_MAP).values
    y_reg = df['AQI'].values
    
    if len(df) > 450000:
        print(f"[*] Stratifying 350,000 training samples and 50,000 test samples from {len(df):,} records...")
        X_train, X_test, y_train_cat, y_test_cat, y_train_reg, y_test_reg = train_test_split(
            X, y_cat, y_reg, train_size=350000, test_size=50000, random_state=42, stratify=y_cat
        )
    else:
        X_train, X_test, y_train_cat, y_test_cat, y_train_reg, y_test_reg = train_test_split(
            X, y_cat, y_reg, test_size=0.2, random_state=42, stratify=y_cat
        )
    
    print(f"\n[*] Training Set: {X_train.shape[0]:,} samples | Testing Set: {X_test.shape[0]:,} samples")
    print(f"[*] Total Evaluated Features: {len(FEATURE_COLS)}")
    
    # ─── 1. TRAIN MULTI-CLASS XGBOOST CLASSIFIER ──────────────────────────────
    print("\n[*] Training XGBoost Multi-Class Risk Category Classifier...")
    clf = xgb.XGBClassifier(
        n_estimators=350,
        max_depth=8,
        learning_rate=0.07,
        subsample=0.85,
        colsample_bytree=0.85,
        tree_method='hist',
        random_state=42,
        eval_metric='mlogloss',
        n_jobs=-1
    )
    clf.fit(X_train, y_train_cat)
    
    preds_cat = clf.predict(X_test)
    acc = accuracy_score(y_test_cat, preds_cat)
    print("\n" + "="*60)
    print(f"[✔] MASTER CLASSIFICATION ACCURACY: {acc * 100:.2f}%")
    print("="*60)
    print("\nClassification Report across all 6 CPCB Tiers:")
    print(classification_report(y_test_cat, preds_cat, target_names=RISK_LABELS, digits=4))
    
    # ─── 2. TRAIN CONTINUOUS XGBOOST REGRESSOR ────────────────────────────────
    print("\n[*] Training XGBoost Continuous AQI Regressor...")
    reg = xgb.XGBRegressor(
        n_estimators=350,
        max_depth=8,
        learning_rate=0.07,
        subsample=0.85,
        colsample_bytree=0.85,
        tree_method='hist',
        random_state=42,
        n_jobs=-1
    )
    reg.fit(X_train, y_train_reg)
    
    preds_reg = reg.predict(X_test)
    r2 = r2_score(y_test_reg, preds_reg)
    mae = mean_absolute_error(y_test_reg, preds_reg)
    print("="*60)
    print(f"[✔] MASTER REGRESSION R² SCORE: {r2 * 100:.2f}%  |  MAE: {mae:.2f} AQI points")
    print("="*60)
    
    # ─── 3. TRAIN IN-BROWSER SCALING & LINEAR/RIDGE INFERENCE WEIGHTS ──────────
    print("\n[*] Training In-Browser Real-Time ML Linear & Diurnal Model Weights...")
    ridge = Ridge(alpha=1.0)
    ridge.fit(X_train, y_train_reg)
    
    means = X_train.mean().to_dict()
    stds = X_train.std().replace(0, 1.0).to_dict()
    mins = X_train.min().to_dict()
    maxs = X_train.max().to_dict()
    
    # Train diurnal hourly response matrix (linking weather features to hourly variations)
    diurnal_features = ['Temperature_C', 'Humidity_Pct', 'Pressure_hPa', 'Wind_Speed_kmh', 'hour', 'month']
    diurnal_reg = LinearRegression()
    diurnal_reg.fit(X_train[diurnal_features], y_train_reg)
    diurnal_weights = {feat: round(float(c), 5) for feat, c in zip(diurnal_features, diurnal_reg.coef_)}
    
    # ─── 4. FEATURE IMPORTANCE RANKING ────────────────────────────────────────
    importances = dict(zip(FEATURE_COLS, [float(v) for v in clf.feature_importances_]))
    print("\n[+] Top 15 Feature Importances in AQI Determination:")
    for feat, imp in sorted(importances.items(), key=lambda x: x[1], reverse=True)[:15]:
        print(f"    - {feat:18s}: {imp * 100:6.2f}%")
        
    # ─── 5. SAVE PYTHON MODEL PKL ─────────────────────────────────────────────
    model_payload = {
        'classifier': clf,
        'regressor': reg,
        'ridge_regressor': ridge,
        'features': FEATURE_COLS,
        'risk_labels': RISK_LABELS,
        'label_map': LABEL_MAP,
        'cpcb_breakpoints': CPCB_BREAKPOINTS,
        'scaling': {'means': means, 'stds': stds, 'mins': mins, 'maxs': maxs},
        'metrics': {
            'accuracy': float(acc),
            'r2': float(r2),
            'mae': float(mae),
            'total_samples': int(len(df))
        }
    }
    joblib.dump(model_payload, OUTPUT_PKL)
    print(f"\n[✔] Saved Comprehensive Python Model Pipeline: {OUTPUT_PKL}")
    
    # ─── 6. SAVE COMPLETE WEB MODEL JSON FOR WORKER.JS ────────────────────────
    web_model = {
        'version': '4.0.0',
        'model_name': 'AirFlow AI Multi-Source Master ML Ensemble (All Pollutants & Weather)',
        'metrics': {
            'classification_accuracy': round(float(acc * 100), 2),
            'regression_r2': round(float(r2 * 100), 2),
            'mae': round(float(mae), 2),
            'samples_trained': int(len(df)),
            'features_count': len(FEATURE_COLS),
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S')
        },
        'feature_cols': FEATURE_COLS,
        'feature_importances': {k: round(v, 5) for k, v in importances.items()},
        'ridge_coefficients': {col: round(float(c), 5) for col, c in zip(FEATURE_COLS, ridge.coef_)},
        'ridge_intercept': round(float(ridge.intercept_), 5),
        'diurnal_weights': diurnal_weights,
        'diurnal_intercept': round(float(diurnal_reg.intercept_), 5),
        'scaling': {
            'means': {k: round(float(v), 4) for k, v in means.items()},
            'stds': {k: round(float(v), 4) for k, v in stds.items()},
            'mins': {k: round(float(v), 4) for k, v in mins.items()},
            'maxs': {k: round(float(v), 4) for k, v in maxs.items()}
        },
        'risk_labels': RISK_LABELS,
        'cpcb_breakpoints': CPCB_BREAKPOINTS
    }
    with open(OUTPUT_JSON, 'w') as f:
        json.dump(web_model, f, indent=2)
    print(f"[✔] Saved Master Web Model JSON with full ML feature & diurnal weights: {OUTPUT_JSON}")
    print("\n[★] Comprehensive Multi-Dataset Model Training Completed Successfully!")

if __name__ == '__main__':
    train_and_evaluate()
