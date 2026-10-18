"""Pydantic schemas for Disruption Detection and Alerting endpoints."""

from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class AlertSeverityEnum(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AlertTypeEnum(str, Enum):
    INVENTORY_SHORTAGE = "inventory_shortage"
    DATA_QUALITY = "data_quality"
    SUPPLIER_DELAY_EXPOSURE = "supplier_delay_exposure"
    PO_SLIPPED = "po_slipped"
    PO_OVERDUE = "po_overdue"
    DEMAND_SURGE = "demand_surge"
    QUALITY_ISSUE = "quality_issue"
    CAPACITY_CONSTRAINT = "capacity_constraint"
    COMPOUND_RISK = "compound_risk"


class AlertConfigSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    surge_recent_days: int
    surge_baseline_days: int
    surge_ratio_medium: float
    surge_ratio_high: float
    surge_min_baseline_mean: float
    surge_min_coverage: float
    quality_recent_days: int
    quality_rejection_threshold: float
    quality_min_received_units: int
    delay_min_late_probability: float
    delay_min_deliveries: int
    compound_min_types: int
    compound_escalate_at_types: int


class AlertSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    counts_by_severity: Dict[str, int]
    counts_by_type: Dict[str, int]
    total_alerts: int


class AlertListItemSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    severity: str
    title: str
    summary: str
    component_id: Optional[int] = None
    component_sku: Optional[str] = None
    component_name: Optional[str] = None
    supplier_id: Optional[int] = None
    supplier_code: Optional[str] = None
    po_number: Optional[str] = None
    days_until_impact: Optional[int] = None
    affected_orders_count: Optional[int] = None
    exposed_revenue: Optional[str] = None
    related_alert_ids: List[str] = Field(default_factory=list)
    flags: List[str] = Field(default_factory=list)


class AlertListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seeded: bool
    as_of: Optional[date] = None
    config: Optional[AlertConfigSchema] = None
    summary: AlertSummary
    items: List[AlertListItemSchema]
    total: int
    limit: int
    offset: int


class EvidenceItemSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    label: str
    value: Any
    unit: Optional[str] = None


class ExposedCustomerOrderSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_number: str
    customer_name: str
    product_sku: str
    product_name: str
    quantity: int
    due_date: date
    priority: str
    component_units_required: int


class AlertImpactDetailSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    orders_count: int
    count_by_priority: Dict[str, int]
    total_component_units_required: int
    exposed_revenue: str
    exposed_orders: List[ExposedCustomerOrderSchema]


class DelayScenarioItemSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    scenario_name: str
    shift_days: int
    expected_date: Optional[date] = None
    shortage_date: Optional[date] = None
    first_episode_start: Optional[date] = None
    first_episode_end: Optional[date] = None
    first_episode_days: int
    unmet_before_next_inbound: Optional[float] = None
    total_unmet_demand: float
    incremental_total_unmet: float
    change_in_shortage_days: int


class AlertDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    severity: str
    title: str
    summary: str
    component_id: Optional[int] = None
    component_sku: Optional[str] = None
    component_name: Optional[str] = None
    supplier_id: Optional[int] = None
    supplier_code: Optional[str] = None
    po_number: Optional[str] = None
    days_until_impact: Optional[int] = None
    detected_on: date
    evidence: List[EvidenceItemSchema]
    assumptions: List[str]
    impact: Optional[AlertImpactDetailSchema] = None
    impact_null_reason: Optional[str] = None
    related_alert_ids: List[str] = Field(default_factory=list)
    flags: List[str] = Field(default_factory=list)
    delay_scenarios: Optional[List[DelayScenarioItemSchema]] = None
