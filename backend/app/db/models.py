from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class DatasetMeta(Base):
    __tablename__ = "dataset_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(50), nullable=False, default="DEMO DATA")
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="demo")
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    generator_version: Mapped[str] = mapped_column(String(20), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)

    __table_args__ = (
        CheckConstraint("role IN ('plant', 'regional')", name="ck_warehouse_role"),
    )

    inventory_levels: Mapped[List["InventoryLevel"]] = relationship(
        "InventoryLevel", back_populates="warehouse", cascade="all, delete-orphan"
    )
    po_lines: Mapped[List["PurchaseOrderLine"]] = relationship(
        "PurchaseOrderLine", back_populates="warehouse"
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    selling_price: Mapped[Decimal] = mapped_column(Numeric(12, 2, asdecimal=True), nullable=False)

    __table_args__ = (
        CheckConstraint("selling_price >= 0", name="ck_product_selling_price"),
    )

    bom_lines: Mapped[List["BomLine"]] = relationship(
        "BomLine", back_populates="product", cascade="all, delete-orphan"
    )
    customer_orders: Mapped[List["CustomerOrder"]] = relationship(
        "CustomerOrder", back_populates="product"
    )


class Component(Base):
    __tablename__ = "components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    unit_of_measure: Mapped[str] = mapped_column(String(20), nullable=False)
    criticality: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)

    __table_args__ = (
        CheckConstraint("criticality IN ('critical', 'high', 'normal')", name="ck_component_criticality"),
    )

    bom_lines: Mapped[List["BomLine"]] = relationship(
        "BomLine", back_populates="component"
    )
    supplier_offers: Mapped[List["SupplierComponent"]] = relationship(
        "SupplierComponent", back_populates="component", cascade="all, delete-orphan"
    )
    inventory_levels: Mapped[List["InventoryLevel"]] = relationship(
        "InventoryLevel", back_populates="component", cascade="all, delete-orphan"
    )
    demand_records: Mapped[List["DemandRecord"]] = relationship(
        "DemandRecord", back_populates="component", cascade="all, delete-orphan"
    )
    po_lines: Mapped[List["PurchaseOrderLine"]] = relationship(
        "PurchaseOrderLine", back_populates="component"
    )
    delivery_records: Mapped[List["DeliveryRecord"]] = relationship(
        "DeliveryRecord", back_populates="component"
    )


class BomLine(Base):
    __tablename__ = "bom_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    component_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("components.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    quantity_per_unit: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("quantity_per_unit > 0", name="ck_bom_qty"),
        UniqueConstraint("product_id", "component_id", name="uq_bom_product_component"),
    )

    product: Mapped["Product"] = relationship("Product", back_populates="bom_lines")
    component: Mapped["Component"] = relationship("Component", back_populates="bom_lines")


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    country: Mapped[str] = mapped_column(String(50), nullable=False)

    offers: Mapped[List["SupplierComponent"]] = relationship(
        "SupplierComponent", back_populates="supplier", cascade="all, delete-orphan"
    )
    purchase_orders: Mapped[List["PurchaseOrder"]] = relationship(
        "PurchaseOrder", back_populates="supplier"
    )
    delivery_records: Mapped[List["DeliveryRecord"]] = relationship(
        "DeliveryRecord", back_populates="supplier"
    )


class SupplierComponent(Base):
    __tablename__ = "supplier_components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), index=True, nullable=False
    )
    component_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("components.id", ondelete="CASCADE"), index=True, nullable=False
    )
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2, asdecimal=True), nullable=False)
    lead_time_days: Mapped[int] = mapped_column(Integer, nullable=False)
    min_order_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    max_weekly_capacity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_preferred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expedite_available: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expedite_lead_time_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    expedite_cost_premium_pct: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 4, asdecimal=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint("unit_cost > 0", name="ck_supplier_comp_unit_cost"),
        CheckConstraint("lead_time_days >= 0", name="ck_supplier_comp_lead_time"),
        CheckConstraint("min_order_qty >= 1", name="ck_supplier_comp_min_qty"),
        CheckConstraint(
            "max_weekly_capacity IS NULL OR max_weekly_capacity >= 0",
            name="ck_supplier_comp_capacity",
        ),
        CheckConstraint(
            "expedite_lead_time_days IS NULL OR expedite_lead_time_days >= 0",
            name="ck_supplier_comp_expedite_lead_time",
        ),
        CheckConstraint(
            "expedite_cost_premium_pct IS NULL OR (expedite_cost_premium_pct >= 0 AND expedite_cost_premium_pct <= 1)",
            name="ck_supplier_comp_expedite_premium",
        ),
        UniqueConstraint("supplier_id", "component_id", name="uq_supplier_component"),
    )

    supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="offers")
    component: Mapped["Component"] = relationship("Component", back_populates="supplier_offers")


class InventoryLevel(Base):
    __tablename__ = "inventory_levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    component_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("components.id", ondelete="CASCADE"), index=True, nullable=False
    )
    warehouse_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("warehouses.id", ondelete="CASCADE"), index=True, nullable=False
    )
    on_hand: Mapped[int] = mapped_column(Integer, nullable=False)
    reserved: Mapped[int] = mapped_column(Integer, nullable=False)
    as_of_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("on_hand >= 0", name="ck_inventory_on_hand"),
        CheckConstraint("reserved >= 0", name="ck_inventory_reserved"),
        UniqueConstraint("component_id", "warehouse_id", name="uq_inventory_comp_wh"),
    )

    component: Mapped["Component"] = relationship("Component", back_populates="inventory_levels")
    warehouse: Mapped["Warehouse"] = relationship("Warehouse", back_populates="inventory_levels")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    supplier_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    order_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    promised_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    latest_estimate_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'in_transit', 'partially_received', 'received', 'cancelled')",
            name="ck_po_status",
        ),
    )

    supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="purchase_orders")
    lines: Mapped[List["PurchaseOrderLine"]] = relationship(
        "PurchaseOrderLine", back_populates="purchase_order", cascade="all, delete-orphan"
    )
    delivery_records: Mapped[List["DeliveryRecord"]] = relationship(
        "DeliveryRecord", back_populates="purchase_order"
    )


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    component_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("components.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    warehouse_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("warehouses.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    qty_ordered: Mapped[int] = mapped_column(Integer, nullable=False)
    qty_received: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2, asdecimal=True), nullable=False)

    __table_args__ = (
        CheckConstraint("qty_ordered > 0", name="ck_pol_qty_ordered"),
        CheckConstraint(
            "qty_received >= 0 AND qty_received <= qty_ordered",
            name="ck_pol_qty_received",
        ),
        CheckConstraint("unit_price >= 0", name="ck_pol_unit_price"),
    )

    purchase_order: Mapped["PurchaseOrder"] = relationship("PurchaseOrder", back_populates="lines")
    component: Mapped["Component"] = relationship("Component", back_populates="po_lines")
    warehouse: Mapped["Warehouse"] = relationship("Warehouse", back_populates="po_lines")


class CustomerOrder(Base):
    __tablename__ = "customer_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    customer_name: Mapped[str] = mapped_column(String(150), nullable=False)
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    priority: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(30), index=True, nullable=False)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_cust_order_qty"),
        CheckConstraint("priority IN ('critical', 'high', 'normal', 'low')", name="ck_cust_order_priority"),
        CheckConstraint(
            "status IN ('open', 'in_production', 'shipped', 'cancelled')",
            name="ck_cust_order_status",
        ),
    )

    product: Mapped["Product"] = relationship("Product", back_populates="customer_orders")


class DemandRecord(Base):
    __tablename__ = "demand_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    component_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("components.id", ondelete="CASCADE"), index=True, nullable=False
    )
    date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_demand_qty"),
        UniqueConstraint("component_id", "date", name="uq_demand_comp_date"),
    )

    component: Mapped["Component"] = relationship("Component", back_populates="demand_records")


class DeliveryRecord(Base):
    __tablename__ = "delivery_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    component_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("components.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    purchase_order_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("purchase_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    promised_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    actual_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    qty_ordered: Mapped[int] = mapped_column(Integer, nullable=False)
    qty_received: Mapped[int] = mapped_column(Integer, nullable=False)
    qty_rejected: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("qty_ordered > 0", name="ck_deliv_qty_ordered"),
        CheckConstraint(
            "qty_received >= 0 AND qty_received <= qty_ordered",
            name="ck_deliv_qty_received",
        ),
        CheckConstraint(
            "qty_rejected >= 0 AND qty_rejected <= qty_received",
            name="ck_deliv_qty_rejected",
        ),
    )

    supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="delivery_records")
    component: Mapped["Component"] = relationship("Component", back_populates="delivery_records")
    purchase_order: Mapped[Optional["PurchaseOrder"]] = relationship(
        "PurchaseOrder", back_populates="delivery_records"
    )
