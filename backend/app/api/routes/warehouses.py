from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Warehouse
from app.db.session import get_db
from app.schemas import PaginatedEnvelope, WarehouseResponse

router = APIRouter(tags=["Warehouses"])


@router.get("/warehouses", response_model=PaginatedEnvelope[WarehouseResponse])
def list_warehouses(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
) -> PaginatedEnvelope[WarehouseResponse]:
    total = db.scalar(select(func.count(Warehouse.id))) or 0
    query = select(Warehouse).order_by(Warehouse.id.asc()).limit(limit).offset(offset)
    warehouses = db.scalars(query).all()

    items = [WarehouseResponse.model_validate(w) for w in warehouses]
    return PaginatedEnvelope(items=items, total=total, limit=limit, offset=offset)
