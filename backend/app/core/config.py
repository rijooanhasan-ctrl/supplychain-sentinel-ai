import json
from functools import lru_cache
from typing import List, Union
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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("CORS_ORIGINS", mode="after")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            clean_str = v.strip()
            if clean_str.startswith("[") and clean_str.endswith("]"):
                try:
                    parsed = json.loads(clean_str)
                    if isinstance(parsed, list):
                        return [str(item).strip() for item in parsed]
                except Exception:
                    pass
            return [i.strip() for i in clean_str.split(",") if i.strip()]
        elif isinstance(v, list):
            return [str(item).strip() for item in v]
        return v

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
