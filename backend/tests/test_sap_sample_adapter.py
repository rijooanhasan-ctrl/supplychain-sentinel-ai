"""tests/test_sap_sample_adapter.py

Tests for SapSampleAdapter:
- Verifies is_live is False and adapter name is 'sap-style-sample'.
- Enforces NO network/socket access during fetch_dataset (monkeypatches socket).
- Verifies coverage report structure and disclaimer text.
- Validates transactional seeding of the static sample fixture into a temporary sqlite DB.
"""

import socket
from pathlib import Path
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, Component, DatasetMeta, PurchaseOrder, Supplier, Warehouse
from app.integrations.sap_sample_adapter import SAP_DISCLAIMER_TEXT, SapSampleAdapter
from app.services.ingest import load_dataset


def test_sap_sample_adapter_metadata_and_no_network(monkeypatch: pytest.MonkeyPatch):
    adapter = SapSampleAdapter()
    assert adapter.is_live is False
    assert adapter.name == "sap-style-sample"

    # Enforce zero socket / network activity
    def forbidden_socket(*args, **kwargs):
        raise RuntimeError("Network activity forbidden in SapSampleAdapter!")

    monkeypatch.setattr(socket, "socket", forbidden_socket)

    # Must succeed purely via local JSON fixture
    dataset = adapter.fetch_dataset()
    assert dataset.meta.source == "sap-style-sample"
    assert dataset.meta.label == "SAP-STYLE SAMPLE (STATIC FIXTURE)"
    assert len(dataset.components) == 3
    assert len(dataset.warehouses) == 1
    assert len(dataset.suppliers) == 2
    assert len(dataset.purchase_orders) == 2
    # Confirms missing parts are empty
    assert len(dataset.products) == 0
    assert len(dataset.demand_records) == 0
    assert len(dataset.delivery_records) == 0


def test_sap_sample_adapter_coverage_report():
    adapter = SapSampleAdapter()
    report = adapter.get_coverage_report()
    assert report["source"] == "sap-style-sample"
    assert report["is_live"] is False
    assert "warehouses" in report["entities_covered"]
    assert "components" in report["entities_covered"]
    assert "demand_records" in report["entities_missing"]
    assert "delivery_records" in report["entities_missing"]
    assert "supplier_components" in report["entities_missing"]
    assert report["disclaimer"] == SAP_DISCLAIMER_TEXT


def test_sap_sample_adapter_seed_temp_db(tmp_path: Path):
    temp_db_path = tmp_path / "test_sap_sample.db"
    db_url = f"sqlite:///{temp_db_path.as_posix()}"

    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

    adapter = SapSampleAdapter()
    dataset = adapter.fetch_dataset()

    with session_factory() as session:
        counts = load_dataset(session, dataset, reset=False)
        assert counts["components"] == 3
        assert counts["warehouses"] == 1
        assert counts["suppliers"] == 2
        assert counts["purchase_orders"] == 2

        # Verify DB records
        meta = session.scalar(select(DatasetMeta))
        assert meta is not None
        assert meta.source == "sap-style-sample"
        assert meta.label == "SAP-STYLE SAMPLE (STATIC FIXTURE)"

        comp_skus = session.scalars(select(Component.sku)).all()
        assert set(comp_skus) == {"MAT-CPU-01", "MAT-MEM-01", "MAT-SSD-01"}
