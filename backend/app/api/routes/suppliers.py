from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Component, Supplier, SupplierComponent
from app.db.session import get_db
from app.schemas import (
    PaginatedEnvelope,
    SupplierDetailResponse,
    SupplierOfferResponse,
    SupplierResponse,
)

router = APIRouter(tags=["Suppliers"])


@router.get("/suppliers", response_model=PaginatedEnvelope[SupplierResponse])
def list_suppliers(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[SupplierResponse]:
    total = db.scalar(select(func.count(Supplier.id))) or 0
    query = select(Supplier).order_by(Supplier.id.asc()).limit(limit).offset(offset)
    suppliers = db.scalars(query).all()

    items = [SupplierResponse.model_validate(s) for s in suppliers]
    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)


@router.get("/suppliers/{id}", response_model=SupplierDetailResponse)
def get_supplier(
    id: int,
    db: Session = Depends(get_db),
) -> SupplierDetailResponse:
    query = (
        select(Supplier)
        .options(selectinload(Supplier.offers).selectinload(SupplierComponent.component))
        .where(Supplier.id == id)
    )
    supplier = db.scalar(query)
    if supplier is None:
        raise HTTPException(status_code=404, detail=f"Supplier with id {id} not found")

    offers_dto: List[SupplierOfferResponse] = []
    for sc in supplier.offers:
        offers_dto.append(
            SupplierOfferResponse(
                id=sc.id,
                component_id=sc.component_id,
                component_sku=sc.component.sku,
                component_name=sc.component.name,
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

    return SupplierDetailResponse(
        id=supplier.id,
        code=supplier.code,
        name=supplier.name,
        country=supplier.country,
        offers=offers_dto,
    )
