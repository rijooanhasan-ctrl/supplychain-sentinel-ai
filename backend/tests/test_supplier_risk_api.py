"""Integration tests for Supplier Risk API and service layer."""

from datetime import date, timedelta
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import Base, DatasetMeta, DeliveryRecord, PurchaseOrder, Supplier
from app.db.session import get_db
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def test_supplier_db_setup(tmp_path):
    """Sets up a temporary SQLite database seeded with fixed as_of date."""
    db_file = tmp_path / "test_supplier_risk.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    as_of = date(2026, 10, 17)
    adapter = DemoAdapter(seed=42, as_of=as_of)
    dataset = adapter.fetch_dataset()
    with session_factory() as session:
        load_dataset(session, dataset, reset=True)

    settings = Settings(
        DATABASE_URL=db_url,
        DATA_SOURCE="demo",
        SUPPLIER_RISK_LOOKBACK_DAYS=365,
        SUPPLIER_RISK_GRACE_DAYS=0,
        SUPPLIER_RISK_W_ON_TIME=0.40,
        SUPPLIER_RISK_W_DELAY=0.25,
        SUPPLIER_RISK_W_REJECTION=0.20,
        SUPPLIER_RISK_W_FILL=0.15,
        SUPPLIER_RISK_BAND_MEDIUM=25.0,
        SUPPLIER_RISK_BAND_HIGH=50.0,
    )
    app = create_app(settings)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    return client, session_factory, as_of, settings


def test_supplier_risk_unseeded_db(tmp_path):
    """Verifies unseeded database returns 200 with seeded=False and empty items."""
    db_file = tmp_path / "unseeded_supplier.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

    settings = Settings(DATABASE_URL=db_url)
    app = create_app(settings)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    res = client.get("/api/supplier-risk")
    assert res.status_code == 200
    data = res.json()
    assert data["seeded"] is False
    assert data["as_of"] is None
    assert data["items"] == []
    assert data["total"] == 0
    assert data["summary"]["total_suppliers"] == 0


def test_supplier_risk_list_envelope_and_summary(test_supplier_db_setup):
    client, _, as_of, _ = test_supplier_db_setup

    res = client.get("/api/supplier-risk")
    assert res.status_code == 200
    data = res.json()

    assert data["seeded"] is True
    assert data["as_of"] == str(as_of)
    assert data["total"] >= 8
    assert len(data["items"]) == data["total"]
    assert "summary" in data
    assert "counts_by_band" in data["summary"]

    # Verify summary consistency
    counts = data["summary"]["counts_by_band"]
    assert sum(counts.values()) == data["total"]


def test_supplier_risk_sorting_and_nulls_last(test_supplier_db_setup):
    client, _, _, _ = test_supplier_db_setup

    res = client.get("/api/supplier-risk")
    assert res.status_code == 200
    items = res.json()["items"]

    # Scores must be descending with nulls at the end
    seen_null = False
    for i in range(len(items) - 1):
        score_a = items[i]["risk_score"]
        score_b = items[i + 1]["risk_score"]

        if score_a is None:
            seen_null = True
        if seen_null:
            assert score_b is None, "Non-null score found after null score"
        elif score_b is not None:
            assert score_a >= score_b, f"Scores not descending: {score_a} < {score_b}"


def test_helix_scored_higher_than_lumen(test_supplier_db_setup):
    """Verifies that unreliable SUP-HELIX receives a higher risk score than reliable SUP-LUMEN."""
    client, _, _, _ = test_supplier_db_setup

    res = client.get("/api/supplier-risk")
    assert res.status_code == 200
    items = res.json()["items"]

    helix = next((s for s in items if s["supplier_code"] == "SUP-HELIX"), None)
    lumen = next((s for s in items if s["supplier_code"] == "SUP-LUMEN"), None)

    assert helix is not None
    assert lumen is not None
    assert helix["risk_score"] is not None
    assert lumen["risk_score"] is not None

    assert helix["risk_score"] > lumen["risk_score"]
    assert helix["on_time_rate"] < lumen["on_time_rate"]


def test_independent_recomputation_of_helix_from_raw_rows(test_supplier_db_setup):
    """Independently computes HELIX metrics directly from database rows without calling app domain code."""
    client, session_factory, as_of, _ = test_supplier_db_setup

    with session_factory() as session:
        helix = session.scalar(select(Supplier).where(Supplier.code == "SUP-HELIX"))
        assert helix is not None
        helix_id = helix.id

        lookback_start = as_of - timedelta(days=365)
        raw_delivs = session.scalars(
            select(DeliveryRecord).where(
                DeliveryRecord.supplier_id == helix_id,
                DeliveryRecord.actual_date >= lookback_start,
                DeliveryRecord.actual_date <= as_of,
            )
        ).all()
        assert len(raw_delivs) > 0

        # Independent hand calculation
        on_time_count = sum(
            1 for d in raw_delivs if (d.actual_date - d.promised_date).days <= 0
        )
        independent_ontime_rate = on_time_count / len(raw_delivs)

        total_rec = sum(d.qty_received for d in raw_delivs)
        total_rej = sum(d.qty_rejected for d in raw_delivs)
        independent_rej_rate = total_rej / total_rec if total_rec > 0 else 0.0

    res = client.get(f"/api/supplier-risk/{helix_id}")
    assert res.status_code == 200
    detail = res.json()

    assert detail["on_time_rate"] == pytest.approx(round(independent_ontime_rate, 4), abs=1e-4)
    assert detail["rejection_rate"] == pytest.approx(round(independent_rej_rate, 4), abs=1e-4)


def test_supplier_risk_filters_and_pagination(test_supplier_db_setup):
    client, _, _, _ = test_supplier_db_setup

    # Country filter
    res_de = client.get("/api/supplier-risk?country=DE")
    assert res_de.status_code == 200
    de_items = res_de.json()["items"]
    assert all(it["country"] == "DE" for it in de_items)

    # Band filter
    res_high = client.get("/api/supplier-risk?band=high")
    assert res_high.status_code == 200
    high_items = res_high.json()["items"]
    assert all(it["risk_band"] == "high" for it in high_items)

    # Pagination
    res_p1 = client.get("/api/supplier-risk?limit=2&offset=0")
    res_p2 = client.get("/api/supplier-risk?limit=2&offset=2")
    assert res_p1.status_code == 200
    assert res_p2.status_code == 200
    assert len(res_p1.json()["items"]) == 2
    assert len(res_p2.json()["items"]) == 2
    assert res_p1.json()["items"][0]["supplier_code"] != res_p2.json()["items"][0]["supplier_code"]


def test_supplier_risk_validation_and_404(test_supplier_db_setup):
    client, _, _, _ = test_supplier_db_setup

    # Invalid band -> 422
    res_bad_band = client.get("/api/supplier-risk?band=extreme")
    assert res_bad_band.status_code == 422

    # Invalid limit -> 422
    res_bad_limit = client.get("/api/supplier-risk?limit=0")
    assert res_bad_limit.status_code == 422
    res_bad_limit2 = client.get("/api/supplier-risk?limit=500")
    assert res_bad_limit2.status_code == 422

    # Unknown supplier -> 404 JSON
    res_404 = client.get("/api/supplier-risk/999999")
    assert res_404.status_code == 404
    assert res_404.headers["content-type"].startswith("application/json")


def test_supplier_risk_determinism(test_supplier_db_setup):
    client, _, _, _ = test_supplier_db_setup

    res1 = client.get("/api/supplier-risk")
    res2 = client.get("/api/supplier-risk")
    assert res1.status_code == 200
    assert res2.status_code == 200
    assert res1.json() == res2.json()


def test_supplier_risk_seeds_one_to_five_no_exceptions(tmp_path):
    """Verifies that seeds 1 through 5 generate clean datasets where HELIX is riskier than LUMEN."""
    for s in range(1, 6):
        db_file = tmp_path / f"test_seed_{s}.db"
        db_url = f"sqlite:///{db_file.as_posix()}"
        engine = create_engine(db_url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(bind=engine)

        as_of = date(2026, 10, 17)
        adapter = DemoAdapter(seed=s, as_of=as_of)
        dataset = adapter.fetch_dataset()
        with session_factory() as session:
            load_dataset(session, dataset, reset=True)

        settings = Settings(DATABASE_URL=db_url)
        app = create_app(settings)

        def override_get_db():
            db = session_factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        client = TestClient(app)

        res = client.get("/api/supplier-risk")
        assert res.status_code == 200
        items = res.json()["items"]
        helix = next(it for it in items if it["supplier_code"] == "SUP-HELIX")
        lumen = next(it for it in items if it["supplier_code"] == "SUP-LUMEN")
        assert helix["risk_score"] > lumen["risk_score"], f"Seed {s}: HELIX not riskier than LUMEN"


def test_supplier_risk_env_settings_validation(tmp_path):
    """Verifies that invalid supplier risk settings in Settings fail fast with ValueError."""
    with pytest.raises(ValueError, match="Supplier risk weights must sum to 1"):
        Settings(SUPPLIER_RISK_W_ON_TIME=0.99)

    with pytest.raises(ValueError, match="SUPPLIER_RISK_LOOKBACK_DAYS must be positive"):
        Settings(SUPPLIER_RISK_LOOKBACK_DAYS=0)

    with pytest.raises(ValueError, match="Invalid supplier risk band ordering"):
        Settings(SUPPLIER_RISK_BAND_MEDIUM=60.0, SUPPLIER_RISK_BAND_HIGH=50.0)
