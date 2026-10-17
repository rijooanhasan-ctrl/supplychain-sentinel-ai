from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Component, InventoryLevel, Warehouse
from app.db.session import get_db
from app.schemas import InventoryItemResponse, PaginatedEnvelope

router = APIRouter(tags=["Inventory"])


@router.get("/inventory", response_model=PaginatedEnvelope[InventoryItemResponse])
def list_inventory(
    component_id: Optional[int] = Query(default=None, description="Filter by component ID"),
    warehouse_id: Optional[int] = Query(default=None, description="Filter by warehouse ID"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[InventoryItemResponse]:
    filters = []
    if component_id is not None:
        filters.append(InventoryLevel.component_id == component_id)
    if warehouse_id is not None:
        filters.append(InventoryLevel.warehouse_id == warehouse_id)

    count_query = select(func.count(InventoryLevel.id))
    if filters:
        count_query = count_query.where(*filters)
    total = db.scalar(count_query) or 0

    query = (
        select(InventoryLevel)
        .options(
            selectinload(InventoryLevel.component),
            selectinload(InventoryLevel.warehouse),
        )
    )
    if filters:
        query = query.where(*filters)
    query = query.order_by(InventoryLevel.id.asc()).limit(limit).offset(offset)
    records = db.scalars(query).all()

    items: List[InventoryItemResponse] = []
    for r in records:
        items.append(
            InventoryItemResponse(
                id=r.id,
                component_id=r.component_id,
                component_sku=r.component.sku,
                component_name=r.component.name,
                warehouse_id=r.warehouse_id,
                warehouse_code=r.warehouse.code,
                warehouse_name=r.warehouse.name,
                on_hand=r.on_hand,
                reserved=r.reserved,
                as_of_ts=r.as_of_ts,
            )
        )

    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)
