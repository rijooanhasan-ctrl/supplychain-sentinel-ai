"""app/api/routes/integration_status.py

Endpoint providing honest, transparent integration status and connector capabilities.
Zero live SAP connection claims.
"""

from __future__ import annotations

from typing import Any, Dict, List
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
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
from app.db.session import get_db
from app.integrations.sap_sample_adapter import SAP_DISCLAIMER_TEXT, SapSampleAdapter

router = APIRouter(tags=["Integration"])


class IntegrationStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    active_source: str
    is_live: bool
    label: str
    entities_covered: List[str]
    entities_missing: List[str]
    notes: Dict[str, str]
    disclaimer: str
    active_dataset: str = "demo"


ALL_STANDARD_ENTITIES = [
    "warehouses",
    "products",
    "components",
    "bom_lines",
    "suppliers",
    "supplier_components",
    "inventory_levels",
    "purchase_orders",
    "purchase_order_lines",
    "customer_orders",
    "demand_records",
    "delivery_records",
]


@router.get("/integration-status", response_model=IntegrationStatusResponse)
def get_integration_status(
    request: Request,
    db: Session = Depends(get_db),
) -> IntegrationStatusResponse:
    """Return the active data connector status, entity coverage, and mandatory SAP connectivity disclaimer."""
    active_dataset = getattr(getattr(request, "app", None), "state", None) and getattr(request.app.state, "active_dataset", "demo") or "demo"
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))

    active_source = meta.source if meta and meta.source else "demo"
    label = meta.label if meta and meta.label else "DEMO DATA"

    if active_source == "file-import":
        # Determine actual stored entity coverage
        table_checks = [
            ("warehouses", Warehouse),
            ("products", Product),
            ("components", Component),
            ("bom_lines", BomLine),
            ("suppliers", Supplier),
            ("supplier_components", SupplierComponent),
            ("inventory_levels", InventoryLevel),
            ("purchase_orders", PurchaseOrder),
            ("purchase_order_lines", PurchaseOrderLine),
            ("customer_orders", CustomerOrder),
            ("demand_records", DemandRecord),
            ("delivery_records", DeliveryRecord),
        ]
        covered: List[str] = []
        missing: List[str] = []
        for name, model_cls in table_checks:
            has_rows = db.scalar(select(model_cls.id).limit(1)) is not None
            if has_rows:
                covered.append(name)
            else:
                missing.append(name)

        notes: Dict[str, str] = {
            "connector_type": "User-supplied CSV file import via CLI. Decision support only; not a live connection.",
        }
        if "demand_records" in missing:
            notes["demand_records"] = "no demand_history.csv: demand forecasts and shortage projections will show 'insufficient history'"
        if "supplier_components" in missing:
            notes["supplier_components"] = "no supplier_offers.csv: no recovery options"
        if "delivery_records" in missing:
            notes["delivery_records"] = "no delivery_history.csv: supplier risk unknown"
        if any(e in missing for e in ("customer_orders", "bom_lines", "products")):
            notes["customer_exposure"] = "no customer_orders/bom/products: exposed-orders figures unavailable"
        if "purchase_orders" in missing:
            notes["purchase_orders"] = "no purchase_orders.csv: inbound pipeline visibility unavailable"

        return IntegrationStatusResponse(
            active_source="file-import",
            is_live=False,
            label=label,
            entities_covered=covered,
            entities_missing=missing,
            notes=notes,
            disclaimer=SAP_DISCLAIMER_TEXT,
            active_dataset=active_dataset,
        )

    if active_source == "sap-style-sample":
        adapter = SapSampleAdapter()
        rep = adapter.get_coverage_report()
        return IntegrationStatusResponse(
            active_source="sap-style-sample",
            is_live=False,
            label=label,
            entities_covered=rep["entities_covered"],
            entities_missing=rep["entities_missing"],
            notes=rep.get("notes", {}),
            disclaimer=SAP_DISCLAIMER_TEXT,
            active_dataset=active_dataset,
        )

    # Demo source: full synthetic coverage
    return IntegrationStatusResponse(
        active_source=active_source,
        is_live=False,
        label=label,
        entities_covered=ALL_STANDARD_ENTITIES,
        entities_missing=[],
        notes={
            "connector_type": "Synthetic internal demo generator with fully simulated supply chain entities."
        },
        disclaimer=SAP_DISCLAIMER_TEXT,
        active_dataset=active_dataset,
    )

