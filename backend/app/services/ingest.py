from typing import Dict
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

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
from app.integrations.base import SourceDataset


def load_dataset(session: Session, dataset: SourceDataset, *, reset: bool = False) -> Dict[str, int]:
    """
    Loads a SourceDataset into the relational database.
    Resolves business keys to integer IDs, validates all references, and enforces
    all-or-nothing transactional guarantees.
    """
    # Check if database already has data
    existing_meta = session.scalar(select(DatasetMeta).limit(1))
    existing_warehouses = session.scalar(select(Warehouse).limit(1))

    if (existing_meta is not None or existing_warehouses is not None) and not reset:
        raise RuntimeError(
            "Database already contains data. Pass reset=True (or --reset CLI flag) to overwrite existing dataset."
        )

    # Use a transaction block for all-or-nothing
    try:
        if reset:
            # Delete in reverse foreign-key order
            session.execute(delete(DeliveryRecord))
            session.execute(delete(DemandRecord))
            session.execute(delete(CustomerOrder))
            session.execute(delete(PurchaseOrderLine))
            session.execute(delete(PurchaseOrder))
            session.execute(delete(InventoryLevel))
            session.execute(delete(SupplierComponent))
            session.execute(delete(BomLine))
            session.execute(delete(Component))
            session.execute(delete(Product))
            session.execute(delete(Supplier))
            session.execute(delete(Warehouse))
            session.execute(delete(DatasetMeta))
            session.flush()

        counts: Dict[str, int] = {}

        # 1. DatasetMeta
        db_meta = DatasetMeta(
            label=dataset.meta.label,
            source=dataset.meta.source,
            seed=dataset.meta.seed,
            as_of=dataset.meta.as_of,
            generator_version=dataset.meta.generator_version,
            generated_at=dataset.meta.generated_at,
        )
        session.add(db_meta)
        session.flush()
        counts["dataset_meta"] = 1

        # 2. Warehouses
        wh_map: Dict[str, int] = {}
        for w in dataset.warehouses:
            wh_obj = Warehouse(code=w.code, name=w.name, role=w.role)
            session.add(wh_obj)
            session.flush()
            wh_map[w.code] = wh_obj.id
        counts["warehouses"] = len(dataset.warehouses)

        # 3. Products
        prod_map: Dict[str, int] = {}
        for p in dataset.products:
            p_obj = Product(sku=p.sku, name=p.name, selling_price=p.selling_price)
            session.add(p_obj)
            session.flush()
            prod_map[p.sku] = p_obj.id
        counts["products"] = len(dataset.products)

        # 4. Components
        comp_map: Dict[str, int] = {}
        for c in dataset.components:
            c_obj = Component(
                sku=c.sku,
                name=c.name,
                category=c.category,
                unit_of_measure=c.unit_of_measure,
                criticality=c.criticality,
                is_active=c.is_active,
            )
            session.add(c_obj)
            session.flush()
            comp_map[c.sku] = c_obj.id
        counts["components"] = len(dataset.components)

        # 5. BOM Lines
        for b in dataset.bom_lines:
            if b.product_sku not in prod_map:
                raise ValueError(f"Unknown product SKU '{b.product_sku}' in BOM line")
            if b.component_sku not in comp_map:
                raise ValueError(f"Unknown component SKU '{b.component_sku}' in BOM line")
            bom_obj = BomLine(
                product_id=prod_map[b.product_sku],
                component_id=comp_map[b.component_sku],
                quantity_per_unit=b.quantity_per_unit,
            )
            session.add(bom_obj)
        session.flush()
        counts["bom_lines"] = len(dataset.bom_lines)

        # 6. Suppliers
        sup_map: Dict[str, int] = {}
        for s in dataset.suppliers:
            s_obj = Supplier(code=s.code, name=s.name, country=s.country)
            session.add(s_obj)
            session.flush()
            sup_map[s.code] = s_obj.id
        counts["suppliers"] = len(dataset.suppliers)

        # 7. Supplier Components (Offers)
        for sc in dataset.supplier_components:
            if sc.supplier_code not in sup_map:
                raise ValueError(f"Unknown supplier code '{sc.supplier_code}' in offer")
            if sc.component_sku not in comp_map:
                raise ValueError(f"Unknown component SKU '{sc.component_sku}' in offer")
            sc_obj = SupplierComponent(
                supplier_id=sup_map[sc.supplier_code],
                component_id=comp_map[sc.component_sku],
                unit_cost=sc.unit_cost,
                lead_time_days=sc.lead_time_days,
                min_order_qty=sc.min_order_qty,
                max_weekly_capacity=sc.max_weekly_capacity,
                is_preferred=sc.is_preferred,
                expedite_available=sc.expedite_available,
                expedite_lead_time_days=sc.expedite_lead_time_days,
                expedite_cost_premium_pct=sc.expedite_cost_premium_pct,
            )
            session.add(sc_obj)
        session.flush()
        counts["supplier_components"] = len(dataset.supplier_components)

        # 8. Inventory Levels
        for inv in dataset.inventory_levels:
            if inv.component_sku not in comp_map:
                raise ValueError(f"Unknown component SKU '{inv.component_sku}' in inventory")
            if inv.warehouse_code not in wh_map:
                raise ValueError(f"Unknown warehouse code '{inv.warehouse_code}' in inventory")
            inv_obj = InventoryLevel(
                component_id=comp_map[inv.component_sku],
                warehouse_id=wh_map[inv.warehouse_code],
                on_hand=inv.on_hand,
                reserved=inv.reserved,
                as_of_ts=inv.as_of_ts,
            )
            session.add(inv_obj)
        session.flush()
        counts["inventory_levels"] = len(dataset.inventory_levels)

        # 9. Purchase Orders & Lines
        po_map: Dict[str, int] = {}
        total_po_lines = 0
        for po in dataset.purchase_orders:
            if po.supplier_code not in sup_map:
                raise ValueError(f"Unknown supplier code '{po.supplier_code}' in purchase order")
            po_obj = PurchaseOrder(
                po_number=po.po_number,
                supplier_id=sup_map[po.supplier_code],
                status=po.status,
                order_date=po.order_date,
                promised_date=po.promised_date,
                latest_estimate_date=po.latest_estimate_date,
            )
            session.add(po_obj)
            session.flush()
            po_map[po.po_number] = po_obj.id

            for line in po.lines:
                if line.component_sku not in comp_map:
                    raise ValueError(f"Unknown component SKU '{line.component_sku}' in PO line")
                if line.warehouse_code not in wh_map:
                    raise ValueError(f"Unknown warehouse code '{line.warehouse_code}' in PO line")
                pol_obj = PurchaseOrderLine(
                    purchase_order_id=po_obj.id,
                    component_id=comp_map[line.component_sku],
                    warehouse_id=wh_map[line.warehouse_code],
                    qty_ordered=line.qty_ordered,
                    qty_received=line.qty_received,
                    unit_price=line.unit_price,
                )
                session.add(pol_obj)
                total_po_lines += 1
        session.flush()
        counts["purchase_orders"] = len(dataset.purchase_orders)
        counts["purchase_order_lines"] = total_po_lines

        # 10. Customer Orders
        for co in dataset.customer_orders:
            if co.product_sku not in prod_map:
                raise ValueError(f"Unknown product SKU '{co.product_sku}' in customer order")
            co_obj = CustomerOrder(
                order_number=co.order_number,
                customer_name=co.customer_name,
                product_id=prod_map[co.product_sku],
                quantity=co.quantity,
                due_date=co.due_date,
                priority=co.priority,
                status=co.status,
            )
            session.add(co_obj)
        session.flush()
        counts["customer_orders"] = len(dataset.customer_orders)

        # 11. Demand Records
        for dr in dataset.demand_records:
            if dr.component_sku not in comp_map:
                raise ValueError(f"Unknown component SKU '{dr.component_sku}' in demand record")
            dr_obj = DemandRecord(
                component_id=comp_map[dr.component_sku],
                date=dr.date,
                quantity=dr.quantity,
            )
            session.add(dr_obj)
        session.flush()
        counts["demand_records"] = len(dataset.demand_records)

        # 12. Delivery Records
        for dlv in dataset.delivery_records:
            if dlv.supplier_code not in sup_map:
                raise ValueError(f"Unknown supplier code '{dlv.supplier_code}' in delivery record")
            if dlv.component_sku not in comp_map:
                raise ValueError(f"Unknown component SKU '{dlv.component_sku}' in delivery record")
            po_id = po_map.get(dlv.po_number) if dlv.po_number else None
            dlv_obj = DeliveryRecord(
                supplier_id=sup_map[dlv.supplier_code],
                component_id=comp_map[dlv.component_sku],
                purchase_order_id=po_id,
                promised_date=dlv.promised_date,
                actual_date=dlv.actual_date,
                qty_ordered=dlv.qty_ordered,
                qty_received=dlv.qty_received,
                qty_rejected=dlv.qty_rejected,
            )
            session.add(dlv_obj)
        session.flush()
        counts["delivery_records"] = len(dataset.delivery_records)

        session.commit()
        return counts

    except Exception:
        session.rollback()
        raise
