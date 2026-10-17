from enum import Enum
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Component, PurchaseOrder, PurchaseOrderLine, Supplier, Warehouse
from app.db.session import get_db
from app.schemas import (
    PaginatedEnvelope,
    PurchaseOrderDetailResponse,
    PurchaseOrderLineResponse,
    PurchaseOrderResponse,
)

router = APIRouter(tags=["Purchase Orders"])


class POStatusEnum(str, Enum):
    open = "open"
    in_transit = "in_transit"
    partially_received = "partially_received"
    received = "received"
    cancelled = "cancelled"


@router.get("/purchase-orders", response_model=PaginatedEnvelope[PurchaseOrderResponse])
def list_purchase_orders(
    status: Optional[POStatusEnum] = Query(default=None, description="Filter by status"),
    supplier_id: Optional[int] = Query(default=None, description="Filter by supplier ID"),
    component_id: Optional[int] = Query(default=None, description="Filter by component ID in lines"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[PurchaseOrderResponse]:
    filters = []
    if status is not None:
        filters.append(PurchaseOrder.status == status.value)
    if supplier_id is not None:
        filters.append(PurchaseOrder.supplier_id == supplier_id)
    if component_id is not None:
        filters.append(PurchaseOrder.lines.any(PurchaseOrderLine.component_id == component_id))

    count_query = select(func.count(PurchaseOrder.id))
    if filters:
        count_query = count_query.where(*filters)
    total = db.scalar(count_query) or 0

    query = select(PurchaseOrder).options(selectinload(PurchaseOrder.supplier))
    if filters:
        query = query.where(*filters)
    query = query.order_by(PurchaseOrder.id.asc()).limit(limit).offset(offset)
    pos = db.scalars(query).all()

    items: List[PurchaseOrderResponse] = []
    for po in pos:
        items.append(
            PurchaseOrderResponse(
                id=po.id,
                po_number=po.po_number,
                supplier_id=po.supplier_id,
                supplier_code=po.supplier.code,
                supplier_name=po.supplier.name,
                status=po.status,
                order_date=po.order_date,
                promised_date=po.promised_date,
                latest_estimate_date=po.latest_estimate_date,
            )
        )

    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)


@router.get("/purchase-orders/{id}", response_model=PurchaseOrderDetailResponse)
def get_purchase_order(
    id: int,
    db: Session = Depends(get_db),
) -> PurchaseOrderDetailResponse:
    query = (
        select(PurchaseOrder)
        .options(
            selectinload(PurchaseOrder.supplier),
            selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.component),
            selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.warehouse),
        )
        .where(PurchaseOrder.id == id)
    )
    po = db.scalar(query)
    if po is None:
        raise HTTPException(status_code=404, detail=f"Purchase order with id {id} not found")

    lines_dto: List[PurchaseOrderLineResponse] = []
    for line in po.lines:
        lines_dto.append(
            PurchaseOrderLineResponse(
                id=line.id,
                component_id=line.component_id,
                component_sku=line.component.sku,
                component_name=line.component.name,
                warehouse_id=line.warehouse_id,
                warehouse_code=line.warehouse.code,
                warehouse_name=line.warehouse.name,
                qty_ordered=line.qty_ordered,
                qty_received=line.qty_received,
                unit_price=line.unit_price,
            )
        )

    return PurchaseOrderDetailResponse(
        id=po.id,
        po_number=po.po_number,
        supplier_id=po.supplier_id,
        supplier_code=po.supplier.code,
        supplier_name=po.supplier.name,
        status=po.status,
        order_date=po.order_date,
        promised_date=po.promised_date,
        latest_estimate_date=po.latest_estimate_date,
        lines=lines_dto,
    )
