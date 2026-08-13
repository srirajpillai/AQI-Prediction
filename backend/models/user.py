"""
AirFlow AI — User & Health Profile Data Models
Defines Pydantic schemas for validation and plain dict helpers
for Firestore serialisation/deserialisation.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator


# ──────────────────────────────────────────────────────────────────────────────
# Enumerations (plain strings for JSON-friendly serialisation)
# ──────────────────────────────────────────────────────────────────────────────

AGE_GROUPS        = ('child', 'teen', 'adult', 'senior')
ACTIVITY_LEVELS   = ('sedentary', 'light', 'moderate', 'vigorous')
SMOKING_STATUSES  = ('never', 'former', 'current')
ALERT_THRESHOLDS  = ('low', 'moderate', 'high', 'severe')
BIOLOGICAL_SEXES  = ('male', 'female', 'other', 'prefer_not_to_say')
BMI_CATEGORIES    = ('underweight', 'normal', 'overweight', 'obese')


def _age_to_group(age: int) -> str:
    if age < 12:   return 'child'
    if age < 18:   return 'teen'
    if age < 60:   return 'adult'
    return 'senior'


# ──────────────────────────────────────────────────────────────────────────────
# Medical Conditions
# ──────────────────────────────────────────────────────────────────────────────

class MedicalConditions(BaseModel):
    """Boolean flags for each health condition tracked by the risk engine."""
    asthma:           bool = False
    copd:             bool = False
    cardiovascular:   bool = False
    hypertension:     bool = False
    diabetes:         bool = False
    pregnancy:        bool = False
    immunocompromised: bool = False
    allergies:        bool = False
    kidney_disease:   bool = False

    def active_conditions(self) -> List[str]:
        """Return list of condition keys that are True."""
        return [k for k, v in self.model_dump().items() if v]


class Medications(BaseModel):
    """Medications that influence pollution sensitivity."""
    inhaler:       bool = False
    beta_blockers: bool = False
    blood_thinners: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# Location
# ──────────────────────────────────────────────────────────────────────────────

class HomeLocation(BaseModel):
    lat:   float = Field(..., ge=-90.0,  le=90.0)
    lon:   float = Field(..., ge=-180.0, le=180.0)
    city:  str   = ""
    state: str   = ""

    def to_dict(self) -> dict:
        return self.model_dump()


# ──────────────────────────────────────────────────────────────────────────────
# Health Profile
# ──────────────────────────────────────────────────────────────────────────────

class HealthProfile(BaseModel):
    """Complete user health profile stored under users/{uid}/health_profile."""

    # Demographics
    age:              int   = Field(25, ge=1, le=120)
    age_group:        str   = 'adult'
    biological_sex:   str   = 'prefer_not_to_say'
    bmi_category:     str   = 'normal'
    height_cm:        Optional[float] = None
    weight_kg:        Optional[float] = None

    # Lifestyle
    activity_level:   str   = 'moderate'
    outdoor_worker:   bool  = False
    smoking_status:   str   = 'never'

    # Medical
    conditions:       MedicalConditions = Field(default_factory=MedicalConditions)
    medications:      Medications       = Field(default_factory=Medications)

    # Notifications
    alert_threshold:          str  = 'moderate'
    notifications_enabled:    bool = True

    # Location (optional — same as user.home_location)
    home_location:    Optional[HomeLocation] = None

    updated_at:       Optional[str] = None

    @field_validator('biological_sex')
    @classmethod
    def validate_sex(cls, v: str) -> str:
        if v not in BIOLOGICAL_SEXES:
            raise ValueError(f"biological_sex must be one of {BIOLOGICAL_SEXES}")
        return v

    @field_validator('activity_level')
    @classmethod
    def validate_activity(cls, v: str) -> str:
        if v not in ACTIVITY_LEVELS:
            raise ValueError(f"activity_level must be one of {ACTIVITY_LEVELS}")
        return v

    @field_validator('smoking_status')
    @classmethod
    def validate_smoking(cls, v: str) -> str:
        if v not in SMOKING_STATUSES:
            raise ValueError(f"smoking_status must be one of {SMOKING_STATUSES}")
        return v

    @field_validator('alert_threshold')
    @classmethod
    def validate_threshold(cls, v: str) -> str:
        if v not in ALERT_THRESHOLDS:
            raise ValueError(f"alert_threshold must be one of {ALERT_THRESHOLDS}")
        return v

    def model_post_init(self, __context) -> None:  # noqa
        self.age_group = _age_to_group(self.age)

    def to_firestore(self) -> dict:
        """Serialise to a flat dict suitable for Firestore storage."""
        # Ensure age_group is always derived correctly on save
        self.age_group = _age_to_group(self.age)
        
        data = self.model_dump()
        data['conditions'] = self.conditions.model_dump()
        data['medications'] = self.medications.model_dump()
        data['home_location'] = self.home_location.to_dict() if self.home_location else None
        data['updated_at'] = datetime.utcnow().isoformat()
        return data

    @classmethod
    def from_firestore(cls, data: dict) -> 'HealthProfile':
        """Reconstruct from Firestore document dict."""
        raw = dict(data)
        if isinstance(raw.get('conditions'), dict):
            raw['conditions'] = MedicalConditions(**raw['conditions'])
        if isinstance(raw.get('medications'), dict):
            raw['medications'] = Medications(**raw['medications'])
        if isinstance(raw.get('home_location'), dict):
            raw['home_location'] = HomeLocation(**raw['home_location'])
        return cls(**raw)


# ──────────────────────────────────────────────────────────────────────────────
# User Document
# ──────────────────────────────────────────────────────────────────────────────

class UserDocument(BaseModel):
    """Top-level document stored at users/{uid} in Firestore."""
    uid:                    str
    email:                  str
    display_name:           str   = ""
    created_at:             Optional[str] = None
    fcm_tokens:             List[str]     = Field(default_factory=list)
    notifications_enabled:  bool          = True
    home_location:          Optional[HomeLocation] = None

    def to_firestore(self) -> dict:
        data = self.model_dump()
        data['home_location'] = self.home_location.to_dict() if self.home_location else None
        if not data.get('created_at'):
            data['created_at'] = datetime.utcnow().isoformat()
        return data
