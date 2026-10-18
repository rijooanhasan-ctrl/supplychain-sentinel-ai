"""app/api/routes/integration_status.py

Endpoint providing honest, transparent integration status and connector capabilities.
Zero live SAP connection claims.
"""

from __future__ import annotations

from typing import Any, Dict, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DatasetMeta
from app.db.session import get_db
from app.integrations.sap_sample_adapter import SAP_DISCLAIMER_TEXT, SapSampleAdapter

router = APIRouter(tags=["Integration"])


class IntegrationStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    active_source: str
    is_live: bool
    label: str
    entities_covered: List[str]
    entities_missing: List[str]
    notes: Dict[str, str]
    disclaimer: str


ALL_STANDARD_ENTITIES = [
    "warehouses",
    "products",
    "components",
    "bom_lines",
    "suppliers",
    "supplier_components",
    "inventory_levels",
    "purchase_orders",
    "purchase_order_lines",
    "customer_orders",
    "demand_records",
    "delivery_records",
]


@router.get("/integration-status", response_model=IntegrationStatusResponse)
def get_integration_status(
    db: Session = Depends(get_db),
) -> IntegrationStatusResponse:
    """Return the active data connector status, entity coverage, and mandatory SAP connectivity disclaimer."""
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))

    active_source = meta.source if meta and meta.source else "demo"
    label = meta.label if meta and meta.label else "DEMO DATA"

    if active_source == "sap-style-sample":
        adapter = SapSampleAdapter()
        rep = adapter.get_coverage_report()
        return IntegrationStatusResponse(
            active_source="sap-style-sample",
            is_live=False,
            label=label,
            entities_covered=rep["entities_covered"],
            entities_missing=rep["entities_missing"],
            notes=rep.get("notes", {}),
            disclaimer=SAP_DISCLAIMER_TEXT,
        )

    # Demo source: full synthetic coverage
    return IntegrationStatusResponse(
        active_source=active_source,
        is_live=False,
        label=label,
        entities_covered=ALL_STANDARD_ENTITIES,
        entities_missing=[],
        notes={
            "connector_type": "Synthetic internal demo generator with fully simulated supply chain entities."
        },
        disclaimer=SAP_DISCLAIMER_TEXT,
    )
