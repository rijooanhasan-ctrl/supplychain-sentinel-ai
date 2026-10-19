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
    assert settings.INVENTORY_LOOKBACK_DAYS == 28
    assert settings.INVENTORY_HORIZON_DAYS == 60
    assert settings.INVENTORY_CRITICAL_DAYS == 7
    assert settings.INVENTORY_HIGH_DAYS == 14
    assert settings.INVENTORY_MEDIUM_DAYS == 30
    assert settings.DISPLAY_CURRENCY == "USD"
    assert settings.USD_TO_INR_RATE is None


def test_config_overrides_via_env_vars(monkeypatch):
    monkeypatch.setenv("APP_NAME", "Overridden Sentinel")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_VERSION", "2.0.0")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8080")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./prod.db")
    monkeypatch.setenv("DATA_SOURCE", "sap_mock")
    monkeypatch.setenv("INVENTORY_LOOKBACK_DAYS", "35")
    monkeypatch.setenv("INVENTORY_HORIZON_DAYS", "90")
    monkeypatch.setenv("INVENTORY_CRITICAL_DAYS", "10")
    monkeypatch.setenv("INVENTORY_HIGH_DAYS", "20")
    monkeypatch.setenv("INVENTORY_MEDIUM_DAYS", "45")

    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.APP_NAME == "Overridden Sentinel"
        assert settings.APP_ENV == "production"
        assert settings.API_VERSION == "2.0.0"
        assert settings.CORS_ORIGINS == ["http://localhost:3000", "http://localhost:8080"]
        assert settings.DATABASE_URL == "sqlite:///./prod.db"
        assert settings.DATA_SOURCE == "sap_mock"
        assert settings.INVENTORY_LOOKBACK_DAYS == 35
        assert settings.INVENTORY_HORIZON_DAYS == 90
        assert settings.INVENTORY_CRITICAL_DAYS == 10
        assert settings.INVENTORY_HIGH_DAYS == 20
        assert settings.INVENTORY_MEDIUM_DAYS == 45
    finally:
        get_settings.cache_clear()


def test_config_inventory_validation_rejects_invalid_values(monkeypatch):
    monkeypatch.setenv("INVENTORY_HORIZON_DAYS", "5")
    with pytest.raises(ValueError, match="INVENTORY_HORIZON_DAYS must be between 7 and 180"):
        Settings()

    monkeypatch.setenv("INVENTORY_HORIZON_DAYS", "60")
    monkeypatch.setenv("INVENTORY_CRITICAL_DAYS", "15")
    monkeypatch.setenv("INVENTORY_HIGH_DAYS", "10")
    with pytest.raises(ValueError, match="Invalid inventory threshold ordering"):
        Settings()


def test_config_currency_settings_valid(monkeypatch):
    monkeypatch.setenv("DISPLAY_CURRENCY", "INR")
    monkeypatch.setenv("USD_TO_INR_RATE", "83.5")
    s = Settings()
    assert s.DISPLAY_CURRENCY == "INR"
    assert s.USD_TO_INR_RATE == pytest.approx(83.5)


def test_config_currency_validation_errors(monkeypatch):
    # Invalid currency name
    monkeypatch.setenv("DISPLAY_CURRENCY", "EUR")
    with pytest.raises(ValueError, match="DISPLAY_CURRENCY must be 'USD' or 'INR'"):
        Settings()

    # INR without rate
    monkeypatch.setenv("DISPLAY_CURRENCY", "INR")
    monkeypatch.delenv("USD_TO_INR_RATE", raising=False)
    with pytest.raises(ValueError, match="USD_TO_INR_RATE must be configured"):
        Settings()

    # INR with non-positive rate
    monkeypatch.setenv("USD_TO_INR_RATE", "0")
    with pytest.raises(ValueError, match="USD_TO_INR_RATE must be finite and greater than 0"):
        Settings()

    monkeypatch.setenv("USD_TO_INR_RATE", "-5.5")
    with pytest.raises(ValueError, match="USD_TO_INR_RATE must be finite and greater than 0"):
        Settings()

