# User-Supplied CSV Data Import Guide

SupplyChain Sentinel AI supports importing custom, user-supplied operational data through a strictly offline, CLI-driven CSV import pipeline (`FileAdapter`).

This document details the file formats, schemas, validation rules, coverage implications, and command-line usage.

---

## 1. High-Level Principles & Limitations

- **Offline & CLI Only**: Import is strictly performed via the command-line interface (`app.cli`). There is **no web upload endpoint** and **no write API** (`POST`/`PUT`/`DELETE`).
- **Zero Live Connections**: SupplyChain Sentinel AI never touches live ERP systems or creates purchase orders.
- **Transactional & All-or-Nothing**: All CSV files and cross-table references are validated upfront. If any error is found (capped at 50 reported errors), nothing is loaded into the database.
- **Currency Standard**: All monetary values (`selling_price`, `unit_price`, `unit_cost`) **must be provided in US Dollars (USD)**. Currency display conversions (such as INR) are applied dynamically by the presentation layer.
- **Reference As-Of Date**: Importing user files requires an explicit `--as-of YYYY-MM-DD` cutoff date. Demand history records should end the day before this date.
- **Incomplete Feeds & "Unknown" Status**: When optional files are omitted, features degrade gracefully into "unknown" or "insufficient history" states rather than crashing or inventing numbers.

---

## 2. File Specifications & Columns

Import datasets are placed in a folder containing up to 11 UTF-8 encoded CSV files with standard header rows.

### Required Files (Core Entities)

1. **`warehouses.csv`**
   - **Columns**: `code`, `name`, `role`
   - **Role Enum**: `plant` or `regional`
   - **Rule**: Exactly one warehouse with `role='plant'` is required for production inventory consumption.
   - **Example**:
     ```csv
     code,name,role
     WH-PLANT-01,Main Laptop Assembly Plant,plant
     WH-REG-NORTH,Regional Logistics Center North,regional
     ```

2. **`components.csv`**
   - **Columns**: `sku`, `name`, `category`, `unit_of_measure`, `criticality`, `is_active`
   - **Criticality Enum**: `critical`, `high`, `normal`
   - **is_active**: Boolean (`true` / `false`)
   - **Example**:
     ```csv
     sku,name,category,unit_of_measure,criticality,is_active
     CMP-CPU-001,Intel Core i7-13700H Mobile Processor,Processors,EA,critical,true
     CMP-RAM-002,DDR5 SO-DIMM 16GB 4800MHz,Memory,EA,high,true
     ```

3. **`suppliers.csv`**
   - **Columns**: `code`, `name`, `country`
   - **Example**:
     ```csv
     code,name,country
     SUP-INT-01,Global Silicon Foundries Ltd,TW
     SUP-MEM-02,Pacific Memory Modules Inc,KR
     ```

4. **`inventory.csv`**
   - **Columns**: `component_sku`, `warehouse_code`, `on_hand`, `reserved`
   - **Foreign Keys**: `component_sku` must exist in `components.csv`; `warehouse_code` in `warehouses.csv`.
   - **Rules**: `on_hand >= 0`, `reserved >= 0`. Unique pair `(component_sku, warehouse_code)`.
   - **Example**:
     ```csv
     component_sku,warehouse_code,on_hand,reserved
     CMP-CPU-001,WH-PLANT-01,250,50
     CMP-RAM-002,WH-PLANT-01,600,120
     ```

---

### Optional Files & Missing Consequences

If an optional file is omitted, the system continues to operate but flags the omission in the coverage report:

| Optional File | Columns | Consequence if Omitted |
|---|---|---|
| `demand_history.csv` | `component_sku`, `date`, `quantity` | Demand forecasts and shortage projections show "insufficient history"; component risk level remains "unknown". |
| `purchase_orders.csv` | `po_number`, `supplier_code`, `status`, `order_date`, `promised_date`, `latest_estimate_date`, `component_sku`, `warehouse_code`, `qty_ordered`, `qty_received`, `unit_price` | Inbound pipeline visibility is absent; zero scheduled receipts. |
| `supplier_offers.csv` | `supplier_code`, `component_sku`, `unit_cost`, `lead_time_days`, `min_order_qty`, `max_weekly_capacity`, `is_preferred`, `expedite_available`, `expedite_lead_time_days`, `expedite_cost_premium_pct` | Automated recovery options (expedite, alternate supplier) cannot be evaluated. |
| `delivery_history.csv` | `supplier_code`, `component_sku`, `promised_date`, `actual_date`, `qty_ordered`, `qty_received`, `qty_rejected` | Supplier on-time and quality score is unknown. |
| `products.csv` | `sku`, `name`, `selling_price` | Finished goods revenue exposure calculation unavailable. |
| `bom.csv` | `product_sku`, `component_sku`, `quantity_per_unit` | Cannot map component stockouts to affected customer orders. |
| `customer_orders.csv` | `order_number`, `customer_name`, `product_sku`, `quantity`, `due_date`, `priority`, `status` | Financial exposure and exposed customer orders cannot be evaluated. |

---

## 3. Validation Rules

All validation occurs before database interaction:
1. **Header & Required Files**: Required files must exist; all expected column headers must match exactly.
2. **Data Types**: Dates must follow ISO `YYYY-MM-DD`; quantities must be integers; prices and costs must be decimals.
3. **Empty Cells**:
   - Nullable columns (`latest_estimate_date`, `max_weekly_capacity`, `expedite_lead_time_days`, `expedite_cost_premium_pct`) parse as `None` if blank.
   - Non-nullable columns cannot be blank.
4. **Logical Boundaries**:
   - `qty_ordered > 0`
   - `qty_received >= 0` and `qty_received <= qty_ordered`
   - `qty_rejected >= 0` and `qty_rejected <= qty_received`
   - `unit_cost > 0`, `unit_price >= 0`, `selling_price >= 0`
   - `lead_time_days >= 0`, `min_order_qty >= 1`
   - `expedite_cost_premium_pct` between `0.0` and `1.0` (e.g. 0.15 for 15%)
5. **Purchase Order Line Grouping**: Multiple rows sharing `po_number` are grouped into lines of that PO. Header fields (`supplier_code`, `status`, `order_date`, `promised_date`, `latest_estimate_date`) must agree across rows, otherwise an error is raised.
6. **Error Reporting & Halting**: Errors are gathered up to a cap of 50, each citing the filename and line number (e.g., `inventory.csv: line 4: Unknown component SKU 'XYZ'`).

---

## 4. CLI Commands

From the `backend` directory (using the virtual environment):

### 1. Export Clean Template Files
Creates template CSV files populated with 1-2 fictional example rows and a `README.txt`:
```powershell
& ".\.venv\Scripts\python.exe" -m app.cli export-template --path "C:\path\to\my_data"
```
*Note: Refuses to overwrite if any files already exist in the target directory.*

### 2. Validate Files (Offline, Touches NO Database)
Validates all CSV schemas and cross-references without modifying or creating any database:
```powershell
& ".\.venv\Scripts\python.exe" -m app.cli validate-files --path "C:\path\to\my_data" --as-of 2026-10-18
```

### 3. Seed Database from CSV Files
Loads the validated dataset into the configured SQLite database:
```powershell
& ".\.venv\Scripts\python.exe" -m app.cli seed --source file --path "C:\path\to\my_data" --as-of 2026-10-18 --reset
```
*Note: Without `--reset`, existing database tables will not be overwritten.*
