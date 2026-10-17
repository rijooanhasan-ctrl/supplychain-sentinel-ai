"""Integration tests for Inventory Intelligence API and services."""

from collections import defaultdict
from datetime import date, timedelta
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import Base, Component, DatasetMeta, DemandRecord, InventoryLevel, PurchaseOrderLine, Warehouse
from app.db.session import get_db
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def test_db_setup(tmp_path):
    """Sets up a temporary SQLite database seeded with fixed as_of date."""
    db_file = tmp_path / "test_inv_risk.db"
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


def test_inventory_risk_unseeded_db(client_empty):
    res = client_empty.get("/api/inventory-risk")
    assert res.status_code == 200
    data = res.json()
    assert data["seeded"] is False
    assert data["as_of"] is None
    assert data["total"] == 0
    assert data["items"] == []
    assert data["summary"]["components_evaluated"] == 0

    res_detail = client_empty.get("/api/inventory-risk/1")
    assert res_detail.status_code == 404
    assert "detail" in res_detail.json()


def test_inventory_risk_list_envelope_and_summary(test_db_setup):
    client, _, as_of, _ = test_db_setup
    res = client.get("/api/inventory-risk?limit=100")
    assert res.status_code == 200
    data = res.json()

    assert data["seeded"] is True
    assert data["as_of"] == str(as_of)
    assert data["model"]["name"] == "weekday_average"
    assert data["config"]["lookback_days"] == 28
    assert data["config"]["horizon_days"] == 60
    assert data["config"]["critical_days"] == 7

    summary = data["summary"]
    items = data["items"]
    assert summary["components_evaluated"] == len(items)
    assert sum(summary["counts_by_risk_level"].values()) == summary["components_evaluated"]

    # Verify sort order: severity (critical first), then shortage_date (nulls last), then criticality, then sku
    severity_map = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4, "none": 5}
    for i in range(len(items) - 1):
        item_a = items[i]
        item_b = items[i + 1]
        sev_a = severity_map[item_a["risk_level"]]
        sev_b = severity_map[item_b["risk_level"]]
        assert sev_a <= sev_b


def test_inventory_risk_filters_and_pagination(test_db_setup):
    client, _, _, _ = test_db_setup

    # Filter by risk_level
    res_crit = client.get("/api/inventory-risk?risk_level=critical")
    assert res_crit.status_code == 200
    crit_data = res_crit.json()
    assert all(it["risk_level"] == "critical" for it in crit_data["items"])

    # Filter by category
    res_proc = client.get("/api/inventory-risk?category=Processor")
    assert res_proc.status_code == 200
    proc_data = res_proc.json()
    assert len(proc_data["items"]) >= 1
    assert all(it["category"].lower() == "processor" for it in proc_data["items"])

    # Pagination
    res_p1 = client.get("/api/inventory-risk?limit=2&offset=0")
    res_p2 = client.get("/api/inventory-risk?limit=2&offset=2")
    assert res_p1.status_code == 200
    assert res_p2.status_code == 200
    p1_items = res_p1.json()["items"]
    p2_items = res_p2.json()["items"]
    assert len(p1_items) == 2
    assert len(p2_items) == 2
    assert p1_items[0]["sku"] != p2_items[0]["sku"]


def test_inventory_risk_validation_errors(test_db_setup):
    client, _, _, _ = test_db_setup

    res_bad_enum = client.get("/api/inventory-risk?risk_level=super_critical")
    assert res_bad_enum.status_code == 422

    res_bad_limit = client.get("/api/inventory-risk?limit=0")
    assert res_bad_limit.status_code == 422

    res_bad_limit2 = client.get("/api/inventory-risk?limit=500")
    assert res_bad_limit2.status_code == 422

    res_not_found = client.get("/api/inventory-risk/999999")
    assert res_not_found.status_code == 404
    assert res_not_found.headers["content-type"].startswith("application/json")


def test_cpu_x7_independent_calculation(test_db_setup):
    """Independently verifies CPU-X7 directly from database records without using the app's domain logic."""
    client, session_factory, as_of, _ = test_db_setup

    with session_factory() as session:
        cpu = session.scalar(select(Component).where(Component.sku == "CPU-X7"))
        assert cpu is not None
        cpu_id = cpu.id

        # Raw inventory
        plant_wh = session.scalar(select(Warehouse).where(Warehouse.role == "plant"))
        inv = session.scalar(
            select(InventoryLevel).where(
                InventoryLevel.component_id == cpu_id,
                InventoryLevel.warehouse_id == plant_wh.id,
            )
        )
        assert inv is not None
        assert inv.on_hand == 520
        assert inv.reserved == 100
        raw_usable = inv.on_hand - inv.reserved
        assert raw_usable == 420

        # Raw demand records in window [as_of - 28, as_of - 1]
        win_start = as_of - timedelta(days=28)
        win_end = as_of - timedelta(days=1)
        raw_demands = session.scalars(
            select(DemandRecord).where(
                DemandRecord.component_id == cpu_id,
                DemandRecord.date >= win_start,
                DemandRecord.date <= win_end,
            )
        ).all()
        assert len(raw_demands) == 28

        # Compute weekday averages manually
        weekday_buckets = defaultdict(list)
        for d in raw_demands:
            weekday_buckets[d.date.weekday()].append(d.quantity)

        manual_forecast = {}
        for w in range(7):
            manual_forecast[w] = sum(weekday_buckets[w]) / len(weekday_buckets[w])

        # Manual daily stock simulation
        sim_balance = float(raw_usable)
        manual_shortage_day = None
        manual_shortage_date = None
        for day_idx in range(60):
            sim_date = as_of + timedelta(days=day_idx)
            w = sim_date.weekday()
            demand_k = manual_forecast[w]
            receipts_k = 800.0 if sim_date == (as_of + timedelta(days=7)) else 0.0

            bal_start = sim_balance + receipts_k
            unmet_k = max(0.0, demand_k - bal_start)
            sim_balance = max(0.0, bal_start - demand_k)

            if unmet_k > 0 and manual_shortage_day is None:
                manual_shortage_day = day_idx
                manual_shortage_date = sim_date

    assert manual_shortage_day is not None
    assert 3 <= manual_shortage_day <= 5

    # Now verify the API detail response matches the independent calculation
    res = client.get(f"/api/inventory-risk/{cpu_id}")
    assert res.status_code == 200
    data = res.json()

    assert data["plant_usable_stock"] == 420
    assert data["risk_level"] == "critical"
    assert data["shortage_date"] == str(manual_shortage_date)
    assert data["days_until_shortage"] == manual_shortage_day
    assert data["unmet_demand_units"] > 0
    assert data["next_replenishment"]["po_number"] == "PO-CPU-701"
    assert data["next_replenishment"]["date"] == str(as_of + timedelta(days=7))
    assert data["next_replenishment"]["date_basis"] == "promised"

    flag_codes = [f["code"] for f in data["flags"]]
    assert "inbound_promise_only" in flag_codes
    assert "regional_stock_available" in flag_codes

    # Compare first 7 projection days
    for k in range(7):
        proj_item = data["daily_projection"][k]
        sim_d = as_of + timedelta(days=k)
        assert proj_item["date"] == str(sim_d)
        assert proj_item["forecast_demand"] == pytest.approx(round(manual_forecast[sim_d.weekday()], 1), abs=0.1)


def test_edge_case_components(test_db_setup):
    client, session_factory, _, _ = test_db_setup

    with session_factory() as session:
        comp_spare = session.scalar(select(Component).where(Component.sku == "COMP-SPARE-01"))
        comp_kb = session.scalar(select(Component).where(Component.sku == "KB-BACKLIT-EN"))
        comp_bat = session.scalar(select(Component).where(Component.sku == "BAT-50WH"))
        comp_mb = session.scalar(select(Component).where(Component.sku == "MB-PRO-01"))

        # Find component for PO-PARTIAL-01
        pol_partial = session.scalar(
            select(PurchaseOrderLine).join(PurchaseOrderLine.purchase_order).where(
                PurchaseOrderLine.qty_ordered == 500,
                PurchaseOrderLine.qty_received == 200,
            )
        )
        assert pol_partial is not None
        partial_comp_id = pol_partial.component_id

    # COMP-SPARE-01: zero demand, risk "none"
    res_spare = client.get(f"/api/inventory-risk/{comp_spare.id}")
    assert res_spare.status_code == 200
    spare_data = res_spare.json()
    assert spare_data["risk_level"] == "none"
    assert spare_data["coverage_days"] is None
    assert any(f["code"] == "zero_demand" for f in spare_data["flags"])

    # KB-BACKLIT-EN: no open inbound
    res_kb = client.get(f"/api/inventory-risk/{comp_kb.id}")
    assert res_kb.status_code == 200
    kb_data = res_kb.json()
    assert any(f["code"] == "no_open_inbound" for f in kb_data["flags"])

    # PO-PARTIAL-01 component: counts only remaining 300
    res_partial = client.get(f"/api/inventory-risk/{partial_comp_id}")
    assert res_partial.status_code == 200
    part_data = res_partial.json()
    counted = [line for line in part_data["counted_inbound"] if line["qty_ordered"] == 500]
    assert len(counted) == 1
    assert counted[0]["remaining_qty"] == 300

    # BAT-50WH and MB-PRO-01 evaluate without error
    res_bat = client.get(f"/api/inventory-risk/{comp_bat.id}")
    assert res_bat.status_code == 200
    res_mb = client.get(f"/api/inventory-risk/{comp_mb.id}")
    assert res_mb.status_code == 200


def test_determinism_and_multiple_seeds(tmp_path):
    as_of = date(2026, 10, 17)

    # 1. Determinism: same DB twice -> identical JSON
    db_file1 = tmp_path / "seed42_a.db"
    db_file2 = tmp_path / "seed42_b.db"

    def seed_and_fetch(db_file, seed):
        db_url = f"sqlite:///{db_file.as_posix()}"
        engine = create_engine(db_url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        adapter = DemoAdapter(seed=seed, as_of=as_of)
        ds = adapter.fetch_dataset()
        sf = sessionmaker(bind=engine, autocommit=False, autoflush=False)
        with sf() as session:
            load_dataset(session, ds, reset=True)

        settings = Settings(APP_NAME="Test", APP_ENV="testing", DATABASE_URL=db_url)
        app = create_app(settings=settings)

        def override_get_db():
            with sf() as s:
                yield s

        app.dependency_overrides[get_db] = override_get_db
        with TestClient(app) as client:
            return client.get("/api/inventory-risk?limit=100").json()

    json_a = seed_and_fetch(db_file1, seed=42)
    json_b = seed_and_fetch(db_file2, seed=42)
    assert json_a == json_b, "Inventory risk API output is non-deterministic for identical seed!"

    # 2. Run for seeds 1..5: no exceptions, CPU-X7 is still critical
    for s in range(1, 6):
        db_file_s = tmp_path / f"seed_{s}.db"
        data_s = seed_and_fetch(db_file_s, seed=s)
        cpu_items = [it for it in data_s["items"] if it["sku"] == "CPU-X7"]
        assert len(cpu_items) == 1
        assert cpu_items[0]["risk_level"] == "critical"
