"""Supplier Risk API routes. Read-only GET endpoints."""

from enum import Enum
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.supplier_risk import SupplierRiskDetailResponse, SupplierRiskListResponse
from app.services.supplier_risk import evaluate_all_suppliers, get_supplier_risk_detail

router = APIRouter(prefix="/supplier-risk", tags=["supplier-risk"])


class RiskBandFilter(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    unknown = "unknown"


@router.get("", response_model=SupplierRiskListResponse)
def get_supplier_risk_list(
    band: Optional[RiskBandFilter] = Query(default=None, description="Filter by risk band"),
    country: Optional[str] = Query(default=None, description="Filter by supplier country"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page (1..200)"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SupplierRiskListResponse:
    """Calculates supplier risk profiles for all suppliers with summary counts."""
    return evaluate_all_suppliers(
        session=db,
        settings=settings,
        band=band.value if band else None,
        country=country,
        limit=limit,
        offset=offset,
    )


@router.get("/{supplier_id}", response_model=SupplierRiskDetailResponse)
def get_single_supplier_risk(
    supplier_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SupplierRiskDetailResponse:
    """Retrieves full evaluation details, metric breakdown, and historical monthly trends for a supplier."""
    detail = get_supplier_risk_detail(
        supplier_id=supplier_id,
        session=db,
        settings=settings,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Supplier {supplier_id} not found")
    return detail
