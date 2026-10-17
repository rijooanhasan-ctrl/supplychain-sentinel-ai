"""API integration tests for /api/forecasting/evaluation and /api/forecasting/components/{id}."""

from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import Base
from app.db.session import get_db
from app.domain.forecasting import DATA_CAVEAT
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def forecast_test_db(tmp_path):
    """Sets up an isolated temporary SQLite database seeded with fixed as_of date."""
    db_file = tmp_path / "test_forecast.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    as_of = date(2026, 10, 17)
    adapter = DemoAdapter(seed=42, as_of=as_of)
    dataset = adapter.fetch_dataset()

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        load_dataset(session, dataset, reset=True)

    test_settings = Settings(
        APP_NAME="SupplyChain Sentinel AI Test",
        APP_ENV="testing",
        DATABASE_URL=db_url,
        DATA_SOURCE="demo",
    )
    app = create_app(settings=test_settings)

    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as client:
        yield client, session_factory, as_of, engine


def test_forecasting_unseeded_db(client_empty):
    """Unseeded DB returns seeded=False without 500 errors."""
    # 1. Evaluation endpoint
    resp = client_empty.get("/api/forecasting/evaluation")
    assert resp.status_code == 200
    data = resp.json()
    assert data["seeded"] is False
    assert data["per_component"] == []

    # 2. Component endpoint
    resp2 = client_empty.get("/api/forecasting/components/1")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["seeded"] is False
    assert data2["forecast_days"] == []


def test_forecasting_evaluation_envelope_and_models(forecast_test_db):
    """Seeded DB returns complete evaluation report with 3 models, 6 folds, and per-component metrics."""
    client, _, _, _ = forecast_test_db

    resp = client.get("/api/forecasting/evaluation")
    assert resp.status_code == 200
    data = resp.json()

    assert data["seeded"] is True
    assert data["as_of"] == "2026-10-17"
    assert data["data_caveat"] == DATA_CAVEAT

    # Protocol
    protocol = data["protocol"]
    assert protocol["min_train_days"] == 84
    assert protocol["horizon_days"] == 14
    assert protocol["step_days"] == 14
    assert protocol["folds"] == 6
    assert len(protocol["origin_dates"]) == 6

    # Models & Aggregate
    models = data["models"]
    model_names = [m["name"] for m in models]
    assert "seasonal_naive" in model_names
    assert "weekday_average" in model_names
    assert "ridge_weekday_trend" in model_names

    agg = data["aggregate"]
    assert set(agg.keys()) == set(model_names)
    for m in model_names:
        assert agg[m]["n_points"] == 1092  # 13 components * 6 folds * 14 days
        assert agg[m]["n_components"] == 13
        assert agg[m]["pooled_wape"] is not None
        assert agg[m]["mae"] > 0
        assert agg[m]["rmse"] > 0

    # Decision
    decision = data["decision"]
    assert decision["champion"] == "weekday_average"
    assert decision["challenger"] == "ridge_weekday_trend"
    assert isinstance(decision["recommended"], bool)
    assert decision["pooled_wape_improvement_pct"] is not None
    assert decision["win_rate"] is not None
    assert len(decision["reason"]) > 0

    # Per component & skipped
    per_comp = data["per_component"]
    assert len(per_comp) == 14

    skipped = data["skipped"]
    assert len(skipped) == 1
    assert skipped[0]["sku"] == "COMP-SPARE-01"


def test_component_forecast_detail_success_and_last_fold(forecast_test_db):
    """Component forecast endpoint returns next N days and last backtest fold."""
    client, _, _, _ = forecast_test_db

    # CPU-X7 is component 1
    resp = client.get("/api/forecasting/components/1?days=7")
    assert resp.status_code == 200
    data = resp.json()

    assert data["seeded"] is True
    assert data["component_id"] == 1
    assert data["sku"] == "CPU-X7"
    assert data["days"] == 7
    assert len(data["forecast_days"]) == 7

    for df in data["forecast_days"]:
        assert "date" in df
        assert "weekday" in df
        fc = df["forecasts"]
        assert "seasonal_naive" in fc
        assert "weekday_average" in fc
        assert "ridge_weekday_trend" in fc
        assert all(v >= 0.0 for v in fc.values())

    # Backtest last fold points (14 days in fold 5)
    last_fold = data["backtest_last_fold"]
    assert len(last_fold) == 14
    for bp in last_fold:
        assert "date" in bp
        assert "actual" in bp
        assert bp["actual"] > 0.0
        assert "seasonal_naive" in bp["forecasts"]
        assert "weekday_average" in bp["forecasts"]
        assert "ridge_weekday_trend" in bp["forecasts"]


def test_component_forecast_validation_errors(forecast_test_db):
    """Component forecast endpoint validates query parameters properly (422)."""
    client, _, _, _ = forecast_test_db

    # days < 1
    resp = client.get("/api/forecasting/components/1?days=0")
    assert resp.status_code == 422

    # days > 60
    resp2 = client.get("/api/forecasting/components/1?days=61")
    assert resp2.status_code == 422

    # days not an int
    resp3 = client.get("/api/forecasting/components/1?days=abc")
    assert resp3.status_code == 422


def test_component_forecast_404_for_unknown_component(forecast_test_db):
    """Component forecast returns 404 for unknown component ID."""
    client, _, _, _ = forecast_test_db

    resp = client.get("/api/forecasting/components/999999")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_forecasting_evaluation_determinism_and_caching(forecast_test_db):
    """Calling /api/forecasting/evaluation twice returns identical responses (cached/deterministic)."""
    client, _, _, _ = forecast_test_db

    r1 = client.get("/api/forecasting/evaluation").json()
    r2 = client.get("/api/forecasting/evaluation").json()
    assert r1 == r2


def test_forecasting_env_settings_validation():
    """Validates settings for forecasting parameters at initialization."""
    # min_train_days < 14
    with pytest.raises(ValueError, match="FORECAST_MIN_TRAIN_DAYS"):
        Settings(FORECAST_MIN_TRAIN_DAYS=10)

    # horizon_days <= 0
    with pytest.raises(ValueError, match="FORECAST_HORIZON_DAYS"):
        Settings(FORECAST_HORIZON_DAYS=0)

    # step_days <= 0
    with pytest.raises(ValueError, match="FORECAST_STEP_DAYS"):
        Settings(FORECAST_STEP_DAYS=-1)

    # min_improvement_pct < 0
    with pytest.raises(ValueError, match="FORECAST_MIN_IMPROVEMENT_PCT"):
        Settings(FORECAST_MIN_IMPROVEMENT_PCT=-5.0)

    # min_win_rate not in [0, 1]
    with pytest.raises(ValueError, match="FORECAST_MIN_WIN_RATE"):
        Settings(FORECAST_MIN_WIN_RATE=1.2)
