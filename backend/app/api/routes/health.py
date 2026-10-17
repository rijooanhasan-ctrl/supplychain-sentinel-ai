from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str = Field(default="ok", description="Application health status")
    app: str = Field(..., description="Application name")
    version: str = Field(..., description="API version")
    environment: str = Field(..., description="Application environment")
    data_source: str = Field(..., description="Active data source adapter")
    timestamp: str = Field(..., description="UTC ISO-8601 timestamp")


@router.get("/health", response_model=HealthResponse)
def get_health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    now_utc_iso = datetime.now(timezone.utc).isoformat()
    return HealthResponse(
        status="ok",
        app=settings.APP_NAME,
        version=settings.API_VERSION,
        environment=settings.APP_ENV,
        data_source=settings.DATA_SOURCE,
        timestamp=now_utc_iso,
    )
