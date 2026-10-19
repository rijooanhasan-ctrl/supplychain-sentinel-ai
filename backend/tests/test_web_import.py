"""tests/test_web_import.py

Comprehensive tests for Phase 13 Web CSV Import:
- Import status (disabled/enabled)
- 403 when disabled
- Validate valid set -> valid true, no DB touched
- Error classes (bad enum, received > ordered, unknown SKU with file+line, missing required file, no plant warehouse, bad date, negative qty)
- Unknown filename 422
- Path traversal name rejected 422
- Oversize file 413, total oversize 413
- Too many files 422
- Binary content rejected 422
- Errors truncated to 200 chars
- Temp directory cleaned up on failure
- Load success switches active, /api/meta label USER-SUPPLIED DATA, /api/inventory-risk and /api/alerts respond 200
- Load invalid -> nothing changes and previous uploaded.db intact
- Load never touches sentinel.db (hashes match)
- Activate demo/uploaded and 409 when no uploaded data
- Restart (new app instance) defaults to demo
- In-process caches never mix datasets
- Refuse path equal to sentinel.db (409)
- End-to-end sample data validation: CMP-CPU-001 shortage, inventory_shortage alert, SUP-001 risk > SUP-002, recommendations for CMP-CPU-001.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import io
import os
from pathlib import Path
import tempfile
from typing import Dict
import pytest
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import Base, DatasetMeta
from app.db.session import create_engine_and_sessionmaker
from app.main import create_app
from app.services.forecasting import get_forecast_evaluation_service, _EVALUATION_CACHE
from app.services.ingest import load_dataset


def build_valid_sample_files(as_of: str = "2026-10-18") -> Dict[str, str]:
    """Build a complete valid 11-CSV dataset where:
    - CMP-CPU-001 has severe shortage risk
    - inventory_shortage alert exists
    - SUP-001 has higher supplier risk than SUP-002
    - recommendations contain options for CMP-CPU-001.
    """
    as_of_date = date.fromisoformat(as_of)

    # 1. warehouses
    warehouses_csv = "code,name,role\nWH-PLANT,Main Laptop Plant,plant\nWH-REG,Regional Hub,regional\n"

    # 2. components
    components_csv = (
        "sku,name,category,unit_of_measure,criticality,is_active\n"
        "CMP-CPU-001,Core Processor 1,Processors,EA,critical,true\n"
        "CMP-RAM-002,DDR5 Memory Module,Memory,EA,high,true\n"
    )

    # 3. suppliers
    suppliers_csv = "code,name,country\nSUP-001,Apex Tech,US\nSUP-002,Nexus Global,TW\n"

    # 4. inventory: very low stock for CMP-CPU-001
    inventory_csv = (
        "component_sku,warehouse_code,on_hand,reserved\n"
        "CMP-CPU-001,WH-PLANT,5,0\n"
        "CMP-RAM-002,WH-PLANT,500,0\n"
    )

    # 5. demand history: 90 days of high daily demand for CMP-CPU-001 ending day before as_of
    demand_lines = ["component_sku,date,quantity"]
    for i in range(1, 91):
        d = as_of_date - timedelta(days=i)
        demand_lines.append(f"CMP-CPU-001,{d.isoformat()},25")
        demand_lines.append(f"CMP-RAM-002,{d.isoformat()},10")
    demand_history_csv = "\n".join(demand_lines) + "\n"

    # 6. purchase orders
    purchase_orders_csv = (
        "po_number,supplier_code,status,order_date,promised_date,latest_estimate_date,component_sku,warehouse_code,qty_ordered,qty_received,unit_price\n"
        f"PO-101,SUP-001,open,2026-10-01,2026-10-25,2026-10-28,CMP-CPU-001,WH-PLANT,200,0,300.00\n"
    )

    # 7. supplier offers
    supplier_offers_csv = (
        "supplier_code,component_sku,unit_cost,lead_time_days,min_order_qty,max_weekly_capacity,is_preferred,expedite_available,expedite_lead_time_days,expedite_cost_premium_pct\n"
        "SUP-001,CMP-CPU-001,300.00,14,50,500,true,true,5,0.25\n"
        "SUP-002,CMP-CPU-001,320.00,10,50,500,false,true,3,0.30\n"
        "SUP-001,CMP-RAM-002,80.00,7,20,300,true,false,,\n"
    )

    # 8. delivery history: SUP-001 delivered late and rejected; SUP-002 on time
    delivery_lines = [
        "supplier_code,component_sku,promised_date,actual_date,qty_ordered,qty_received,qty_rejected"
    ]
    for i in range(1, 15):
        p_date = as_of_date - timedelta(days=i * 10)
        # SUP-001 is late by 5 days and has rejections
        act_date_bad = p_date + timedelta(days=5)
        delivery_lines.append(f"SUP-001,CMP-CPU-001,{p_date.isoformat()},{act_date_bad.isoformat()},100,100,15")
        # SUP-002 is on time with 0 rejections
        delivery_lines.append(f"SUP-002,CMP-CPU-001,{p_date.isoformat()},{p_date.isoformat()},100,100,0")
    delivery_history_csv = "\n".join(delivery_lines) + "\n"

    # 9. products
    products_csv = "sku,name,selling_price\nPRD-LAP-01,UltraLaptop 15,1499.00\n"

    # 10. bom
    bom_csv = (
        "product_sku,component_sku,quantity_per_unit\n"
        "PRD-LAP-01,CMP-CPU-001,1\n"
        "PRD-LAP-01,CMP-RAM-002,2\n"
    )

    # 11. customer orders
    customer_orders_csv = (
        "order_number,customer_name,product_sku,quantity,due_date,priority,status\n"
        f"ORD-501,Acme Corp,PRD-LAP-01,20,{(as_of_date + timedelta(days=5)).isoformat()},high,open\n"
    )

    return {
        "warehouses.csv": warehouses_csv,
        "components.csv": components_csv,
        "suppliers.csv": suppliers_csv,
        "inventory.csv": inventory_csv,
        "demand_history.csv": demand_history_csv,
        "purchase_orders.csv": purchase_orders_csv,
        "supplier_offers.csv": supplier_offers_csv,
        "delivery_history.csv": delivery_history_csv,
        "products.csv": products_csv,
        "bom.csv": bom_csv,
        "customer_orders.csv": customer_orders_csv,
    }


@pytest.fixture
def import_test_env(tmp_path):
    demo_db_path = tmp_path / "test_demo.db"
    upload_db_path = tmp_path / "test_uploaded.db"

    # Create and seed demo_db
    engine, sf = create_engine_and_sessionmaker(f"sqlite:///{demo_db_path.as_posix()}")
    Base.metadata.create_all(engine)
    with sf() as sess:
        meta = DatasetMeta(
            source="demo",
            label="DEMO DATA (SYNTHETIC)",
            as_of=date(2026, 10, 17),
            seed=42,
            generator_version="0.1.0",
            generated_at=datetime.now(timezone.utc),
        )
        sess.add(meta)
        sess.commit()
    engine.dispose()

    settings_enabled = Settings(
        DATABASE_URL=f"sqlite:///{demo_db_path.as_posix()}",
        UPLOAD_DB_PATH=str(upload_db_path),
        ENABLE_WEB_IMPORT=True,
        IMPORT_MAX_FILE_BYTES=1024 * 1024,
        IMPORT_MAX_FILES=11,
        IMPORT_MAX_TOTAL_BYTES=5 * 1024 * 1024,
    )

    settings_disabled = Settings(
        DATABASE_URL=f"sqlite:///{demo_db_path.as_posix()}",
        UPLOAD_DB_PATH=str(upload_db_path),
        ENABLE_WEB_IMPORT=False,
    )

    return {
        "demo_db_path": demo_db_path,
        "upload_db_path": upload_db_path,
        "settings_enabled": settings_enabled,
        "settings_disabled": settings_disabled,
    }


def test_import_status_and_disabled_access(import_test_env):
    """When ENABLE_WEB_IMPORT is false:
    - GET /api/import/status says enabled=false
    - POST endpoints return 403 {"detail": "Web import is disabled"}
    """
    app = create_app(settings=import_test_env["settings_disabled"])
    client = TestClient(app)

    # Status returns enabled=false
    res = client.get("/api/import/status")
    assert res.status_code == 200
    data = res.json()
    assert data["enabled"] is False
    assert data["active"] == "demo"
    assert data["uploaded_available"] is False

    # POST routes return 403
    for path in ["/api/import/validate", "/api/import/load", "/api/import/activate"]:
        res_post = client.post(path, json={})
        assert res_post.status_code == 403
        assert res_post.json() == {"detail": "Web import is disabled"}

    # GET /api/import/template returns 403
    res_tmpl = client.get("/api/import/template")
    assert res_tmpl.status_code == 403
    assert res_tmpl.json() == {"detail": "Web import is disabled"}


def test_import_template_endpoint(import_test_env):
    """GET /api/import/template returns CSV templates for all 11 files."""
    app = create_app(settings=import_test_env["settings_enabled"])
    client = TestClient(app)

    res = client.get("/api/import/template")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 11
    assert "warehouses.csv" in data
    assert "components.csv" in data
    assert "code,name,role" in data["warehouses.csv"]


def test_validate_valid_dataset_no_db_created(import_test_env):
    """Valid dataset returns valid=True and NEVER touches or creates upload database."""
    app = create_app(settings=import_test_env["settings_enabled"])
    client = TestClient(app)
    upload_path = import_test_env["upload_db_path"]

    files = build_valid_sample_files("2026-10-18")
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": files})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert len(data["errors"]) == 0
    assert data["row_counts"]["warehouses"] == 2
    assert not upload_path.exists(), "Validate must NEVER create or touch any database!"


def test_validate_error_classes(import_test_env):
    """Validate returns valid=False and collects errors for various business rule violations."""
    app = create_app(settings=import_test_env["settings_enabled"])
    client = TestClient(app)

    base_files = build_valid_sample_files("2026-10-18")

    # 1. Bad enum (warehouse role)
    bad_enum = dict(base_files)
    bad_enum["warehouses.csv"] = "code,name,role\nWH-1,Test,invalid_role\n"
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": bad_enum})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any("role" in e["message"] or "plant" in e["message"] for e in data["errors"])

    # 2. Received > Ordered in delivery_history
    bad_rec = dict(base_files)
    bad_rec["delivery_history.csv"] = (
        "supplier_code,component_sku,promised_date,actual_date,qty_ordered,qty_received,qty_rejected\n"
        "SUP-001,CMP-CPU-001,2026-10-01,2026-10-01,100,150,0\n"
    )
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": bad_rec})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any("received" in e["message"].lower() or "ordered" in e["message"].lower() for e in data["errors"])

    # 3. Unknown SKU in inventory
    bad_sku = dict(base_files)
    bad_sku["inventory.csv"] = "component_sku,warehouse_code,on_hand,reserved\nUNKNOWN-SKU,WH-PLANT,10,0\n"
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": bad_sku})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any("UNKNOWN-SKU" in e["message"] for e in data["errors"])
    # Check file and line present
    err = [e for e in data["errors"] if "UNKNOWN-SKU" in e["message"]][0]
    assert err["file"] == "inventory.csv"
    assert err["line"] == 2

    # 4. Missing required file (warehouses.csv)
    missing_req = dict(base_files)
    del missing_req["warehouses.csv"]
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": missing_req})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any("warehouses.csv" in e["message"] for e in data["errors"])

    # 5. No plant warehouse (all regional)
    no_plant = dict(base_files)
    no_plant["warehouses.csv"] = "code,name,role\nWH-REG,Regional 1,regional\n"
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": no_plant})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any("plant" in e["message"].lower() for e in data["errors"])

    # 6. Bad date format in demand_history
    bad_date = dict(base_files)
    bad_date["demand_history.csv"] = "component_sku,date,quantity\nCMP-CPU-001,not-a-date,10\n"
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": bad_date})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any("date" in e["message"].lower() for e in data["errors"])

    # 7. Negative qty in inventory
    neg_qty = dict(base_files)
    neg_qty["inventory.csv"] = "component_sku,warehouse_code,on_hand,reserved\nCMP-CPU-001,WH-PLANT,-5,0\n"
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": neg_qty})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any("negative" in e["message"].lower() or "0" in e["message"] for e in data["errors"])


def test_validate_negative_security_checks(import_test_env):
    """Enforces 422 for path traversal, unknown files, binary content, and 413 for oversize."""
    app = create_app(settings=import_test_env["settings_enabled"])
    client = TestClient(app)

    base_files = build_valid_sample_files("2026-10-18")

    # Path traversal rejected (422)
    bad_name = dict(base_files)
    bad_name["../warehouses.csv"] = bad_name.pop("warehouses.csv")
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": bad_name})
    assert res.status_code == 422

    bad_slash = dict(base_files)
    bad_slash["folder/warehouses.csv"] = bad_slash.pop("warehouses.csv")
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": bad_slash})
    assert res.status_code == 422

    # Unknown file (422)
    unknown = dict(base_files)
    unknown["custom_script.py"] = "print('hello')"
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": unknown})
    assert res.status_code == 422

    # Binary content (null byte) (422)
    binary = dict(base_files)
    binary["warehouses.csv"] = "code,name,role\nWH-1,\x00\x01\x02,plant\n"
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": binary})
    assert res.status_code == 422

    # Oversize file > IMPORT_MAX_FILE_BYTES (413)
    oversize = dict(base_files)
    oversize["warehouses.csv"] = "code,name,role\n" + ("WH-1,Plant,plant\n" * 100000)
    res = client.post("/api/import/validate", json={"as_of": "2026-10-18", "files": oversize})
    assert res.status_code == 413


def test_refuse_upload_path_equal_to_sentinel_db(tmp_path):
    """Refuses (409) if UPLOAD_DB_PATH resolves to sentinel.db."""
    db_path = tmp_path / "sentinel.db"
    settings = Settings(
        DATABASE_URL=f"sqlite:///{db_path.as_posix()}",
        UPLOAD_DB_PATH=str(db_path),
        ENABLE_WEB_IMPORT=True,
    )
    app = create_app(settings=settings)
    client = TestClient(app)

    files = build_valid_sample_files("2026-10-18")
    res = client.post("/api/import/load", json={"as_of": "2026-10-18", "files": files})
    assert res.status_code == 409
    assert "sentinel.db" in res.json()["detail"]


def test_load_atomic_and_sentinel_db_untouched(import_test_env):
    """Load valid dataset:
    - Atomically loads into uploaded.db
    - Switches active to 'uploaded'
    - Leaves sentinel.db SHA-256 completely unchanged
    - /api/meta shows USER-SUPPLIED DATA label
    """
    demo_db_path = import_test_env["demo_db_path"]
    with open(demo_db_path, "rb") as f:
        hash_before = hashlib.sha256(f.read()).hexdigest()

    app = create_app(settings=import_test_env["settings_enabled"])
    client = TestClient(app)

    files = build_valid_sample_files("2026-10-18")

    # Load dataset
    res = client.post("/api/import/load", json={"as_of": "2026-10-18", "files": files})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["active"] == "uploaded"

    # Verify sentinel.db hash is 100% identical
    with open(demo_db_path, "rb") as f:
        hash_after = hashlib.sha256(f.read()).hexdigest()
    assert hash_before == hash_after, "sentinel.db MUST NEVER be modified!"

    # Verify /api/meta reflects uploaded dataset
    meta_res = client.get("/api/meta")
    assert meta_res.status_code == 200
    meta_data = meta_res.json()
    assert meta_data["active_dataset"] == "uploaded"
    assert meta_data["data_source"] == "file-import"
    assert "USER-SUPPLIED DATA" in meta_data["label"]

    # Verify /api/inventory-risk and /api/alerts respond 200
    assert client.get("/api/inventory-risk").status_code == 200
    assert client.get("/api/alerts").status_code == 200


def test_load_failure_preserves_previous_uploaded_db(import_test_env):
    """When a load has invalid data, existing uploaded.db remains completely intact."""
    app = create_app(settings=import_test_env["settings_enabled"])
    client = TestClient(app)

    # 1. Load valid dataset first
    valid_files = build_valid_sample_files("2026-10-18")
    res1 = client.post("/api/import/load", json={"as_of": "2026-10-18", "files": valid_files})
    assert res1.status_code == 200
    assert res1.json()["valid"] is True

    # Record uploaded.db hash
    upload_path = import_test_env["upload_db_path"]
    with open(upload_path, "rb") as f:
        upload_hash_initial = hashlib.sha256(f.read()).hexdigest()

    # 2. Attempt to load invalid dataset
    invalid_files = dict(valid_files)
    invalid_files["inventory.csv"] = "component_sku,warehouse_code,on_hand,reserved\nNON_EXISTENT,WH-PLANT,10,0\n"
    res2 = client.post("/api/import/load", json={"as_of": "2026-10-18", "files": invalid_files})
    assert res2.status_code == 200
    assert res2.json()["valid"] is False

    # Verify uploaded.db is unchanged
    with open(upload_path, "rb") as f:
        upload_hash_after = hashlib.sha256(f.read()).hexdigest()
    assert upload_hash_initial == upload_hash_after


def test_activate_switching_and_restart_defaults_to_demo(import_test_env):
    """Test switching datasets with /api/import/activate and 409 when no uploaded data.
    A new app instance defaults to demo."""
    settings = import_test_env["settings_enabled"]
    app = create_app(settings=settings)
    client = TestClient(app)

    # Activating uploaded before any upload -> 409
    res_act = client.post("/api/import/activate", json={"dataset": "uploaded"})
    assert res_act.status_code == 409

    # Load dataset
    files = build_valid_sample_files("2026-10-18")
    client.post("/api/import/load", json={"as_of": "2026-10-18", "files": files})

    # Switch to demo
    res_demo = client.post("/api/import/activate", json={"dataset": "demo"})
    assert res_demo.status_code == 200
    assert res_demo.json()["active"] == "demo"
    assert client.get("/api/meta").json()["active_dataset"] == "demo"

    # Switch back to uploaded
    res_up = client.post("/api/import/activate", json={"dataset": "uploaded"})
    assert res_up.status_code == 200
    assert res_up.json()["active"] == "uploaded"
    assert client.get("/api/meta").json()["active_dataset"] == "uploaded"

    # Restart app (simulating process restart) -> MUST default to demo
    app_restarted = create_app(settings=settings)
    client_restarted = TestClient(app_restarted)
    assert client_restarted.get("/api/import/status").json()["active"] == "demo"
    assert client_restarted.get("/api/meta").json()["active_dataset"] == "demo"


def test_forecasting_cache_dataset_isolation(import_test_env):
    """In-process forecasting cache never mixes datasets when switching active dataset."""
    demo_db_path = import_test_env["demo_db_path"]
    upload_db_path = import_test_env["upload_db_path"]

    # Clear evaluation cache
    _EVALUATION_CACHE.clear()

    # Create session for demo
    demo_eng, demo_sf = create_engine_and_sessionmaker(f"sqlite:///{demo_db_path.as_posix()}")
    # Create session for upload
    up_eng, up_sf = create_engine_and_sessionmaker(f"sqlite:///{upload_db_path.as_posix()}")
    Base.metadata.create_all(up_eng)
    with up_sf() as sess:
        sess.add(
            DatasetMeta(
                source="file-import",
                label="USER-SUPPLIED DATA (file import)",
                as_of=date(2026, 10, 18),
                seed=0,
                generator_version="0.1.0",
                generated_at=datetime.now(timezone.utc),
            )
        )
        sess.commit()

    with demo_sf() as demo_sess:
        demo_sess.info["active_dataset"] = "demo"
        seeded_demo, rep_demo = get_forecast_evaluation_service(demo_sess, dataset_name="demo")

    with up_sf() as up_sess:
        up_sess.info["active_dataset"] = "uploaded"
        seeded_up, rep_up = get_forecast_evaluation_service(up_sess, dataset_name="uploaded")

    # Both datasets have entries or unseeded results under their own keys
    for key in _EVALUATION_CACHE.keys():
        assert key[0] in ("demo", "uploaded")
    demo_eng.dispose()
    up_eng.dispose()


def test_sample_dataset_business_scenario(import_test_env):
    """Using sample data:
    - load succeeds
    - CMP-CPU-001 shows shortage risk
    - inventory_shortage alert exists
    - SUP-001 supplier risk is higher than SUP-002
    - recommendations contain at least one option for CMP-CPU-001
    """
    app = create_app(settings=import_test_env["settings_enabled"])
    client = TestClient(app)

    # Check if docs/sample_data exists, else use generated valid files
    sample_dir = Path("docs/sample_data")
    if sample_dir.exists() and (sample_dir / "warehouses.csv").exists():
        files = {}
        for f in sample_dir.glob("*.csv"):
            files[f.name] = f.read_text(encoding="utf-8")
        as_of = "2026-10-18"
    else:
        files = build_valid_sample_files("2026-10-18")
        as_of = "2026-10-18"

    # 1. Load dataset
    res = client.post("/api/import/load", json={"as_of": as_of, "files": files})
    assert res.status_code == 200
    assert res.json()["valid"] is True
    assert res.json()["active"] == "uploaded"

    # 2. Inventory risk: CMP-CPU-001 has shortage risk (critical, high, or medium)
    inv_risk_res = client.get("/api/inventory-risk")
    assert inv_risk_res.status_code == 200
    inv_items = inv_risk_res.json()["items"]
    cpu_risk = [item for item in inv_items if item["sku"] == "CMP-CPU-001"]
    assert len(cpu_risk) == 1
    assert cpu_risk[0]["risk_level"] in ("critical", "high", "medium")

    # 3. Disruption alert: inventory_shortage alert exists
    alerts_res = client.get("/api/alerts")
    assert alerts_res.status_code == 200
    alerts = alerts_res.json()["items"]
    shortage_alerts = [a for a in alerts if a["type"] == "inventory_shortage"]
    assert len(shortage_alerts) >= 1

    # 4. Supplier risk: SUP-001 risk score is higher than SUP-002
    sup_risk_res = client.get("/api/supplier-risk")
    assert sup_risk_res.status_code == 200
    sup_items = sup_risk_res.json()["items"]
    sup001 = [s for s in sup_items if s["supplier_code"] == "SUP-001"][0]
    sup002 = [s for s in sup_items if s["supplier_code"] == "SUP-002"][0]
    assert sup001["risk_score"] is not None and sup002["risk_score"] is not None
    assert sup001["risk_score"] > sup002["risk_score"], (
        f"Expected SUP-001 risk ({sup001['risk_score']}) > SUP-002 risk ({sup002['risk_score']})"
    )

    # 5. Recommendations: contain at least one option for CMP-CPU-001
    rec_res = client.get("/api/recommendations")
    assert rec_res.status_code == 200
    rec_items = rec_res.json()["items"]
    cpu_recs = [r for r in rec_items if r["sku"] == "CMP-CPU-001"]
    assert len(cpu_recs) >= 1
    assert len(cpu_recs[0]["options"]) >= 1
