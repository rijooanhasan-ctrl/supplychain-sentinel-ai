# User-Supplied CSV Data Import Guide

SupplyChain Sentinel AI supports importing custom, user-supplied operational data through a strictly offline, CLI-driven CSV import pipeline (`FileAdapter`).

This document details the file formats, schemas, validation rules, coverage implications, and command-line usage.

---

## 1. High-Level Principles & Architecture

- **Dual-Mode Import (Web UI & CLI)**:
  - **Web UI (`/import`)**: In-browser CSV upload using `File.text()` over JSON payloads (`POST /api/import/validate`, `POST /api/import/load`). Uploaded data is stored **strictly** in a separate SQLite database (`backend/data/uploaded.db`).
  - **CLI (`app.cli`)**: Offline validation and database seeding for developer workflows.
- **Strict Isolation & Zero Write to Demo Data**: `backend/sentinel.db` is strictly read-only and is never written, updated, or deleted by web import operations.
- **Zero Live Connections**: SupplyChain Sentinel AI never touches live ERP systems or creates purchase orders.
- **Transactional & All-or-Nothing**: All CSV files and cross-table references are validated upfront. If any error is found (capped at 50 reported errors), nothing is loaded into the database. On load, atomic replacement ensures existing uploaded data remains intact if an import fails.
- **In-Memory Active Dataset**: The active dataset (`demo` vs `uploaded`) is held in application process state (`app.state`). Backend restarts **always** revert to the default `demo` dataset. Choice is never persisted.
- **Currency Standard**: All monetary values (`selling_price`, `unit_price`, `unit_cost`) **must be provided in US Dollars (USD)**. Currency display conversions (such as INR) are applied dynamically by the presentation layer.
- **Reference As-Of Date**: Importing user files requires an explicit `--as-of YYYY-MM-DD` cutoff date. Demand history records should end the day before this date.
- **Incomplete Feeds & "Unknown" Status**: When optional files are omitted, features degrade gracefully into "unknown" or "insufficient history" states rather than crashing or inventing numbers.

---

## 2. Web Upload Flow (`/import`)

### Configuration & Feature Flag
Web upload is controlled via configuration in `backend/.env`:
- `ENABLE_WEB_IMPORT=true` (default: `false` for maximum security; returns 403 when disabled)
- `IMPORT_MAX_FILE_BYTES=5242880` (5 MB per file limit)
- `IMPORT_MAX_FILES=11` (maximum 11 accepted CSV files)
- `IMPORT_MAX_TOTAL_BYTES=26214400` (25 MB total request payload limit)
- `UPLOAD_DB_PATH=backend/data/uploaded.db` (destination database file)

### Web Upload Workflow
1. **Access**: Navigate to the **Import Data** page (`/import`), accessible from the top navigation bar or the Data Sources page.
2. **File Selection**: Drag and drop or browse for up to 11 CSV files. Client-side validation checks extension and file size limits before transmission.
3. **Template Download**: Click **Download template files** to fetch clean CSV templates populated with fictional sample records.
4. **Validation (`POST /api/import/validate`)**:
   - Sends file contents as JSON (no `multipart/form-data`).
   - Server writes files to an isolated temporary directory.
   - Executes `FileAdapter` validation and cross-referencing.
   - Cleans up temporary directory in a `finally` block without touching any database.
   - Returns validation status, error log (up to 50 items with file and line number), warnings, and entity coverage report.
5. **Loading (`POST /api/import/load`)**:
   - Enabled only after successful validation.
   - Re-validates server-side; builds new dataset into a temporary database file before atomically replacing `backend/data/uploaded.db`.
   - Automatically switches active dataset to `uploaded`.
   - Updates global application metadata and page views to reflect `USER-SUPPLIED DATA (file import)`.
6. **Switching & Returning to Demo Data**:
   - The Active Dataset panel allows instant switching between **View demo data** and **View uploaded data** via `POST /api/import/activate`.
   - Restarting the backend service automatically restores the active dataset to `demo`.

---

## 3. File Specifications & Columns

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

## 4. Validation Rules

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

## 5. CLI Commands

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

---

## 6. Geographic Location Resolution for Imported Data
When custom datasets are uploaded:
1. **Automated Country Centroids:** If `suppliers.csv` includes standard 2-letter ISO country codes (e.g. `US`, `DE`, `TW`, `VN`), facilities are automatically mapped to public-domain ISO-3166 country centroids.
2. **Needs Location Queue:** Any vendor or facility without valid coordinates or recognized country code appears in the **Needs Location** queue on the Global Map (`/globe`).
3. **Manual Override & Click-to-Place:** When `ENABLE_WEB_IMPORT=true`, operators can set coordinates via standard country selection, manual latitude/longitude entry, or interactive click-to-place on the 3D globe.
4. **Dataset Isolation:** Location overrides are keyed directly to the imported dataset's signature (`backend/data/location_overrides_<dataset_key>.json`). Switching back to demo data automatically restores demo fixtures without cross-contamination.
