"""
AirFlow AI — ML Model Training Pipeline
=========================================
Trains an XGBoost classifier on the India AQI Kaggle dataset
(city_day.csv) to predict AQI risk buckets.

Usage:
    cd version3/backend
    python ml/train_model.py              # Train & save
    python ml/train_model.py --evaluate   # Train + print metrics

Dataset Source:
    https://www.kaggle.com/datasets/rohanrao/air-quality-data-in-india
    Place city_day.csv in version3/backend/ml/datasets/

Model Output:
    ml/risk_model.pkl  — saved XGBoost pipeline
"""
from __future__ import annotations
import os
import sys
import argparse
import logging
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import joblib
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.ensemble import RandomForestClassifier
import xgboost as xgb

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('ml.train')

# ──────────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(SCRIPT_DIR, 'datasets', 'city_day.csv')
MODEL_PATH   = os.path.join(SCRIPT_DIR, 'risk_model.pkl')
LABEL_PATH   = os.path.join(SCRIPT_DIR, 'label_encoder.pkl')

# AQI risk label order (from India CPCB)
RISK_LABELS = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe']

# Features used for training
FEATURE_COLS = [
    'PM2.5', 'PM10', 'NO', 'NO2', 'NOx', 'NH3',
    'CO', 'SO2', 'O3', 'Benzene', 'Toluene', 'Xylene',
    'hour', 'day_of_week', 'month', 'pm25_rolling_7d'
]


# ──────────────────────────────────────────────────────────────────────────────
# 1. Load & Preprocess Dataset
# ──────────────────────────────────────────────────────────────────────────────

def load_and_preprocess(path: str) -> tuple[pd.DataFrame, pd.Series]:
    """
    Load city_day.csv, engineer features, return X and y.
    """
    logger.info(f"Loading dataset from {path}")
    df = pd.read_csv(path, parse_dates=['Date'])

    # Drop rows without AQI label
    df = df.dropna(subset=['AQI_Bucket'])
    df = df[df['AQI_Bucket'].isin(RISK_LABELS)]

    # Temporal features
    df['hour']        = df['Date'].dt.hour      # will be 0 since daily data
    df['day_of_week'] = df['Date'].dt.dayofweek
    df['month']       = df['Date'].dt.month

    # Rolling 7-day PM2.5 per city
    df = df.sort_values(['City', 'Date'])
    df['pm25_rolling_7d'] = df.groupby('City')['PM2.5'].transform(
        lambda x: x.rolling(7, min_periods=1).mean()
    )

    # Fill missing pollutant values with city median
    for col in ['PM2.5', 'PM10', 'NO', 'NO2', 'NOx', 'NH3',
                'CO', 'SO2', 'O3', 'Benzene', 'Toluene', 'Xylene']:
        if col in df.columns:
            df[col] = df[col].fillna(df.groupby('City')[col].transform('median'))
            df[col] = df[col].fillna(0)
        else:
            df[col] = 0.0

    available_features = [c for c in FEATURE_COLS if c in df.columns]
    X = df[available_features].copy()
    y = df['AQI_Bucket']

    logger.info(f"Dataset shape: {X.shape}, Classes: {y.value_counts().to_dict()}")
    return X, y, available_features


# ──────────────────────────────────────────────────────────────────────────────
# 2. Train Model
# ──────────────────────────────────────────────────────────────────────────────

def train(X: pd.DataFrame, y: pd.Series,
          features: list[str], evaluate: bool = False) -> Pipeline:
    """
    Train XGBoost classifier pipeline. Falls back to RandomForest if XGBoost
    training fails.
    """
    le = LabelEncoder()
    le.fit(RISK_LABELS)
    y_enc = le.transform(y)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=0.2, random_state=42, stratify=y_enc
    )

    logger.info("Training XGBoost classifier...")
    xgb_clf = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=7,
        learning_rate=0.08,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric='mlogloss',
        random_state=42,
        n_jobs=-1,
        verbosity=0,
    )

    pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('clf',    xgb_clf),
    ])

    pipeline.fit(X_train, y_train)

    if evaluate:
        y_pred = pipeline.predict(X_test)
        acc    = accuracy_score(y_test, y_pred)
        logger.info(f"\nTest Accuracy: {acc:.4f} ({acc*100:.2f}%)")
        logger.info("\nClassification Report:")
        print(classification_report(y_test, y_pred,
                                     target_names=le.classes_,
                                     zero_division=0))
        logger.info("\nConfusion Matrix:")
        print(confusion_matrix(y_test, y_pred))

        # Cross-validation
        cv_scores = cross_val_score(pipeline, X, y_enc, cv=5,
                                     scoring='accuracy', n_jobs=-1)
        logger.info(f"\n5-Fold CV Accuracy: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    # Attach metadata for inference
    pipeline.feature_names_ = features
    pipeline.label_encoder_  = le
    pipeline.risk_labels_     = RISK_LABELS

    return pipeline


# ──────────────────────────────────────────────────────────────────────────────
# 3. Inference Helper
# ──────────────────────────────────────────────────────────────────────────────

def predict_risk_bucket(pipeline: Pipeline, pollutants: dict,
                         hour: int = 12, month: int = 6) -> dict:
    """
    Given a dict of current pollutant readings, predict the AQI risk bucket.

    pollutants keys: pm25, pm10, no, no2, nox, nh3, co, so2, o3, benzene,
                     toluene, xylene  (missing values default to 0)
    Returns: { 'bucket': 'Moderate', 'probability': 0.72 }
    """
    feature_map = {
        'PM2.5':          pollutants.get('pm25', 0),
        'PM10':           pollutants.get('pm10', 0),
        'NO':             pollutants.get('no', 0),
        'NO2':            pollutants.get('no2', 0),
        'NOx':            pollutants.get('nox', 0),
        'NH3':            pollutants.get('nh3', 0),
        'CO':             pollutants.get('co', 0),
        'SO2':            pollutants.get('so2', 0),
        'O3':             pollutants.get('o3', 0),
        'Benzene':        pollutants.get('benzene', 0),
        'Toluene':        pollutants.get('toluene', 0),
        'Xylene':         pollutants.get('xylene', 0),
        'hour':           hour,
        'day_of_week':    0,
        'month':          month,
        'pm25_rolling_7d': pollutants.get('pm25', 0),  # approximation
    }

    features    = getattr(pipeline, 'feature_names_', list(feature_map.keys()))
    le          = getattr(pipeline, 'label_encoder_', None)

    row     = pd.DataFrame([[feature_map.get(f, 0) for f in features]], columns=features)
    pred    = pipeline.predict(row)[0]
    proba   = pipeline.predict_proba(row)[0]

    bucket = le.inverse_transform([pred])[0] if le else str(pred)
    return {
        'bucket':      bucket,
        'probability': round(float(proba.max()), 3),
        'all_probs':   {le.classes_[i]: round(float(p), 3)
                        for i, p in enumerate(proba)} if le else {},
    }


# ──────────────────────────────────────────────────────────────────────────────
# 4. Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Train AirFlow AI risk model')
    parser.add_argument('--evaluate', action='store_true',
                        help='Print evaluation metrics after training')
    parser.add_argument('--dataset', default=DATASET_PATH,
                        help=f'Path to city_day.csv (default: {DATASET_PATH})')
    args = parser.parse_args()

    if not os.path.exists(args.dataset):
        logger.error(
            f"Dataset not found at: {args.dataset}\n"
            "Please download 'city_day.csv' from:\n"
            "  https://www.kaggle.com/datasets/rohanrao/air-quality-data-in-india\n"
            f"And place it at: {os.path.join(SCRIPT_DIR, 'datasets', 'city_day.csv')}"
        )
        sys.exit(1)

    os.makedirs(os.path.join(SCRIPT_DIR, 'datasets'), exist_ok=True)

    X, y, features = load_and_preprocess(args.dataset)
    model = train(X, y, features, evaluate=args.evaluate)

    joblib.dump(model, MODEL_PATH)
    logger.info(f"✅ Model saved to: {MODEL_PATH}")

    # Quick sanity test
    test_pollutants = {'pm25': 85, 'pm10': 110, 'no2': 55, 'so2': 20, 'co': 1.2, 'o3': 80}
    result = predict_risk_bucket(model, test_pollutants)
    logger.info(f"Sanity check prediction (PM2.5=85): {result}")


if __name__ == '__main__':
    main()
