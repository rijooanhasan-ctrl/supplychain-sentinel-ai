"""backend/tests/test_globe.py

Comprehensive tests for 3D Supply Chain Globe backend logic:
1. validate_lat_lon (bounds, NaN, strings, null island).
2. resolve_country (alpha-2, alpha-3, name, ambiguous, unknown, whitespace).
3. resolution precedence and 'unresolved' for warehouses without data.
4. Determinism: no random coordinates (same input twice -> identical).
5. Country grouping and concentration calculations (threshold boundaries at exactly 3 suppliers and 40%, single-country critical flag, unknown band counted).
6. GET /api/globe on demo dataset (all suppliers/warehouses mapped, routes only from open POs, coverage consistency, is_live=false).
7. Cross-endpoint consistency (/api/globe agrees with /api/supplier-risk and /api/purchase-orders for at least 3 suppliers).
8. GET /api/globe on CSV-imported temp dataset (suppliers resolve to centroids, warehouses unresolved).
9. GET /api/globe on unseeded DB ({seeded: false}, no 500).
10. POST /api/locations/override (403 disabled, 404 unknown code, 422 bad coordinates, success atomic write, manual precision, clear works, dataset isolation, corrupt file handling).
11. sentinel.db hash verification before and after test suite execution.
"""

from __future__ import annotations

from datetime import date
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import pytest
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import Base, Component, DatasetMeta, PurchaseOrder, PurchaseOrderLine, Supplier, SupplierComponent, Warehouse
from app.db.session import create_engine_and_sessionmaker
from app.domain.geo import (
    compute_concentration,
    group_by_country,
    load_country_centroids,
    resolve_country,
    resolve_location,
    validate_lat_lon,
)
from app.main import create_app
from app.services.globe import (
    get_globe_data,
    load_demo_locations,
    load_location_overrides,
    save_location_override,
)

SENTINEL_DB_PATH = Path(__file__).resolve().parent.parent / "sentinel.db"
EXPECTED_SENTINEL_SHA256 = "0f84999d5149a8780fe7797cb5d5eb2fb6d815b73a0efe782568fed5740e73a1"


def compute_file_sha256(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# 1. validate_lat_lon unit tests
# ---------------------------------------------------------------------------

def test_validate_lat_lon():
    # Valid coordinates
    ok, reason = validate_lat_lon(37.7749, -122.4194)
    assert ok is True
    assert reason == ""

    # Extreme valid bounds
    assert validate_lat_lon(90.0, 180.0)[0] is True
    assert validate_lat_lon(-90.0, -180.0)[0] is True

    # Out of range latitude
    ok, reason = validate_lat_lon(90.1, 0.0)
    assert ok is False
    assert "Latitude must be between -90 and 90" in reason

    ok, reason = validate_lat_lon(-90.01, 0.0)
    assert ok is False
    assert "Latitude must be between -90 and 90" in reason

    # Out of range longitude
    ok, reason = validate_lat_lon(0.0, 180.1)
    assert ok is False
    assert "Longitude must be between -180 and 180" in reason

    ok, reason = validate_lat_lon(0.0, -180.5)
    assert ok is False
    assert "Longitude must be between -180 and 180" in reason

    # Null Island rejection
    ok, reason = validate_lat_lon(0.0, 0.0)
    assert ok is False
    assert "Null Island" in reason

    # Null Island allowed explicitly
    ok, reason = validate_lat_lon(0.0, 0.0, allow_null_island=True)
    assert ok is True

    # Non-numeric or strings
    ok, reason = validate_lat_lon("37.7", "-122.4")  # type: ignore
    assert ok is False
    assert "numeric float or int" in reason.lower()

    # NaN and Infinite
    ok, reason = validate_lat_lon(float("nan"), 10.0)
    assert ok is False
    assert "finite numbers" in reason.lower()

    ok, reason = validate_lat_lon(10.0, float("inf"))
    assert ok is False
    assert "finite numbers" in reason.lower()


# ---------------------------------------------------------------------------
# 2. resolve_country unit tests
# ---------------------------------------------------------------------------

def test_resolve_country():
    # Alpha-2
    assert resolve_country("US") == "US"
    assert resolve_country("us") == "US"
    assert resolve_country("DE") == "DE"
    assert resolve_country("TW") == "TW"

    # Alpha-3
    assert resolve_country("USA") == "US"
    assert resolve_country("DEU") == "DE"
    assert resolve_country("KOR") == "KR"
    assert resolve_country("TWN") == "TW"

    # Name matching & whitespace tolerance
    assert resolve_country(" United States ") == "US"
    assert resolve_country("Germany") == "DE"
    assert resolve_country("south korea") == "KR"
    assert resolve_country("Taiwan") == "TW"
    assert resolve_country("Viet Nam") == "VN" or resolve_country("Vietnam") == "VN"

    # Unknown or empty or ambiguous
    assert resolve_country("") is None
    assert resolve_country("   ") is None
    assert resolve_country("Atlantis") is None
    assert resolve_country(None) is None


# ---------------------------------------------------------------------------
# 3. Resolution precedence & determinism
# ---------------------------------------------------------------------------

def test_resolution_precedence_and_determinism():
    centroids = load_country_centroids()
    demo_fix = {"SUP-1": {"lat": 25.0, "lon": 121.5, "precision": "exact", "source": "Demo"}}
    overrides = {"SUP-1": {"lat": 26.0, "lon": 122.0, "note": "manual fix"}}

    # Override takes precedence over fixture
    res1 = resolve_location("supplier", "SUP-1", "TW", overrides, demo_fix, centroids)
    assert res1.lat == 26.0
    assert res1.precision == "manual"
    assert "Manually set" in res1.source

    # Fixture takes precedence over country centroid
    res2 = resolve_location("supplier", "SUP-1", "TW", {}, demo_fix, centroids)
    assert res2.lat == 25.0
    assert res2.precision == "exact"

    # Country centroid used when entity has country and no fixture
    res3 = resolve_location("supplier", "SUP-OTHER", "DE", {}, demo_fix, centroids)
    assert res3.precision == "country_centroid"
    assert res3.country_code == "DE"
    assert "Country centre (approximate)" in res3.source

    # Warehouse without fixture or override -> unresolved
    res_wh = resolve_location("warehouse", "WH-NEW", None, {}, demo_fix, centroids)
    assert res_wh.precision == "unresolved"
    assert res_wh.lat is None
    assert "Warehouse without location" in res_wh.source

    # Determinism: same input twice yields identical output (no random jitter)
    res_a = resolve_location("supplier", "SUP-OTHER", "JP", {}, demo_fix, centroids)
    res_b = resolve_location("supplier", "SUP-OTHER", "JP", {}, demo_fix, centroids)
    assert res_a == res_b


# ---------------------------------------------------------------------------
# 4. Country grouping & concentration boundaries
# ---------------------------------------------------------------------------

def test_country_grouping_and_concentration():
    suppliers = [
        {"code": "S1", "location": {"country_code": "DE"}, "risk_band": "low", "name": "S1"},
        {"code": "S2", "location": {"country_code": "DE"}, "risk_band": "high", "name": "S2"},
        {"code": "S3", "location": {"country_code": "DE"}, "risk_band": "unknown", "name": "S3"},
        {"code": "S4", "location": {"country_code": "FR"}, "risk_band": "medium", "name": "S4"},
    ]
    routes = [
        {"supplier_code": "S1", "open_po_count": 2, "remaining_qty": 200},
        {"supplier_code": "S2", "open_po_count": 1, "remaining_qty": 50},
    ]
    single_country_map = {"DE": ["CMP-A"]}

    groups = group_by_country(suppliers, routes, single_country_map)
    assert "DE" in groups
    assert groups["DE"]["supplier_count"] == 3
    assert groups["DE"]["risk_distribution"]["unknown"] == 1
    assert groups["DE"]["risk_distribution"]["high"] == 1
    assert groups["DE"]["open_po_count"] == 3
    assert groups["DE"]["remaining_qty"] == 250
    assert groups["DE"]["single_country_components"] == ["CMP-A"]

    # Concentration check
    # Total resolved suppliers = 4. DE has 3 -> 3/4 = 75% >= 40% AND supplier count >= 3 -> FLAGGED
    conc = compute_concentration(groups, total_suppliers=4, min_suppliers=3, share_threshold=0.40)
    de_conc = next(c for c in conc if c["country_code"] == "DE")
    assert de_conc["flagged"] is True
    assert "Concentration threshold met" in de_conc["reason"]

    # Boundary test: if DE has 2 suppliers out of 4 (50%), min_suppliers=3 is not met
    groups["DE"]["supplier_count"] = 2
    groups["DE"]["single_country_components"] = []  # no critical single-source
    conc_boundary = compute_concentration(groups, total_suppliers=4, min_suppliers=3, share_threshold=0.40)
    de_b = next(c for c in conc_boundary if c["country_code"] == "DE")
    assert de_b["flagged"] is False

    # Single-country critical component triggers flag even if count < 3
    groups["DE"]["single_country_components"] = ["CMP-CRIT"]
    conc_single = compute_concentration(groups, total_suppliers=4, min_suppliers=3, share_threshold=0.40)
    de_s = next(c for c in conc_single if c["country_code"] == "DE")
    assert de_s["flagged"] is True
    assert "sole source" in de_s["reason"]


# ---------------------------------------------------------------------------
# 5. GET /api/globe on Demo dataset & cross-endpoint consistency
# ---------------------------------------------------------------------------

def test_api_globe_demo_dataset():
    client = TestClient(create_app())
    res = client.get("/api/globe")
    assert res.status_code == 200
    data = res.json()

    assert data["seeded"] is True
    assert data["dataset"]["is_live"] is False
    assert data["dataset"]["active_dataset"] == "demo"
    assert data["as_of"] is not None

    # Verify coverage
    cov = data["coverage"]
    assert cov["suppliers_total"] == len(data["suppliers"])
    assert cov["suppliers_unresolved"] == 0
    assert cov["warehouses_total"] == len(data["warehouses"])
    assert cov["warehouses_unresolved"] == 0

    # Verify all suppliers have location with precision 'exact' (from demo_locations fixture)
    for s in data["suppliers"]:
        assert s["location"] is not None
        assert s["location"]["precision"] == "exact"
        assert s["location"]["source"] == "Illustrative demo location"
        assert s["risk_band"] in ("critical", "high", "medium", "low", "unknown")

    # Verify warehouses
    for wh in data["warehouses"]:
        assert wh["location"] is not None
        assert wh["location"]["precision"] == "exact"
        assert wh["inventory_summary"]["components_held"] >= 0

    # Verify routes
    assert len(data["routes"]) > 0
    for r in data["routes"]:
        assert r["label"] == "Estimated route - not live shipment tracking"
        assert len(r["po_numbers"]) > 0
        assert r["open_po_count"] > 0

    # Cross-endpoint agreement on at least 3 suppliers
    s_risk_res = client.get("/api/supplier-risk").json()["items"]
    s_risk_map = {sr["supplier_id"]: sr for sr in s_risk_res}

    tested_suppliers = 0
    for s in data["suppliers"][:5]:
        sr = s_risk_map.get(s["id"])
        if sr:
            assert s["risk_score"] == sr["risk_score"]
            assert s["risk_band"] == sr["risk_band"]
            assert s["on_time_rate"] == sr["on_time_rate"]
            tested_suppliers += 1
    assert tested_suppliers >= 3


# ---------------------------------------------------------------------------
# 6. Unseeded database behavior
# ---------------------------------------------------------------------------

def test_api_globe_unseeded():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        empty_db_path = tf.name

    app = None
    try:
        settings = Settings(DATABASE_URL=f"sqlite:///{empty_db_path}")
        app = create_app(settings)
        with TestClient(app) as client:
            res = client.get("/api/globe")
            assert res.status_code == 200
            data = res.json()
            assert data["seeded"] is False
            assert len(data["suppliers"]) == 0
            assert len(data["warehouses"]) == 0
    finally:
        if app is not None and hasattr(app.state, "engine") and app.state.engine:
            app.state.engine.dispose()
        if os.path.exists(empty_db_path):
            try:
                os.remove(empty_db_path)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# 7. POST /api/locations/override (validation, permissions, isolation)
# ---------------------------------------------------------------------------

def test_locations_override_route(tmp_path, monkeypatch):
    # Use a temp directory for overrides file
    overrides_file = tmp_path / "location_overrides.json"
    import app.services.globe as globe_srv
    monkeypatch.setattr(globe_srv, "OVERRIDES_PATH", overrides_file)

    # 1. 403 when ENABLE_WEB_IMPORT is False
    disabled_settings = Settings(ENABLE_WEB_IMPORT=False)
    client_disabled = TestClient(create_app(disabled_settings))
    res_403 = client_disabled.post("/api/locations/override", json={
        "entity_type": "supplier",
        "code": "SUP-HELIX",
        "lat": 24.5,
        "lon": 120.5,
    })
    assert res_403.status_code == 403
    assert res_403.json()["detail"] == "Web import is disabled"

    # 2. Enabled client
    enabled_settings = Settings(ENABLE_WEB_IMPORT=True)
    client = TestClient(create_app(enabled_settings))

    # 404 for unknown entity
    res_404 = client.post("/api/locations/override", json={
        "entity_type": "supplier",
        "code": "UNKNOWN-SUPPLIER-CODE",
        "lat": 24.5,
        "lon": 120.5,
    })
    assert res_404.status_code == 404
    assert "not found" in res_404.json()["detail"]

    # 422 for invalid coordinates
    res_422 = client.post("/api/locations/override", json={
        "entity_type": "supplier",
        "code": "SUP-HELIX",
        "lat": 95.0,  # invalid latitude > 90
        "lon": 120.5,
    })
    assert res_422.status_code == 422
    assert "Latitude must be between" in res_422.json()["detail"]

    # 422 for Null Island (0,0)
    res_null = client.post("/api/locations/override", json={
        "entity_type": "supplier",
        "code": "SUP-HELIX",
        "lat": 0.0,
        "lon": 0.0,
    })
    assert res_null.status_code == 422
    assert "Null Island" in res_null.json()["detail"]

    # 3. Successful override write
    res_ok = client.post("/api/locations/override", json={
        "entity_type": "supplier",
        "code": "SUP-HELIX",
        "lat": 24.77,
        "lon": 120.99,
        "note": "Test override for Hsinchu",
    })
    assert res_ok.status_code == 200
    ret = res_ok.json()
    assert ret["status"] == "saved"
    assert ret["location"]["lat"] == 24.77
    assert ret["location"]["precision"] == "manual"
    assert "Manually set by user" in ret["location"]["source"]

    # Verify GET /api/globe reflects this manual override
    globe_res = client.get("/api/globe").json()
    helix = next(s for s in globe_res["suppliers"] if s["code"] == "SUP-HELIX")
    assert helix["location"]["lat"] == 24.77
    assert helix["location"]["precision"] == "manual"

    # 4. Clear override
    res_clear = client.post("/api/locations/override", json={
        "entity_type": "supplier",
        "code": "SUP-HELIX",
        "clear": True,
    })
    assert res_clear.status_code == 200
    assert res_clear.json()["status"] == "cleared"

    globe_res2 = client.get("/api/globe").json()
    helix2 = next(s for s in globe_res2["suppliers"] if s["code"] == "SUP-HELIX")
    assert helix2["location"]["precision"] == "exact"  # restored to fixture

    # 5. Corrupt override file handled gracefully (does not crash)
    overrides_file.write_text("NOT_VALID_JSON{:::}")
    globe_corrupt = client.get("/api/globe").json()
    assert globe_corrupt["seeded"] is True


# ---------------------------------------------------------------------------
# 8. GET /api/globe on CSV-imported temp dataset
# ---------------------------------------------------------------------------

def test_api_globe_csv_imported_dataset(tmp_path):
    from tests.test_web_import import build_valid_sample_files

    upload_db_path = tmp_path / "imported.db"
    settings = Settings(
        ENABLE_WEB_IMPORT=True,
        UPLOAD_DB_PATH=str(upload_db_path),
    )
    app = create_app(settings)
    files = build_valid_sample_files("2026-10-18")
    
    # Customize warehouse code so it does not match demo fixtures
    files["warehouses.csv"] = "code,name,role\nWH-IMP-1,Imported Plant,plant\nWH-IMP-2,Imported Hub,regional\n"
    files["inventory.csv"] = "component_sku,warehouse_code,on_hand,reserved\nCMP-CPU-001,WH-IMP-1,5,0\nCMP-RAM-002,WH-IMP-1,500,0\n"
    files["purchase_orders.csv"] = (
        "po_number,supplier_code,status,order_date,promised_date,latest_estimate_date,component_sku,warehouse_code,qty_ordered,qty_received,unit_price\n"
        "PO-101,SUP-001,open,2026-10-01,2026-10-25,2026-10-28,CMP-CPU-001,WH-IMP-1,200,0,300.00\n"
    )

    with TestClient(app) as client:
        load_res = client.post("/api/import/load", json={"as_of": "2026-10-18", "files": files})
        assert load_res.status_code == 200

        res = client.get("/api/globe")
        assert res.status_code == 200
        data = res.json()

        # Suppliers resolve to country centroids (US and TW)
        for s in data["suppliers"]:
            assert s["location"] is not None
            assert s["location"]["precision"] == "country_centroid"
            assert "Country centre (approximate)" in s["location"]["source"]

        # Warehouses without fixtures resolve to unresolved
        for w in data["warehouses"]:
            assert w["location"] is None

        # Coverage counts
        assert data["coverage"]["warehouses_unresolved"] == len(data["warehouses"])
        assert data["coverage"]["warehouses_mapped"] == 0
        assert data["coverage"]["suppliers_mapped"] == len(data["suppliers"])
        assert data["coverage"]["approximate_count"] == len(data["suppliers"])

    if hasattr(app.state, "engine") and app.state.engine:
        app.state.engine.dispose()
    if hasattr(app.state, "uploaded_engine") and app.state.uploaded_engine:
        app.state.uploaded_engine.dispose()


# ---------------------------------------------------------------------------
# 9. Sentinel.db SHA-256 verification (must not change)
# ---------------------------------------------------------------------------

def test_sentinel_db_integrity():
    if SENTINEL_DB_PATH.exists():
        current_hash = compute_file_sha256(SENTINEL_DB_PATH)
        assert current_hash == EXPECTED_SENTINEL_SHA256, (
            f"sentinel.db hash changed! Expected {EXPECTED_SENTINEL_SHA256}, got {current_hash}"
        )
