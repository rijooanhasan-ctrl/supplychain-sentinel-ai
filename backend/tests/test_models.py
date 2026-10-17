from datetime import date, datetime, timezone
from decimal import Decimal
import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    BomLine,
    Component,
    CustomerOrder,
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


def test_warehouse_unique_code_and_role_constraint(temp_session):
    w1 = Warehouse(code="WH-01", name="Plant 1", role="plant")
    temp_session.add(w1)
    temp_session.commit()

    # Duplicate code
    w_dup = Warehouse(code="WH-01", name="Plant Duplicate", role="regional")
    temp_session.add(w_dup)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()

    # Invalid role
    w_bad_role = Warehouse(code="WH-02", name="Bad Role Plant", role="floating")
    temp_session.add(w_bad_role)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()


def test_product_unique_sku_and_negative_price(temp_session):
    p1 = Product(sku="PROD-01", name="Laptop Alpha", selling_price=Decimal("999.99"))
    temp_session.add(p1)
    temp_session.commit()

    # Duplicate SKU
    p_dup = Product(sku="PROD-01", name="Laptop Beta", selling_price=Decimal("1200.00"))
    temp_session.add(p_dup)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()

    # Negative price
    p_neg = Product(sku="PROD-02", name="Negative Laptop", selling_price=Decimal("-10.00"))
    temp_session.add(p_neg)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()


def test_component_constraints(temp_session):
    # Invalid criticality
    c_bad = Component(
        sku="COMP-BAD",
        name="Bad Comp",
        category="processor",
        unit_of_measure="ea",
        criticality="ultra_critical",
    )
    temp_session.add(c_bad)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()


def test_bom_line_constraints_and_foreign_keys(temp_session):
    # Orphan foreign key (product_id = 9999 does not exist)
    c1 = Component(sku="C1", name="Comp 1", category="sensor", unit_of_measure="ea", criticality="normal")
    temp_session.add(c1)
    temp_session.commit()

    orphan_bom = BomLine(product_id=9999, component_id=c1.id, quantity_per_unit=2)
    temp_session.add(orphan_bom)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()

    # Negative quantity
    p1 = Product(sku="P1", name="Prod 1", selling_price=Decimal("500.00"))
    temp_session.add(p1)
    temp_session.commit()

    bad_qty_bom = BomLine(product_id=p1.id, component_id=c1.id, quantity_per_unit=-1)
    temp_session.add(bad_qty_bom)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()


def test_supplier_component_rate_and_cost_constraints(temp_session):
    s = Supplier(code="SUP-1", name="Supplier One", country="US")
    c = Component(sku="C-RATE", name="Component Rate", category="memory", unit_of_measure="ea", criticality="high")
    temp_session.add_all([s, c])
    temp_session.commit()

    # Rate outside 0..1 (1.5 is > 1.0)
    offer_bad_rate = SupplierComponent(
        supplier_id=s.id,
        component_id=c.id,
        unit_cost=Decimal("50.00"),
        lead_time_days=5,
        min_order_qty=10,
        expedite_cost_premium_pct=Decimal("1.5000"),
    )
    temp_session.add(offer_bad_rate)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()

    # Non-positive unit cost (0 or negative)
    offer_bad_cost = SupplierComponent(
        supplier_id=s.id,
        component_id=c.id,
        unit_cost=Decimal("0.00"),
        lead_time_days=5,
        min_order_qty=10,
    )
    temp_session.add(offer_bad_cost)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()


def test_inventory_level_negative_quantities(temp_session):
    w = Warehouse(code="WH-INV", name="Inv Warehouse", role="plant")
    c = Component(sku="C-INV", name="Inv Comp", category="display", unit_of_measure="ea", criticality="normal")
    temp_session.add_all([w, c])
    temp_session.commit()

    inv_neg = InventoryLevel(
        component_id=c.id,
        warehouse_id=w.id,
        on_hand=-5,
        reserved=0,
        as_of_ts=datetime.now(timezone.utc),
    )
    temp_session.add(inv_neg)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()


def test_purchase_order_line_received_exceeds_ordered(temp_session):
    s = Supplier(code="SUP-PO", name="PO Supplier", country="KR")
    w = Warehouse(code="WH-PO", name="PO Warehouse", role="plant")
    c = Component(sku="C-PO", name="PO Comp", category="storage", unit_of_measure="ea", criticality="normal")
    po = PurchaseOrder(
        po_number="PO-TEST-001",
        supplier=s,
        status="open",
        order_date=date(2026, 1, 1),
        promised_date=date(2026, 1, 15),
    )
    temp_session.add_all([s, w, c, po])
    temp_session.commit()

    # qty_received (150) > qty_ordered (100)
    bad_line = PurchaseOrderLine(
        purchase_order_id=po.id,
        component_id=c.id,
        warehouse_id=w.id,
        qty_ordered=100,
        qty_received=150,
        unit_price=Decimal("25.00"),
    )
    temp_session.add(bad_line)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()


def test_delivery_record_rejected_exceeds_received(temp_session):
    s = Supplier(code="SUP-DEL", name="Delivery Supplier", country="JP")
    c = Component(sku="C-DEL", name="Delivery Comp", category="battery", unit_of_measure="ea", criticality="critical")
    temp_session.add_all([s, c])
    temp_session.commit()

    # qty_rejected (50) > qty_received (30)
    bad_del = DeliveryRecord(
        supplier_id=s.id,
        component_id=c.id,
        promised_date=date(2026, 2, 1),
        actual_date=date(2026, 2, 2),
        qty_ordered=100,
        qty_received=30,
        qty_rejected=50,
    )
    temp_session.add(bad_del)
    with pytest.raises(IntegrityError):
        temp_session.commit()
    temp_session.rollback()
