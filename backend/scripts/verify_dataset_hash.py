import hashlib
import json
import sys
from pathlib import Path

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, select

from app.core.config import get_settings
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


def compute_dataset_hash(database_url: str | None = None) -> str:
    url = database_url or get_settings().DATABASE_URL
    engine = create_engine(url)

    hasher = hashlib.sha256()

    with engine.connect() as conn:
        # 1. Warehouses
        wh_rows = conn.execute(
            select(Warehouse.code, Warehouse.name, Warehouse.role).order_by(Warehouse.code)
        ).fetchall()
        hasher.update(json.dumps([list(r) for r in wh_rows], sort_keys=True).encode("utf-8"))

        # 2. Products
        prod_rows = conn.execute(
            select(Product.sku, Product.name, Product.selling_price).order_by(Product.sku)
        ).fetchall()
        hasher.update(json.dumps([[r[0], r[1], str(r[2])] for r in prod_rows], sort_keys=True).encode("utf-8"))

        # 3. Components
        comp_rows = conn.execute(
            select(
                Component.sku,
                Component.name,
                Component.category,
                Component.unit_of_measure,
                Component.criticality,
                Component.is_active,
            ).order_by(Component.sku)
        ).fetchall()
        hasher.update(json.dumps([list(r) for r in comp_rows], sort_keys=True).encode("utf-8"))

        # 4. BOM lines
        bom_rows = conn.execute(
            select(Product.sku, Component.sku, BomLine.quantity_per_unit)
            .join(Product, BomLine.product_id == Product.id)
            .join(Component, BomLine.component_id == Component.id)
            .order_by(Product.sku, Component.sku)
        ).fetchall()
        hasher.update(json.dumps([list(r) for r in bom_rows], sort_keys=True).encode("utf-8"))

        # 5. Suppliers
        sup_rows = conn.execute(
            select(Supplier.code, Supplier.name, Supplier.country).order_by(Supplier.code)
        ).fetchall()
        hasher.update(json.dumps([list(r) for r in sup_rows], sort_keys=True).encode("utf-8"))

        # 6. Supplier Components
        sc_rows = conn.execute(
            select(
                Supplier.code,
                Component.sku,
                SupplierComponent.unit_cost,
                SupplierComponent.lead_time_days,
                SupplierComponent.min_order_qty,
                SupplierComponent.max_weekly_capacity,
                SupplierComponent.is_preferred,
                SupplierComponent.expedite_available,
                SupplierComponent.expedite_lead_time_days,
                SupplierComponent.expedite_cost_premium_pct,
            )
            .join(Supplier, SupplierComponent.supplier_id == Supplier.id)
            .join(Component, SupplierComponent.component_id == Component.id)
            .order_by(Supplier.code, Component.sku)
        ).fetchall()
        sc_normalized = [
            [
                r[0],
                r[1],
                str(r[2]),
                r[3],
                r[4],
                r[5],
                r[6],
                r[7],
                r[8],
                str(r[9]) if r[9] is not None else None,
            ]
            for r in sc_rows
        ]
        hasher.update(json.dumps(sc_normalized, sort_keys=True).encode("utf-8"))

        # 7. Inventory Levels
        inv_rows = conn.execute(
            select(
                Component.sku,
                Warehouse.code,
                InventoryLevel.on_hand,
                InventoryLevel.reserved,
                InventoryLevel.as_of_ts,
            )
            .join(Component, InventoryLevel.component_id == Component.id)
            .join(Warehouse, InventoryLevel.warehouse_id == Warehouse.id)
            .order_by(Component.sku, Warehouse.code)
        ).fetchall()
        inv_normalized = [
            [r[0], r[1], r[2], r[3], r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4])]
            for r in inv_rows
        ]
        hasher.update(json.dumps(inv_normalized, sort_keys=True).encode("utf-8"))

        # 8. Purchase Orders
        po_rows = conn.execute(
            select(
                PurchaseOrder.po_number,
                Supplier.code,
                PurchaseOrder.status,
                PurchaseOrder.order_date,
                PurchaseOrder.promised_date,
                PurchaseOrder.latest_estimate_date,
            )
            .join(Supplier, PurchaseOrder.supplier_id == Supplier.id)
            .order_by(PurchaseOrder.po_number)
        ).fetchall()
        po_normalized = [
            [
                r[0],
                r[1],
                r[2],
                r[3].isoformat() if hasattr(r[3], "isoformat") else str(r[3]),
                r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4]),
                r[5].isoformat() if r[5] is not None and hasattr(r[5], "isoformat") else str(r[5]),
            ]
            for r in po_rows
        ]
        hasher.update(json.dumps(po_normalized, sort_keys=True).encode("utf-8"))

        # 9. Purchase Order Lines
        pol_rows = conn.execute(
            select(
                PurchaseOrder.po_number,
                Component.sku,
                Warehouse.code,
                PurchaseOrderLine.qty_ordered,
                PurchaseOrderLine.qty_received,
                PurchaseOrderLine.unit_price,
            )
            .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
            .join(Component, PurchaseOrderLine.component_id == Component.id)
            .join(Warehouse, PurchaseOrderLine.warehouse_id == Warehouse.id)
            .order_by(PurchaseOrder.po_number, Component.sku, Warehouse.code)
        ).fetchall()
        pol_normalized = [
            [r[0], r[1], r[2], r[3], r[4], str(r[5])] for r in pol_rows
        ]
        hasher.update(json.dumps(pol_normalized, sort_keys=True).encode("utf-8"))

        # 10. Customer Orders
        co_rows = conn.execute(
            select(
                CustomerOrder.order_number,
                CustomerOrder.customer_name,
                Product.sku,
                CustomerOrder.quantity,
                CustomerOrder.due_date,
                CustomerOrder.priority,
                CustomerOrder.status,
            )
            .join(Product, CustomerOrder.product_id == Product.id)
            .order_by(CustomerOrder.order_number)
        ).fetchall()
        co_normalized = [
            [
                r[0],
                r[1],
                r[2],
                r[3],
                r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4]),
                r[5],
                r[6],
            ]
            for r in co_rows
        ]
        hasher.update(json.dumps(co_normalized, sort_keys=True).encode("utf-8"))

        # 11. Demand Records
        dr_rows = conn.execute(
            select(Component.sku, DemandRecord.date, DemandRecord.quantity)
            .join(Component, DemandRecord.component_id == Component.id)
            .order_by(Component.sku, DemandRecord.date)
        ).fetchall()
        dr_normalized = [
            [r[0], r[1].isoformat() if hasattr(r[1], "isoformat") else str(r[1]), r[2]]
            for r in dr_rows
        ]
        hasher.update(json.dumps(dr_normalized, sort_keys=True).encode("utf-8"))

        # 12. Delivery Records
        dlv_rows = conn.execute(
            select(
                Supplier.code,
                Component.sku,
                DeliveryRecord.promised_date,
                DeliveryRecord.actual_date,
                DeliveryRecord.qty_ordered,
                DeliveryRecord.qty_received,
                DeliveryRecord.qty_rejected,
            )
            .join(Supplier, DeliveryRecord.supplier_id == Supplier.id)
            .join(Component, DeliveryRecord.component_id == Component.id)
            .order_by(
                Supplier.code,
                Component.sku,
                DeliveryRecord.promised_date,
                DeliveryRecord.actual_date,
                DeliveryRecord.qty_ordered,
                DeliveryRecord.qty_received,
                DeliveryRecord.qty_rejected,
            )
        ).fetchall()
        dlv_normalized = [
            [
                r[0],
                r[1],
                r[2].isoformat() if hasattr(r[2], "isoformat") else str(r[2]),
                r[3].isoformat() if hasattr(r[3], "isoformat") else str(r[3]),
                r[4],
                r[5],
                r[6],
            ]
            for r in dlv_rows
        ]
        hasher.update(json.dumps(dlv_normalized, sort_keys=True).encode("utf-8"))

    return hasher.hexdigest()


if __name__ == "__main__":
    db_url = sys.argv[1] if len(sys.argv) > 1 else None
    h = compute_dataset_hash(db_url)
    print(f"Dataset SHA-256 (12 tables): {h}")
