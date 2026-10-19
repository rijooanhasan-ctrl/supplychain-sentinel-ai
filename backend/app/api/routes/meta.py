from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
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
from app.schemas import DatasetMetaResponse

router = APIRouter(tags=["Metadata"])


@router.get("/meta", response_model=DatasetMetaResponse)
def get_metadata(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> DatasetMetaResponse:
    active_dataset = getattr(getattr(request, "app", None), "state", None) and getattr(request.app.state, "active_dataset", "demo") or "demo"
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))

    if meta is None:
        return DatasetMetaResponse(
            seeded=False,
            data_source=settings.DATA_SOURCE,
            label=None,
            seed=None,
            as_of=None,
            generator_version=None,
            generated_at=None,
            counts={
                "warehouses": 0,
                "products": 0,
                "components": 0,
                "bom_lines": 0,
                "suppliers": 0,
                "supplier_components": 0,
                "inventory_levels": 0,
                "purchase_orders": 0,
                "purchase_order_lines": 0,
                "customer_orders": 0,
                "demand_records": 0,
                "delivery_records": 0,
            },
            message="Database is not seeded yet.",
            display_currency=settings.DISPLAY_CURRENCY,
            usd_to_inr_rate=str(settings.USD_TO_INR_RATE) if settings.USD_TO_INR_RATE is not None else None,
            stored_currency="USD",
            active_dataset=active_dataset,
        )

    # Collect actual row counts
    counts = {
        "warehouses": db.scalar(select(func.count(Warehouse.id))) or 0,
        "products": db.scalar(select(func.count(Product.id))) or 0,
        "components": db.scalar(select(func.count(Component.id))) or 0,
        "bom_lines": db.scalar(select(func.count(BomLine.id))) or 0,
        "suppliers": db.scalar(select(func.count(Supplier.id))) or 0,
        "supplier_components": db.scalar(select(func.count(SupplierComponent.id))) or 0,
        "inventory_levels": db.scalar(select(func.count(InventoryLevel.id))) or 0,
        "purchase_orders": db.scalar(select(func.count(PurchaseOrder.id))) or 0,
        "purchase_order_lines": db.scalar(select(func.count(PurchaseOrderLine.id))) or 0,
        "customer_orders": db.scalar(select(func.count(CustomerOrder.id))) or 0,
        "demand_records": db.scalar(select(func.count(DemandRecord.id))) or 0,
        "delivery_records": db.scalar(select(func.count(DeliveryRecord.id))) or 0,
    }

    return DatasetMetaResponse(
        seeded=True,
        data_source=meta.source,
        label=meta.label,
        seed=meta.seed,
        as_of=meta.as_of,
        generator_version=meta.generator_version,
        generated_at=meta.generated_at,
        counts=counts,
        message=f"Dataset active: {meta.label} (source: {meta.source})",
        display_currency=settings.DISPLAY_CURRENCY,
        usd_to_inr_rate=str(settings.USD_TO_INR_RATE) if settings.USD_TO_INR_RATE is not None else None,
        stored_currency="USD",
        active_dataset=active_dataset,
    )
