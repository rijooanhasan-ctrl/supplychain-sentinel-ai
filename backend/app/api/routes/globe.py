"""app/api/routes/globe.py

Endpoints for the 3D Supply Chain Globe:
- GET /api/globe (read-only decision support, composable metrics)
- POST /api/locations/override (manual location overrides persisted in file, gated by ENABLE_WEB_IMPORT)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes.data_import import require_web_import_enabled
from app.core.config import Settings, get_settings
from app.db.models import DatasetMeta, Supplier, Warehouse
from app.db.session import get_db
from app.domain.geo import validate_lat_lon
from app.services.globe import (
    get_dataset_key,
    get_globe_data,
    load_location_overrides,
    save_location_override,
)

logger = logging.getLogger("app.globe")

router = APIRouter(prefix="", tags=["Globe"])


class LocationOverridePayload(BaseModel):
    entity_type: str = Field(..., description="'supplier' or 'warehouse'")
    code: str = Field(..., description="Supplier or warehouse code")
    lat: Optional[float] = Field(default=None, description="Latitude between -90 and 90")
    lon: Optional[float] = Field(default=None, description="Longitude between -180 and 180")
    note: Optional[str] = Field(default=None, max_length=200, description="Optional note (max 200 chars)")
    clear: Optional[bool] = Field(default=False, description="Set True to clear manual override")


@router.get("/globe")
def get_globe(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Retrieve supply chain globe data for the active dataset."""
    return get_globe_data(db)


@router.post("/locations/override", dependencies=[Depends(require_web_import_enabled)])
def override_location(
    payload: LocationOverridePayload,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
    """Manually set or clear coordinate override for a supplier or warehouse in the active dataset.
    
    Coordinates are validated and persisted to a dataset-isolated JSON file, never modifying the SQLite database.
    """
    entity_type = payload.entity_type.strip().lower()
    if entity_type not in ("supplier", "warehouse"):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid entity_type '{payload.entity_type}', must be 'supplier' or 'warehouse'",
        )

    code = payload.code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="Entity code cannot be empty")

    # Validate entity exists in active dataset
    if entity_type == "supplier":
        entity = db.scalar(select(Supplier).where(Supplier.code == code))
    else:
        entity = db.scalar(select(Warehouse).where(Warehouse.code == code))

    if entity is None:
        raise HTTPException(
            status_code=404,
            detail=f"{entity_type.capitalize()} '{code}' not found in active dataset",
        )

    # Validate note length
    if payload.note and len(payload.note) > 200:
        raise HTTPException(status_code=422, detail="Note must not exceed 200 characters")

    # If not clearing, validate lat/lon
    if not payload.clear:
        if payload.lat is None or payload.lon is None:
            raise HTTPException(
                status_code=422,
                detail="Latitude and longitude must be provided when clear is false",
            )
        ok, reason = validate_lat_lon(payload.lat, payload.lon)
        if not ok:
            raise HTTPException(status_code=422, detail=reason)

    # Derive dataset key
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    dataset_key = get_dataset_key(meta)

    # Persist override atomically
    save_location_override(
        dataset_key=dataset_key,
        entity_type=entity_type,
        code=code,
        lat=payload.lat,
        lon=payload.lon,
        note=payload.note,
        clear=bool(payload.clear),
    )

    # Return refreshed location
    globe_data = get_globe_data(db)
    items = globe_data.get(f"{entity_type}s", [])
    matched = next((item for item in items if item.get("code") == code), None)

    return {
        "status": "cleared" if payload.clear else "saved",
        "entity_type": entity_type,
        "code": code,
        "location": matched.get("location") if matched else None,
    }
