"""Integration and API tests for Recovery Recommendations (/api/recommendations).

Validates:
- API envelope and response schema
- component_id filtering
- Unseeded database returns seeded=false, items=[], no 500
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
    Supplier,
    SupplierComponent,
    Warehouse,
)
from app.db.session import get_db
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def recovery_test_setup(tmp_path):
    """Sets up a temporary SQLite database seeded with default seed 42 as_of 2026-10-17."""
    db_file = tmp_path / "test_recovery_api.db"
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


@pytest.fixture
def empty_db_setup(tmp_path):
    """Sets up an unseeded temporary SQLite database."""
    db_file = tmp_path / "empty_recovery_api.db"
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
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as client:
        yield client, session_factory, engine


# =====================================================================
# 1. Envelope and Unseeded DB
# =====================================================================

def test_unseeded_database_returns_empty_envelope(empty_db_setup):
    client, _, _ = empty_db_setup
    resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert data["seeded"] is False
    assert data["as_of"] is None
    assert data["items"] == []
    assert data["total"] == 0
    assert "Decision support only" in data["note"]


def test_recommendations_envelope(recovery_test_setup):
    client, _, as_of, _ = recovery_test_setup
    resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert data["seeded"] is True
    assert data["as_of"] == as_of.isoformat()
    assert "config" in data
    assert data["config"]["transfer_days"] == 2
    assert isinstance(data["items"], list)
    assert data["total"] == len(data["items"])
    assert "Decision support only. No orders are created." in data["note"]


# =====================================================================
# 2. Filtering by component_id
# =====================================================================

def test_filter_by_component_id(recovery_test_setup):
    client, _, _, _ = recovery_test_setup

    # Valid component_id=1 (CPU-X7)
    resp = client.get("/api/recommendations?component_id=1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["component_id"] == 1
    assert item["sku"] == "CPU-X7"

    # Non-existent component_id=9999
    resp_empty = client.get("/api/recommendations?component_id=9999")
    assert resp_empty.status_code == 200
    data_empty = resp_empty.json()
    assert data_empty["total"] == 0
    assert data_empty["items"] == []


# =====================================================================
# 3. Multi-seed stability (seeds 1..5)
# =====================================================================

@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_multi_seed_recommendations_no_exceptions(tmp_path, seed):
    db_file = tmp_path / f"test_rec_seed_{seed}.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    as_of = date(2026, 10, 17)
    adapter = DemoAdapter(seed=seed, as_of=as_of)
    dataset = adapter.fetch_dataset()

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        load_dataset(session, dataset, reset=True)

    test_settings = Settings(
        APP_NAME=f"SupplyChain Sentinel AI Test Seed {seed}",
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
        resp = client.get("/api/recommendations")
        assert resp.status_code == 200
        data = resp.json()
        assert data["seeded"] is True
        for rec in data["items"]:
            assert rec["need_units"] > 0
            assert rec["recommended_option_id"] is not None
            assert len(rec["options"]) > 0
            # Every option must be well-formed
            for opt in rec["options"]:
                assert opt["kind"] in ("transfer", "expedite_existing", "alternative_supplier", "accept_delay")
                if not opt["feasible"]:
                    assert opt["infeasible_reason"] is not None


# =====================================================================
# 4. Strict RAW Database Rows Validation for CPU-X7
# =====================================================================

def test_raw_database_cross_validation_for_cpu_x7(recovery_test_setup):
    """Independently verifies CPU-X7 options using RAW database queries only."""
    client, session_factory, as_of, _ = recovery_test_setup

    with session_factory() as session:
        # 1. Query raw Component row
        comp = session.scalars(select(Component).where(Component.sku == "CPU-X7")).one()
        assert comp.id == 1

        # 2. Query raw offers for CPU-X7
        offers = session.scalars(
            select(SupplierComponent)
            .where(SupplierComponent.component_id == comp.id)
        ).all()
        helix_offer = next(o for o in offers if o.supplier_id == 1)  # SUP-HELIX
        nexus_offer = next(o for o in offers if o.supplier_id == 2)  # SUP-NEXUS

        # 3. Query raw Regional Inventories
        wh_reg_levels = session.execute(
            select(Warehouse.code, InventoryLevel.on_hand, InventoryLevel.reserved)
            .join(Warehouse, InventoryLevel.warehouse_id == Warehouse.id)
            .where(InventoryLevel.component_id == comp.id, Warehouse.role == "regional")
        ).all()
        raw_regional_usable = {
            row[0]: max(0, row[1] - row[2]) for row in wh_reg_levels
        }

        # 4. Query raw PO lines
        po_lines = session.execute(
            select(PurchaseOrder.po_number, PurchaseOrderLine.qty_ordered, PurchaseOrderLine.qty_received)
            .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
            .where(PurchaseOrderLine.component_id == comp.id, PurchaseOrder.po_number == "PO-CPU-701")
        ).first()
        assert po_lines is not None
        po_rem_qty = po_lines[1] - po_lines[2]

    # Call API for component 1
    resp = client.get("/api/recommendations?component_id=1")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    rec = data["items"][0]
    opt_map = {o["id"]: o for o in rec["options"]}

    # A. CPU-X7 has a recommendation and recommended option is FEASIBLE
    assert rec["recommended_option_id"] is not None
    rec_opt = opt_map[rec["recommended_option_id"]]
    assert rec_opt["feasible"] is True

    # B. The recommended option's residual is the MINIMUM among feasible options
    feasible_residuals = [o["residual_unmet_before_next_inbound"] for o in rec["options"] if o["feasible"]]
    assert rec_opt["residual_unmet_before_next_inbound"] == min(feasible_residuals)

    # C. Nexus option quantity is within [min_order_qty, 300]
    nexus_opt = opt_map["alt_supplier.SUP-NEXUS"]
    assert nexus_opt["feasible"] is True
    assert nexus_offer.min_order_qty <= nexus_opt["quantity"] <= 300
    # Its arrival equals as_of + lead_time_days
    expected_nexus_arrival = as_of + timedelta(days=nexus_offer.lead_time_days)
    assert nexus_opt["arrival_date"] == expected_nexus_arrival.isoformat()

    # D. Transfer option quantity <= regional usable stock computed from raw rows
    for wh_code, usable in raw_regional_usable.items():
        transfer_opt_id = f"transfer.{wh_code}"
        assert transfer_opt_id in opt_map
        t_opt = opt_map[transfer_opt_id]
        assert t_opt["quantity"] <= usable
        expected_xfer_arrival = as_of + timedelta(days=2)
        assert t_opt["arrival_date"] == expected_xfer_arrival.isoformat()

    # E. Expedite option cost equals remaining qty x 250.00 x 0.25 computed independently as Decimal
    expedite_opt = opt_map["expedite.PO-CPU-701"]
    assert expedite_opt["feasible"] is True
    assert expedite_opt["quantity"] == po_rem_qty
    raw_expedite_cost = (
        Decimal(str(po_rem_qty)) * helix_offer.unit_cost * helix_offer.expedite_cost_premium_pct
    )
    assert expedite_opt["incremental_cost"] == f"{raw_expedite_cost:.2f}"
    assert expedite_opt["incremental_cost"] == "50000.00"

    # F. No recommended option is infeasible
    for item in data["items"]:
        winner = next(o for o in item["options"] if o["id"] == item["recommended_option_id"])
        assert winner["feasible"] is True
