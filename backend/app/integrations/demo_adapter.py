import random
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional

from app.integrations.base import (
    BomLineDTO,
    ComponentDTO,
    CustomerOrderDTO,
    DatasetMetaDTO,
    DeliveryRecordDTO,
    DemandRecordDTO,
    InventoryLevelDTO,
    ProductDTO,
    PurchaseOrderDTO,
    PurchaseOrderLineDTO,
    SourceAdapter,
    SourceDataset,
    SupplierComponentDTO,
    SupplierDTO,
    WarehouseDTO,
)


class DemoAdapter(SourceAdapter):
    """Deterministic synthetic data generator for SupplyChain Sentinel AI demo."""

    name: str = "demo"
    is_live: bool = False
    GENERATOR_VERSION: str = "1.0.0"

    def __init__(self, seed: int = 42, as_of: Optional[date] = None):
        self.seed = seed
        self.as_of = as_of or datetime.now(timezone.utc).date()

    def fetch_dataset(self) -> SourceDataset:
        rng = random.Random(self.seed)
        now_utc = datetime(
            self.as_of.year, self.as_of.month, self.as_of.day, 12, 0, 0, tzinfo=timezone.utc
        )

        meta = DatasetMetaDTO(
            label="DEMO DATA",
            source=self.name,
            seed=self.seed,
            as_of=self.as_of,
            generator_version=self.GENERATOR_VERSION,
            generated_at=now_utc,
        )

        # 1. Warehouses (3: 1 plant, 2 regional)
        warehouses = [
            WarehouseDTO(code="WH-PLANT", name="Austin Main Assembly Plant", role="plant"),
            WarehouseDTO(code="WH-REG-EAST", name="Columbus Regional Hub", role="regional"),
            WarehouseDTO(code="WH-REG-WEST", name="Reno Regional Depot", role="regional"),
        ]

        # 2. Products (4 laptop models)
        products = [
            ProductDTO(sku="LAPTOP-PRO-15", name="AeroBook Pro 15", selling_price=Decimal("1499.00")),
            ProductDTO(sku="LAPTOP-PRO-13", name="AeroBook Air 13", selling_price=Decimal("1199.00")),
            ProductDTO(sku="LAPTOP-GAMING-16", name="Apex Titan 16", selling_price=Decimal("2199.00")),
            ProductDTO(sku="LAPTOP-WORK-14", name="WorkSentinel 14", selling_price=Decimal("1299.00")),
        ]

        # 3. Components (13 items across 8 categories)
        components = [
            ComponentDTO(sku="CPU-X7", name="NovaCore X7 Processor", category="processor", unit_of_measure="ea", criticality="critical", is_active=True),
            ComponentDTO(sku="CPU-X5", name="NovaCore X5 Processor", category="processor", unit_of_measure="ea", criticality="high", is_active=True),
            ComponentDTO(sku="RAM-16GB", name="DDR5 16GB SODIMM Module", category="memory", unit_of_measure="ea", criticality="high", is_active=True),
            ComponentDTO(sku="RAM-32GB", name="DDR5 32GB SODIMM Module", category="memory", unit_of_measure="ea", criticality="normal", is_active=True),
            ComponentDTO(sku="BAT-70WH", name="Lithium-Polymer 70Wh Battery Pack", category="battery", unit_of_measure="ea", criticality="critical", is_active=True),
            ComponentDTO(sku="BAT-50WH", name="Lithium-Polymer 50Wh Battery Pack", category="battery", unit_of_measure="ea", criticality="normal", is_active=True),
            ComponentDTO(sku="DISP-15-OLED", name="15.6-inch 4K OLED Display Panel", category="display", unit_of_measure="ea", criticality="high", is_active=True),
            ComponentDTO(sku="DISP-13-IPS", name="13.3-inch FHD IPS Display Panel", category="display", unit_of_measure="ea", criticality="normal", is_active=True),
            ComponentDTO(sku="SSD-1TB", name="PCIe 4.0 NVMe 1TB M.2 SSD", category="storage", unit_of_measure="ea", criticality="normal", is_active=True),
            ComponentDTO(sku="SSD-2TB", name="PCIe 4.0 NVMe 2TB M.2 SSD", category="storage", unit_of_measure="ea", criticality="normal", is_active=True),
            ComponentDTO(sku="MB-PRO-01", name="AeroMain Pro System Board", category="motherboard", unit_of_measure="ea", criticality="critical", is_active=True),
            ComponentDTO(sku="CHAS-ALU-15", name="CNC Aluminum 15-inch Enclosure", category="chassis", unit_of_measure="ea", criticality="normal", is_active=True),
            ComponentDTO(sku="KB-BACKLIT-EN", name="Precision Backlit ANSI Keyboard", category="keyboard", unit_of_measure="ea", criticality="normal", is_active=True),
            # Mandatory Edge Case: Active component with ZERO demand across history
            ComponentDTO(sku="COMP-SPARE-01", name="Legacy Diagnostic Interface Sensor", category="sensor", unit_of_measure="ea", criticality="normal", is_active=True),
        ]

        # 4. BOM Lines
        bom_lines = [
            # LAPTOP-PRO-15
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="CPU-X7", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="RAM-16GB", quantity_per_unit=2),
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="BAT-70WH", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="DISP-15-OLED", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="SSD-1TB", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="MB-PRO-01", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="CHAS-ALU-15", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-15", component_sku="KB-BACKLIT-EN", quantity_per_unit=1),
            # LAPTOP-GAMING-16
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="CPU-X7", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="RAM-32GB", quantity_per_unit=2),
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="BAT-70WH", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="DISP-15-OLED", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="SSD-2TB", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="MB-PRO-01", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="CHAS-ALU-15", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-GAMING-16", component_sku="KB-BACKLIT-EN", quantity_per_unit=1),
            # LAPTOP-PRO-13
            BomLineDTO(product_sku="LAPTOP-PRO-13", component_sku="CPU-X5", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-13", component_sku="RAM-16GB", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-13", component_sku="BAT-50WH", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-13", component_sku="DISP-13-IPS", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-13", component_sku="SSD-1TB", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-13", component_sku="MB-PRO-01", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-PRO-13", component_sku="KB-BACKLIT-EN", quantity_per_unit=1),
            # LAPTOP-WORK-14
            BomLineDTO(product_sku="LAPTOP-WORK-14", component_sku="CPU-X5", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-WORK-14", component_sku="RAM-16GB", quantity_per_unit=2),
            BomLineDTO(product_sku="LAPTOP-WORK-14", component_sku="BAT-50WH", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-WORK-14", component_sku="DISP-13-IPS", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-WORK-14", component_sku="SSD-1TB", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-WORK-14", component_sku="MB-PRO-01", quantity_per_unit=1),
            BomLineDTO(product_sku="LAPTOP-WORK-14", component_sku="KB-BACKLIT-EN", quantity_per_unit=1),
        ]

        # 5. Suppliers (8 suppliers)
        suppliers = [
            SupplierDTO(code="SUP-HELIX", name="Helix Silicon Technologies Inc", country="TW"),
            SupplierDTO(code="SUP-NEXUS", name="Nexus Micro Devices Corp", country="KR"),
            SupplierDTO(code="SUP-VOLT", name="VoltPower Cell Systems", country="JP"),
            SupplierDTO(code="SUP-LUMEN", name="Lumen Optics Advanced Displays", country="KR"),
            SupplierDTO(code="SUP-CORE", name="CoreMemory International", country="US"),
            SupplierDTO(code="SUP-FLASH", name="FlashSpeed Storage Technologies", country="SG"),
            SupplierDTO(code="SUP-CIRCUIT", name="CircuitWorks Manufacturing Ltd", country="VN"),
            SupplierDTO(code="SUP-METALS", name="Apex Precision Metalworks GmbH", country="DE"),
        ]

        # 6. Supplier Components (Offers)
        supplier_components = [
            # CPU-X7 Preferred (SUP-HELIX)
            SupplierComponentDTO(
                supplier_code="SUP-HELIX",
                component_sku="CPU-X7",
                unit_cost=Decimal("250.00"),
                lead_time_days=14,
                min_order_qty=200,
                max_weekly_capacity=1000,
                is_preferred=True,
                expedite_available=True,
                expedite_lead_time_days=5,
                expedite_cost_premium_pct=Decimal("0.2500"),
            ),
            # CPU-X7 Alternative (SUP-NEXUS) - ~18% higher unit cost, ~4 days lead time
            SupplierComponentDTO(
                supplier_code="SUP-NEXUS",
                component_sku="CPU-X7",
                unit_cost=Decimal("295.00"),
                lead_time_days=4,
                min_order_qty=100,
                max_weekly_capacity=300,
                is_preferred=False,
                expedite_available=False,
                expedite_lead_time_days=None,
                expedite_cost_premium_pct=None,
            ),
            # CPU-X5
            SupplierComponentDTO(
                supplier_code="SUP-HELIX",
                component_sku="CPU-X5",
                unit_cost=Decimal("170.00"),
                lead_time_days=12,
                min_order_qty=200,
                max_weekly_capacity=800,
                is_preferred=True,
                expedite_available=True,
                expedite_lead_time_days=4,
                expedite_cost_premium_pct=Decimal("0.2000"),
            ),
            SupplierComponentDTO(
                supplier_code="SUP-NEXUS",
                component_sku="CPU-X5",
                unit_cost=Decimal("195.00"),
                lead_time_days=5,
                min_order_qty=100,
                max_weekly_capacity=400,
                is_preferred=False,
                expedite_available=False,
            ),
            # RAM
            SupplierComponentDTO(
                supplier_code="SUP-CORE",
                component_sku="RAM-16GB",
                unit_cost=Decimal("38.00"),
                lead_time_days=7,
                min_order_qty=500,
                max_weekly_capacity=5000,
                is_preferred=True,
                expedite_available=True,
                expedite_lead_time_days=2,
                expedite_cost_premium_pct=Decimal("0.1500"),
            ),
            SupplierComponentDTO(
                supplier_code="SUP-FLASH",
                component_sku="RAM-16GB",
                unit_cost=Decimal("42.00"),
                lead_time_days=6,
                min_order_qty=250,
                max_weekly_capacity=2000,
                is_preferred=False,
            ),
            SupplierComponentDTO(
                supplier_code="SUP-CORE",
                component_sku="RAM-32GB",
                unit_cost=Decimal("72.00"),
                lead_time_days=7,
                min_order_qty=300,
                max_weekly_capacity=3000,
                is_preferred=True,
            ),
            # Battery
            SupplierComponentDTO(
                supplier_code="SUP-VOLT",
                component_sku="BAT-70WH",
                unit_cost=Decimal("48.00"),
                lead_time_days=10,
                min_order_qty=200,
                max_weekly_capacity=1500,
                is_preferred=True,
                expedite_available=True,
                expedite_lead_time_days=4,
                expedite_cost_premium_pct=Decimal("0.3000"),
            ),
            # Mandatory Edge Case: Offer with max_weekly_capacity = NULL (unknown)
            SupplierComponentDTO(
                supplier_code="SUP-VOLT",
                component_sku="BAT-50WH",
                unit_cost=Decimal("34.00"),
                lead_time_days=10,
                min_order_qty=200,
                max_weekly_capacity=None,
                is_preferred=True,
            ),
            # Displays
            SupplierComponentDTO(
                supplier_code="SUP-LUMEN",
                component_sku="DISP-15-OLED",
                unit_cost=Decimal("120.00"),
                lead_time_days=14,
                min_order_qty=150,
                max_weekly_capacity=800,
                is_preferred=True,
            ),
            SupplierComponentDTO(
                supplier_code="SUP-LUMEN",
                component_sku="DISP-13-IPS",
                unit_cost=Decimal("65.00"),
                lead_time_days=10,
                min_order_qty=200,
                max_weekly_capacity=1200,
                is_preferred=True,
            ),
            # Storage
            SupplierComponentDTO(
                supplier_code="SUP-FLASH",
                component_sku="SSD-1TB",
                unit_cost=Decimal("52.00"),
                lead_time_days=8,
                min_order_qty=400,
                max_weekly_capacity=3000,
                is_preferred=True,
            ),
            SupplierComponentDTO(
                supplier_code="SUP-FLASH",
                component_sku="SSD-2TB",
                unit_cost=Decimal("98.00"),
                lead_time_days=8,
                min_order_qty=200,
                max_weekly_capacity=1500,
                is_preferred=True,
            ),
            # Mandatory Edge Case: Component with ONLY ONE supplier offer (single source)
            SupplierComponentDTO(
                supplier_code="SUP-CIRCUIT",
                component_sku="MB-PRO-01",
                unit_cost=Decimal("185.00"),
                lead_time_days=18,
                min_order_qty=100,
                max_weekly_capacity=600,
                is_preferred=True,
                expedite_available=True,
                expedite_lead_time_days=7,
                expedite_cost_premium_pct=Decimal("0.3500"),
            ),
            # Chassis
            SupplierComponentDTO(
                supplier_code="SUP-METALS",
                component_sku="CHAS-ALU-15",
                unit_cost=Decimal("55.00"),
                lead_time_days=12,
                min_order_qty=300,
                max_weekly_capacity=2000,
                is_preferred=True,
            ),
            # Keyboard
            SupplierComponentDTO(
                supplier_code="SUP-CIRCUIT",
                component_sku="KB-BACKLIT-EN",
                unit_cost=Decimal("18.00"),
                lead_time_days=9,
                min_order_qty=500,
                max_weekly_capacity=4000,
                is_preferred=True,
            ),
            # Spare sensor
            SupplierComponentDTO(
                supplier_code="SUP-CIRCUIT",
                component_sku="COMP-SPARE-01",
                unit_cost=Decimal("12.50"),
                lead_time_days=15,
                min_order_qty=50,
                max_weekly_capacity=500,
                is_preferred=True,
            ),
        ]

        # 7. Inventory Levels
        # Mandatory CPU-X7 scenario:
        # Plant on_hand=520, reserved=100 (usable 420).
        # Regional WH-REG-EAST on_hand=150, reserved=0 (usable 150).
        inventory_levels = [
            InventoryLevelDTO(
                component_sku="CPU-X7",
                warehouse_code="WH-PLANT",
                on_hand=520,
                reserved=100,
                as_of_ts=now_utc,
            ),
            InventoryLevelDTO(
                component_sku="CPU-X7",
                warehouse_code="WH-REG-EAST",
                on_hand=150,
                reserved=0,
                as_of_ts=now_utc,
            ),
            InventoryLevelDTO(
                component_sku="CPU-X7",
                warehouse_code="WH-REG-WEST",
                on_hand=50,
                reserved=0,
                as_of_ts=now_utc,
            ),
        ]

        # Other components inventory
        base_stocks = {
            "CPU-X5": (850, 150, 200, 100),
            "RAM-16GB": (3200, 600, 800, 500),
            "RAM-32GB": (1100, 200, 300, 150),
            "BAT-70WH": (680, 120, 250, 100),
            "BAT-50WH": (920, 180, 200, 100),
            "DISP-15-OLED": (750, 150, 180, 80),
            "DISP-13-IPS": (840, 140, 220, 90),
            "SSD-1TB": (2400, 450, 600, 400),
            "SSD-2TB": (890, 160, 200, 100),
            "MB-PRO-01": (620, 110, 150, 80),
            "CHAS-ALU-15": (1450, 250, 350, 200),
            "KB-BACKLIT-EN": (2100, 300, 500, 300),
            "COMP-SPARE-01": (120, 0, 30, 20),
        }
        for sku, (p_hand, p_res, r1_hand, r2_hand) in base_stocks.items():
            inventory_levels.extend([
                InventoryLevelDTO(
                    component_sku=sku,
                    warehouse_code="WH-PLANT",
                    on_hand=p_hand,
                    reserved=p_res,
                    as_of_ts=now_utc,
                ),
                InventoryLevelDTO(
                    component_sku=sku,
                    warehouse_code="WH-REG-EAST",
                    on_hand=r1_hand,
                    reserved=0,
                    as_of_ts=now_utc,
                ),
                InventoryLevelDTO(
                    component_sku=sku,
                    warehouse_code="WH-REG-WEST",
                    on_hand=r2_hand,
                    reserved=0,
                    as_of_ts=now_utc,
                ),
            ])

        # 8. Demand Records (180 days ending as_of - 1 day)
        demand_records: List[DemandRecordDTO] = []
        start_date = self.as_of - timedelta(days=180)

        for comp in components:
            sku = comp.sku
            if sku == "COMP-SPARE-01":
                # Mandatory Edge Case: Active component with ZERO demand
                for d_offset in range(180):
                    curr_date = start_date + timedelta(days=d_offset)
                    demand_records.append(
                        DemandRecordDTO(component_sku=sku, date=curr_date, quantity=0)
                    )
                continue

            for d_offset in range(180):
                curr_date = start_date + timedelta(days=d_offset)
                is_weekend = curr_date.weekday() >= 5
                days_before_as_of = (self.as_of - curr_date).days

                if sku == "CPU-X7":
                    # Mandatory Scenario: Trailing-30-day average between 90 and 110.
                    # Base pattern: weekday ~125, weekend ~40.
                    # In a typical 30-day window (~21-22 weekdays, 8-9 weekend):
                    # 21.5 * 125 + 8.5 * 40 = 2687.5 + 340 = 3027.5 / 30 = ~100.9 units/day.
                    # Add mild noise bounded by +/- 4.
                    noise = rng.randint(-4, 4)
                    qty = (40 if is_weekend else 125) + noise
                elif sku == "RAM-16GB" and 3 <= days_before_as_of <= 21:
                    # Mandatory: Component with recent demand spike in the last 3 weeks
                    noise = rng.randint(-10, 10)
                    qty = (120 if is_weekend else 360) + noise  # 2.5x spike
                else:
                    # Standard demand pattern for other components
                    base_mean = 80 if comp.criticality == "critical" else 50
                    noise = rng.randint(-8, 8)
                    qty = max(0, (20 if is_weekend else base_mean) + noise)

                demand_records.append(
                    DemandRecordDTO(component_sku=sku, date=curr_date, quantity=max(0, qty))
                )

        # 9. Purchase Orders (20+ purchase orders)
        # Mandatory items:
        # - CPU-X7 in_transit PO from SUP-HELIX: qty 800 to plant, promised_date = as_of + 7, latest_estimate_date = None.
        # - Overdue open/in_transit PO: promised_date < as_of.
        # - Partially received PO: qty_received > 0 and < qty_ordered.
        # - Component with NO open purchase order: KB-BACKLIT-EN (only has received POs or none open).
        purchase_orders = [
            # 1. Mandatory CPU-X7 story PO
            PurchaseOrderDTO(
                po_number="PO-CPU-701",
                supplier_code="SUP-HELIX",
                status="in_transit",
                order_date=self.as_of - timedelta(days=7),
                promised_date=self.as_of + timedelta(days=7),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="CPU-X7",
                        warehouse_code="WH-PLANT",
                        qty_ordered=800,
                        qty_received=0,
                        unit_price=Decimal("250.00"),
                    )
                ],
            ),
            # 2. Mandatory Overdue PO
            PurchaseOrderDTO(
                po_number="PO-OVERDUE-01",
                supplier_code="SUP-CORE",
                status="in_transit",
                order_date=self.as_of - timedelta(days=18),
                promised_date=self.as_of - timedelta(days=4),
                latest_estimate_date=self.as_of + timedelta(days=3),
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="RAM-16GB",
                        warehouse_code="WH-PLANT",
                        qty_ordered=1000,
                        qty_received=0,
                        unit_price=Decimal("38.00"),
                    )
                ],
            ),
            # 3. Mandatory Partially Received PO
            PurchaseOrderDTO(
                po_number="PO-PARTIAL-01",
                supplier_code="SUP-VOLT",
                status="partially_received",
                order_date=self.as_of - timedelta(days=12),
                promised_date=self.as_of - timedelta(days=2),
                latest_estimate_date=self.as_of + timedelta(days=4),
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="BAT-70WH",
                        warehouse_code="WH-PLANT",
                        qty_ordered=500,
                        qty_received=200,
                        unit_price=Decimal("48.00"),
                    )
                ],
            ),
            # 4. Open PO for CPU-X5
            PurchaseOrderDTO(
                po_number="PO-CPU-501",
                supplier_code="SUP-HELIX",
                status="open",
                order_date=self.as_of - timedelta(days=2),
                promised_date=self.as_of + timedelta(days=10),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="CPU-X5",
                        warehouse_code="WH-PLANT",
                        qty_ordered=600,
                        qty_received=0,
                        unit_price=Decimal("170.00"),
                    )
                ],
            ),
            # 5. In transit display PO
            PurchaseOrderDTO(
                po_number="PO-DISP-01",
                supplier_code="SUP-LUMEN",
                status="in_transit",
                order_date=self.as_of - timedelta(days=6),
                promised_date=self.as_of + timedelta(days=8),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="DISP-15-OLED",
                        warehouse_code="WH-PLANT",
                        qty_ordered=300,
                        qty_received=0,
                        unit_price=Decimal("120.00"),
                    )
                ],
            ),
            # 6. Open storage PO
            PurchaseOrderDTO(
                po_number="PO-SSD-01",
                supplier_code="SUP-FLASH",
                status="open",
                order_date=self.as_of - timedelta(days=1),
                promised_date=self.as_of + timedelta(days=7),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="SSD-1TB",
                        warehouse_code="WH-PLANT",
                        qty_ordered=800,
                        qty_received=0,
                        unit_price=Decimal("52.00"),
                    )
                ],
            ),
            # 7. Motherboard open PO
            PurchaseOrderDTO(
                po_number="PO-MB-01",
                supplier_code="SUP-CIRCUIT",
                status="open",
                order_date=self.as_of - timedelta(days=5),
                promised_date=self.as_of + timedelta(days=13),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="MB-PRO-01",
                        warehouse_code="WH-PLANT",
                        qty_ordered=400,
                        qty_received=0,
                        unit_price=Decimal("185.00"),
                    )
                ],
            ),
            # 8. Chassis in-transit PO
            PurchaseOrderDTO(
                po_number="PO-CHAS-01",
                supplier_code="SUP-METALS",
                status="in_transit",
                order_date=self.as_of - timedelta(days=8),
                promised_date=self.as_of + timedelta(days=4),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="CHAS-ALU-15",
                        warehouse_code="WH-PLANT",
                        qty_ordered=500,
                        qty_received=0,
                        unit_price=Decimal("55.00"),
                    )
                ],
            ),
            # 9. Cancelled PO
            PurchaseOrderDTO(
                po_number="PO-CANC-01",
                supplier_code="SUP-NEXUS",
                status="cancelled",
                order_date=self.as_of - timedelta(days=25),
                promised_date=self.as_of - timedelta(days=15),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="CPU-X7",
                        warehouse_code="WH-PLANT",
                        qty_ordered=200,
                        qty_received=0,
                        unit_price=Decimal("295.00"),
                    )
                ],
            ),
            # 10. Received PO for KB-BACKLIT-EN (No open PO for this component!)
            PurchaseOrderDTO(
                po_number="PO-KB-REC-01",
                supplier_code="SUP-CIRCUIT",
                status="received",
                order_date=self.as_of - timedelta(days=35),
                promised_date=self.as_of - timedelta(days=26),
                latest_estimate_date=None,
                lines=[
                    PurchaseOrderLineDTO(
                        component_sku="KB-BACKLIT-EN",
                        warehouse_code="WH-PLANT",
                        qty_ordered=1000,
                        qty_received=1000,
                        unit_price=Decimal("18.00"),
                    )
                ],
            ),
        ]

        # Add 12 more historical received / closed POs to reach 22 total
        for i in range(11, 23):
            sup = suppliers[i % len(suppliers)]
            po_num = f"PO-HIST-{i:03d}"
            od = self.as_of - timedelta(days=rng.randint(40, 180))
            pd = od + timedelta(days=rng.randint(7, 21))
            status_choice = "received" if i != 18 else "cancelled"

            # pick component
            c_sku = "RAM-32GB" if i % 2 == 0 else "SSD-2TB"
            qty = rng.randint(200, 600)
            rec_qty = qty if status_choice == "received" else 0

            purchase_orders.append(
                PurchaseOrderDTO(
                    po_number=po_num,
                    supplier_code=sup.code,
                    status=status_choice,
                    order_date=od,
                    promised_date=pd,
                    latest_estimate_date=None,
                    lines=[
                        PurchaseOrderLineDTO(
                            component_sku=c_sku,
                            warehouse_code="WH-PLANT",
                            qty_ordered=qty,
                            qty_received=rec_qty,
                            unit_price=Decimal("65.00"),
                        )
                    ],
                )
            )

        # 10. Delivery Records (180+ records)
        # Mandatory requirements:
        # - SUP-HELIX: clearly unreliable (on-time rate roughly 65-75%, multi-day delays, rejections).
        # - SUP-LUMEN: clearly reliable (on-time rate > 95%, 0 delays or near 0, 0 rejections).
        # - Overall count >= 150.
        delivery_records: List[DeliveryRecordDTO] = []

        # Deliveries for SUP-HELIX (~40 records)
        for i in range(40):
            promised = self.as_of - timedelta(days=rng.randint(15, 340))
            is_delayed = (i % 3 == 0) or (i % 7 == 0)  # ~35% delayed -> ~65-70% on-time
            delay_days = rng.randint(2, 14) if is_delayed else 0
            actual = promised + timedelta(days=delay_days)
            ordered = rng.randint(300, 1000)
            received = ordered
            rejected = rng.randint(5, 40) if (i % 4 == 0) else 0

            delivery_records.append(
                DeliveryRecordDTO(
                    supplier_code="SUP-HELIX",
                    component_sku="CPU-X7" if i % 2 == 0 else "CPU-X5",
                    po_number=None,
                    promised_date=promised,
                    actual_date=actual,
                    qty_ordered=ordered,
                    qty_received=received,
                    qty_rejected=rejected,
                )
            )

        # Deliveries for SUP-LUMEN (~35 records) - highly reliable (>95% on-time, 0 rejections)
        for i in range(35):
            promised = self.as_of - timedelta(days=rng.randint(15, 340))
            # 1 delivery slightly delayed by 1 day out of 35 -> 34/35 = ~97.1% on-time
            delay_days = 1 if i == 12 else 0
            actual = promised + timedelta(days=delay_days)
            ordered = rng.randint(200, 600)

            delivery_records.append(
                DeliveryRecordDTO(
                    supplier_code="SUP-LUMEN",
                    component_sku="DISP-15-OLED" if i % 2 == 0 else "DISP-13-IPS",
                    po_number=None,
                    promised_date=promised,
                    actual_date=actual,
                    qty_ordered=ordered,
                    qty_received=ordered,
                    qty_rejected=0,
                )
            )

        # Deliveries for remaining 6 suppliers (~20 records each -> 120 records)
        other_suppliers = [s for s in suppliers if s.code not in ("SUP-HELIX", "SUP-LUMEN")]
        for s in other_suppliers:
            for j in range(20):
                promised = self.as_of - timedelta(days=rng.randint(15, 340))
                is_delayed = j % 6 == 0  # ~83% on-time
                delay_days = rng.randint(1, 5) if is_delayed else 0
                actual = promised + timedelta(days=delay_days)
                ordered = rng.randint(200, 800)
                rejected = rng.randint(1, 10) if (j % 10 == 0) else 0

                delivery_records.append(
                    DeliveryRecordDTO(
                        supplier_code=s.code,
                        component_sku="RAM-16GB" if "CORE" in s.code else "SSD-1TB",
                        po_number=None,
                        promised_date=promised,
                        actual_date=actual,
                        qty_ordered=ordered,
                        qty_received=ordered,
                        qty_rejected=rejected,
                    )
                )

        # 11. Customer Orders (28 orders >= 25)
        # Fictional customer names, open orders due within next ~30 days, several critical,
        # includes products using CPU-X7 (LAPTOP-PRO-15, LAPTOP-GAMING-16).
        customer_names = [
            "Meridian Global Logistics",
            "Apex Enterprise Systems",
            "Vanguard Financial Tech",
            "Summit Cloud Dynamics",
            "Orion Healthcare Informatics",
            "Pacific Retail Solutions",
            "Atlas Engineering Group",
            "Helios Clean Energy",
            "Beacon Telecom",
            "Centurion Data Labs",
        ]

        customer_orders: List[CustomerOrderDTO] = []
        for i in range(28):
            cust_name = customer_names[i % len(customer_names)]
            prod = products[i % len(products)]
            order_num = f"ORD-{2026000 + i}"
            qty = rng.randint(20, 150)
            due = self.as_of + timedelta(days=rng.randint(5, 35))

            if i < 8:
                priority = "critical"
                status = "open"
                # ensure critical open orders use CPU-X7 products
                prod = products[0] if i % 2 == 0 else products[2]
            elif i < 18:
                priority = "high"
                status = "open" if i % 2 == 0 else "in_production"
            elif i < 24:
                priority = "normal"
                status = "shipped"
            else:
                priority = "low"
                status = "cancelled" if i == 27 else "open"

            customer_orders.append(
                CustomerOrderDTO(
                    order_number=order_num,
                    customer_name=cust_name,
                    product_sku=prod.sku,
                    quantity=qty,
                    due_date=due,
                    priority=priority,
                    status=status,
                )
            )

        return SourceDataset(
            meta=meta,
            warehouses=warehouses,
            products=products,
            components=components,
            bom_lines=bom_lines,
            suppliers=suppliers,
            supplier_components=supplier_components,
            inventory_levels=inventory_levels,
            purchase_orders=purchase_orders,
            customer_orders=customer_orders,
            demand_records=demand_records,
            delivery_records=delivery_records,
        )
