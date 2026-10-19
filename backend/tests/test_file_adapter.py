"""backend/tests/test_file_adapter.py

Comprehensive tests for FileAdapter, csv_schema, CLI commands (seed, validate-files, export-template),
and end-to-end API behaviour with user-supplied CSV datasets.
"""

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.cli import run_export_template, run_seed, run_validate_files
from app.core.config import Settings, get_settings
from app.db.models import Base, DatasetMeta
from app.db.session import get_db
from app.integrations.csv_schema import export_templates
from app.integrations.file_adapter import FileAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def template_dir(tmp_path):
    """Generates a fresh folder with exported template CSVs."""
    t_dir = tmp_path / "templates"
    export_templates(t_dir)
    return t_dir


def test_file_adapter_valid_template_set(template_dir):
    """FileAdapter on exported template set passes validation and produces valid SourceDataset."""
    as_of = date(2026, 10, 18)
    adapter = FileAdapter(path=template_dir, as_of=as_of)
    errors, warnings = adapter.validate()
    assert errors == []
    assert adapter.name == "file-import"
    assert adapter.is_live is False
    assert adapter.label == "USER-SUPPLIED DATA (file import)"

    dataset = adapter.fetch_dataset()
    assert dataset.meta.label == "USER-SUPPLIED DATA (file import)"
    assert dataset.meta.source == "file-import"
    assert dataset.meta.as_of == as_of
    assert len(dataset.warehouses) == 2
    assert len(dataset.components) == 2
    assert len(dataset.suppliers) == 2
    assert len(dataset.inventory_levels) == 2
    assert len(dataset.products) == 2
    assert len(dataset.bom_lines) == 4
    assert len(dataset.supplier_components) == 2
    assert len(dataset.purchase_orders) == 2
    assert len(dataset.customer_orders) == 2
    assert len(dataset.demand_records) == 4
    assert len(dataset.delivery_records) == 2


def test_validation_missing_required_file(tmp_path):
    """Missing any required file fails validation."""
    export_templates(tmp_path)
    (tmp_path / "inventory.csv").unlink()

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("Missing required file: inventory.csv" in err for err in errors)
    with pytest.raises(ValueError, match="validation failed"):
        adapter.fetch_dataset()


def test_validation_missing_column(tmp_path):
    """Missing a required column in CSV header produces error."""
    export_templates(tmp_path)
    # Overwrite components.csv with missing criticality column
    with open(tmp_path / "components.csv", "w", encoding="utf-8") as f:
        f.write("sku,name,category,unit_of_measure,is_active\n")
        f.write("CMP-01,Test Component,Cat,EA,true\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("Missing expected column(s): criticality" in err for err in errors)


def test_validation_bad_enum(tmp_path):
    """Invalid enum values produce errors."""
    export_templates(tmp_path)
    # Bad warehouse role
    with open(tmp_path / "warehouses.csv", "w", encoding="utf-8") as f:
        f.write("code,name,role\n")
        f.write("WH-01,Warehouse 1,distribution_center\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("Invalid role 'distribution_center'" in err for err in errors)


def test_validation_negative_quantities(tmp_path):
    """Negative quantities produce errors."""
    export_templates(tmp_path)
    with open(tmp_path / "inventory.csv", "w", encoding="utf-8") as f:
        f.write("component_sku,warehouse_code,on_hand,reserved\n")
        f.write("CMP-CPU-001,WH-PLANT-01,-10,5\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("line 2: 'on_hand' cannot be negative (-10)" in err for err in errors)


def test_validation_received_exceeds_ordered(tmp_path):
    """qty_received > qty_ordered produces error."""
    export_templates(tmp_path)
    with open(tmp_path / "purchase_orders.csv", "w", encoding="utf-8") as f:
        f.write("po_number,supplier_code,status,order_date,promised_date,latest_estimate_date,component_sku,warehouse_code,qty_ordered,qty_received,unit_price\n")
        f.write("PO-01,SUP-INT-01,open,2026-09-01,2026-09-20,,CMP-CPU-001,WH-PLANT-01,100,120,50.00\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("qty_received' (120) cannot exceed 'qty_ordered' (100)" in err for err in errors)


def test_validation_rejected_exceeds_received(tmp_path):
    """qty_rejected > qty_received in delivery history produces error."""
    export_templates(tmp_path)
    with open(tmp_path / "delivery_history.csv", "w", encoding="utf-8") as f:
        f.write("supplier_code,component_sku,promised_date,actual_date,qty_ordered,qty_received,qty_rejected\n")
        f.write("SUP-INT-01,CMP-CPU-001,2026-08-01,2026-08-05,100,80,90\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("qty_rejected' (90) cannot exceed 'qty_received' (80)" in err for err in errors)


def test_validation_unknown_foreign_key_with_file_and_line(tmp_path):
    """Unknown foreign keys report file name, line number, and clear message."""
    export_templates(tmp_path)
    with open(tmp_path / "inventory.csv", "w", encoding="utf-8") as f:
        f.write("component_sku,warehouse_code,on_hand,reserved\n")
        f.write("CMP-NONEXISTENT,WH-PLANT-01,100,0\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("inventory.csv: line 2: Unknown component SKU 'CMP-NONEXISTENT'" in err for err in errors)


def test_validation_duplicate_keys(tmp_path):
    """Duplicate primary keys produce error with line number."""
    export_templates(tmp_path)
    with open(tmp_path / "components.csv", "w", encoding="utf-8") as f:
        f.write("sku,name,category,unit_of_measure,criticality,is_active\n")
        f.write("CMP-DUP-01,Part 1,Processors,EA,critical,true\n")
        f.write("CMP-DUP-01,Part 1 Duplicate,Processors,EA,critical,true\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("components.csv: line 3: Duplicate component SKU 'CMP-DUP-01'" in err for err in errors)


def test_validation_po_header_mismatch(tmp_path):
    """Inconsistent header values across rows with the same po_number produce error."""
    export_templates(tmp_path)
    with open(tmp_path / "purchase_orders.csv", "w", encoding="utf-8") as f:
        f.write("po_number,supplier_code,status,order_date,promised_date,latest_estimate_date,component_sku,warehouse_code,qty_ordered,qty_received,unit_price\n")
        f.write("PO-MULTI,SUP-INT-01,open,2026-09-01,2026-09-20,,CMP-CPU-001,WH-PLANT-01,100,0,50.00\n")
        # Line 3 has different supplier_code for same PO
        f.write("PO-MULTI,SUP-MEM-02,open,2026-09-01,2026-09-20,,CMP-RAM-002,WH-PLANT-01,200,0,30.00\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("purchase_orders.csv: line 3: Inconsistent header for PO 'PO-MULTI'" in err for err in errors)


def test_validation_no_plant_warehouse(tmp_path):
    """Warehouses with no role='plant' produce error."""
    export_templates(tmp_path)
    with open(tmp_path / "warehouses.csv", "w", encoding="utf-8") as f:
        f.write("code,name,role\n")
        f.write("WH-REG-01,Regional 1,regional\n")
        f.write("WH-REG-02,Regional 2,regional\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("At least one warehouse with role 'plant' is required" in err for err in errors)


def test_validation_bad_date(tmp_path):
    """Invalid date format produces error with line number."""
    export_templates(tmp_path)
    with open(tmp_path / "demand_history.csv", "w", encoding="utf-8") as f:
        f.write("component_sku,date,quantity\n")
        f.write("CMP-CPU-001,2026/09/01,10\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert any("demand_history.csv: line 2: Invalid ISO date for 'date': '2026/09/01'" in err for err in errors)


def test_all_errors_collected_and_capped_at_50(tmp_path):
    """FileAdapter collects all errors across rows up to 50 cap."""
    export_templates(tmp_path)
    # Generate 60 invalid rows in demand_history.csv
    with open(tmp_path / "demand_history.csv", "w", encoding="utf-8") as f:
        f.write("component_sku,date,quantity\n")
        for i in range(1, 65):
            f.write(f"CMP-CPU-001,invalid-date-{i},-5\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert len(errors) >= 50
    assert any("Reached maximum limit of 50 validation errors" in err for err in errors)


def test_empty_cell_is_null_for_nullable_columns(tmp_path):
    """Empty cells in nullable columns parse as None."""
    export_templates(tmp_path)
    with open(tmp_path / "supplier_offers.csv", "w", encoding="utf-8") as f:
        f.write("supplier_code,component_sku,unit_cost,lead_time_days,min_order_qty,max_weekly_capacity,is_preferred,expedite_available,expedite_lead_time_days,expedite_cost_premium_pct\n")
        f.write("SUP-INT-01,CMP-CPU-001,150.00,14,50,,true,false,,\n")

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    errors, _ = adapter.validate()
    assert errors == []
    dataset = adapter.fetch_dataset()
    offer = dataset.supplier_components[0]
    assert offer.max_weekly_capacity is None
    assert offer.expedite_lead_time_days is None
    assert offer.expedite_cost_premium_pct is None


def test_coverage_report_plain_language_notes(tmp_path):
    """Missing optional CSV files result in plain-language consequence notes."""
    export_templates(tmp_path)
    # Remove optional files
    (tmp_path / "demand_history.csv").unlink()
    (tmp_path / "supplier_offers.csv").unlink()
    (tmp_path / "delivery_history.csv").unlink()

    adapter = FileAdapter(path=tmp_path, as_of=date(2026, 10, 18))
    adapter.validate()
    rep = adapter.get_coverage_report()
    assert "demand_history" in rep["entities_missing"]
    assert "supplier_offers" in rep["entities_missing"]
    assert "delivery_history" in rep["entities_missing"]
    assert "insufficient history" in rep["notes"]["demand_history"]
    assert "no recovery options" in rep["notes"]["supplier_offers"]
    assert "supplier risk unknown" in rep["notes"]["delivery_history"]


def test_cli_export_template_and_refuse_overwrite(tmp_path, capsys):
    """CLI export-template writes templates and refuses to overwrite existing files."""
    dest = tmp_path / "new_templates"
    # First export succeeds
    code1 = run_export_template(str(dest))
    assert code1 == 0
    assert (dest / "README.txt").exists()
    assert (dest / "warehouses.csv").exists()

    # Second export refuses overwrite
    code2 = run_export_template(str(dest))
    assert code2 == 1
    captured = capsys.readouterr()
    assert "Refusing to overwrite existing files" in captured.err


def test_cli_validate_files_touches_no_database(tmp_path, capsys):
    """CLI validate-files validates files and touches no database."""
    export_templates(tmp_path)
    # Ensure no .db file in tmp_path or anywhere
    db_files_before = list(tmp_path.glob("*.db"))
    assert db_files_before == []

    code = run_validate_files(str(tmp_path), "2026-10-18")
    assert code == 0
    captured = capsys.readouterr()
    assert "Validation passed successfully" in captured.out

    db_files_after = list(tmp_path.glob("*.db"))
    assert db_files_after == []


def test_cli_seed_lifecycle_with_file_adapter(tmp_path, temp_db_url, monkeypatch, capsys):
    """CLI seed --source file seeds into temp DB, refuses without --reset, and loads DatasetMeta."""
    monkeypatch.setenv("DATABASE_URL", temp_db_url)
    get_settings.cache_clear()

    export_templates(tmp_path)

    # 1. First seed with --source file succeeds
    code = run_seed(seed=0, as_of_str="2026-10-18", reset=False, source="file", path=str(tmp_path))
    assert code == 0
    captured = capsys.readouterr()
    assert "USER-SUPPLIED DATA (file import)" in captured.out

    # Verify DB content
    engine = create_engine(temp_db_url)
    with sessionmaker(bind=engine)() as session:
        meta = session.scalar(select(DatasetMeta))
        assert meta is not None
        assert meta.label == "USER-SUPPLIED DATA (file import)"
        assert meta.source == "file-import"
        assert meta.as_of == date(2026, 10, 18)

    # 2. Second seed without --reset refuses
    code_refused = run_seed(seed=0, as_of_str="2026-10-18", reset=False, source="file", path=str(tmp_path))
    assert code_refused == 2

    # 3. Third seed with --reset overwrites successfully
    code_reset = run_seed(seed=0, as_of_str="2026-10-18", reset=True, source="file", path=str(tmp_path))
    assert code_reset == 0

    get_settings.cache_clear()


def test_end_to_end_api_with_file_import(tmp_path, temp_db_url, monkeypatch):
    """End-to-end API test: seed custom 2-component file set into temp DB.

    Asserts /api/inventory-risk and /api/alerts respond 200 without exceptions,
    component without demand history shows 'unknown' risk, and /api/integration-status
    reports file-import.
    """
    monkeypatch.setenv("DATABASE_URL", temp_db_url)
    get_settings.cache_clear()

    # Build custom small realistic file set:
    # 2 components: CMP-A (has 60 days demand), CMP-B (no demand history)
    # 1 plant warehouse, 1 supplier, inventory for both, 1 PO for CMP-A
    as_of = date(2026, 10, 18)

    # warehouses.csv
    with open(tmp_path / "warehouses.csv", "w", encoding="utf-8") as f:
        f.write("code,name,role\n")
        f.write("WH-PLANT,Assembly Plant,plant\n")

    # components.csv
    with open(tmp_path / "components.csv", "w", encoding="utf-8") as f:
        f.write("sku,name,category,unit_of_measure,criticality,is_active\n")
        f.write("CMP-A,Processor A,Processors,EA,critical,true\n")
        f.write("CMP-B,Capacitor B,Passives,EA,normal,true\n")

    # suppliers.csv
    with open(tmp_path / "suppliers.csv", "w", encoding="utf-8") as f:
        f.write("code,name,country\n")
        f.write("SUP-01,Alpha Supplier,TW\n")

    # inventory.csv
    with open(tmp_path / "inventory.csv", "w", encoding="utf-8") as f:
        f.write("component_sku,warehouse_code,on_hand,reserved\n")
        f.write("CMP-A,WH-PLANT,50,10\n")
        f.write("CMP-B,WH-PLANT,100,0\n")

    # demand_history.csv: 60 days of demand for CMP-A only, none for CMP-B
    with open(tmp_path / "demand_history.csv", "w", encoding="utf-8") as f:
        f.write("component_sku,date,quantity\n")
        for i in range(1, 61):
            dt = as_of - timedelta(days=i)
            f.write(f"CMP-A,{dt.isoformat()},5\n")

    # purchase_orders.csv
    with open(tmp_path / "purchase_orders.csv", "w", encoding="utf-8") as f:
        f.write("po_number,supplier_code,status,order_date,promised_date,latest_estimate_date,component_sku,warehouse_code,qty_ordered,qty_received,unit_price\n")
        f.write(f"PO-101,SUP-01,open,{as_of - timedelta(days=10)},{as_of + timedelta(days=15)},,CMP-A,WH-PLANT,200,0,100.00\n")

    # supplier_offers.csv
    with open(tmp_path / "supplier_offers.csv", "w", encoding="utf-8") as f:
        f.write("supplier_code,component_sku,unit_cost,lead_time_days,min_order_qty,max_weekly_capacity,is_preferred,expedite_available,expedite_lead_time_days,expedite_cost_premium_pct\n")
        f.write("SUP-01,CMP-A,100.00,15,50,500,true,true,7,0.20\n")

    # delivery_history.csv
    with open(tmp_path / "delivery_history.csv", "w", encoding="utf-8") as f:
        f.write("supplier_code,component_sku,promised_date,actual_date,qty_ordered,qty_received,qty_rejected\n")
        f.write(f"SUP-01,CMP-A,{as_of - timedelta(days=30)},{as_of - timedelta(days=30)},100,100,0\n")

    # Seed into temp DB
    exit_code = run_seed(seed=0, as_of_str=str(as_of), reset=True, source="file", path=str(tmp_path))
    assert exit_code == 0

    engine = create_engine(temp_db_url)
    session_factory = sessionmaker(bind=engine)

    def override_get_db():
        with session_factory() as s:
            yield s

    app = create_app(settings=Settings(DATABASE_URL=temp_db_url, APP_ENV="testing"))
    app.dependency_overrides[get_db] = override_get_db

    client = TestClient(app)

    # 1. /api/meta
    res_meta = client.get("/api/meta")
    assert res_meta.status_code == 200
    meta_json = res_meta.json()
    assert meta_json["data_source"] == "file-import"
    assert meta_json["label"] == "USER-SUPPLIED DATA (file import)"

    # 2. /api/integration-status
    res_status = client.get("/api/integration-status")
    assert res_status.status_code == 200
    status_json = res_status.json()
    assert status_json["active_source"] == "file-import"
    assert status_json["is_live"] is False
    assert status_json["label"] == "USER-SUPPLIED DATA (file import)"
    assert "warehouses" in status_json["entities_covered"]
    assert "components" in status_json["entities_covered"]
    assert "customer_orders" in status_json["entities_missing"]

    # 3. /api/inventory-risk
    res_risk = client.get("/api/inventory-risk")
    assert res_risk.status_code == 200
    risk_data = res_risk.json()["items"]
    # CMP-B has no demand records, so its risk level must be "unknown"
    cmp_b_risk = next(item for item in risk_data if item["sku"] == "CMP-B")
    assert cmp_b_risk["risk_level"] == "unknown"

    # 4. /api/alerts
    res_alerts = client.get("/api/alerts")
    assert res_alerts.status_code == 200

    get_settings.cache_clear()
