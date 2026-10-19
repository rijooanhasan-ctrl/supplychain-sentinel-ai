# SupplyChain Sentinel AI — Demo Runbook

This runbook provides concise instructions for launching and demonstrating the application at SAP Hackfest 2026.

---

## 1. Prerequisites & Environment

- **Backend**: Python 3.12+ in `backend\.venv`
- **Frontend**: Node.js 18+
- **Database**: SQLite (`backend\sentinel.db`)
- **Port Mapping**:
  - Backend API: `http://localhost:8000`
  - Frontend Preview Build: `http://localhost:4173`

> [!TIP]
> Always open the web UI in an **Incognito / Private Browsing window** to ensure no stale browser cache or previous state interferes with the presentation.

---

## 2. Configuration & Currency Setup

Before starting the demo, verify currency settings in `backend\.env`:
```ini
DISPLAY_CURRENCY=INR
USD_TO_INR_RATE=83.50
```
> [!NOTE]
> All underlying calculations remain strictly in USD. The application converts display amounts to INR using the configured exchange rate. Ensure `USD_TO_INR_RATE` is configured when `DISPLAY_CURRENCY=INR`.

---

## 3. Starting the Production Demo Services

### Step A: Start the Backend (Port 8000)
From the repository root or `backend` folder:
```powershell
cd C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --port 8000
```

### Step B: Build and Preview the Frontend (Port 4173)
From the `frontend` folder:
```powershell
cd C:\Users\SK MD Rijooan Hasan\Desktop\SAP\frontend
npm run build
npm run preview -- --port 4173
```

Open `http://localhost:4173` in your browser.

---

## 4. Key Demo Flows

### Flow 1: Guided Demo Mode
1. Click **"Start guided demo"** in the sidebar or top of the Executive Summary.
2. The interactive 5-step tour docks in the lower-right corner and automatically navigates across:
   - **Step 1 — Executive Summary** (`/executive-summary`): High-level operational posture and top component risk.
   - **Step 2 — Alerts** (`/alerts`): Root-cause breakdown of the active shortage alert.
   - **Step 3 — Supplier Delay What-If** (`/alerts`): Lead-time delivery reliability and upstream exposure.
   - **Step 4 — Recommendations** (`/recommendations`): Prescriptive recovery options with bounded resolution scope.
   - **Step 5 — Simulator** (`/simulator`): What-if disruption modeling and cost comparison.
3. Use `Next`, `Back`, or press <kbd>Esc</kbd> to exit at any time.

### Flow 2: Printable Executive Decision Report
1. Navigate to `/executive-summary` or click **"Print / Save as PDF"**.
2. Route `/report` loads a print-optimized, clean single-column summary.
3. Click **"Print / Save as PDF"** (or press <kbd>Ctrl</kbd>+<kbd>P</kbd>) to preview an A4 document with navigation and buttons cleanly hidden.

---

## 5. Switching Data Sources

### Resetting to Synthetic Demo Data (Default)
To restore the default deterministic demo dataset at any time:
```powershell
cd C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend
& ".\.venv\Scripts\python.exe" -m app.cli seed --source demo --seed 42 --reset
```

### Switching to SAP Sample Fixture
```powershell
& ".\.venv\Scripts\python.exe" -m app.cli seed --source sap-sample --reset
```

### Importing User-Supplied CSV Data
```powershell
& ".\.venv\Scripts\python.exe" -m app.cli seed --source file --path "C:\path\to\csv_folder" --as-of 2026-10-18 --reset
```
