# SupplyChain Sentinel AI — Demo Runbook

Tested operational and demonstration guide for the SAP Hackfest 2026 presentation.

---

## 1. System Overview & Safety Boundary

**SupplyChain Sentinel AI** is an intelligent, read-only decision-support system designed for a fictional laptop manufacturer.

> [!IMPORTANT]
> - **Zero Live Writes**: Sentinel AI never creates purchase orders, modifies inventory levels, or alters ERP records.
> - **Synthetic / User-Supplied Data**: All demonstration data is synthetic; there is NO live connection to an SAP instance.
> - **Deterministic State**: Default demonstration runs use deterministic seed 42 with snapshot as-of date `2026-10-17`.

---

## 2. Prerequisites & One-Time Setup

### System Prerequisites
- **Python**: 3.12+ (64-bit)
- **Node.js**: 18+ and npm 9+
- **Operating System**: Windows (PowerShell)

### Initial Setup Commands

Run once during initial repository provisioning:

```powershell
# 1. Setup Python virtual environment
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend"
python -m venv .venv
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

# 2. Setup Frontend dependencies
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\frontend"
npm install
```

---

## 3. Environment & Currency Configuration

Configure `backend\.env` (or copy from `backend\.env.example`):

```ini
APP_NAME="SupplyChain Sentinel AI"
APP_ENV=development
API_VERSION=0.1.0
CORS_ORIGINS=["http://localhost:5173","http://localhost:4173"]
DATABASE_URL=sqlite:///./sentinel.db
DATA_SOURCE=demo

# Display currency configuration
DISPLAY_CURRENCY=INR
USD_TO_INR_RATE=83.50
```

> [!NOTE]
> - **Calculation Currency**: All calculations and database stored amounts remain strictly in USD.
> - **Display Conversion**: `DISPLAY_CURRENCY=INR` requires `USD_TO_INR_RATE` (e.g. 83.50 INR per USD, benchmarked as of October 2026). If `DISPLAY_CURRENCY=INR` is set without `USD_TO_INR_RATE`, the application fails at startup with a clear error message.

---

## 4. Seeding the Demo Data

To populate or reset the demo database to its deterministic state:

```powershell
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend"
& ".\.venv\Scripts\python.exe" -m app.cli seed --source demo --seed 42 --as-of 2026-10-17 --reset
```

Verified record baseline loaded into `backend\sentinel.db`:
- 3 warehouses (1 plant: `WH-PLANT-01`, 2 regional)
- 4 products (laptops)
- 14 components (processors, memory, screens, motherboards, batteries)
- 40 purchase orders & line items
- 10 suppliers & 30 supplier offers
- 260 customer orders
- 2,520 demand history records
- 356 historical delivery records

---

## 5. Starting the Production Demo Services

Always run presentations from the **production preview build** (not the development server) to guarantee optimized performance and prevent hot-reload stale state.

### Step 1: Start the Backend API (Port 8000)
```powershell
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend"
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --port 8000
```
Backend API will be accessible at: `http://localhost:8000` (API documentation at `/docs`).

### Step 2: Build & Start Frontend Production Preview (Port 4173)
```powershell
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\frontend"
npm run build
npm run preview -- --port 4173
```
Production web application will be accessible at: `http://localhost:4173`.

> [!TIP]
> Open `http://localhost:4173` in a fresh **Incognito / Private Browsing window** to ensure clean browser state and avoid cached assets.

---

## 6. Automated Pre-Demo Health Check

Before presenting to an audience, run the automated read-only smoke test script:

```powershell
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend"
& ".\.venv\Scripts\python.exe" scripts/smoke_test.py --api http://localhost:8000 --web http://localhost:4173
```

Expected output:
```
======================================================================
Summary: 53 passed, 0 failed, 0 skipped (total 53 checks)
======================================================================
```
All 53 checks validate HTTP 200 on all API endpoints, GET-only enforcement (POST rejected with 405), frontend route rendering, and deterministic demo story facts.

---

## 7. Guided Demo Flow (Hackfest Presentation Steps)

Click **"Start guided demo"** on the Executive Summary page (or in the navigation sidebar) to launch the docked interactive tour.

### Step 1: Executive Summary (`/executive-summary`)
- **Headline**: "9 components face shortage risk; the most urgent is CPU-X7, short from 2026-10-21 (4 days)."
- **Top Risk Card**: CPU-X7 (NovaCore X7 Processor). Usable stock: 420 units. First shortage date: 2026-10-21. Shortage before next inbound: 289.5 units.
- **Exposure**: 15 customer orders potentially exposed with selling value ₹20,93,43,685.00 ($2,507,110.00 USD) — emphasized as an upper bound, not an estimate of loss.
- **Priority Decision**: Alt supplier `SUP-NEXUS` recommended, arriving 2026-10-21, incremental cost ₹71,43,425.00 ($85,550.00 USD), residual unmet demand 0.0 units.
- **Scope Note**: Targets first shortage window only; later shortage beginning 2026-11-02 is clearly flagged as not covered.

### Step 2: Active Disruption Alerts (`/alerts`)
- Show compound risk alert for `CPU-X7` combining projected inventory stockout and supplier delay exposure.
- Severity badges clearly indicate Critical / High / Medium priorities.

### Step 3: Supplier Risk & Delay Sensitivity (`/supplier-risk`)
- Show primary supplier `SUP-HELIX` delivery reliability: 55.0% on-time rate (22 of 40 deliveries), assessed in high risk band.
- Review historical delay distribution (p50: 3 days, p90: 7 days) and Wilson confidence intervals.

### Step 4: Prescriptive Recovery Recommendations (`/recommendations`)
- Compare evaluated options: expedited PO vs alternative supplier vs inter-warehouse transfer.
- Expand details to show feasibility constraints, lead times, and why `alt_supplier.SUP-NEXUS` was ranked #1.

### Step 5: Comparative What-If Simulation (`/simulator`)
- Select `CPU-X7` and adjust what-if levers (e.g. supplier delay +7 days).
- Compare the 3-column outcome: Baseline vs Disrupted (+7 days unmet rises to 999.0 units) vs Action Plan.

### Step 6: Printable Executive Decision Report (`/report`)
- Click **"Print / Save as PDF"** or navigate to `/report`.
- Demonstrates an executive single-column layout optimized for print (<kbd>Ctrl</kbd>+<kbd>P</kbd>), hiding navigation, filters, and buttons.

---

## 8. Importing User-Supplied CSV Data

Sentinel AI allows evaluating custom supply chain datasets via the command-line interface.

### Step 1: Export CSV Template Files
```powershell
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend"
& ".\.venv\Scripts\python.exe" -m app.cli export-template --path "C:\path\to\my_csvs"
```
Generates 11 clean CSV template files (`warehouses.csv`, `components.csv`, `products.csv`, `bom.csv`, `suppliers.csv`, `supplier_offers.csv`, `inventory.csv`, `demand_history.csv`, `purchase_orders.csv`, `delivery_history.csv`, `customer_orders.csv`).

### Step 2: Validate Files Before Ingestion
```powershell
& ".\.venv\Scripts\python.exe" -m app.cli validate-files --path "C:\path\to\my_csvs" --as-of 2026-10-18
```
Validates column headers, foreign key referential integrity, date formats, non-negative quantities, and enum constraints. In case of errors, the exact filename and line number are reported.

### Step 3: Ingest into an Isolated Database
To protect `sentinel.db`, always ingest custom data into a separate database file:

```powershell
$env:DATABASE_URL="sqlite:///./custom_dataset.db"
& ".\.venv\Scripts\python.exe" -m app.cli seed --source file --path "C:\path\to\my_csvs" --as-of 2026-10-18 --reset
```

Start the backend pointing to the custom database:
```powershell
$env:DATABASE_URL="sqlite:///./custom_dataset.db"
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --port 8000
```

### Step 4: Revert Back to Synthetic Demo Data
```powershell
$env:DATABASE_URL="sqlite:///./sentinel.db"
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --port 8000
```

---

## 9. Troubleshooting Guide

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **Port 8000 or 4173 already in use** | Stale background process still running. | Inspect owning PID: `netstat -ano \| findstr :8000`<br>Stop process: `Stop-Process -Id <PID> -Force` |
| **Stale Web Page / 404 on new routes** | Browser cache or dev-server running older bundle. | 1. Stop `npm run dev`<br>2. Run `npm run build`<br>3. Launch `npm run preview -- --port 4173`<br>4. Open in Incognito window (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>) and Hard Refresh (<kbd>Ctrl</kbd>+<kbd>F5</kbd>) |
| **Database Unseeded warning in UI** | Database file was wiped or created without seeding. | Run `python -m app.cli seed --source demo --seed 42 --as-of 2026-10-17 --reset` |
| **Backend fails at startup with Currency Error** | `DISPLAY_CURRENCY=INR` without a conversion rate. | Add `USD_TO_INR_RATE=83.50` to `backend\.env` |
| **Frontend cannot reach Backend (Network Error)** | Backend uvicorn server not running on port 8000. | Start backend: `& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --port 8000` |
