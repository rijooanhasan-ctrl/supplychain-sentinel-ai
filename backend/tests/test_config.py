import pytest
from app.core.config import Settings, get_settings


def test_config_defaults_load_correctly():
    settings = Settings()
    assert settings.APP_NAME == "SupplyChain Sentinel AI"
    assert settings.APP_ENV == "development"
    assert settings.API_VERSION == "0.1.0"
    assert settings.CORS_ORIGINS == ["http://localhost:5173"]
    assert settings.DATABASE_URL == "sqlite:///./sentinel.db"
    assert settings.DATA_SOURCE == "demo"


def test_config_overrides_via_env_vars(monkeypatch):
    monkeypatch.setenv("APP_NAME", "Overridden Sentinel")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_VERSION", "2.0.0")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8080")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./prod.db")
    monkeypatch.setenv("DATA_SOURCE", "sap_mock")

    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.APP_NAME == "Overridden Sentinel"
        assert settings.APP_ENV == "production"
        assert settings.API_VERSION == "2.0.0"
        assert settings.CORS_ORIGINS == ["http://localhost:3000", "http://localhost:8080"]
        assert settings.DATABASE_URL == "sqlite:///./prod.db"
        assert settings.DATA_SOURCE == "sap_mock"
    finally:
        get_settings.cache_clear()
