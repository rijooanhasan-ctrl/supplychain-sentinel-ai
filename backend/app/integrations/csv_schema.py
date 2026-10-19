"""app/integrations/csv_schema.py

Schema definitions, template definitions, and validation utilities for CSV file import.
Used by FileAdapter and CLI (validate-files, export-template).
"""

from __future__ import annotations

from typing import Dict, List, Optional

REQUIRED_FILES = [
    "warehouses.csv",
    "components.csv",
    "suppliers.csv",
    "inventory.csv",
]

OPTIONAL_FILES = [
    "demand_history.csv",
    "purchase_orders.csv",
    "supplier_offers.csv",
    "delivery_history.csv",
    "products.csv",
    "bom.csv",
    "customer_orders.csv",
]

ALL_CSV_FILES = REQUIRED_FILES + OPTIONAL_FILES

CSV_COLUMNS: Dict[str, List[str]] = {
    "warehouses.csv": ["code", "name", "role"],
    "components.csv": ["sku", "name", "category", "unit_of_measure", "criticality", "is_active"],
    "suppliers.csv": ["code", "name", "country"],
    "inventory.csv": ["component_sku", "warehouse_code", "on_hand", "reserved"],
    "demand_history.csv": ["component_sku", "date", "quantity"],
    "purchase_orders.csv": [
        "po_number",
        "supplier_code",
        "status",
        "order_date",
        "promised_date",
        "latest_estimate_date",
        "component_sku",
        "warehouse_code",
        "qty_ordered",
        "qty_received",
        "unit_price",
    ],
    "supplier_offers.csv": [
        "supplier_code",
        "component_sku",
        "unit_cost",
        "lead_time_days",
        "min_order_qty",
        "max_weekly_capacity",
        "is_preferred",
        "expedite_available",
        "expedite_lead_time_days",
        "expedite_cost_premium_pct",
    ],
    "delivery_history.csv": [
        "supplier_code",
        "component_sku",
        "promised_date",
        "actual_date",
        "qty_ordered",
        "qty_received",
        "qty_rejected",
    ],
    "products.csv": ["sku", "name", "selling_price"],
    "bom.csv": ["product_sku", "component_sku", "quantity_per_unit"],
    "customer_orders.csv": [
        "order_number",
        "customer_name",
        "product_sku",
        "quantity",
        "due_date",
        "priority",
        "status",
    ],
}

# Optional columns per file (empty string allowed, parsed as None)
NULLABLE_COLUMNS: Dict[str, set[str]] = {
    "purchase_orders.csv": {"latest_estimate_date"},
    "supplier_offers.csv": {
        "max_weekly_capacity",
        "expedite_lead_time_days",
        "expedite_cost_premium_pct",
    },
}

TEMPLATE_SAMPLES: Dict[str, List[Dict[str, str]]] = {
    "warehouses.csv": [
        {"code": "WH-PLANT-01", "name": "Main Laptop Assembly Plant", "role": "plant"},
        {"code": "WH-REG-NORTH", "name": "Regional Logistics Center North", "role": "regional"},
    ],
    "components.csv": [
        {
            "sku": "CMP-CPU-001",
            "name": "Intel Core i7-13700H Mobile Processor",
            "category": "Processors",
            "unit_of_measure": "EA",
            "criticality": "critical",
            "is_active": "true",
        },
        {
            "sku": "CMP-RAM-002",
            "name": "DDR5 SO-DIMM 16GB 4800MHz",
            "category": "Memory",
            "unit_of_measure": "EA",
            "criticality": "high",
            "is_active": "true",
        },
    ],
    "suppliers.csv": [
        {"code": "SUP-INT-01", "name": "Global Silicon Foundries Ltd", "country": "TW"},
        {"code": "SUP-MEM-02", "name": "Pacific Memory Modules Inc", "country": "KR"},
    ],
    "inventory.csv": [
        {"component_sku": "CMP-CPU-001", "warehouse_code": "WH-PLANT-01", "on_hand": "250", "reserved": "50"},
        {"component_sku": "CMP-RAM-002", "warehouse_code": "WH-PLANT-01", "on_hand": "600", "reserved": "120"},
    ],
    "demand_history.csv": [
        {"component_sku": "CMP-CPU-001", "date": "2026-09-01", "quantity": "18"},
        {"component_sku": "CMP-CPU-001", "date": "2026-09-02", "quantity": "22"},
        {"component_sku": "CMP-RAM-002", "date": "2026-09-01", "quantity": "36"},
        {"component_sku": "CMP-RAM-002", "date": "2026-09-02", "quantity": "44"},
    ],
    "purchase_orders.csv": [
        {
            "po_number": "PO-2026-001",
            "supplier_code": "SUP-INT-01",
            "status": "open",
            "order_date": "2026-09-15",
            "promised_date": "2026-10-10",
            "latest_estimate_date": "2026-10-14",
            "component_sku": "CMP-CPU-001",
            "warehouse_code": "WH-PLANT-01",
            "qty_ordered": "500",
            "qty_received": "0",
            "unit_price": "185.00",
        },
        {
            "po_number": "PO-2026-002",
            "supplier_code": "SUP-MEM-02",
            "status": "partially_received",
            "order_date": "2026-09-10",
            "promised_date": "2026-10-01",
            "latest_estimate_date": "",
            "component_sku": "CMP-RAM-002",
            "warehouse_code": "WH-PLANT-01",
            "qty_ordered": "1000",
            "qty_received": "400",
            "unit_price": "45.50",
        },
    ],
    "supplier_offers.csv": [
        {
            "supplier_code": "SUP-INT-01",
            "component_sku": "CMP-CPU-001",
            "unit_cost": "185.00",
            "lead_time_days": "21",
            "min_order_qty": "100",
            "max_weekly_capacity": "500",
            "is_preferred": "true",
            "expedite_available": "true",
            "expedite_lead_time_days": "10",
            "expedite_cost_premium_pct": "0.15",
        },
        {
            "supplier_code": "SUP-MEM-02",
            "component_sku": "CMP-RAM-002",
            "unit_cost": "45.50",
            "lead_time_days": "14",
            "min_order_qty": "200",
            "max_weekly_capacity": "1000",
            "is_preferred": "true",
            "expedite_available": "false",
            "expedite_lead_time_days": "",
            "expedite_cost_premium_pct": "",
        },
    ],
    "delivery_history.csv": [
        {
            "supplier_code": "SUP-INT-01",
            "component_sku": "CMP-CPU-001",
            "promised_date": "2026-08-15",
            "actual_date": "2026-08-15",
            "qty_ordered": "300",
            "qty_received": "300",
            "qty_rejected": "0",
        },
        {
            "supplier_code": "SUP-MEM-02",
            "component_sku": "CMP-RAM-002",
            "promised_date": "2026-08-20",
            "actual_date": "2026-08-23",
            "qty_ordered": "500",
            "qty_received": "500",
            "qty_rejected": "5",
        },
    ],
    "products.csv": [
        {"sku": "PRD-LAP-01", "name": "UltraBook Pro 15", "selling_price": "1299.00"},
        {"sku": "PRD-LAP-02", "name": "WorkStation Max 17", "selling_price": "2199.00"},
    ],
    "bom.csv": [
        {"product_sku": "PRD-LAP-01", "component_sku": "CMP-CPU-001", "quantity_per_unit": "1"},
        {"product_sku": "PRD-LAP-01", "component_sku": "CMP-RAM-002", "quantity_per_unit": "2"},
        {"product_sku": "PRD-LAP-02", "component_sku": "CMP-CPU-001", "quantity_per_unit": "1"},
        {"product_sku": "PRD-LAP-02", "component_sku": "CMP-RAM-002", "quantity_per_unit": "4"},
    ],
    "customer_orders.csv": [
        {
            "order_number": "ORD-2026-101",
            "customer_name": "Apex Enterprise Solutions",
            "product_sku": "PRD-LAP-01",
            "quantity": "50",
            "due_date": "2026-11-01",
            "priority": "high",
            "status": "open",
        },
        {
            "order_number": "ORD-2026-102",
            "customer_name": "Global Tech Logistics",
            "product_sku": "PRD-LAP-02",
            "quantity": "25",
            "due_date": "2026-11-15",
            "priority": "normal",
            "status": "open",
        },
    ],
}

README_TEMPLATE = """# SupplyChain Sentinel AI — CSV File Import Templates

These CSV files provide the template structure for user-supplied data import.
All files use standard UTF-8 encoding with a comma (,) delimiter and a header row.

IMPORTANT RULES & GUIDELINES:
1. STORED CURRENCY IS USD:
   All money amounts (selling_price, unit_price, unit_cost) MUST be provided in US Dollars (USD).
   Display currency conversions (such as INR) are applied dynamically by the application layer.

2. AS-OF DATE:
   You must provide an as-of cutoff date (--as-of YYYY-MM-DD) when importing files.
   Demand history records should end the day before the as-of date.

3. REQUIRED FILES:
   - warehouses.csv (must contain at least one plant warehouse: role='plant')
   - components.csv
   - suppliers.csv
   - inventory.csv

4. OPTIONAL FILES (Omission consequences):
   - demand_history.csv: without this, demand forecasts and shortage projections show "insufficient history".
   - purchase_orders.csv: without this, inbound pipeline visibility is absent.
   - supplier_offers.csv: without this, automated recovery recommendations are unavailable.
   - delivery_history.csv: without this, supplier reliability and on-time risk are unknown.
   - products.csv, bom.csv, customer_orders.csv: without these, customer order exposure figures are unavailable.

5. SAMPLE DATA:
   The rows included in these template files are purely FICTIONAL example rows.
   Replace them with your actual data before running:
     python -m app.cli validate-files --path <folder> --as-of <YYYY-MM-DD>
     python -m app.cli seed --source file --path <folder> --as-of <YYYY-MM-DD> --reset
"""

import csv
from pathlib import Path


def export_templates(dest_dir: Path | str) -> List[Path]:
    """Writes blank CSV templates with 1-2 fictional example rows and a README.txt.

    Refuses to overwrite if any target files already exist in dest_dir.
    """
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)

    existing = []
    if (dest / "README.txt").exists():
        existing.append("README.txt")
    for fname in ALL_CSV_FILES:
        if (dest / fname).exists():
            existing.append(fname)

    if existing:
        raise FileExistsError(
            f"Cannot export templates: destination folder '{dest}' already contains files: {', '.join(existing)}. "
            "Refusing to overwrite existing files."
        )

    written: List[Path] = []
    readme_path = dest / "README.txt"
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(README_TEMPLATE)
    written.append(readme_path)

    for fname in ALL_CSV_FILES:
        fpath = dest / fname
        cols = CSV_COLUMNS[fname]
        samples = TEMPLATE_SAMPLES.get(fname, [])
        with open(fpath, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=cols)
            writer.writeheader()
            for row in samples:
                writer.writerow(row)
        written.append(fpath)

    return written

