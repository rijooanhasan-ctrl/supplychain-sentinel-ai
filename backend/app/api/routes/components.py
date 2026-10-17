from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    Component,
    DemandRecord,
    InventoryLevel,
    Supplier,
    SupplierComponent,
    Warehouse,
)
from app.db.session import get_db
from app.schemas import (
    ComponentDetailResponse,
    ComponentInventoryResponse,
    ComponentResponse,
    DemandHistoryResponse,
    DemandRecordResponse,
    PaginatedEnvelope,
    SupplierComponentResponse,
)

router = APIRouter(tags=["Components"])


@router.get("/components", response_model=PaginatedEnvelope[ComponentResponse])
def list_components(
    category: Optional[str] = Query(default=None, description="Filter by category"),
    q: Optional[str] = Query(default=None, description="Search query across SKU or name"),
    is_active: Optional[bool] = Query(default=None, description="Filter by active status"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[ComponentResponse]:
    filters = []
    if category is not None:
        filters.append(Component.category == category)
    if is_active is not None:
        filters.append(Component.is_active == is_active)
    if q is not None and q.strip():
        search_pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                Component.sku.ilike(search_pattern),
                Component.name.ilike(search_pattern),
            )
        )

    count_query = select(func.count(Component.id))
    if filters:
        count_query = count_query.where(*filters)
    total = db.scalar(count_query) or 0

    query = select(Component)
    if filters:
        query = query.where(*filters)
    query = query.order_by(Component.id.asc()).limit(limit).offset(offset)
    components = db.scalars(query).all()

    items = [ComponentResponse.model_validate(c) for c in components]
    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)


@router.get("/components/{id}", response_model=ComponentDetailResponse)
def get_component(
    id: int,
    db: Session = Depends(get_db),
) -> ComponentDetailResponse:
    query = (
        select(Component)
        .options(
            selectinload(Component.supplier_offers).selectinload(SupplierComponent.supplier),
            selectinload(Component.inventory_levels).selectinload(InventoryLevel.warehouse),
        )
        .where(Component.id == id)
    )
    component = db.scalar(query)
    if component is None:
        raise HTTPException(status_code=404, detail=f"Component with id {id} not found")

    supplier_offers_dto: List[SupplierComponentResponse] = []
    for sc in component.supplier_offers:
        supplier_offers_dto.append(
            SupplierComponentResponse(
                id=sc.id,
                supplier_id=sc.supplier_id,
                supplier_code=sc.supplier.code,
                supplier_name=sc.supplier.name,
                unit_cost=sc.unit_cost,
                lead_time_days=sc.lead_time_days,
                min_order_qty=sc.min_order_qty,
                max_weekly_capacity=sc.max_weekly_capacity,
                is_preferred=sc.is_preferred,
                expedite_available=sc.expedite_available,
                expedite_lead_time_days=sc.expedite_lead_time_days,
                expedite_cost_premium_pct=sc.expedite_cost_premium_pct,
            )
        )

    inventory_dto: List[ComponentInventoryResponse] = []
    for inv in component.inventory_levels:
        inventory_dto.append(
            ComponentInventoryResponse(
                id=inv.id,
                warehouse_id=inv.warehouse_id,
                warehouse_code=inv.warehouse.code,
                warehouse_name=inv.warehouse.name,
                on_hand=inv.on_hand,
                reserved=inv.reserved,
                as_of_ts=inv.as_of_ts,
            )
        )

    return ComponentDetailResponse(
        id=component.id,
        sku=component.sku,
        name=component.name,
        category=component.category,
        unit_of_measure=component.unit_of_measure,
        criticality=component.criticality,
        is_active=component.is_active,
        supplier_offers=supplier_offers_dto,
        inventory=inventory_dto,
    )


@router.get("/components/{id}/demand-history", response_model=DemandHistoryResponse)
def get_component_demand_history(
    id: int,
    days: int = Query(default=90, ge=1, le=365, description="Number of recent days of history"),
    db: Session = Depends(get_db),
) -> DemandHistoryResponse:
    # Verify component exists
    exists = db.scalar(select(Component.id).where(Component.id == id))
    if exists is None:
        raise HTTPException(status_code=404, detail=f"Component with id {id} not found")

    # Fetch the most recent N days of stored data, then return in ascending order
    subq = (
        select(DemandRecord)
        .where(DemandRecord.component_id == id)
        .order_by(DemandRecord.date.desc())
        .limit(days)
    )
    records = db.scalars(subq).all()
    # Sort ascending by date as required
    ascending_records = sorted(records, key=lambda r: r.date)

    items = [
        DemandRecordResponse(
            id=r.id,
            component_id=r.component_id,
            date=r.date,
            quantity=r.quantity,
        )
        for r in ascending_records
    ]
    return DemandHistoryResponse(items=items, total=len(items), days=days)
