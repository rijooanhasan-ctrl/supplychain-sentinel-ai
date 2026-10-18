"""FastAPI route handlers for Disruption Detection and Alerting endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.alerts import (
    AlertDetailResponse,
    AlertListResponse,
    AlertSeverityEnum,
    AlertTypeEnum,
)
from app.services.alerts import get_alert_detail, list_alerts

router = APIRouter(tags=["Alerts"])


@router.get("/alerts", response_model=AlertListResponse)
def get_alerts(
    severity: Optional[AlertSeverityEnum] = Query(
        default=None,
        description="Filter by alert severity (critical, high, medium, low, info)",
    ),
    type: Optional[AlertTypeEnum] = Query(
        default=None,
        description="Filter by alert disruption type",
    ),
    component_id: Optional[int] = Query(
        default=None,
        description="Filter by component ID",
    ),
    supplier_id: Optional[int] = Query(
        default=None,
        description="Filter by supplier ID",
    ),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page (1..200)"),
    offset: int = Query(default=0, ge=0, description="Items offset"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AlertListResponse:
    """Lists disruption alerts with server-side filtering, pagination, and overall summary counts."""
    return list_alerts(
        db=db,
        settings=settings,
        severity=severity,
        alert_type=type,
        component_id=component_id,
        supplier_id=supplier_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/alerts/{alert_id:path}",
    response_model=AlertDetailResponse,
    responses={
        404: {"description": "Alert not found"},
    },
)
def get_alert_by_id(
    alert_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AlertDetailResponse:
    """Retrieves full detail of a specific disruption alert including evidence, assumptions, impact, and scenarios."""
    detail = get_alert_detail(db=db, settings=settings, alert_id=alert_id)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disruption alert '{alert_id}' not found",
        )
    return detail
