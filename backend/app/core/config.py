from decimal import Decimal
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, List, Optional, Union
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "SupplyChain Sentinel AI"
    APP_ENV: str = "development"
    API_VERSION: str = "0.1.0"
    CORS_ORIGINS: Union[List[str], str] = ["http://localhost:5173"]
    DATABASE_URL: str = "sqlite:///./sentinel.db"
    DATA_SOURCE: str = "demo"

    # Inventory Intelligence thresholds
    INVENTORY_LOOKBACK_DAYS: int = 28
    INVENTORY_HORIZON_DAYS: int = 60
    INVENTORY_CRITICAL_DAYS: int = 7
    INVENTORY_HIGH_DAYS: int = 14
    INVENTORY_MEDIUM_DAYS: int = 30

    # Supplier Risk thresholds
    SUPPLIER_RISK_LOOKBACK_DAYS: int = 365
    SUPPLIER_RISK_GRACE_DAYS: int = 0
    SUPPLIER_RISK_W_ON_TIME: float = 0.40
    SUPPLIER_RISK_W_DELAY: float = 0.25
    SUPPLIER_RISK_W_REJECTION: float = 0.20
    SUPPLIER_RISK_W_FILL: float = 0.15
    SUPPLIER_RISK_BAND_MEDIUM: float = 25.0
    SUPPLIER_RISK_BAND_HIGH: float = 50.0

    # Demand Forecasting settings
    FORECAST_MIN_TRAIN_DAYS: int = 84
    FORECAST_HORIZON_DAYS: int = 14
    FORECAST_STEP_DAYS: int = 14
    FORECAST_MIN_IMPROVEMENT_PCT: float = 5.0
    FORECAST_MIN_WIN_RATE: float = 0.60

    # Disruption Alert thresholds
    ALERT_SURGE_RECENT_DAYS: int = 14
    ALERT_SURGE_BASELINE_DAYS: int = 28
    ALERT_SURGE_RATIO_MEDIUM: float = 1.25
    ALERT_SURGE_RATIO_HIGH: float = 1.5
    ALERT_QUALITY_REJECTION_THRESHOLD: float = 0.02
    ALERT_DELAY_MIN_LATE_PROBABILITY: float = 0.20
    ALERT_DELAY_MIN_DELIVERIES: int = 10

    # Phase 7: Recovery Recommendations Configuration
    RECOVERY_TRANSFER_DAYS: int = 2
    RECOVERY_TRANSFER_COST_PER_UNIT: Optional[Decimal] = None

    # Currency display configuration
    DISPLAY_CURRENCY: str = "USD"
    USD_TO_INR_RATE: Optional[Decimal] = None

    # Phase 13: Web CSV Import Settings
    ENABLE_WEB_IMPORT: bool = False
    IMPORT_MAX_FILE_BYTES: int = 5242880
    IMPORT_MAX_FILES: int = 11
    IMPORT_MAX_TOTAL_BYTES: int = 26214400
    UPLOAD_DB_PATH: str = "backend/data/uploaded.db"

    # Phase 14: Globe Supply Concentration thresholds
    GLOBE_CONCENTRATION_MIN_SUPPLIERS: int = 3
    GLOBE_CONCENTRATION_SHARE: float = 0.40

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def __init__(self, *args, **kwargs):
        if "_env_file" not in kwargs and "ENV_FILE" in os.environ:
            val = os.environ["ENV_FILE"]
            kwargs["_env_file"] = val if val else None
        super().__init__(*args, **kwargs)

    @field_validator("DATABASE_URL", mode="after")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        clean_url = str(v).strip()
        if not clean_url.startswith("sqlite"):
            raise ValueError(
                f"DATABASE_URL must be an SQLite database URL (e.g. 'sqlite:///./sentinel.db'), got '{v}'"
            )
        return clean_url

    @field_validator("CORS_ORIGINS", mode="after")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        origins: List[str] = []
        if isinstance(v, str):
            clean_str = v.strip()
            if clean_str.startswith("[") and clean_str.endswith("]"):
                try:
                    parsed = json.loads(clean_str)
                    if isinstance(parsed, list):
                        origins = [str(item).strip() for item in parsed]
                except Exception:
                    pass
            if not origins:
                origins = [i.strip() for i in clean_str.split(",") if i.strip()]
        elif isinstance(v, list):
            origins = [str(item).strip() for item in v]

        for origin in origins:
            if origin == "*":
                raise ValueError("CORS_ORIGINS cannot contain wildcard '*'; explicit origins required.")
        return origins

    @model_validator(mode="after")
    def validate_inventory_thresholds(self) -> "Settings":
        if self.INVENTORY_LOOKBACK_DAYS < 7:
            raise ValueError(
                f"INVENTORY_LOOKBACK_DAYS must be at least 7, got {self.INVENTORY_LOOKBACK_DAYS}"
            )
        if not (7 <= self.INVENTORY_HORIZON_DAYS <= 180):
            raise ValueError(
                f"INVENTORY_HORIZON_DAYS must be between 7 and 180, got {self.INVENTORY_HORIZON_DAYS}"
            )
        if not (
            0
            < self.INVENTORY_CRITICAL_DAYS
            < self.INVENTORY_HIGH_DAYS
            < self.INVENTORY_MEDIUM_DAYS
            <= self.INVENTORY_HORIZON_DAYS
        ):
            raise ValueError(
                f"Invalid inventory threshold ordering: must satisfy "
                f"0 < CRITICAL ({self.INVENTORY_CRITICAL_DAYS}) < HIGH ({self.INVENTORY_HIGH_DAYS}) "
                f"< MEDIUM ({self.INVENTORY_MEDIUM_DAYS}) <= HORIZON ({self.INVENTORY_HORIZON_DAYS})"
            )
        return self

    @model_validator(mode="after")
    def validate_supplier_risk_settings(self) -> "Settings":
        if self.SUPPLIER_RISK_LOOKBACK_DAYS <= 0:
            raise ValueError(
                f"SUPPLIER_RISK_LOOKBACK_DAYS must be positive, got {self.SUPPLIER_RISK_LOOKBACK_DAYS}"
            )
        if self.SUPPLIER_RISK_GRACE_DAYS < 0:
            raise ValueError(
                f"SUPPLIER_RISK_GRACE_DAYS cannot be negative, got {self.SUPPLIER_RISK_GRACE_DAYS}"
            )
        weights = [
            self.SUPPLIER_RISK_W_ON_TIME,
            self.SUPPLIER_RISK_W_DELAY,
            self.SUPPLIER_RISK_W_REJECTION,
            self.SUPPLIER_RISK_W_FILL,
        ]
        if any(w < 0 for w in weights):
            raise ValueError(f"Supplier risk weights cannot be negative: {weights}")
        total_w = sum(weights)
        if abs(total_w - 1.0) > 1e-6:
            raise ValueError(f"Supplier risk weights must sum to 1 within 1e-6, got {total_w}")
        if not (0 < self.SUPPLIER_RISK_BAND_MEDIUM < self.SUPPLIER_RISK_BAND_HIGH <= 100):
            raise ValueError(
                f"Invalid supplier risk band ordering: must satisfy "
                f"0 < MEDIUM ({self.SUPPLIER_RISK_BAND_MEDIUM}) < HIGH ({self.SUPPLIER_RISK_BAND_HIGH}) <= 100"
            )
        return self

    @model_validator(mode="after")
    def validate_forecasting_settings(self) -> "Settings":
        if self.FORECAST_MIN_TRAIN_DAYS < 14:
            raise ValueError(
                f"FORECAST_MIN_TRAIN_DAYS must be at least 14, got {self.FORECAST_MIN_TRAIN_DAYS}"
            )
        if self.FORECAST_HORIZON_DAYS <= 0:
            raise ValueError(
                f"FORECAST_HORIZON_DAYS must be positive, got {self.FORECAST_HORIZON_DAYS}"
            )
        if self.FORECAST_STEP_DAYS <= 0:
            raise ValueError(
                f"FORECAST_STEP_DAYS must be positive, got {self.FORECAST_STEP_DAYS}"
            )
        if self.FORECAST_MIN_IMPROVEMENT_PCT < 0:
            raise ValueError(
                f"FORECAST_MIN_IMPROVEMENT_PCT cannot be negative, got {self.FORECAST_MIN_IMPROVEMENT_PCT}"
            )
        if not (0.0 <= self.FORECAST_MIN_WIN_RATE <= 1.0):
            raise ValueError(
                f"FORECAST_MIN_WIN_RATE must be between 0.0 and 1.0, got {self.FORECAST_MIN_WIN_RATE}"
            )
        return self

    @model_validator(mode="after")
    def validate_alert_settings(self) -> "Settings":
        if self.ALERT_SURGE_RECENT_DAYS <= 0:
            raise ValueError(
                f"ALERT_SURGE_RECENT_DAYS must be positive, got {self.ALERT_SURGE_RECENT_DAYS}"
            )
        if self.ALERT_SURGE_BASELINE_DAYS <= 0:
            raise ValueError(
                f"ALERT_SURGE_BASELINE_DAYS must be positive, got {self.ALERT_SURGE_BASELINE_DAYS}"
            )
        if self.ALERT_SURGE_RATIO_MEDIUM <= 1.0:
            raise ValueError(
                f"ALERT_SURGE_RATIO_MEDIUM must be greater than 1.0, got {self.ALERT_SURGE_RATIO_MEDIUM}"
            )
        if self.ALERT_SURGE_RATIO_HIGH <= self.ALERT_SURGE_RATIO_MEDIUM:
            raise ValueError(
                f"ALERT_SURGE_RATIO_HIGH ({self.ALERT_SURGE_RATIO_HIGH}) must be greater than "
                f"ALERT_SURGE_RATIO_MEDIUM ({self.ALERT_SURGE_RATIO_MEDIUM})"
            )
        if not (0.0 < self.ALERT_QUALITY_REJECTION_THRESHOLD <= 1.0):
            raise ValueError(
                f"ALERT_QUALITY_REJECTION_THRESHOLD must be in (0, 1.0], got {self.ALERT_QUALITY_REJECTION_THRESHOLD}"
            )
        if not (0.0 < self.ALERT_DELAY_MIN_LATE_PROBABILITY <= 1.0):
            raise ValueError(
                f"ALERT_DELAY_MIN_LATE_PROBABILITY must be in (0, 1.0], got {self.ALERT_DELAY_MIN_LATE_PROBABILITY}"
            )
        if self.ALERT_DELAY_MIN_DELIVERIES < 1:
            raise ValueError(
                f"ALERT_DELAY_MIN_DELIVERIES must be at least 1, got {self.ALERT_DELAY_MIN_DELIVERIES}"
            )
        return self

    @model_validator(mode="after")
    def validate_recovery_settings(self) -> "Settings":
        if self.RECOVERY_TRANSFER_DAYS < 0:
            raise ValueError(
                f"RECOVERY_TRANSFER_DAYS cannot be negative, got {self.RECOVERY_TRANSFER_DAYS}"
            )
        if (
            self.RECOVERY_TRANSFER_COST_PER_UNIT is not None
            and self.RECOVERY_TRANSFER_COST_PER_UNIT < Decimal("0")
        ):
            raise ValueError(
                f"RECOVERY_TRANSFER_COST_PER_UNIT cannot be negative, got {self.RECOVERY_TRANSFER_COST_PER_UNIT}"
            )
        return self

    @field_validator("DISPLAY_CURRENCY", mode="before")
    @classmethod
    def normalize_display_currency(cls, v: Any) -> Any:
        if isinstance(v, str):
            v_clean = v.strip().upper()
            if v_clean in ("USD", "INR"):
                return v_clean
        return v

    @model_validator(mode="after")
    def validate_currency_settings(self) -> "Settings":
        if self.DISPLAY_CURRENCY not in ("USD", "INR"):
            raise ValueError(
                f"DISPLAY_CURRENCY must be 'USD' or 'INR', got '{self.DISPLAY_CURRENCY}'"
            )
        if self.DISPLAY_CURRENCY == "INR":
            if self.USD_TO_INR_RATE is None:
                raise ValueError("USD_TO_INR_RATE must be configured when DISPLAY_CURRENCY is 'INR'")
            if not self.USD_TO_INR_RATE.is_finite() or self.USD_TO_INR_RATE <= Decimal("0"):
                raise ValueError(
                    f"USD_TO_INR_RATE must be finite and greater than 0, got {self.USD_TO_INR_RATE}"
                )
        elif self.USD_TO_INR_RATE is not None:
            if not self.USD_TO_INR_RATE.is_finite() or self.USD_TO_INR_RATE <= Decimal("0"):
                raise ValueError(
                    f"USD_TO_INR_RATE must be finite and greater than 0, got {self.USD_TO_INR_RATE}"
                )
        return self

    @model_validator(mode="after")
    def validate_import_settings(self) -> "Settings":
        if self.IMPORT_MAX_FILE_BYTES <= 0:
            raise ValueError(
                f"IMPORT_MAX_FILE_BYTES must be positive, got {self.IMPORT_MAX_FILE_BYTES}"
            )
        if self.IMPORT_MAX_FILES <= 0:
            raise ValueError(
                f"IMPORT_MAX_FILES must be positive, got {self.IMPORT_MAX_FILES}"
            )
        if self.IMPORT_MAX_TOTAL_BYTES <= 0:
            raise ValueError(
                f"IMPORT_MAX_TOTAL_BYTES must be positive, got {self.IMPORT_MAX_TOTAL_BYTES}"
            )
        if not self.UPLOAD_DB_PATH or not str(self.UPLOAD_DB_PATH).strip():
            raise ValueError("UPLOAD_DB_PATH cannot be empty")

        # Protect primary database from accidental upload overwrite
        if self.DATABASE_URL.startswith("sqlite:///") and self.DATABASE_URL != "sqlite:///:memory:":
            db_subpath = self.DATABASE_URL[len("sqlite:///"):]
            primary_path = Path(db_subpath).resolve()
            upload_path = Path(self.UPLOAD_DB_PATH).resolve()
            if primary_path == upload_path:
                raise ValueError(
                    f"UPLOAD_DB_PATH cannot resolve to the primary DATABASE_URL ({self.DATABASE_URL})"
                )

        return self

    @model_validator(mode="after")
    def validate_globe_settings(self) -> "Settings":
        if self.GLOBE_CONCENTRATION_MIN_SUPPLIERS < 1:
            raise ValueError(
                f"GLOBE_CONCENTRATION_MIN_SUPPLIERS must be at least 1, got {self.GLOBE_CONCENTRATION_MIN_SUPPLIERS}"
            )
        if not (0.0 < self.GLOBE_CONCENTRATION_SHARE <= 1.0):
            raise ValueError(
                f"GLOBE_CONCENTRATION_SHARE must be in (0, 1.0], got {self.GLOBE_CONCENTRATION_SHARE}"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
