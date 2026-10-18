"""Integration and API tests for What-If Simulation (/api/simulation).

Validates:
- API response envelope and schema
- 422 for parameter range violations and excessive negative on-hand adjustment
- 404 for unknown component ID
- Unseeded database returns seeded=false, no 500
- Multi-seed stability across seeds 1..5
- Strict verification against RAW database rows (independent of domain logic)
"""

from datetime import date, timedelta
from decimal import Decimal
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import (
    Base,
    Component,
    DatasetMeta,
    InventoryLevel,
    PurchaseOrder,
    PurchaseOrderLine,
    Warehouse,
)
from app.db.session import get_db
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def simulation_test_setup(tmp_path):
    """Sets up a temporary SQLite database seeded with default seed 42 as_of 2026-10-17."""
    db_file = tmp_path / "test_simulation_api.db"
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
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    return {
        "engine": engine,
        "session_factory": session_factory,
        "client": client,
        "as_of": as_of,
    }


def test_simulation_api_envelope(simulation_test_setup):
    client = simulation_test_setup["client"]

    response = client.get("/api/simulation?component_id=1")
    assert response.status_code == 200
    data = response.json()

    assert data["seeded"] is True
    assert data["as_of"] == "2026-10-17"
    assert data["component"]["sku"] == "CPU-X7"
    assert "params" in data
    assert "baseline" in data
    assert "disrupted" in data
    assert "recovered" in data
    assert isinstance(data["what_changed"], list)
    assert isinstance(data["assumptions"], list)
    assert "What-if simulation" in data["note"]

    # Verify baseline structure
    b = data["baseline"]
    assert b["risk_level"] == "critical"
    assert b["shortage_date"] == "2026-10-21"
    assert b["days_until_shortage"] == 4
    assert len(b["daily_projection_30d"]) == 30
    assert b["unmet_before_next_inbound"] > 0


def test_simulation_api_validation_422(simulation_test_setup):
    client = simulation_test_setup["client"]

    # Missing required component_id
    r = client.get("/api/simulation")
    assert r.status_code == 422

    # Delay out of range (> 60)
    r = client.get("/api/simulation?component_id=1&supplier_delay_days=61")
    assert r.status_code == 422

    # Delay out of range (< 0)
    r = client.get("/api/simulation?component_id=1&supplier_delay_days=-1")
    assert r.status_code == 422

    # Demand multiplier out of range (> 3.0)
    r = client.get("/api/simulation?component_id=1&demand_multiplier=3.5")
    assert r.status_code == 422

    # Demand multiplier out of range (< 0.5)
    r = client.get("/api/simulation?component_id=1&demand_multiplier=0.2")
    assert r.status_code == 422

    # On hand delta out of range
    r = client.get("/api/simulation?component_id=1&on_hand_delta=15000")
    assert r.status_code == 422


def test_simulation_api_negative_on_hand_422(simulation_test_setup):
    client = simulation_test_setup["client"]

    # CPU-X7 plant on-hand is 520. Attempting to reduce by -600 should 422 with a clear explanation
    r = client.get("/api/simulation?component_id=1&on_hand_delta=-600")
    assert r.status_code == 422
    assert "negative on-hand" in r.json()["detail"].lower()


def test_simulation_api_not_found_404(simulation_test_setup):
    client = simulation_test_setup["client"]

    r = client.get("/api/simulation?component_id=999999")
    assert r.status_code == 404
    assert "not found" in r.json()["detail"].lower()


def test_simulation_api_unseeded(tmp_path):
    db_file = tmp_path / "test_unseeded_simulation.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    test_settings = Settings(
        APP_NAME="SupplyChain Sentinel AI Test",
        APP_ENV="testing",
        DATABASE_URL=db_url,
        DATA_SOURCE="demo",
    )
    app = create_app(settings=test_settings)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    r = client.get("/api/simulation?component_id=1")
    assert r.status_code == 200
    data = r.json()
    assert data["seeded"] is False
    assert data["component"] is None


def test_simulation_api_seeds_1_to_5(tmp_path):
    as_of = date(2026, 10, 17)

    for seed_val in range(1, 6):
        db_file = tmp_path / f"test_sim_seed_{seed_val}.db"
        db_url = f"sqlite:///{db_file.as_posix()}"
        engine = create_engine(db_url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)

        adapter = DemoAdapter(seed=seed_val, as_of=as_of)
        ds = adapter.fetch_dataset()
        sf = sessionmaker(bind=engine, autocommit=False, autoflush=False)
        with sf() as session:
            load_dataset(session, ds, reset=True)

        app = create_app(settings=Settings(DATABASE_URL=db_url, APP_ENV="testing"))

        def override():
            db = sf()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override
        client = TestClient(app)

        r = client.get("/api/simulation?component_id=1&supplier_delay_days=5&demand_multiplier=1.2")
        assert r.status_code == 200, f"Seed {seed_val} failed with {r.text}"
        data = r.json()
        assert data["seeded"] is True
        assert data["disrupted"] is not None
        assert data["recovered"] is not None


def test_simulation_api_raw_row_assertions(simulation_test_setup):
    """Independently verifies API results using RAW database queries without domain functions."""
    session_factory = simulation_test_setup["session_factory"]
    client = simulation_test_setup["client"]

    with session_factory() as session:
        # Verify RAW on-hand inventory for CPU-X7 at plant warehouse
        plant_wh = session.scalar(select(Warehouse).where(Warehouse.code == "WH-PLANT"))
        assert plant_wh is not None
        assert plant_wh.role == "plant"

        cpu_comp = session.scalar(select(Component).where(Component.sku == "CPU-X7"))
        assert cpu_comp is not None

        inv_level = session.scalar(
            select(InventoryLevel).where(
                InventoryLevel.component_id == cpu_comp.id,
                InventoryLevel.warehouse_id == plant_wh.id,
            )
        )
        assert inv_level is not None
        raw_on_hand = inv_level.on_hand
        raw_reserved = inv_level.reserved
        raw_usable = raw_on_hand - raw_reserved
        assert raw_on_hand == 520
        assert raw_reserved == 100
        assert raw_usable == 420

        # Verify RAW inbound PO line
        po_line_row = session.execute(
            select(PurchaseOrder.promised_date, PurchaseOrderLine.qty_ordered)
            .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
            .where(
                PurchaseOrderLine.component_id == cpu_comp.id,
                PurchaseOrderLine.warehouse_id == plant_wh.id,
            )
        ).first()
        assert po_line_row is not None
        assert po_line_row[0] == date(2026, 10, 24)
        assert po_line_row[1] == 800

    # 1. Defaults: disrupted equals baseline
    r_def = client.get("/api/simulation?component_id=1")
    assert r_def.status_code == 200
    d_def = r_def.json()
    assert d_def["disrupted"]["shortage_date"] == d_def["baseline"]["shortage_date"]
    assert d_def["disrupted"]["unmet_before_next_inbound"] == d_def["baseline"]["unmet_before_next_inbound"]
    assert d_def["what_changed"] == ["No changes applied; disrupted equals baseline."]

    # 2. supplier_delay_days=7: receipt moves from 2026-10-24 to 2026-10-31, shortage window ends 2026-10-30
    r_delay = client.get("/api/simulation?component_id=1&supplier_delay_days=7")
    assert r_delay.status_code == 200
    d_delay = r_delay.json()
    dis = d_delay["disrupted"]
    assert dis["next_inbound"]["date"] == "2026-10-31"
    assert dis["first_shortage_episode"]["start_date"] == "2026-10-21"
    assert dis["first_shortage_episode"]["end_date"] == "2026-10-30"
    assert dis["first_shortage_episode"]["days"] == 10

    # 3. demand_multiplier=1.3: shortage date not later than baseline
    r_demand = client.get("/api/simulation?component_id=1&demand_multiplier=1.3")
    assert r_demand.status_code == 200
    d_demand = r_demand.json()
    assert d_demand["disrupted"]["shortage_date"] <= d_demand["baseline"]["shortage_date"]

    # 4. recovered unmet_before_next_inbound <= disrupted unmet_before_next_inbound
    assert d_delay["recovered"]["unmet_before_next_inbound"] <= d_delay["disrupted"]["unmet_before_next_inbound"]
