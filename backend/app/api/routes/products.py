from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import BomLine, Product
from app.db.session import get_db
from app.schemas import BomLineComponentResponse, PaginatedEnvelope, ProductDetailResponse, ProductResponse

router = APIRouter(tags=["Products"])


@router.get("/products", response_model=PaginatedEnvelope[ProductResponse])
def list_products(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[ProductResponse]:
    total = db.scalar(select(func.count(Product.id))) or 0
    query = select(Product).order_by(Product.id.asc()).limit(limit).offset(offset)
    products = db.scalars(query).all()

    items = [ProductResponse.model_validate(p) for p in products]
    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)


@router.get("/products/{id}", response_model=ProductDetailResponse)
def get_product(
    id: int,
    db: Session = Depends(get_db),
) -> ProductDetailResponse:
    query = (
        select(Product)
        .options(selectinload(Product.bom_lines).selectinload(BomLine.component))
        .where(Product.id == id)
    )
    product = db.scalar(query)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product with id {id} not found")

    bom_lines_dto: List[BomLineComponentResponse] = []
    for bl in product.bom_lines:
        bom_lines_dto.append(
            BomLineComponentResponse(
                id=bl.id,
                component_id=bl.component_id,
                component_sku=bl.component.sku,
                component_name=bl.component.name,
                quantity_per_unit=bl.quantity_per_unit,
            )
        )

    return ProductDetailResponse(
        id=product.id,
        sku=product.sku,
        name=product.name,
        selling_price=product.selling_price,
        bom_lines=bom_lines_dto,
    )
