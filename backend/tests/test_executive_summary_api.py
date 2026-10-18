"""tests/test_executive_summary_api.py

Integration and API tests for /api/executive-summary.
Uses temporary SQLite databases and DemoAdapter with independent raw SQL cross-checks.
"""

from datetime import date
from decimal import Decimal
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
    Product,
    Supplier,
    SupplierComponent,
)
from app.db.session import get_db
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def exec_summary_test_setup(tmp_path):
    """Sets up a temporary SQLite database seeded with seed 42 as_of 2026-10-17."""
    db_file = tmp_path / "test_exec_summary.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    as_of = date(2026, 10, 17)
    adapter = DemoAdapter(seed=42, as_of=as_of)
    dataset = adapter.fetch_dataset()

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        load_dataset(session, dataset, reset=True)

    app = create_app()

    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    return {
        "client": client,
        "engine": engine,
        "session_factory": session_factory,
        "as_of": as_of,
    }


def test_api_executive_summary_envelope(exec_summary_test_setup):
    client = exec_summary_test_setup["client"]
    resp = client.get("/api/executive-summary")
    assert resp.status_code == 200
    data = resp.json()

    assert data["seeded"] is True
    assert data["as_of"] == "2026-10-17"
    assert "headline" in data
    assert isinstance(data["top_risks"], list)
    assert len(data["top_risks"]) <= 3
    assert data["priority_decision"] is not None
    assert data["cost_comparison"] is not None
    assert isinstance(data["exposure_totals"], list)
    assert "data_quality" in data
    assert isinstance(data["assumptions"], list)
    assert isinstance(data["why"], dict)
    assert data["note"] == "Decision support only. No orders are created."


def test_api_executive_summary_unseeded(tmp_path):
    db_file = tmp_path / "test_unseeded_exec.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    app = create_app()

    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    resp = client.get("/api/executive-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["seeded"] is False
    assert data["top_risks"] == []
    assert data["priority_decision"] is None
    assert data["cost_comparison"] is None
    assert data["note"] == "Decision support only. No orders are created."


def test_api_executive_summary_seeds_1_to_5(tmp_path):
    for seed in range(1, 6):
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

        app = create_app()

        def override_get_db():
            with session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = override_get_db
        client = TestClient(app)

        resp = client.get("/api/executive-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["seeded"] is True
        assert len(data["top_risks"]) <= 3


def test_api_raw_row_cross_checks(exec_summary_test_setup):
    client = exec_summary_test_setup["client"]
    session_factory = exec_summary_test_setup["session_factory"]

    resp = client.get("/api/executive-summary")
    assert resp.status_code == 200
    data = resp.json()

    # 1. CPU-X7 is the first top risk
    top_risk = data["top_risks"][0]
    assert top_risk["component_sku"] == "CPU-X7"

    # 2. Priority decision recommends alt_supplier.SUP-NEXUS with cost = 290 x unit_cost
    decision = data["priority_decision"]
    assert decision["component_sku"] == "CPU-X7"
    assert decision["recommended_option_id"] == "alt_supplier.SUP-NEXUS"
    assert decision["quantity"] == 290

    # Query raw database row for Nexus unit cost
    with session_factory() as session:
        cpu = session.scalar(select(Component).where(Component.sku == "CPU-X7"))
        assert cpu is not None
        sup = session.scalar(select(Supplier).where(Supplier.code == "SUP-NEXUS"))
        assert sup is not None
        sc = session.scalar(
            select(SupplierComponent).where(
                SupplierComponent.component_id == cpu.id,
                SupplierComponent.supplier_id == sup.id,
            )
        )
        assert sc is not None
        expected_cost = Decimal(290) * sc.unit_cost

    assert decision["incremental_cost"] == f"{expected_cost:.2f}"
    assert decision["cost_known"] is True

    # 3. Cost comparison do_nothing units short = baseline unmet
    cc = data["cost_comparison"]
    assert cc["do_nothing"]["units_short"] == 289.5
    assert cc["act"]["residual_units_short"] == 0.0

    # 4. Later shortage note mentions 2026-11-02
    assert "2026-11-02" in decision["later_shortage_note"]

    # 5. Independent raw cross-check of customer order exposure for CPU-X7
    with session_factory() as session:
        # Products using CPU-X7
        boms = session.scalars(select(BomLine).where(BomLine.component_id == cpu.id)).all()
        product_ids = {b.product_id for b in boms}

        # Customer orders due between shortage start (2026-10-21) and horizon end (2026-10-17 + 42 days)
        orders = session.scalars(
            select(CustomerOrder).where(
                CustomerOrder.product_id.in_(product_ids),
                CustomerOrder.status.in_(("open", "in_production")),
                CustomerOrder.due_date >= date(2026, 10, 21),
            )
        ).all()

        products = {p.id: p for p in session.scalars(select(Product)).all()}
        expected_count = len(orders)
        expected_revenue = sum(
            Decimal(o.quantity) * products[o.product_id].selling_price
            for o in orders
        )

    assert cc["do_nothing"]["affected_orders_count"] == expected_count
    assert cc["do_nothing"]["selling_value"] == f"{expected_revenue:.2f}"
    assert top_risk["exposed_orders_count"] == expected_count
    assert top_risk["exposed_selling_value"] == f"{expected_revenue:.2f}"


def test_api_is_get_only_no_write_routes(exec_summary_test_setup):
    client = exec_summary_test_setup["client"]
    # Verify that POST, PUT, DELETE, PATCH return 405 Method Not Allowed
    assert client.post("/api/executive-summary").status_code == 405
    assert client.put("/api/executive-summary").status_code == 405
    assert client.delete("/api/executive-summary").status_code == 405
    assert client.patch("/api/executive-summary").status_code == 405
