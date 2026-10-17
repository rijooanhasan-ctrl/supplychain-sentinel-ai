from datetime import datetime
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_health_returns_200_and_expected_fields():
    app = create_app()
    client = TestClient(app)
    response = client.get("/api/health")

    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "ok"
    assert data["app"] == "SupplyChain Sentinel AI"
    assert isinstance(data["version"], str)
    assert isinstance(data["environment"], str)
    assert isinstance(data["data_source"], str)
    assert isinstance(data["timestamp"], str)


def test_health_timestamp_parses_as_iso8601():
    app = create_app()
    client = TestClient(app)
    response = client.get("/api/health")

    assert response.status_code == 200
    data = response.json()

    parsed_dt = datetime.fromisoformat(data["timestamp"])
    assert parsed_dt is not None
    assert parsed_dt.tzinfo is not None


def test_health_reflects_custom_settings():
    custom_settings = Settings(
        APP_NAME="Custom Sentinel",
        APP_ENV="staging",
        API_VERSION="1.2.3",
        DATA_SOURCE="custom_adapter",
    )
    app = create_app(settings=custom_settings)
    client = TestClient(app)
    response = client.get("/api/health")

    assert response.status_code == 200
    data = response.json()
    assert data["app"] == "Custom Sentinel"
    assert data["environment"] == "staging"
    assert data["version"] == "1.2.3"
    assert data["data_source"] == "custom_adapter"
