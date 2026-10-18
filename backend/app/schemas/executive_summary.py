"""app/schemas/executive_summary.py

Pydantic schemas for the Executive Summary API endpoint.
Serializes monetary amounts strictly as decimal strings or null to prevent precision loss.
"""

from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class WhyItemSchema(BaseModel):
    """Why this? explanation pair."""

    label: str
    text: str


class TopRiskItemSchema(BaseModel):
    """Summary card for a top risk component."""

    component_id: int
    component_sku: str
    component_name: str
    severity: str
    shortage_date: Optional[date] = None
    days_until_impact: Optional[int] = None
    units_short_before_next_inbound: float
    first_shortage_window_days: int
    reason: str
    related_alert_id: Optional[str] = None
    has_later_shortage: bool = False
    exposed_orders_count: int = 0
    exposed_selling_value: Optional[str] = None
    why: List[WhyItemSchema] = Field(default_factory=list)


class RunnerUpOptionSchema(BaseModel):
    """Runner up option schema."""

    id: str
    kind: str
    description: str
    incremental_cost: Optional[str] = None
    cost_known: bool


class PriorityDecisionSchema(BaseModel):
    """Priority recommendation card."""

    component_id: int
    component_sku: str
    component_name: str
    recommended_option_id: str
    recommended_option_kind: str
    recommended_option_description: str
    quantity: int
    arrival_date: Optional[date] = None
    incremental_cost: Optional[str] = None
    cost_known: bool
    residual_unmet_before_next_inbound: float
    later_shortage_note: Optional[str] = None
    runner_up: Optional[RunnerUpOptionSchema] = None
    scope_note: str = "Fixes the first shortage window only. Later shortages are not covered."
    why: List[WhyItemSchema] = Field(default_factory=list)


class CostComparisonActSchema(BaseModel):
    """Cost and exposure of executing the recommended recovery."""

    cost: Optional[str] = None
    cost_known: bool
    residual_units_short: float
    affected_orders_count: int
    selling_value: Optional[str] = None


class CostComparisonDoNothingSchema(BaseModel):
    """Exposure of taking no recovery action."""

    units_short: float
    affected_orders_count: int
    selling_value: Optional[str] = None


class CostComparisonSchema(BaseModel):
    """Side-by-side comparison table."""

    act: CostComparisonActSchema
    do_nothing: CostComparisonDoNothingSchema
    difference_sentence: str
    exposure_disclaimer: str


class ComponentExposureItemSchema(BaseModel):
    """Individual component exposure line item."""

    component_id: int
    component_sku: str
    component_name: str
    orders_count: int
    selling_value: Optional[str] = None


class SupplierConfidenceSummarySchema(BaseModel):
    """Supplier confidence rating and volume."""

    supplier_id: int
    supplier_code: str
    supplier_name: str
    confidence: str
    n_deliveries: int


class DataQualityInfoSchema(BaseModel):
    """Data quality audit card and metadata."""

    dataset_label: str
    dataset_source: str
    is_live: bool = False
    components_evaluated: int
    components_unknown_risk: int
    supplier_confidence_counts: Dict[str, int]
    top_risk_supplier_confidence: List[SupplierConfidenceSummarySchema]
    priority_component_demand_history_days: Optional[int] = None
    flags: List[str] = Field(default_factory=list)
    data_quality_note: str


class ExecutiveSummaryResponse(BaseModel):
    """Executive Summary response payload."""

    seeded: bool
    as_of: Optional[date] = None
    label: Optional[str] = None
    headline: str
    top_risks: List[TopRiskItemSchema] = Field(default_factory=list)
    priority_decision: Optional[PriorityDecisionSchema] = None
    cost_comparison: Optional[CostComparisonSchema] = None
    exposure_totals: List[ComponentExposureItemSchema] = Field(default_factory=list)
    exposure_note: str
    data_quality: Optional[DataQualityInfoSchema] = None
    assumptions: List[str] = Field(default_factory=list)
    why: Dict[str, List[WhyItemSchema]] = Field(default_factory=dict)
    note: str = "Decision support only. No orders are created."
