import os
from pathlib import Path
import pytest


def test_no_test_touches_sentinel_db(client_seeded):
    """Verify that backend/sentinel.db is never modified or written to during test execution."""
    root_backend = Path(__file__).resolve().parent.parent
    db_path = root_backend / "sentinel.db"
    if db_path.exists():
        stat_before = db_path.stat().st_mtime_ns
        client_seeded.get("/api/products")
        client_seeded.get("/api/meta")
        stat_after = db_path.stat().st_mtime_ns
        assert stat_before == stat_after, "Test execution modified backend/sentinel.db!"


def test_meta_on_empty_db(client_empty):
    response = client_empty.get("/api/meta")
    assert response.status_code == 200
    data = response.json()
    assert data["seeded"] is False
    assert data["label"] is None
    assert all(count == 0 for count in data["counts"].values())
    assert "not seeded" in data["message"].lower()


def test_all_endpoints_return_200_and_envelopes(client_seeded):
    # /api/meta
    res_meta = client_seeded.get("/api/meta")
    assert res_meta.status_code == 200
    meta = res_meta.json()
    assert meta["seeded"] is True
    assert meta["label"] == "DEMO DATA"
    assert meta["data_source"] == "demo"
    assert meta["counts"]["products"] >= 4

    # /api/warehouses
    res_wh = client_seeded.get("/api/warehouses")
    assert res_wh.status_code == 200
    wh_data = res_wh.json()
    assert "items" in wh_data and "total" in wh_data
    assert wh_data["total"] >= 3

    # /api/products and /api/products/{id}
    res_prod = client_seeded.get("/api/products")
    assert res_prod.status_code == 200
    prod_data = res_prod.json()
    assert prod_data["total"] >= 4
    first_prod_id = prod_data["items"][0]["id"]

    res_prod_det = client_seeded.get(f"/api/products/{first_prod_id}")
    assert res_prod_det.status_code == 200
    prod_detail = res_prod_det.json()
    assert "bom_lines" in prod_detail
    assert len(prod_detail["bom_lines"]) > 0

    # /api/components and /api/components/{id}
    res_comp = client_seeded.get("/api/components")
    assert res_comp.status_code == 200
    comp_data = res_comp.json()
    assert comp_data["total"] >= 12
    cpu_comp = next(c for c in comp_data["items"] if c["sku"] == "CPU-X7")

    res_comp_det = client_seeded.get(f"/api/components/{cpu_comp['id']}")
    assert res_comp_det.status_code == 200
    comp_detail = res_comp_det.json()
    assert "supplier_offers" in comp_detail
    assert "inventory" in comp_detail
    assert len(comp_detail["supplier_offers"]) >= 2
    assert len(comp_detail["inventory"]) >= 2

    # /api/components/{id}/demand-history
    res_dh = client_seeded.get(f"/api/components/{cpu_comp['id']}/demand-history?days=30")
    assert res_dh.status_code == 200
    dh_data = res_dh.json()
    assert dh_data["days"] == 30
    assert dh_data["total"] == 30
    assert len(dh_data["items"]) == 30
    # verify ascending by date
    dates = [item["date"] for item in dh_data["items"]]
    assert dates == sorted(dates)

    # /api/suppliers and /api/suppliers/{id}
    res_sup = client_seeded.get("/api/suppliers")
    assert res_sup.status_code == 200
    sup_data = res_sup.json()
    assert sup_data["total"] >= 8
    first_sup_id = sup_data["items"][0]["id"]

    res_sup_det = client_seeded.get(f"/api/suppliers/{first_sup_id}")
    assert res_sup_det.status_code == 200
    sup_detail = res_sup_det.json()
    assert "offers" in sup_detail

    # /api/inventory
    res_inv = client_seeded.get("/api/inventory")
    assert res_inv.status_code == 200
    inv_data = res_inv.json()
    assert inv_data["total"] > 0
    first_inv = inv_data["items"][0]
    assert "on_hand" in first_inv and "reserved" in first_inv

    # /api/purchase-orders and /api/purchase-orders/{id}
    res_po = client_seeded.get("/api/purchase-orders")
    assert res_po.status_code == 200
    po_data = res_po.json()
    assert po_data["total"] >= 20
    first_po_id = po_data["items"][0]["id"]

    res_po_det = client_seeded.get(f"/api/purchase-orders/{first_po_id}")
    assert res_po_det.status_code == 200
    po_detail = res_po_det.json()
    assert "lines" in po_detail
    assert len(po_detail["lines"]) > 0

    # /api/customer-orders
    res_co = client_seeded.get("/api/customer-orders")
    assert res_co.status_code == 200
    co_data = res_co.json()
    assert co_data["total"] >= 25

    # /api/delivery-records
    res_dr = client_seeded.get("/api/delivery-records")
    assert res_dr.status_code == 200
    dr_data = res_dr.json()
    assert dr_data["total"] >= 150

    # /api/health still passes
    res_health = client_seeded.get("/api/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "ok"


def test_pagination_and_validation(client_seeded):
    # Valid pagination
    res_page = client_seeded.get("/api/components?limit=5&offset=2")
    assert res_page.status_code == 200
    data = res_page.json()
    assert len(data["items"]) == 5
    assert data["limit"] == 5
    assert data["offset"] == 2

    # Invalid pagination: limit=0 (must return 422)
    res_zero = client_seeded.get("/api/components?limit=0")
    assert res_zero.status_code == 422

    # Invalid pagination: limit=201 (must return 422)
    res_over = client_seeded.get("/api/components?limit=201")
    assert res_over.status_code == 422

    # Invalid pagination: offset=-1 (must return 422)
    res_neg_off = client_seeded.get("/api/components?offset=-1")
    assert res_neg_off.status_code == 422

    # Invalid days for demand history: days=0 or days=366
    res_bad_days = client_seeded.get("/api/components/1/demand-history?days=0")
    assert res_bad_days.status_code == 422
    res_bad_days2 = client_seeded.get("/api/components/1/demand-history?days=400")
    assert res_bad_days2.status_code == 422


def test_filters(client_seeded):
    # Filter components by category
    res_cat = client_seeded.get("/api/components?category=processor")
    assert res_cat.status_code == 200
    procs = res_cat.json()["items"]
    assert len(procs) >= 2
    assert all(c["category"] == "processor" for c in procs)

    # Filter components by case-insensitive q
    res_q = client_seeded.get("/api/components?q=novacore")
    assert res_q.status_code == 200
    items = res_q.json()["items"]
    assert len(items) >= 2
    assert all("novacore" in (c["name"] + c["sku"]).lower() for c in items)

    # Filter inventory by component_id
    comp_id = procs[0]["id"]
    res_inv = client_seeded.get(f"/api/inventory?component_id={comp_id}")
    assert res_inv.status_code == 200
    invs = res_inv.json()["items"]
    assert len(invs) >= 1
    assert all(inv["component_id"] == comp_id for inv in invs)

    # Filter purchase orders by status
    res_po = client_seeded.get("/api/purchase-orders?status=in_transit")
    assert res_po.status_code == 200
    in_transit_pos = res_po.json()["items"]
    assert len(in_transit_pos) >= 1
    assert all(po["status"] == "in_transit" for po in in_transit_pos)

    # Invalid status enum returns 422
    res_bad_status = client_seeded.get("/api/purchase-orders?status=non_existent_status")
    assert res_bad_status.status_code == 422

    # Filter customer orders by priority and status
    res_co = client_seeded.get("/api/customer-orders?priority=critical&status=open")
    assert res_co.status_code == 200
    crit_orders = res_co.json()["items"]
    assert len(crit_orders) >= 1
    assert all(co["priority"] == "critical" and co["status"] == "open" for co in crit_orders)

    # Invalid customer order priority returns 422
    res_bad_prio = client_seeded.get("/api/customer-orders?priority=ultra")
    assert res_bad_prio.status_code == 422


def test_404_responses(client_seeded):
    # Unknown product id
    res_p = client_seeded.get("/api/products/99999")
    assert res_p.status_code == 404
    assert "not found" in res_p.json()["detail"].lower()

    # Unknown component id
    res_c = client_seeded.get("/api/components/99999")
    assert res_c.status_code == 404

    # Unknown component demand history
    res_dh = client_seeded.get("/api/components/99999/demand-history")
    assert res_dh.status_code == 404

    # Unknown supplier id
    res_s = client_seeded.get("/api/suppliers/99999")
    assert res_s.status_code == 404

    # Unknown PO id
    res_po = client_seeded.get("/api/purchase-orders/99999")
    assert res_po.status_code == 404


def test_non_get_methods_are_not_routable(client_seeded):
    # POST to /api/products returns 405 Method Not Allowed
    res_post = client_seeded.post("/api/products", json={"sku": "NEW-PROD"})
    assert res_post.status_code == 405

    # DELETE to /api/components/1 returns 405
    res_del = client_seeded.delete("/api/components/1")
    assert res_del.status_code == 405

    # PUT to /api/purchase-orders/1 returns 405
    res_put = client_seeded.put("/api/purchase-orders/1", json={"status": "received"})
    assert res_put.status_code == 405


def test_nullable_fields_appear_as_null(client_seeded):
    # Find supplier offer with null capacity
    res_comp = client_seeded.get("/api/components")
    comps = res_comp.json()["items"]
    bat50 = next(c for c in comps if c["sku"] == "BAT-50WH")

    res_detail = client_seeded.get(f"/api/components/{bat50['id']}")
    assert res_detail.status_code == 200
    offers = res_detail.json()["supplier_offers"]
    assert len(offers) >= 1
    assert offers[0]["max_weekly_capacity"] is None

    # Find PO with null latest_estimate_date
    res_po = client_seeded.get("/api/purchase-orders?status=in_transit")
    pos = res_po.json()["items"]
    assert any(po["latest_estimate_date"] is None for po in pos)


def test_utc_timestamps_format(client_seeded):
    """Verify that all API datetime fields end in +00:00 or Z (unambiguous UTC ISO-8601)."""
    # 1. /api/meta -> generated_at
    res_meta = client_seeded.get("/api/meta")
    assert res_meta.status_code == 200
    gen_at = res_meta.json()["generated_at"]
    assert gen_at is not None
    assert gen_at.endswith("+00:00") or gen_at.endswith("Z")

    # 2. /api/inventory -> as_of_ts
    res_inv = client_seeded.get("/api/inventory?limit=5")
    assert res_inv.status_code == 200
    for item in res_inv.json()["items"]:
        assert item["as_of_ts"].endswith("+00:00") or item["as_of_ts"].endswith("Z")

    # 3. /api/health -> timestamp
    res_health = client_seeded.get("/api/health")
    assert res_health.status_code == 200
    ts = res_health.json()["timestamp"]
    assert ts.endswith("+00:00") or ts.endswith("Z")

