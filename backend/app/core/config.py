import json
from functools import lru_cache
from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "SupplyChain Sentinel AI"
    APP_ENV: str = "development"
    API_VERSION: str = "0.1.0"
    CORS_ORIGINS: Union[List[str], str] = ["http://localhost:5173"]
    DATABASE_URL: str = "sqlite:///./sentinel.db"
    DATA_SOURCE: str = "demo"

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
