from enum import Enum
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import CustomerOrder, Product
from app.db.session import get_db
from app.schemas import CustomerOrderResponse, PaginatedEnvelope

router = APIRouter(tags=["Customer Orders"])


class CustomerOrderStatusEnum(str, Enum):
    open = "open"
    in_production = "in_production"
    shipped = "shipped"
    cancelled = "cancelled"


class CustomerOrderPriorityEnum(str, Enum):
    critical = "critical"
    high = "high"
    normal = "normal"
    low = "low"


@router.get("/customer-orders", response_model=PaginatedEnvelope[CustomerOrderResponse])
def list_customer_orders(
    status: Optional[CustomerOrderStatusEnum] = Query(default=None, description="Filter by status"),
    priority: Optional[CustomerOrderPriorityEnum] = Query(default=None, description="Filter by priority"),
    product_id: Optional[int] = Query(default=None, description="Filter by product ID"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[CustomerOrderResponse]:
    filters = []
    if status is not None:
        filters.append(CustomerOrder.status == status.value)
    if priority is not None:
        filters.append(CustomerOrder.priority == priority.value)
    if product_id is not None:
        filters.append(CustomerOrder.product_id == product_id)

    count_query = select(func.count(CustomerOrder.id))
    if filters:
        count_query = count_query.where(*filters)
    total = db.scalar(count_query) or 0

    query = (
        select(CustomerOrder)
        .options(selectinload(CustomerOrder.product))
    )
    if filters:
        query = query.where(*filters)
    query = query.order_by(CustomerOrder.id.asc()).limit(limit).offset(offset)
    orders = db.scalars(query).all()

    items: List[CustomerOrderResponse] = []
    for co in orders:
        items.append(
            CustomerOrderResponse(
                id=co.id,
                order_number=co.order_number,
                customer_name=co.customer_name,
                product_id=co.product_id,
                product_sku=co.product.sku,
                product_name=co.product.name,
                quantity=co.quantity,
                due_date=co.due_date,
                priority=co.priority,
                status=co.status,
            )
        )

    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)
