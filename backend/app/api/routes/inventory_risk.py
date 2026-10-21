"""FastAPI route handlers for Inventory Intelligence endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.inventory_risk import (
    InventoryRiskDetailResponse,
    InventoryRiskListResponse,
    RiskLevelEnum,
)
from app.services.inventory_risk import (
    get_inventory_risk_detail,
    list_inventory_risk,
)

router = APIRouter(tags=["Inventory Risk"])


@router.get("/inventory-risk", response_model=InventoryRiskListResponse)
def get_inventory_risks(
    risk_level: Optional[RiskLevelEnum] = Query(
        default=None,
        description="Filter by calculated risk level (critical, high, medium, low, none, unknown)",
    ),
    category: Optional[str] = Query(
        default=None,
        description="Filter by component category",
    ),
    criticality: Optional[str] = Query(
        default=None,
        description="Filter by component criticality (critical, high, normal)",
    ),
    include_inactive: bool = Query(
        default=False,
        description="Include inactive catalog components in evaluation",
    ),
    search: Optional[str] = Query(
        default=None,
        description="Search by component SKU or name",
    ),
    sort_by: Optional[str] = Query(
        default=None,
        description="Sort by field: coverage_days, shortage_date, plant_usable_stock, severity, sku",
    ),
    sort_dir: Optional[str] = Query(
        default="asc",
        description="Sort direction: asc or desc",
    ),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> InventoryRiskListResponse:
    """Evaluates and lists inventory risk across components with sorting, filtering, and summary metrics."""
    return list_inventory_risk(
        db=db,
        settings=settings,
        risk_level=risk_level,
        category=category,
        criticality=criticality,
        include_inactive=include_inactive,
        search=search,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/inventory-risk/{component_id}",
    response_model=InventoryRiskDetailResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "Component not found",
            "content": {"application/json": {"example": {"detail": "Component with id 999 not found"}}},
        }
    },
)
def get_single_component_inventory_risk(
    component_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> InventoryRiskDetailResponse:
    """Evaluates and returns comprehensive inventory risk, 60-day stock projection, and replenishment details for a component."""
    detail = get_inventory_risk_detail(
        component_id=component_id,
        db=db,
        settings=settings,
    )
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Component with id {component_id} not found",
        )
    return detail
