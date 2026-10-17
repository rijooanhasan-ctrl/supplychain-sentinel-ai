from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Dict, Generic, List, Optional, TypeVar
from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

T = TypeVar("T")


def serialize_utc_datetime(dt: Optional[datetime]) -> Optional[str]:
    """Serialize datetime to unambiguous UTC ISO-8601 (ending in +00:00)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        # Treat naive datetimes from SQLite as UTC
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()


UtcDatetime = Annotated[datetime, PlainSerializer(serialize_utc_datetime, return_type=str)]


class PaginatedEnvelope(BaseModel, Generic[T]):
    items: List[T]
    total: int
    limit: int
    offset: int


class DatasetMetaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seeded: bool
    data_source: str
    label: Optional[str] = None
    seed: Optional[int] = None
    as_of: Optional[date] = None
    generator_version: Optional[str] = None
    generated_at: Optional[UtcDatetime] = None
    counts: Dict[str, int] = Field(default_factory=dict)
    message: Optional[str] = None


class WarehouseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    role: str


class BomLineComponentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    component_id: int
    component_sku: str
    component_name: str
    quantity_per_unit: int


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    name: str
    selling_price: Decimal


class ProductDetailResponse(ProductResponse):
    bom_lines: List[BomLineComponentResponse] = Field(default_factory=list)


class SupplierComponentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    supplier_code: str
    supplier_name: str
    unit_cost: Decimal
    lead_time_days: int
    min_order_qty: int
    max_weekly_capacity: Optional[int] = None
    is_preferred: bool
    expedite_available: bool
    expedite_lead_time_days: Optional[int] = None
    expedite_cost_premium_pct: Optional[Decimal] = None


class ComponentInventoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    on_hand: int
    reserved: int
    as_of_ts: UtcDatetime


class ComponentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    name: str
    category: str
    unit_of_measure: str
    criticality: str
    is_active: bool


class ComponentDetailResponse(ComponentResponse):
    supplier_offers: List[SupplierComponentResponse] = Field(default_factory=list)
    inventory: List[ComponentInventoryResponse] = Field(default_factory=list)


class DemandRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    component_id: int
    date: date
    quantity: int


class DemandHistoryResponse(BaseModel):
    items: List[DemandRecordResponse]
    total: int
    days: int


class SupplierResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    country: str


class SupplierOfferResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    component_id: int
    component_sku: str
    component_name: str
    unit_cost: Decimal
    lead_time_days: int
    min_order_qty: int
    max_weekly_capacity: Optional[int] = None
    is_preferred: bool
    expedite_available: bool
    expedite_lead_time_days: Optional[int] = None
    expedite_cost_premium_pct: Optional[Decimal] = None


class SupplierDetailResponse(SupplierResponse):
    offers: List[SupplierOfferResponse] = Field(default_factory=list)


class InventoryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    component_id: int
    component_sku: str
    component_name: str
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    on_hand: int
    reserved: int
    as_of_ts: UtcDatetime


class PurchaseOrderLineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    component_id: int
    component_sku: str
    component_name: str
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    qty_ordered: int
    qty_received: int
    unit_price: Decimal


class PurchaseOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    po_number: str
    supplier_id: int
    supplier_code: str
    supplier_name: str
    status: str
    order_date: date
    promised_date: date
    latest_estimate_date: Optional[date] = None


class PurchaseOrderDetailResponse(PurchaseOrderResponse):
    lines: List[PurchaseOrderLineResponse] = Field(default_factory=list)


class CustomerOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_number: str
    customer_name: str
    product_id: int
    product_sku: str
    product_name: str
    quantity: int
    due_date: date
    priority: str
    status: str


class DeliveryRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    supplier_code: str
    supplier_name: str
    component_id: int
    component_sku: str
    component_name: str
    purchase_order_id: Optional[int] = None
    promised_date: date
    actual_date: date
    qty_ordered: int
    qty_received: int
    qty_rejected: int


from app.schemas.inventory_risk import (
    DailyProjectionItemSchema,
    InboundLineDetailSchema,
    InventoryRiskConfigSchema,
    InventoryRiskDetailResponse,
    InventoryRiskItem,
    InventoryRiskListResponse,
    InventoryRiskSummary,
    ModelMetadata,
    RegionalStockSchema,
    ReplenishmentInfoSchema,
    RiskFlagSchema,
    RiskLevelEnum,
    ShortageEpisodeSchema,
    UsableStockBreakdownSchema,
    WeekdayForecastItem,
)
from app.schemas.supplier_risk import (
    InformationalPoSchema,
    MetricScoreBreakdownSchema,
    MonthlyPerformanceSchema,
    SupplierRiskConfigSchema,
    SupplierRiskDetailResponse,
    SupplierRiskListItem,
    SupplierRiskListResponse,
    SupplierRiskSummary,
)
from app.schemas.forecasting import (
    AggregateModelSummarySchema,
    BacktestPointSchema,
    ComponentEvaluationSchema,
    ComponentForecastDetailResponse,
    DayForecastSchema,
    DecisionResultSchema,
    ForecastEvaluationResponse,
    ModelMetadataSchema,
    ModelMetricSummarySchema,
    ProtocolInfoSchema,
    SkippedComponentSchema,
)
