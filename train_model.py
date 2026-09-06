"""
AirFlow AI — Consolidated Training Pipeline (IMD All-India Post-2022)
=====================================================
Trains the ML model using only IMD post-2022 daily and hourly data,
covering all available cities across India, specifically selecting only important features.
"""

import os
import sys
import json
import time
import numpy as np
import pandas as pd
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, r2_score, mean_absolute_error
from sklearn.linear_model import Ridge, LinearRegression
import xgboost as xgb
import joblib
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DAILY_DATASET_PATH = os.path.join(SCRIPT_DIR, 'datasets', 'latest_aqi_daily_2020_2026.csv')
HOURLY_DATASET_PATH = os.path.join(SCRIPT_DIR, 'datasets', 'latest_aqi_hourly_2020_2026.csv')
OUTPUT_PKL = os.path.join(SCRIPT_DIR, 'ml_model.pkl')
OUTPUT_JSON = os.path.join(SCRIPT_DIR, 'ml_model.json')

RISK_LABELS = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe']
LABEL_MAP = {lbl: i for i, lbl in enumerate(RISK_LABELS)}

CPCB_BREAKPOINTS = {
    'PM2.5': [(0, 30, 0, 50), (30, 60, 51, 100), (60, 90, 101, 200), (90, 120, 201, 300), (120, 250, 301, 400), (250, 500, 401, 500)],
    'PM10':  [(0, 50, 0, 50), (50, 100, 51, 100), (100, 250, 101, 200), (250, 350, 201, 300), (350, 430, 301, 400), (430, 600, 401, 500)],
    'NO2':   [(0, 40, 0, 50), (40, 80, 51, 100), (80, 180, 101, 200), (180, 280, 201, 300), (280, 400, 301, 400), (400, 800, 401, 500)],
    'SO2':   [(0, 40, 0, 50), (40, 80, 51, 100), (80, 380, 101, 200), (380, 800, 201, 300), (800, 1600, 301, 400), (1600, 2000, 401, 500)],
    'CO':    [(0, 1.0, 0, 50), (1.0, 2.0, 51, 100), (2.0, 10.0, 101, 200), (10.0, 17.0, 201, 300), (17.0, 34.0, 301, 400), (34.0, 50.0, 401, 500)],
    'O3':    [(0, 50, 0, 50), (50, 100, 51, 100), (100, 168, 101, 200), (168, 208, 201, 300), (208, 748, 301, 400), (748, 1000, 401, 500)]
}

FEATURE_COLS = [
    'PM2.5', 'PM10', 'NO2', 'SO2', 'CO', 'O3',
    'sub_pm25', 'sub_pm10', 'sub_no2', 'sub_so2', 'sub_co', 'sub_o3',
    'max_sub_index', 'pm_ratio', 'oxidant_sum',
    'Temperature_C', 'Humidity_Pct', 'Wind_Speed_kmh',
    'month', 'hour'
]

def calc_sub_index(val, pollutant):
    if pd.isna(val) or val <= 0: return 0.0
    bps = CPCB_BREAKPOINTS.get(pollutant, [])
    for (clo, chi, ilo, ihi) in bps:
        if clo <= val <= chi:
            return ilo + (val - clo) * (ihi - ilo) / (chi - clo)
    if bps and val > bps[-1][1]: return bps[-1][3]
    return 0.0

class AQIBiLSTM(nn.Module):
    def __init__(self, input_size, hidden_size=32, num_layers=1, output_size=1):
        super(AQIBiLSTM, self).__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, bidirectional=True)
        self.fc = nn.Linear(hidden_size * 2, output_size)
        
    def forward(self, x):
        # x shape: (batch, seq_len, input_size)
        out, _ = self.lstm(x)
        out = out[:, -1, :] # Take the last time step
        out = self.fc(out)
        return out

def process_dataset(filepath, date_col):
    if not os.path.exists(filepath):
        print(f"Skipping {filepath}, file not found.")
        return pd.DataFrame()
        
    df = pd.read_csv(filepath)
    
    # REMOVED geographic state filtering so it includes ALL cities across India.
    
    df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
    # Filter post-2022
    df = df[df[date_col].dt.year > 2022].copy()
    
    df['month'] = df[date_col].dt.month.fillna(6).astype(int)
    if 'hour' not in df.columns:
        if date_col == 'Datetime':
            df['hour'] = df[date_col].dt.hour.fillna(12).astype(int)
        else:
            df['hour'] = 12 
    return df

def prepare_data():
    print(f"[*] Loading raw datasets...")
    df_daily = process_dataset(DAILY_DATASET_PATH, 'Date')
    df_hourly = process_dataset(HOURLY_DATASET_PATH, 'Datetime')
    
    print(f"[*] Post-2022 Daily rows: {len(df_daily)}, Hourly rows: {len(df_hourly)}")
    
    df = pd.concat([df_daily, df_hourly], ignore_index=True)
    print(f"[*] All-India & post-2022. Total records: {len(df)}")
    
    df = df.dropna(subset=['AQI', 'AQI_Bucket'])
    df = df[df['AQI_Bucket'].isin(RISK_LABELS)].copy()
    
    base_features = ['PM2.5', 'PM10', 'NO2', 'SO2', 'CO', 'O3']
    for col in base_features:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
        else:
            df[col] = 0.0

    print("[*] Calculating Sub-Indices...")
    df['sub_pm25'] = df['PM2.5'].apply(lambda x: calc_sub_index(x, 'PM2.5'))
    df['sub_pm10'] = df['PM10'].apply(lambda x: calc_sub_index(x, 'PM10'))
    df['sub_no2']  = df['NO2'].apply(lambda x: calc_sub_index(x, 'NO2'))
    df['sub_so2']  = df['SO2'].apply(lambda x: calc_sub_index(x, 'SO2'))
    df['sub_co']   = df['CO'].apply(lambda x: calc_sub_index(x, 'CO'))
    df['sub_o3']   = df['O3'].apply(lambda x: calc_sub_index(x, 'O3'))
    
    sub_cols = ['sub_pm25', 'sub_pm10', 'sub_no2', 'sub_so2', 'sub_co', 'sub_o3']
    df['max_sub_index'] = df[sub_cols].max(axis=1)

    df['pm_ratio'] = np.where(df['PM10'] > 0, df['PM2.5'] / df['PM10'], 0)
    df['pm_ratio'] = df['pm_ratio'].clip(0, 1)
    df['oxidant_sum'] = df['NO2'] + df['O3']
    
    # Fill weather missing
    for col in ['Temperature_C', 'Humidity_Pct', 'Wind_Speed_kmh']:
        if col in df.columns:
            df[col] = df[col].fillna(df[col].median() if not df[col].isnull().all() else 0.0)
        else:
            df[col] = 0.0
    
    X = df[FEATURE_COLS].copy()
    y_cat = df['AQI_Bucket'].map(LABEL_MAP).values
    y_reg = df['AQI'].values
    
    print(f"[*] Final Dataset Ready. Features: {len(FEATURE_COLS)}, Rows: {len(X)}")
    return X, y_cat, y_reg, df

def train_models():
    X, y_cat, y_reg, df = prepare_data()
    
    if len(X) < 100:
        print("Not enough data to train properly! Check dataset.")
        return
        
    X_train, X_test, y_train_cat, y_test_cat, y_train_reg, y_test_reg = train_test_split(
        X, y_cat, y_reg, test_size=0.2, random_state=42, stratify=y_cat
    )
    
    print("\n[*] Training XGBoost Classifier...")
    clf = xgb.XGBClassifier(n_estimators=200, max_depth=6, learning_rate=0.1, tree_method='hist', random_state=42)
    clf.fit(X_train, y_train_cat)
    
    preds_cat = clf.predict(X_test)
    acc = accuracy_score(y_test_cat, preds_cat)
    print(f"[✔] Classification Accuracy: {acc*100:.2f}%")
    
    print("\n[*] Training XGBoost Regressor...")
    reg = xgb.XGBRegressor(n_estimators=200, max_depth=6, learning_rate=0.1, tree_method='hist', random_state=42)
    reg.fit(X_train, y_train_reg)
    
    preds_reg = reg.predict(X_test)
    r2 = r2_score(y_test_reg, preds_reg)
    mae = mean_absolute_error(y_test_reg, preds_reg)
    print(f"[✔] Regression R2: {r2*100:.2f}%, MAE: {mae:.2f}")

    print("\n[*] Training Linear Baseline Weights...")
    ridge = Ridge(alpha=1.0)
    ridge.fit(X_train, y_train_reg)

    diurnal_features = ['Temperature_C', 'Humidity_Pct', 'Wind_Speed_kmh', 'hour', 'month']
    diurnal_reg = LinearRegression()
    diurnal_reg.fit(X_train[diurnal_features], y_train_reg)
    diurnal_weights = {feat: round(float(c), 5) for feat, c in zip(diurnal_features, diurnal_reg.coef_)}
    
    importances = dict(zip(FEATURE_COLS, [float(v) for v in clf.feature_importances_]))
    
    print("\n[*] Training PyTorch BiLSTM...")
    # Normalize data for neural network
    X_train_mean = X_train.mean()
    X_train_std = X_train.std().replace(0, 1.0)
    X_train_norm = (X_train - X_train_mean) / X_train_std
    X_test_norm = (X_test - X_train_mean) / X_train_std
    
    # Reshape for LSTM (batch, seq_len=1, features)
    X_tensor_train = torch.tensor(X_train_norm.values, dtype=torch.float32).unsqueeze(1)
    y_tensor_train = torch.tensor(y_train_reg, dtype=torch.float32).unsqueeze(1)
    
    train_dataset = TensorDataset(X_tensor_train, y_tensor_train)
    train_loader = DataLoader(train_dataset, batch_size=256, shuffle=True)
    
    bilstm = AQIBiLSTM(input_size=len(FEATURE_COLS))
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(bilstm.parameters(), lr=0.01)
    
    bilstm.train()
    for epoch in range(5): # 5 epochs for demonstration
        for batch_x, batch_y in train_loader:
            optimizer.zero_grad()
            outputs = bilstm(batch_x)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
    
    bilstm.eval()
    X_tensor_test = torch.tensor(X_test_norm.values, dtype=torch.float32).unsqueeze(1)
    with torch.no_grad():
        preds_bilstm = bilstm(X_tensor_test).squeeze().numpy()
    
    r2_bilstm = r2_score(y_test_reg, preds_bilstm)
    print(f"[✔] BiLSTM R2: {r2_bilstm*100:.2f}%")
    
    # Export to ONNX
    onnx_path = os.path.join(SCRIPT_DIR, 'bilstm.onnx')
    dummy_input = torch.randn(1, 1, len(FEATURE_COLS))
    torch.onnx.export(bilstm, dummy_input, onnx_path, input_names=['input'], output_names=['output'])
    print(f"[✔] Exported BiLSTM to ONNX: {onnx_path}")
    
    web_model = {
        'version': '7.0.0-all-india-post2022',
        'model_name': 'AirFlow AI (IMD All-India Post-2022 Data)',
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
            'means': {k: round(float(v), 4) for k, v in X_train.mean().items()},
            'stds': {k: round(float(v), 4) for k, v in X_train.std().replace(0, 1.0).items()},
            'mins': {k: round(float(v), 4) for k, v in X_train.min().items()},
            'maxs': {k: round(float(v), 4) for k, v in X_train.max().items()}
        },
        'risk_labels': RISK_LABELS,
        'cpcb_breakpoints': CPCB_BREAKPOINTS
    }
    
    with open(OUTPUT_JSON, 'w') as f:
        json.dump(web_model, f, indent=2)
    print(f"\n[✔] Exported to: {OUTPUT_JSON}")

if __name__ == '__main__':
    train_models()
