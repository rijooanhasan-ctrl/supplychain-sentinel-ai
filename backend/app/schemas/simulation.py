"""app/schemas/simulation.py

Pydantic schemas for the What-If Disruption Simulator endpoints.
Money values formatted as strings, dates as ISO-8601 strings.
Strictly read-only schemas for decision support simulation.
"""

from __future__ import annotations

import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class SimulationParamsSchema(BaseModel):
    """Parameters applied to the simulation."""

    model_config = ConfigDict(from_attributes=True)

    supplier_delay_days: int = Field(0, description="Supplier delay in calendar days applied to all inbound orders")
    demand_multiplier: float = Field(1.0, description="Multiplier scaling recent daily demand history (0.5 - 3.0)")
    on_hand_delta: int = Field(0, description="Manual stock adjustment to plant on-hand inventory")
    alt_supplier_available: bool = Field(True, description="Whether alternative supplier offers are included in recovery")


class SimulationDailyProjectionItemSchema(BaseModel):
    """Daily projected balance for chart and table visualization."""

    model_config = ConfigDict(from_attributes=True)

    day_index: int
    date: datetime.date
    forecast_demand: float
    receipts: float
    ending_balance: float
    unmet: float


class ShortageEpisodeSummarySchema(BaseModel):
    """Summary of the primary shortage window."""

    model_config = ConfigDict(from_attributes=True)

    start_date: datetime.date
    end_date: datetime.date
    days: int
    unmet_units: float


class InboundSummarySchema(BaseModel):
    """Summary of the next scheduled replenishment."""

    model_config = ConfigDict(from_attributes=True)

    date: datetime.date
    qty: float
    po_number: str
    date_basis: str


class AppliedRecoveryActionSchema(BaseModel):
    """Recovery action executed in the recovered scenario."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str = Field(..., description="Action type: expedite | alternative_supplier | transfer | accept_delay")
    description: str
    source_code: Optional[str] = None
    quantity: int
    arrival_date: Optional[datetime.date] = None
    incremental_cost: Optional[str] = Field(None, description="Cost in USD formatted as string")
    cost_known: bool


class ScenarioResultSchema(BaseModel):
    """Comprehensive evaluation outcome of a single scenario."""

    model_config = ConfigDict(from_attributes=True)

    risk_level: str
    shortage_date: Optional[datetime.date] = None
    days_until_shortage: Optional[int] = None
    first_shortage_episode: Optional[ShortageEpisodeSummarySchema] = None
    unmet_before_next_inbound: float
    later_episodes_note: Optional[str] = None
    next_inbound: Optional[InboundSummarySchema] = None
    mean_daily_demand: Optional[float] = None
    plant_usable_stock: Optional[int] = None
    daily_projection_30d: List[SimulationDailyProjectionItemSchema]
    exposed_orders_count: int
    exposed_revenue: Optional[str] = Field(None, description="Upper bound order exposure revenue in USD")
    exposed_orders_summary: str
    applied_actions: List[AppliedRecoveryActionSchema] = Field(default_factory=list)
    recovery_note: Optional[str] = None


class ComponentBriefSchema(BaseModel):
    """Basic component identification."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    name: str


class SimulationResponse(BaseModel):
    """Full comparative response returned by GET /api/simulation."""

    model_config = ConfigDict(from_attributes=True)

    seeded: bool = Field(..., description="Whether database contains seeded data")
    as_of: Optional[datetime.date] = Field(None, description="Current simulated date ('Today')")
    component: Optional[ComponentBriefSchema] = None
    params: Optional[SimulationParamsSchema] = None
    baseline: Optional[ScenarioResultSchema] = None
    disrupted: Optional[ScenarioResultSchema] = None
    recovered: Optional[ScenarioResultSchema] = None
    what_changed: List[str] = Field(default_factory=list, description="Computed plain-language difference sentences")
    assumptions: List[str] = Field(default_factory=list, description="Underlying model assumptions and limitations")
    note: str = Field("What-if simulation. Nothing is saved and no orders are created.")
