"""Integration and API tests for Disruption Detection and Alerts (/api/alerts)."""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
import math
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import (
    Base,
    BomLine,
    Component,
    CustomerOrder,
    DatasetMeta,
    DeliveryRecord,
    DemandRecord,
    InventoryLevel,
    Product,
    PurchaseOrder,
    PurchaseOrderLine,
    Supplier,
    SupplierComponent,
    Warehouse,
)
from app.db.session import get_db
from app.domain.alerts import round_half_up
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def alerts_test_setup(tmp_path):
    """Sets up a temporary SQLite database seeded with default seed 42 as_of 2026-10-17."""
    db_file = tmp_path / "test_alerts_api.db"
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
    db_file = tmp_path / "empty_alerts_api.db"
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
# 1. Unseeded DB
# =====================================================================

def test_alerts_unseeded_db(empty_db_setup):
    client, _, _ = empty_db_setup
    res = client.get("/api/alerts")
    assert res.status_code == 200
    data = res.json()
    assert data["seeded"] is False
    assert data["as_of"] is None
    assert data["total"] == 0
    assert data["items"] == []
    assert data["summary"]["total_alerts"] == 0
    assert data["summary"]["counts_by_severity"] == {
        "critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0
    }


# =====================================================================
# 2. Envelope, Summary, and Config
# =====================================================================

def test_alerts_envelope_and_summary_consistency(alerts_test_setup):
    client, _, as_of, _ = alerts_test_setup
    res = client.get("/api/alerts")
    assert res.status_code == 200
    data = res.json()

    assert data["seeded"] is True
    assert data["as_of"] == as_of.isoformat()
    assert data["config"]["surge_recent_days"] == 14
    assert data["config"]["surge_baseline_days"] == 28
    assert data["config"]["delay_min_late_probability"] == 0.20

    summary = data["summary"]
    total = data["total"]
    assert total == summary["total_alerts"]
    assert sum(summary["counts_by_severity"].values()) == total
    assert sum(summary["counts_by_type"].values()) == total


# =====================================================================
# 3. Filters and Pagination
# =====================================================================

def test_alerts_filters_and_pagination(alerts_test_setup):
    client, _, _, _ = alerts_test_setup

    # Severity filter: summary retains all alerts, items only critical
    res_crit = client.get("/api/alerts?severity=critical")
    assert res_crit.status_code == 200
    data_crit = res_crit.json()
    assert all(it["severity"] == "critical" for it in data_crit["items"])
    assert data_crit["total"] == data_crit["summary"]["counts_by_severity"]["critical"]
    assert data_crit["summary"]["total_alerts"] > data_crit["total"]

    # Type filter: inventory_shortage
    res_type = client.get("/api/alerts?type=inventory_shortage")
    assert res_type.status_code == 200
    data_type = res_type.json()
    assert all(it["type"] == "inventory_shortage" for it in data_type["items"])
    assert data_type["total"] == data_type["summary"]["counts_by_type"]["inventory_shortage"]

    # Pagination
    res_p1 = client.get("/api/alerts?limit=5&offset=0")
    res_p2 = client.get("/api/alerts?limit=5&offset=5")
    assert res_p1.status_code == 200 and res_p2.status_code == 200
    ids_p1 = [it["id"] for it in res_p1.json()["items"]]
    ids_p2 = [it["id"] for it in res_p2.json()["items"]]
    assert len(ids_p1) == 5
    assert len(ids_p2) == 5
    assert len(set(ids_p1).intersection(set(ids_p2))) == 0


# =====================================================================
# 4. Detail View, 404, and 422 Validation
# =====================================================================

def test_alerts_detail_and_validation_errors(alerts_test_setup):
    client, _, _, _ = alerts_test_setup

    # Valid detail
    res = client.get("/api/alerts/inventory_shortage.CPU-X7")
    assert res.status_code == 200
    detail = res.json()
    assert detail["id"] == "inventory_shortage.CPU-X7"
    assert detail["severity"] == "critical"
    assert detail["component_sku"] == "CPU-X7"
    assert detail["impact"] is not None
    assert detail["impact"]["orders_count"] > 0
    assert len(detail["evidence"]) > 0
    assert len(detail["assumptions"]) > 0

    # 404 for unknown alert ID (dots and hyphens in ID)
    res_404 = client.get("/api/alerts/inventory_shortage.UNKNOWN-SKU-999")
    assert res_404.status_code == 404
    assert "not found" in res_404.json()["detail"].lower()

    # 422 on bad enum / invalid pagination
    assert client.get("/api/alerts?severity=ultra").status_code == 422
    assert client.get("/api/alerts?type=fake_disruption").status_code == 422
    assert client.get("/api/alerts?limit=0").status_code == 422
    assert client.get("/api/alerts?limit=500").status_code == 422
    assert client.get("/api/alerts?offset=-1").status_code == 422


# =====================================================================
# 5. Independent CPU-X7 & SUP-HELIX Raw Row Recomputation
# =====================================================================

def test_independent_raw_recomputations_cpu_x7_and_helix(alerts_test_setup):
    """Independent raw-row recomputations with no app domain code."""
    client, session_factory, as_of, _ = alerts_test_setup

    with session_factory() as session:
        # 1. Fetch CPU-X7 component
        cpu = session.execute(select(Component).where(Component.sku == "CPU-X7")).scalar_one()

        # 2. Raw deliveries for SUP-HELIX
        helix = session.execute(select(Supplier).where(Supplier.code == "SUP-HELIX")).scalar_one()
        deliveries = session.execute(
            select(DeliveryRecord).where(
                DeliveryRecord.supplier_id == helix.id,
                DeliveryRecord.actual_date <= as_of,
            )
        ).scalars().all()

        n_delivs = len(deliveries)
        delays_when_late = []
        on_time_count = 0
        for d in deliveries:
            delay = (d.actual_date - d.promised_date).days
            if delay <= 0:
                on_time_count += 1
            else:
                delays_when_late.append(delay)

        on_time_rate = on_time_count / n_delivs
        raw_avg_delay = sum(delays_when_late) / len(delays_when_late)
        sorted_delays = sorted(delays_when_late)
        p90_idx = math.ceil(0.90 * len(sorted_delays)) - 1
        raw_p90_delay = sorted_delays[p90_idx]

        raw_typical_shift = round_half_up(raw_avg_delay)
        raw_severe_shift = math.ceil(raw_p90_delay)

        # 3. Raw exposed customer orders for CPU-X7
        # Orders open or in_production with due_date in [2026-10-21, 2026-10-17 + 60d)
        bom_rows = session.execute(
            select(BomLine).where(BomLine.component_id == cpu.id)
        ).scalars().all()
        cpu_products = {b.product_id: b.quantity_per_unit for b in bom_rows}

        products_map = {
            p.id: p.selling_price
            for p in session.execute(select(Product)).scalars().all()
        }

        horizon_end = as_of + timedelta(days=60)
        shortage_start = date(2026, 10, 21)

        raw_orders = session.execute(
            select(CustomerOrder).where(
                CustomerOrder.status.in_(["open", "in_production"]),
                CustomerOrder.due_date >= shortage_start,
                CustomerOrder.due_date < horizon_end,
                CustomerOrder.product_id.in_(list(cpu_products.keys())),
            )
        ).scalars().all()

        raw_exposed_count = len(raw_orders)
        raw_exposed_revenue = sum(
            Decimal(str(o.quantity)) * products_map[o.product_id] for o in raw_orders
        )

    # Verify inventory_shortage alert exists with severity critical
    res_shortage = client.get(f"/api/alerts/inventory_shortage.{cpu.sku}")
    assert res_shortage.status_code == 200
    alert_shortage = res_shortage.json()
    assert alert_shortage["severity"] == "critical"
    assert alert_shortage["impact"]["orders_count"] == raw_exposed_count
    assert alert_shortage["impact"]["exposed_revenue"] == str(raw_exposed_revenue)

    # Verify supplier_delay_exposure alert exists for CPU-X7 / SUP-HELIX
    res_delay = client.get(f"/api/alerts/supplier_delay_exposure.{cpu.sku}.{helix.code}")
    assert res_delay.status_code == 200
    alert_delay = res_delay.json()
    assert alert_delay["severity"] == "critical"

    scenarios = {s["scenario_name"]: s for s in alert_delay["delay_scenarios"]}
    assert scenarios["typical"]["shift_days"] == raw_typical_shift
    assert scenarios["severe"]["shift_days"] == raw_severe_shift

    # Typical shortage episode is longer than baseline (10 days vs 3 days)
    # and ends the day before the shifted receipt (shifted receipt 2026-10-31 -> ends 2026-10-30)
    assert scenarios["typical"]["first_episode_days"] > scenarios["baseline"]["first_episode_days"]
    assert scenarios["typical"]["first_episode_end"] == "2026-10-30"

    # Compound risk alert exists for CPU-X7
    res_compound = client.get(f"/api/alerts/compound_risk.{cpu.sku}")
    assert res_compound.status_code == 200
    alert_compound = res_compound.json()
    assert alert_compound["severity"] == "critical"
    assert f"inventory_shortage.{cpu.sku}" in alert_compound["related_alert_ids"]
    assert f"supplier_delay_exposure.{cpu.sku}.{helix.code}" in alert_compound["related_alert_ids"]


# =====================================================================
# 6. Demand Surge Raw Ratio Check
# =====================================================================

def test_demand_surge_raw_consistency(alerts_test_setup):
    client, session_factory, as_of, _ = alerts_test_setup

    with session_factory() as session:
        # Recompute demand surge ratio for RAM-16GB from raw DemandRecord rows
        ram = session.execute(select(Component).where(Component.sku == "RAM-16GB")).scalar_one()
        records = session.execute(
            select(DemandRecord).where(
                DemandRecord.component_id == ram.id,
                DemandRecord.date < as_of,
                DemandRecord.date >= as_of - timedelta(days=42),
            )
        ).scalars().all()

        recent_vals = [r.quantity for r in records if r.date >= as_of - timedelta(days=14)]
        base_vals = [r.quantity for r in records if r.date < as_of - timedelta(days=14)]

        recent_mean = sum(recent_vals) / len(recent_vals)
        base_mean = sum(base_vals) / len(base_vals)
        raw_ratio = recent_mean / base_mean

    res = client.get("/api/alerts?type=demand_surge")
    assert res.status_code == 200
    surge_items = res.json()["items"]

    if raw_ratio >= 1.5:
        ram_alerts = [a for a in surge_items if a["component_sku"] == "RAM-16GB"]
        assert len(ram_alerts) == 1
        assert ram_alerts[0]["severity"] == "high"


# =====================================================================
# 7. PO-OVERDUE-01: Slipped, Not Overdue
# =====================================================================

def test_po_overdue_01_slipped_not_overdue(alerts_test_setup):
    client, _, _, _ = alerts_test_setup

    # Must produce po_slipped.PO-OVERDUE-01
    res_slipped = client.get("/api/alerts/po_slipped.PO-OVERDUE-01")
    assert res_slipped.status_code == 200
    assert res_slipped.json()["type"] == "po_slipped"

    # Must NOT produce po_overdue.PO-OVERDUE-01
    res_overdue = client.get("/api/alerts/po_overdue.PO-OVERDUE-01")
    assert res_overdue.status_code == 404


# =====================================================================
# 8. Seeds 1 to 5 No Exceptions
# =====================================================================

@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_alerts_seeds_one_to_five_no_exceptions(tmp_path, seed):
    db_file = tmp_path / f"test_seed_{seed}.db"
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
        res = client.get("/api/alerts")
        assert res.status_code == 200
        data = res.json()
        assert data["seeded"] is True
        assert data["total"] >= 0
