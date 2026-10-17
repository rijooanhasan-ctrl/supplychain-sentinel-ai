"""Pydantic schemas for Supplier Risk Scoring API."""

from datetime import date
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class MetricScoreBreakdownSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    metric_name: str
    raw_value: Optional[float] = None
    penalty: Optional[float] = None
    nominal_weight: float
    effective_weight: float
    contribution_points: float
    dropped: bool
    dropped_reason: Optional[str] = None


class MonthlyPerformanceSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: str  # YYYY-MM
    n_deliveries: int
    on_time_rate: Optional[float] = None


class InformationalPoSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    open_po_count: int
    open_pos_slipped_count: int
    open_pos_overdue_count: int
    open_remaining_qty: int


class SupplierRiskConfigSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lookback_days: int
    on_time_grace_days: int
    w_on_time: float
    w_delay: float
    w_rejection: float
    w_fill: float
    late_rate_full_penalty: float
    delay_full_penalty_days: float
    rejection_full_penalty: float
    fill_shortfall_full_penalty: float
    band_medium: float
    band_high: float
    low_confidence_below: int
    high_confidence_from: int


class SupplierRiskListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    supplier_id: int
    supplier_code: str
    supplier_name: str
    country: str
    n_deliveries: int
    risk_score: Optional[float] = None
    risk_band: str
    confidence: str

    on_time_rate: Optional[float] = None
    on_time_ci_lower: Optional[float] = None
    on_time_ci_upper: Optional[float] = None

    late_delivery_probability: Optional[float] = None
    expected_delay_days_if_late: Optional[float] = None
    avg_delay_days_all: Optional[float] = None
    avg_delay_days_when_late: Optional[float] = None

    rejection_rate: Optional[float] = None
    fill_rate: Optional[float] = None

    open_po_count: int
    open_pos_slipped_count: int
    open_pos_overdue_count: int
    open_remaining_qty: int


class SupplierRiskSummary(BaseModel):
    counts_by_band: Dict[str, int]
    total_suppliers: int


class SupplierRiskListResponse(BaseModel):
    seeded: bool
    as_of: Optional[date] = None
    summary: SupplierRiskSummary
    items: List[SupplierRiskListItem]
    total: int
    limit: int
    offset: int


class SupplierRiskDetailResponse(SupplierRiskListItem):
    as_of: date
    excluded_future_deliveries: int
    has_excluded_future_deliveries: bool

    p50_delay_days_when_late: Optional[float] = None
    p90_delay_days_when_late: Optional[float] = None
    max_delay_days: Optional[float] = None

    total_ordered_qty: int
    total_received_qty: int
    total_rejected_qty: int

    metrics_breakdown: List[MetricScoreBreakdownSchema]
    nominal_weights: Dict[str, float]
    effective_weights: Dict[str, float]
    metrics_used: List[str]
    metrics_dropped: List[str]
    thresholds_used: SupplierRiskConfigSchema

    monthly_breakdown: List[MonthlyPerformanceSchema]
    main_drivers: List[str]

    explanation: str
    assumptions: List[str]
