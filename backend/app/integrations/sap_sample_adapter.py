"""app/integrations/sap_sample_adapter.py

SAP-Style Sample Adapter for SupplyChain Sentinel AI.

Reads a static illustrative SAP-style JSON fixture and maps it into a SourceDataset
using app.integrations.sap_mapping.

HONEST LABELLING & ZERO LIVE CLAIMS:
- is_live is hardcoded to False.
- It makes absolutely NO network or socket calls.
- All data is synthetic SAMPLE DATA.
- The fixture only supplies materials, plants, suppliers, inventory levels, and purchase orders.
- Missing entities (demand history, delivery history, supplier contract offers, customer orders, BOM lines)
  are strictly omitted and clearly flagged in the coverage report.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.integrations.base import (
    DatasetMetaDTO,
    SourceAdapter,
    SourceDataset,
)
from app.integrations.sap_mapping import (
    map_sap_material,
    map_sap_plant,
    map_sap_purchase_order,
    map_sap_stock,
    map_sap_supplier,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "sap_style_sample.json"

SAP_DISCLAIMER_TEXT = (
    "No live SAP connection is configured. To connect a real SAP system you need: "
    "an SAP BTP or S/4HANA account with API access, credentials stored as environment secrets, "
    "and verification of the API field mapping."
)


class SapSampleAdapter(SourceAdapter):
    """Adapter reading static SAP-style sample fixture through the illustrative mapping layer."""

    name: str = "sap-style-sample"
    is_live: bool = False

    def __init__(self, fixture_file: Optional[Path] = None) -> None:
        self.fixture_file = fixture_file or FIXTURE_PATH

    def get_coverage_report(self) -> Dict[str, Any]:
        """Return a structured coverage report detailing present vs missing entity feeds."""
        return {
            "source": self.name,
            "is_live": self.is_live,
            "label": "SAP-STYLE SAMPLE (STATIC FIXTURE)",
            "entities_covered": [
                "warehouses",
                "components",
                "suppliers",
                "inventory_levels",
                "purchase_orders",
                "purchase_order_lines",
            ],
            "entities_missing": [
                "products",
                "bom_lines",
                "supplier_components",
                "customer_orders",
                "demand_records",
                "delivery_records",
            ],
            "notes": {
                "demand_records": (
                    "No historical consumption/sales demand records provided; "
                    "inventory risk cannot compute mean daily demand (risk remains unknown / insufficient history)."
                ),
                "delivery_records": (
                    "No historical goods receipts against past purchase orders provided; "
                    "supplier risk on-time score cannot be evaluated."
                ),
                "supplier_components": (
                    "No negotiated alternative supplier terms or lead times provided; "
                    "recovery engine cannot evaluate alternative supplier procurement."
                ),
                "customer_orders": (
                    "No customer order backlog provided; financial exposure impact cannot be computed."
                ),
                "products": "No finished goods / catalog items defined in sample.",
                "bom_lines": "No bill of materials explosion defined in sample.",
            },
            "disclaimer": SAP_DISCLAIMER_TEXT,
        }

    def fetch_dataset(self) -> SourceDataset:
        """Read static JSON fixture and map records through the illustrative mapping layer.

        Guaranteed pure file read; zero network or socket access.
        """
        if not self.fixture_file.exists():
            raise FileNotFoundError(f"SAP sample fixture file not found at {self.fixture_file}")

        with open(self.fixture_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        as_of_str = data.get("as_of", "2026-10-18")
        as_of_date = datetime.strptime(as_of_str, "%Y-%m-%d").date()
        as_of_ts = datetime(as_of_date.year, as_of_date.month, as_of_date.day, 0, 0, 0, tzinfo=timezone.utc)

        # 1. Plants -> Warehouses
        warehouses = [
            map_sap_plant(p.get("Plant", ""), p.get("PlantName", ""))
            for p in data.get("plants", [])
        ]

        # 2. Materials -> Components
        components = [
            map_sap_material(m)
            for m in data.get("materials", [])
        ]

        # 3. Suppliers
        suppliers = [
            map_sap_supplier(s)
            for s in data.get("suppliers", [])
        ]

        # 4. Stock -> Inventory Levels
        inventory_levels = [
            map_sap_stock(st, as_of_ts=as_of_ts)
            for st in data.get("stock", [])
        ]

        # 5. Purchase Orders
        purchase_orders = []
        for raw_po in data.get("purchase_orders", []):
            po_dto, _ = map_sap_purchase_order(raw_po)
            purchase_orders.append(po_dto)

        meta = DatasetMetaDTO(
            label="SAP-STYLE SAMPLE (STATIC FIXTURE)",
            source=self.name,
            seed=0,
            as_of=as_of_date,
            generator_version="0.1.0-sap-sample",
            generated_at=datetime.now(timezone.utc),
        )

        return SourceDataset(
            meta=meta,
            warehouses=warehouses,
            products=[],
            components=components,
            bom_lines=[],
            suppliers=suppliers,
            supplier_components=[],
            inventory_levels=inventory_levels,
            purchase_orders=purchase_orders,
            customer_orders=[],
            demand_records=[],
            delivery_records=[],
        )
