"""app/schemas/recovery.py

Pydantic schemas for recovery recommendations endpoints.
Money values formatted as strings, dates as ISO-8601 strings.
"""

from __future__ import annotations

import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.alerts import AlertImpactDetailSchema


class RecoveryConfigSchema(BaseModel):
    """Configuration assumptions for recovery recommendations."""

    model_config = ConfigDict(from_attributes=True)

    transfer_days: int = Field(..., description="Assumed calendar days required for inter-warehouse transfers")
    transfer_cost_per_unit: Optional[str] = Field(
        None, description="Assumed freight/handling cost per transferred unit in USD, or null if unknown"
    )


class RecoveryOptionSchema(BaseModel):
    """Evaluated recovery intervention option."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str = Field(..., description="Option type: transfer | expedite_existing | alternative_supplier | accept_delay")
    description: str
    source_code: Optional[str] = Field(None, description="Warehouse code or supplier code if applicable")
    source_name: Optional[str] = Field(None, description="Warehouse name or supplier name if applicable")
    quantity: int = Field(..., description="Supply units transferred, expedited, or ordered")
    arrival_date: Optional[datetime.date] = Field(None, description="Expected arrival date at plant warehouse")
    arrival_within_time: bool = Field(..., description="Whether arrival date is on or before shortage date")
    incremental_cost: Optional[str] = Field(None, description="Total incremental cost in USD formatted as string")
    cost_known: bool = Field(..., description="Whether incremental cost is known from agreement data")
    unit_premium_vs_shortage_supplier: Optional[str] = Field(
        None, description="Per-unit cost premium relative to current shortage supplier in USD"
    )
    residual_unmet_before_next_inbound: float = Field(
        ..., description="Unmet demand remaining before the next inbound receipt after this option"
    )
    new_shortage_date: Optional[datetime.date] = Field(
        None, description="New projected shortage date if still short, or null if fully covered"
    )
    remaining_total_unmet: float = Field(
        ..., description="Total unmet demand over 60-day horizon assuming no further supply"
    )
    constraints_applied: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    flags: List[str] = Field(default_factory=list)
    feasible: bool = Field(..., description="Whether this option can be executed under known constraints")
    infeasible_reason: Optional[str] = Field(None, description="Reason why option cannot be executed")
    impact: Optional[AlertImpactDetailSchema] = Field(
        None, description="Customer order exposure impact when accepting delay"
    )


class CombinedPlanStepSchema(BaseModel):
    """Step in a multi-action combined recovery plan."""

    model_config = ConfigDict(from_attributes=True)

    option_id: str
    kind: str
    source_code: str
    source_name: str
    quantity: int
    arrival_date: Optional[datetime.date] = None
    incremental_cost: Optional[str] = None
    cost_known: bool


class CombinedPlanSchema(BaseModel):
    """Greedy combined recovery plan combining multiple feasible actions."""

    model_config = ConfigDict(from_attributes=True)

    id: str = "combined_plan"
    description: str
    steps: List[CombinedPlanStepSchema] = Field(default_factory=list)
    total_quantity: int
    total_known_cost: Optional[str] = None
    unknown_cost_steps: int = 0
    residual_unmet_before_next_inbound: float
    new_shortage_date: Optional[datetime.date] = None
    remaining_total_unmet: float
    feasible: bool = True


class ComponentRecoveryRecommendationSchema(BaseModel):
    """Recovery recommendation for a single component with shortage."""

    model_config = ConfigDict(from_attributes=True)

    component_id: int
    sku: str
    name: str
    risk_level: str
    baseline_shortage_date: datetime.date
    baseline_unmet_before_next_inbound: float
    need_units: int
    baseline_summary: str
    options: List[RecoveryOptionSchema] = Field(default_factory=list)
    combined_plan: Optional[CombinedPlanSchema] = None
    recommended_option_id: str
    recommended_option_kind: str
    reason: str
    alternatives_note: str
    later_shortage_note: Optional[str] = None


class RecommendationsResponse(BaseModel):
    """Envelope for recovery recommendations."""

    model_config = ConfigDict(from_attributes=True)

    seeded: bool
    as_of: Optional[datetime.date] = None
    config: RecoveryConfigSchema
    items: List[ComponentRecoveryRecommendationSchema] = Field(default_factory=list)
    total: int
    note: str = "Decision support only. No orders are created."
