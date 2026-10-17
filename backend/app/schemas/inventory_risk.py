"""Pydantic schemas for Inventory Intelligence endpoints."""

from datetime import date
from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class RiskLevelEnum(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    NONE = "none"
    UNKNOWN = "unknown"


class ModelMetadata(BaseModel):
    name: str = "weekday_average"
    type: str = "heuristic_baseline"
    description: str = (
        "Weekday-average heuristic baseline calculating mean daily consumption "
        "per day-of-week over recent history."
    )


class InventoryRiskConfigSchema(BaseModel):
    lookback_days: int
    min_history_days: int
    min_coverage_ratio: float
    horizon_days: int
    critical_days: int
    high_days: int
    medium_days: int
    overdue_inbound_policy: str


class RiskFlagSchema(BaseModel):
    code: str
    message: str


class ReplenishmentInfoSchema(BaseModel):
    date: date
    qty: float
    po_number: str
    date_basis: str


class InventoryRiskSummary(BaseModel):
    counts_by_risk_level: Dict[str, int]
    components_evaluated: int


class UsableStockBreakdownSchema(BaseModel):
    on_hand: int
    reserved: int
    usable: int
    reserved_exceeds_on_hand: bool


class WeekdayForecastItem(BaseModel):
    weekday: int
    weekday_name: str
    mean_demand: float


class InboundLineDetailSchema(BaseModel):
    po_id: int
    po_number: str
    status: str
    warehouse_code: str
    qty_ordered: int
    qty_received: int
    remaining_qty: int
    promised_date: date
    latest_estimate_date: Optional[date] = None
    expected_date: date
    date_basis: str


class RegionalStockSchema(BaseModel):
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    on_hand: int
    reserved: int
    usable: int


class DailyProjectionItemSchema(BaseModel):
    day_index: int
    date: date
    forecast_demand: float
    receipts: float
    ending_balance: float
    unmet: float


class ShortageEpisodeSchema(BaseModel):
    start_date: date
    end_date: date
    days: int
    unmet_units: float
    ends_because: str


class InventoryRiskItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    component_id: int
    sku: str
    name: str
    category: str
    criticality: str
    plant_usable_stock: Optional[int] = None
    plant_on_hand: Optional[int] = None
    plant_reserved: Optional[int] = None
    mean_daily_demand: Optional[float] = None
    coverage_days: Optional[float] = None
    next_replenishment: Optional[ReplenishmentInfoSchema] = None
    shortage_date: Optional[date] = None
    days_until_shortage: Optional[int] = None
    unmet_demand_units: float = 0.0
    runout_date_without_inbound: Optional[date] = None
    unmet_before_next_inbound: Optional[float] = None
    first_episode_start_date: Optional[date] = None
    first_episode_end_date: Optional[date] = None
    risk_level: str
    risk_reason: str
    forecast_status: str
    flags: List[RiskFlagSchema] = Field(default_factory=list)


class InventoryRiskListResponse(BaseModel):
    seeded: bool = True
    as_of: Optional[date] = None
    model: ModelMetadata = Field(default_factory=ModelMetadata)
    config: InventoryRiskConfigSchema
    summary: InventoryRiskSummary
    items: List[InventoryRiskItem]
    total: int
    limit: int
    offset: int


class InventoryRiskDetailResponse(InventoryRiskItem):
    as_of: date
    model: ModelMetadata = Field(default_factory=ModelMetadata)
    config: InventoryRiskConfigSchema
    explanation: str
    usable_stock_breakdown: Optional[UsableStockBreakdownSchema] = None
    forecast_by_weekday: Optional[List[WeekdayForecastItem]] = None
    counted_inbound: List[InboundLineDetailSchema] = Field(default_factory=list)
    unconfirmed_inbound: List[InboundLineDetailSchema] = Field(default_factory=list)
    out_of_horizon_inbound: List[InboundLineDetailSchema] = Field(default_factory=list)
    regional_usable_stock: List[RegionalStockSchema] = Field(default_factory=list)
    regional_total_usable: int = 0
    daily_projection: List[DailyProjectionItemSchema] = Field(default_factory=list)
    shortage_episodes: List[ShortageEpisodeSchema] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
