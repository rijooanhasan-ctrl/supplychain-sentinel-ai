from abc import ABC, abstractmethod
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class DatasetMetaDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    label: str = "DEMO DATA"
    source: str = "demo"
    seed: int
    as_of: date
    generator_version: str
    generated_at: datetime


class WarehouseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    role: str


class ProductDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sku: str
    name: str
    selling_price: Decimal


class ComponentDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sku: str
    name: str
    category: str
    unit_of_measure: str
    criticality: str
    is_active: bool = True


class BomLineDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    product_sku: str
    component_sku: str
    quantity_per_unit: int


class SupplierDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    country: str


class SupplierComponentDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    supplier_code: str
    component_sku: str
    unit_cost: Decimal
    lead_time_days: int
    min_order_qty: int
    max_weekly_capacity: Optional[int] = None
    is_preferred: bool = False
    expedite_available: bool = False
    expedite_lead_time_days: Optional[int] = None
    expedite_cost_premium_pct: Optional[Decimal] = None


class InventoryLevelDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    component_sku: str
    warehouse_code: str
    on_hand: int
    reserved: int
    as_of_ts: datetime


class PurchaseOrderLineDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    component_sku: str
    warehouse_code: str
    qty_ordered: int
    qty_received: int
    unit_price: Decimal


class PurchaseOrderDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    po_number: str
    supplier_code: str
    status: str
    order_date: date
    promised_date: date
    latest_estimate_date: Optional[date] = None
    lines: List[PurchaseOrderLineDTO] = Field(default_factory=list)


class CustomerOrderDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_number: str
    customer_name: str
    product_sku: str
    quantity: int
    due_date: date
    priority: str
    status: str


class DemandRecordDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    component_sku: str
    date: date
    quantity: int


class DeliveryRecordDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    supplier_code: str
    component_sku: str
    po_number: Optional[str] = None
    promised_date: date
    actual_date: date
    qty_ordered: int
    qty_received: int
    qty_rejected: int


class SourceDataset(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meta: DatasetMetaDTO
    warehouses: List[WarehouseDTO]
    products: List[ProductDTO]
    components: List[ComponentDTO]
    bom_lines: List[BomLineDTO]
    suppliers: List[SupplierDTO]
    supplier_components: List[SupplierComponentDTO]
    inventory_levels: List[InventoryLevelDTO]
    purchase_orders: List[PurchaseOrderDTO]
    customer_orders: List[CustomerOrderDTO]
    demand_records: List[DemandRecordDTO]
    delivery_records: List[DeliveryRecordDTO]


class SourceAdapter(ABC):
    """Abstract Base Class / Interface for all supply chain data sources."""

    name: str
    is_live: bool = False

    @abstractmethod
    def fetch_dataset(self) -> SourceDataset:
        """Fetch and return the complete dataset structured with business keys."""
        pass
