from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Component, DeliveryRecord, Supplier
from app.db.session import get_db
from app.schemas import DeliveryRecordResponse, PaginatedEnvelope

router = APIRouter(tags=["Delivery Records"])


@router.get("/delivery-records", response_model=PaginatedEnvelope[DeliveryRecordResponse])
def list_delivery_records(
    supplier_id: Optional[int] = Query(default=None, description="Filter by supplier ID"),
    component_id: Optional[int] = Query(default=None, description="Filter by component ID"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[DeliveryRecordResponse]:
    filters = []
    if supplier_id is not None:
        filters.append(DeliveryRecord.supplier_id == supplier_id)
    if component_id is not None:
        filters.append(DeliveryRecord.component_id == component_id)

    count_query = select(func.count(DeliveryRecord.id))
    if filters:
        count_query = count_query.where(*filters)
    total = db.scalar(count_query) or 0

    query = (
        select(DeliveryRecord)
        .options(
            selectinload(DeliveryRecord.supplier),
            selectinload(DeliveryRecord.component),
        )
    )
    if filters:
        query = query.where(*filters)
    query = query.order_by(DeliveryRecord.id.asc()).limit(limit).offset(offset)
    records = db.scalars(query).all()

    items: List[DeliveryRecordResponse] = []
    for d in records:
        items.append(
            DeliveryRecordResponse(
                id=d.id,
                supplier_id=d.supplier_id,
                supplier_code=d.supplier.code,
                supplier_name=d.supplier.name,
                component_id=d.component_id,
                component_sku=d.component.sku,
                component_name=d.component.name,
                purchase_order_id=d.purchase_order_id,
                promised_date=d.promised_date,
                actual_date=d.actual_date,
                qty_ordered=d.qty_ordered,
                qty_received=d.qty_received,
                qty_rejected=d.qty_rejected,
            )
        )

    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)
