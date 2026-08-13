"""
AirFlow AI — Version 3 Configuration
Loads all settings from environment variables via python-dotenv.
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Flask
    SECRET_KEY: str = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-change-in-production")
    DEBUG: bool = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    PORT: int = int(os.getenv("FLASK_PORT", 5000))

    # Firebase
    FIREBASE_CREDENTIALS_PATH: str = os.getenv("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json")
    FIREBASE_PROJECT_ID: str = os.getenv("FIREBASE_PROJECT_ID", "")

    # ML Model
    MODEL_PATH: str = os.getenv("MODEL_PATH", "ml/risk_model.pkl")

    # Notification Scheduler
    SCHEDULER_INTERVAL_MINUTES: int = int(os.getenv("SCHEDULER_INTERVAL_MINUTES", 30))
    NOTIFICATION_COOLDOWN_HOURS: int = int(os.getenv("NOTIFICATION_COOLDOWN_HOURS", 2))

    # CORS
    CORS_ORIGINS: list = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

    # Open-Meteo
    OPENMETEO_BASE_URL: str = os.getenv("OPENMETEO_BASE_URL", "https://api.open-meteo.com/v1")
    OPENMETEO_AQ_BASE_URL: str = os.getenv("OPENMETEO_AQ_BASE_URL", "https://air-quality-api.open-meteo.com/v1")

    # Cache TTL (seconds)
    AQI_CACHE_TTL: int = 600        # 10 minutes
    WEATHER_CACHE_TTL: int = 1800   # 30 minutes
    GEO_CACHE_TTL: int = 86400      # 24 hours


config = Config()
