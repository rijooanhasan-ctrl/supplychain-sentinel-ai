# SupplyChain Sentinel AI

AI/ML-powered supply-chain risk prediction and decision-support web application for **SAP Hackfest 2026** (Theme: *Resilient Supply Chains*).

> **Important Notices:**
> - **Decision-Support Only:** SupplyChain Sentinel AI is strictly an analytical and decision-support system. It does not create real purchase orders, touch real operational ERP transaction ledgers, or modify live enterprise data.
> - **Zero Live SAP Claims / Synthetic Data Notice:** All data currently processed, stored, and exposed by this application is **DEMO DATA** (generated deterministically by `DemoAdapter`) or static sample fixtures (`SapSampleAdapter`). There is **NO live connection to SAP** or any external business system.
> - **SAP Architectural Readiness:** An illustrative mapping layer (`app/integrations/sap_mapping.py`) and static sample adapter (`app/integrations/sap_sample_adapter.py`) demonstrate OData structural readiness. See [`docs/SAP_INTEGRATION.md`](file:///C:/Users/SK%20MD%20Rijooan%20Hasan/Desktop/SAP/docs/SAP_INTEGRATION.md) for full integration architecture and prerequisites.

---

## 1. Prerequisites

Before running the project locally on Windows 11, verify that the following tools are installed:
- **Python**: Version 3.13.x (invoke via `python`, not `python3` on Windows)
- **Node.js**: Version 20+ (verified with v24.16.0) and **npm** (v11.x)
- **Git**: Version 2.40+ (verified with v2.55.0)

---

## 2. Repository Layout

```
SAP/
├── .gitignore
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          # Architectural layers, adapter boundaries, and data model decisions
│   ├── DATA_IMPORT.md           # User-supplied CSV file import schemas, validation rules, and CLI reference
│   ├── DEMO_RUNBOOK.md          # SAP Hackfest 2026 presentation runbook, production start commands, and guides
│   ├── INVENTORY_INTELLIGENCE.md # Inventory risk rules, daily projection math, episodes, and CPU-X7 benchmark
│   ├── SUPPLIER_RISK.md         # Transparent supplier risk scoring formulas, weights, and SUP-HELIX example
│   ├── FORECASTING.md           # Demand forecast evaluation protocol, models, leakage safeguards, and measured results
│   ├── DISRUPTION_DETECTION.md  # Multi-tier disruption detection, what-if delay scenarios, order exposure, and CPU-X7 worked example
│   ├── RECOMMENDATIONS.md       # Recovery options, constraints, ranking rule, combined plan, and CPU-X7 worked example
│   ├── SIMULATOR.md             # What-If Disruption Simulator: inputs/ranges, scenario calc, assumptions, CPU-X7 worked example
│   ├── EXECUTIVE_SUMMARY.md     # Executive Summary: briefing, top risks, act vs do nothing, data quality, worked example
│   ├── UI_GUIDE.md              # Frontend design system, accessible chart architecture, and runway guide
│   └── KNOWN_LIMITATIONS.md     # Transparent boundary disclosure: synthetic data, baseline models, upper bounds
├── backend/
│   ├── .env.example             # Backend environment template
│   ├── requirements.txt         # Production runtime dependencies (FastAPI, Uvicorn, Pydantic, SQLAlchemy, numpy, scikit-learn)
│   ├── requirements-dev.txt     # Development and testing dependencies (pytest, httpx)
│   ├── scripts/
│   │   ├── smoke_test.py        # Read-only end-to-end smoke test script (urllib-only)
│   │   └── verify_dataset_hash.py # Deterministic multi-table SHA-256 verification script
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app factory, lifespan table creation, router registration
│   │   ├── cli.py               # Seed CLI command (python -m app.cli seed)
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── config.py        # Pydantic Settings (inventory, supplier risk, and forecasting threshold validation)
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── models.py        # 13 SQLAlchemy 2.x declarative models with DB constraints
│   │   │   └── session.py       # Engine creation, lazy sessionmaker, SQLite foreign key pragmas
│   │   ├── schemas/
│   │   │   ├── __init__.py      # Pydantic response models, UtcDatetime serializer, and envelopes
│   │   │   ├── inventory_risk.py# Inventory risk & shortage projection schemas
│   │   │   ├── supplier_risk.py # Supplier risk performance, penalties, and monthly breakdown schemas
│   │   │   ├── forecasting.py   # Forecast evaluation, backtest fold, and candidate projection schemas
│   │   │   └── executive_summary.py # Executive summary response schemas and exposure envelopes
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       ├── health.py    # GET /api/health
│   │   │       ├── meta.py      # GET /api/meta
│   │   │       ├── inventory_risk.py # GET /api/inventory-risk, /api/inventory-risk/{component_id}
│   │   │       ├── supplier_risk.py  # GET /api/supplier-risk, /api/supplier-risk/{supplier_id}
│   │   │       ├── forecasting.py    # GET /api/forecasting/evaluation, /api/forecasting/components/{component_id}
│   │   │       ├── products.py  # GET /api/products, /api/products/{id}
│   │   │       ├── components.py# GET /api/components, /api/components/{id}, demand-history
│   │   │       ├── suppliers.py # GET /api/suppliers, /api/suppliers/{id}
│   │   │       ├── warehouses.py# GET /api/warehouses
│   │   │       ├── inventory.py # GET /api/inventory
│   │   │       ├── purchase_orders.py # GET /api/purchase-orders, /api/purchase-orders/{id}
│   │   │       ├── customer_orders.py # GET /api/customer-orders
│   │   │       ├── delivery_records.py# GET /api/delivery-records
│   │   │       ├── simulation.py      # GET /api/simulation (what-if scenario simulator)
│   │   │       └── executive_summary.py # GET /api/executive-summary
│   │   ├── domain/              # Pure business logic layer (zero DB/framework imports)
│   │   │   ├── __init__.py
│   │   │   ├── inventory.py     # Stock projections, shortage episodes, weekday consumption profile; scale_demand, shift_all_inbound, adjust_plant_on_hand
│   │   │   ├── supplier_risk.py # Performance scoring, Wilson interval, delay percentiles, explanations
│   │   │   ├── forecasting.py   # Pure forecast models (isolated numpy/sklearn), backtesting, decision rule
│   │   │   ├── alerts.py        # Multi-tier alert generation, delay scenarios, order exposure impact
│   │   │   ├── recovery.py      # Recovery options, combined plan, recommendation, scope note
│   │   │   ├── simulation.py    # SimulationParams, simulate() — baseline/disrupted/recovered + what_changed
│   │   │   └── executive_summary.py # Pure executive summary builder, cost comparison, top risks, lineage
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── ingest.py        # Transactional dataset loader (load_dataset)
│   │   │   ├── inventory_risk.py# Inventory risk service orchestrating DB queries and domain evaluation
│   │   │   ├── supplier_risk.py # Supplier risk service querying deliveries and calculating metrics
│   │   │   ├── forecasting.py   # Demand forecast service with in-process evaluation caching
│   │   │   ├── simulation.py    # run_component_simulation — loads inputs, delegates to domain/simulation.py
│   │   │   └── executive_summary.py # Executive summary aggregation orchestrator
│   │   └── integrations/
│   │       ├── __init__.py
│   │       ├── base.py          # SourceAdapter interface and SourceDataset DTOs
│   │       └── demo_adapter.py  # Deterministic synthetic data generator
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py          # Isolated temporary DB fixtures
│       ├── test_config.py       # Config defaults and monkeypatched overrides
│       ├── test_health.py       # /api/health endpoint and ISO timestamp
│       ├── test_models.py       # DB constraints and integrity error tests
│       ├── test_adapter.py      # DemoAdapter determinism and CPU-X7 scenario tests
│       ├── test_loader.py       # All-or-nothing loader and overwrite guard tests
│       ├── test_cli.py          # CLI seed command exit codes and argument tests
│       ├── test_api.py          # Complete API endpoint, pagination, filter, and 404 tests
│       ├── test_domain_inventory.py # Pure domain tests (projections, weekday baseline, episodes, boundaries)
│       ├── test_inventory_risk_api.py # Service/API integration tests, edge cases, multi-seed determinism
│       ├── test_domain_supplier_risk.py # Pure supplier risk domain tests (penalties, weights, Wilson CI, limits)
│       ├── test_supplier_risk_api.py    # Supplier risk service/API tests, ranking, sorting, 404/422
│       ├── test_domain_forecasting.py   # Pure forecasting tests (leakage, models, rolling backtest, decision rule)
│       ├── test_forecasting_api.py      # Forecasting service/API tests, determinism, caching, 404/422
│       ├── test_domain_simulation.py    # Pure simulation domain tests (validation, immutability, delay extension, demand)
│       └── test_simulation_api.py       # Simulation API integration tests (envelope, 404, 422, unseeded, multi-seed)
└── frontend/
    ├── package.json             # React 19, react-router-dom v7, Tailwind CSS v4, Vitest
    ├── vite.config.ts           # Vite server config (port 5173, /api proxy to 8000, Vitest)
    ├── tsconfig.json            # TypeScript configuration
    └── src/
        ├── App.tsx              # Declarative React Router routing shell with MetaProvider
        ├── App.test.tsx         # Routing, navigation shell, and layout tests
        ├── index.css            # Tailwind CSS v4 styling
        ├── app/
        │   └── AppLayout.tsx    # Responsive navigation shell (desktop sidebar / mobile bar) and banner
        ├── pages/
        │   ├── ExecutiveSummaryPage.tsx # Executive summary, top 3 risks, act vs do nothing, data quality
        │   ├── ExecutiveSummaryPage.test.tsx # Tests for executive summary cards, comparison table, why dialog
        │   ├── OverviewPage.tsx         # Master entity counts, open/overdue POs, inventory risk summary
        │   ├── OverviewPage.test.tsx    # Tests for overview calculations, overdue logic, risk summary
        │   ├── AlertsPage.tsx           # Disruption alerts table with filters, expandable detail, Simulate/Recover links
        │   ├── AlertsPage.test.tsx      # Tests for alerts table, badges, expand, Simulate/Recover links
        │   ├── RecommendationsPage.tsx  # Recovery recommendation cards with Simulate links
        │   ├── RecommendationsPage.test.tsx # Tests for recommendation cards, combined plan, Simulate links
        │   ├── SimulatorPage.tsx        # What-If Simulator: controls, presets, 3-col comparison, SVG chart
        │   ├── SimulatorPage.test.tsx   # Tests for controls, URL preselect, presets, validation, results, error/unseeded
        │   ├── InventoryRiskPage.tsx    # Stockout risk table, filters, and expandable 14-day projection
        │   ├── InventoryRiskPage.test.tsx # Tests for risk table, null handling, expand panel, filters
        │   ├── InventoryPage.tsx        # Stock levels, filters (comp/wh), usable derivation, text flags
        │   ├── InventoryPage.test.tsx   # Tests for usable stock, zero/deficit flags, pagination
        │   ├── SuppliersPage.tsx        # Supplier directory, expandable agreements, capacity/expedite
        │   ├── SuppliersPage.test.tsx   # Tests for expandable agreements, capacity/expedite terms
        │   ├── PurchaseOrdersPage.tsx   # Inbound POs, status/supplier filters, timing cell, lines
        │   ├── PurchaseOrdersPage.test.tsx # Tests for status filter, timing, line remaining qty
        │   ├── DataSourcesPage.tsx      # System health, integration status, and record counts
        │   ├── DataSourcesPage.test.tsx # Tests for data sources, retry, and integration wording
        │   └── NotFoundPage.tsx         # 404 handler for unknown URL paths
        ├── components/
        │   ├── WhyThis.tsx      # Reusable contextual "Why this?" accordion button
        │   ├── WhyThis.test.tsx # Tests for WhyThis component
        │   ├── Badge.tsx        # Status, criticality, risk level, and flag text badges
        │   ├── DataTable.tsx    # Semantic, accessible table wrapper with overflow control
        │   ├── DemoBanner.tsx   # Persistent DEMO DATA and as-of date notification banner
        │   ├── PageHeader.tsx   # Standardized page title and description header
        │   ├── Pagination.tsx   # Accessible limit selector, range announcement, and page buttons
        │   └── StateViews.tsx   # LoadingView, ErrorView (with Retry), EmptyView, UnseededView
        ├── context/
        │   ├── metaContextDef.ts # Context definition for Fast Refresh compliance
        │   └── MetaContext.tsx   # MetaProvider loading /api/meta once centrally
        ├── hooks/
        │   └── useMeta.ts       # Hook for consuming active dataset metadata
        ├── lib/
        │   ├── format.ts        # Pure formatters: formatUsd (no float math), percent, dates, ints
        │   ├── format.test.ts   # Tests for formatUsd, percentages, dates, and timestamps
        │   ├── dates.ts         # UTC-safe date math, daysBetween, isOverdue, expectedDate, timingLabel
        │   └── dates.test.ts    # Tests for UTC calendar math, DST safety, and timing labels
        ├── api/
        │   ├── http.ts          # Type-safe fetch wrapper, error normalization, AbortSignal
        │   ├── http.test.ts     # Unit tests for HTTP fetcher and error normalization
        │   ├── types.ts         # TypeScript interfaces mirroring backend schemas (exact string Decimals)
        │   ├── endpoints.ts     # Typed endpoint functions for all read-only GET APIs
        │   ├── useApi.ts        # Custom hook for cancellation-safe, reloadable data requests
        │   ├── useApi.test.ts   # Unit tests for useApi hook
        │   └── client.ts        # Health check client adapter (backward compatible)
        └── test/
            └── setup.ts         # Testing Library / jest-dom setup
```

---

## 3. Database Seeding CLI

To seed the local database with deterministic synthetic demo data:
```powershell
# Navigate to backend/
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend"

# Seed default demo dataset (seed=42, as_of=today UTC)
& ".\.venv\Scripts\python.exe" -m app.cli seed --reset

# Optional: seed with specific seed or reference as-of date
& ".\.venv\Scripts\python.exe" -m app.cli seed --seed 100 --as-of 2026-03-01 --reset

# Optional: seed illustrative SAP-style sample fixture (is_live=False, static fixture, no network calls)
& ".\.venv\Scripts\python.exe" -m app.cli seed --source sap-sample --reset
```
*Note: To protect stored data, the CLI refuses to overwrite an existing database without the explicit `--reset` flag.*

### CSV File Import Pipeline (User-Supplied Data)
In addition to the synthetic generator and static SAP sample fixture, SupplyChain Sentinel AI supports importing custom operational data from CSV files:
```powershell
# 1. Export clean CSV templates with sample rows and README
& ".\.venv\Scripts\python.exe" -m app.cli export-template --path "C:\path\to\my_data"

# 2. Validate CSV files and print coverage report (touches NO database)
& ".\.venv\Scripts\python.exe" -m app.cli validate-files --path "C:\path\to\my_data" --as-of 2026-10-18

# 3. Seed database from validated CSV files
& ".\.venv\Scripts\python.exe" -m app.cli seed --source file --path "C:\path\to\my_data" --as-of 2026-10-18 --reset
```
See [`docs/DATA_IMPORT.md`](file:///C:/Users/SK%20MD%20Rijooan%20Hasan/Desktop/SAP/docs/DATA_IMPORT.md) for detailed column specifications and validation rules.

> **Deterministic Synthetic Timestamps & Date Logic:**
> - All timestamps generated for synthetic datasets (such as `DatasetMeta.generated_at` and inventory `as_of_ts`) are deterministic synthetic UTC timestamps derived directly from the reference `as_of` date (`as_of 00:00:00 UTC`), rather than wall-clock times.
> - **Dataset Snapshot Anchor:** All frontend business date comparisons (evaluating whether a purchase order is "Overdue" or "Due in N days") use the active dataset `meta.as_of` returned by `/api/meta` as "today" rather than the browser wall-clock. Because the demo database is a fixed synthetic snapshot in time, using `meta.as_of` guarantees deterministic schedule calculations across all user sessions and test suites.

---

## 4. Running the Application

### Backend API Server
From `backend/`:
```powershell
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --port 8000
```
- Interactive API Swagger documentation: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/api/health`
- Dataset metadata: `http://localhost:8000/api/meta`

### Frontend Application
From `frontend/`:
```powershell
npm run dev
```
- Web Application: `http://localhost:5173` (or production preview `npm run preview -- --port 4173`)
- **Interactive Guided Demo Mode**: Click **"Start guided demo"** in the sidebar or Executive Summary to launch a docked, keyboard-operable 5-step tour guiding reviewers through Executive Summary, Alerts, Supplier Delays, Recommendations, and What-If Simulation.
- **Core Application Views:**
  1. `/executive-summary` (**Executive Summary**): Executive briefing, headline summary badge, top 3 prioritized risk cards with text severity badges, single priority recovery decision, side-by-side cost comparison (Act vs. Do Nothing) with upper-bound framing, contextual "Why this?" accordions, data quality lineage note, and direct access to Guided Demo and Printable Report.
  2. `/report` (**Printable Executive Decision Report**): Dedicated print-optimized single-column layout formatted for A4 printing/PDF generation via `window.print()` and `@media print`. Hides navigation and interactive elements while preserving risk tables, action plans, upper-bound exposure comparisons, assumptions, and lineage notes.
  3. `/` (**Overview**): Visual executive landing page featuring the natural-language HeadlineStrip, 4 KPI indicator tiles (components at risk, soonest shortage, late deliveries, open alerts) with ⓘ glossary tooltips, proportional Risk Mix stacked bar with interactive filter links, 30-day Shortage Runway chart with delivery gap hatching and Simulator deep-links, Inbound Delivery Schedule with slipped and overdue indicators, Supplier On-Time Reliability rankings, and collapsible "How to read this page" guidance. See [`docs/UI_GUIDE.md`](file:///C:/Users/SK%20MD%20Rijooan%20Hasan/Desktop/SAP/docs/UI_GUIDE.md).
  4. `/alerts` (**Disruption Detection & Alerts**): Multi-tier disruption detection across 9 alert types, severity and type filters, server-side pagination, expandable detail views with evidence tables, analytical assumptions, empirical what-if delay scenario tables (baseline, typical, severe), downstream customer order exposure (affected orders table and revenue), compound risk cross-links, and **Simulate →** and **Recover →** links on shortage alerts.
  5. `/recommendations` (**Recovery Recommendations**): Per-component recovery option cards (expedite PO, alternative supplier, transfer, accept delay), ranked by cost/feasibility, with combined-plan view and **Simulate →** link in each card header.
  6. `/simulator` (**What-If Disruption Simulator**): Interactive scenario analysis: select component, set supplier delay (0–60d), demand multiplier (0.5x–3.0x), stock delta (±10 000), alt-supplier toggle; run baseline/disrupted/recovered comparison; 3-column table with text risk badges; `what_changed` sentences; hand-built accessible SVG 30-day stock balance chart; mandatory upper-bound disclosure. Deep-linked from Alerts and Recommendations pages.
  7. `/inventory-risk` (**Inventory Risk & Shortage Projections**): Forward-looking stockout risk and daily shortage projection model across manufacturing plant components with filters, pagination, shortage episodes table, and labeled horizon total.
  8. `/supplier-risk` (**Supplier Risk Scoring**): Transparent weighted delivery performance scoring (on-time rate with 95% Wilson CI, delay percentiles, rejection rate, fill rate), score bands, informational open-order metrics, expandable penalty point contributions, and 12-month delivery breakdown.
  9. `/forecasting` (**Demand Forecast Evaluation**): Backtesting protocol summary, synthetic-data caveat banner, aggregate error metrics (Lowest WAPE indicator), frozen champion vs. challenger decision rule, per-component performance table, and expandable 14-day projections and backtest fold comparison.
  10. `/inventory` (**Inventory Levels**): On-hand, reserved, and usable stock (`on_hand - reserved`) per warehouse, filterable by component and warehouse, with text badges for deficit or zero-stock states.
  11. `/suppliers` (**Supplier Directory**): Global supplier directory with expandable commercial agreement panels showing component unit costs (USD), lead times, minimum order quantities, weekly capacities, and expedite terms.
  12. `/purchase-orders` (**Purchase Orders**): Inbound replenishment orders filterable by status and supplier, displaying derived timing cells with slipped-vs-promise alerts and expandable fulfillment line items.
  13. `/data-sources` (**Data Sources & Integration Status**): Backend health metrics, active dataset metadata, unverified connector indicators, and record counts.

---

## 5. Read-Only API Endpoints

All data endpoints return standard JSON envelopes with pagination (`items`, `total`, `limit`, `offset`) or structured analysis summaries:

| Method | Endpoint | Description & Filters |
| :--- | :--- | :--- |
| `GET` | `/api/executive-summary` | High-level executive briefing, top 3 risks, priority recovery recommendation, side-by-side cost comparison, transparent "Why this?" reasoning, data quality audit, and analytical assumptions |
| `GET` | `/api/health` | Health status and data source verification |
| `GET` | `/api/meta` | Active dataset metadata, seed, as-of date, and entity counts |
| `GET` | `/api/inventory-risk` | Inventory stockout risk and shortage projection summary (filters: `risk_level`, `category`, `criticality`, `include_inactive`) |
| `GET` | `/api/inventory-risk/{component_id}` | Component risk detail, multi-episode breakdown, weekday forecast profile, inbound breakdown, and full daily projection |
| `GET` | `/api/supplier-risk` | Supplier delivery risk ranking, summary counts by band (filters: `band`, `country`, `limit`, `offset`, sort by score descending) |
| `GET` | `/api/supplier-risk/{supplier_id}` | Comprehensive supplier risk detail, penalties, effective weights, contribution points, 12-month delivery breakdown, open orders, and plain-language explanation |
| `GET` | `/api/forecasting/evaluation` | Demand forecast evaluation backtest summary across models (`seasonal_naive`, `weekday_average`, `ridge_weekday_trend`), aggregate WAPE/MAE/RMSE/bias, frozen decision rule outcome, and per-component breakdown |
| `GET` | `/api/forecasting/components/{id}` | Component next-N-day demand forecasts from each model (filter: `days=1..60`, default 14) and last-fold backtest actuals vs predictions |
| `GET` | `/api/alerts` | Multi-tier disruption alerts and summary counts (filters: `severity`, `type`, `component_id`, `supplier_id`, `limit`, `offset`) |
| `GET` | `/api/alerts/{alert_id}` | Full disruption alert detail, computed evidence, assumptions, downstream order exposure, and delay scenarios |
| `GET` | `/api/recommendations` | Per-component recovery recommendations (filters: `component_id`) |
| `GET` | `/api/simulation` | What-if scenario simulator (params: `component_id`, `supplier_delay_days`, `demand_multiplier`, `on_hand_delta`, `alt_supplier_available`) |
| `GET` | `/api/products` | Finished laptop models (`limit`, `offset`) |
| `GET` | `/api/products/{id}` | Product detail with BOM lines and component information |
| `GET` | `/api/components` | Component catalog (filters: `category`, `q`, `is_active`) |
| `GET` | `/api/components/{id}` | Component detail with supplier offers and warehouse inventory |
| `GET` | `/api/components/{id}/demand-history` | Component demand history (filter: `days=1..365`, default 90) |
| `GET` | `/api/suppliers` | Supplier directory (`limit`, `offset`) |
| `GET` | `/api/suppliers/{id}` | Supplier detail with offered components and terms |
| `GET` | `/api/warehouses` | Warehouse facilities (Austin plant, regional hubs) |
| `GET` | `/api/inventory` | Inventory stock (filters: `component_id`, `warehouse_id`) |
| `GET` | `/api/purchase-orders` | Purchase orders (filters: `status`, `supplier_id`, `component_id`) |
| `GET` | `/api/purchase-orders/{id}` | Purchase order detail with line items and fulfillment status |
| `GET` | `/api/customer-orders` | Customer order book (filters: `status`, `priority`, `product_id`) |
| `GET` | `/api/delivery-records` | Historical supplier delivery performance (filters: `supplier_id`, `component_id`) |
| `GET` | `/api/integration-status` | Active connector capabilities, is_live flag (false), entity coverage report, and mandatory SAP connectivity notice |

---

## 6. Environment Configuration Variables

The backend supports configuration via environment variables or a `.env` file:

| Variable | Default | Description & Validation |
| :--- | :--- | :--- |
| `DATABASE_URL` | `sqlite:///./sentinel.db` | SQLAlchemy SQLite database connection string |
| `APP_ENV` | `development` | Application runtime environment |
| `INVENTORY_LOOKBACK_DAYS` | `28` | History lookback window in days (valid: 14..365) |
| `INVENTORY_HORIZON_DAYS` | `60` | Forward projection horizon in days (valid: 7..180) |
| `INVENTORY_CRITICAL_DAYS` | `7` | Threshold for Critical risk ($\le 7$ days until shortage) |
| `INVENTORY_HIGH_DAYS` | `14` | Threshold for High risk ($\le 14$ days until shortage) |
| `INVENTORY_MEDIUM_DAYS` | `30` | Threshold for Medium risk ($\le 30$ days until shortage) |
| `INVENTORY_OVERDUE_INBOUND_POLICY` | `"exclude"` | Policy for overdue inbound POs (only `"exclude"` supported) |
| `SUPPLIER_RISK_LOOKBACK_DAYS` | `365` | Lookback window for delivery evaluation (valid: 30..730) |
| `SUPPLIER_RISK_GRACE_DAYS` | `0` | Grace period in calendar days for on-time delivery classification |
| `SUPPLIER_RISK_W_ON_TIME` | `0.40` | Weight for on-time delivery penalty (weights must sum to 1.0) |
| `SUPPLIER_RISK_W_DELAY` | `0.25` | Weight for average lateness penalty |
| `SUPPLIER_RISK_W_REJECTION` | `0.20` | Weight for quality rejection rate penalty |
| `SUPPLIER_RISK_W_FILL` | `0.15` | Weight for quantity fill shortfall penalty |
| `SUPPLIER_RISK_BAND_MEDIUM` | `25.0` | Threshold between Low and Medium supplier risk band |
| `SUPPLIER_RISK_BAND_HIGH` | `50.0` | Threshold between Medium and High supplier risk band |
| `FORECAST_MIN_TRAIN_DAYS` | `84` | Minimum training history required before first backtest fold (valid: 28..150) |
| `FORECAST_HORIZON_DAYS` | `14` | Evaluation forecast horizon per backtest fold (valid: 7..30) |
| `FORECAST_STEP_DAYS` | `14` | Rolling origin step stride in days (valid: 7..30) |
| `FORECAST_MIN_IMPROVEMENT_PCT` | `5.0` | Relative WAPE reduction required to recommend challenger |
| `FORECAST_MIN_WIN_RATE` | `0.60` | Minimum fraction of component-folds challenger must win |
| `ALERT_SURGE_RECENT_DAYS` | `14` | Recent demand window for surge detection in days (valid: > 0) |
| `ALERT_SURGE_BASELINE_DAYS` | `28` | Baseline demand window for surge detection in days (valid: > 0) |
| `ALERT_SURGE_RATIO_MEDIUM` | `1.25` | Ratio threshold for Medium demand surge alert (valid: > 1.0) |
| `ALERT_SURGE_RATIO_HIGH` | `1.50` | Ratio threshold for High demand surge alert (valid: > ratio_medium) |
| `ALERT_QUALITY_REJECTION_THRESHOLD` | `0.02` | Recent 90-day rejection rate threshold for quality alert (valid: 0..1) |
| `ALERT_DELAY_MIN_LATE_PROBABILITY` | `0.20` | Minimum supplier late delivery probability to trigger delay exposure (valid: 0..1) |
| `ALERT_DELAY_MIN_DELIVERIES` | `10` | Delivery count threshold below which severity is capped at medium (valid: $\ge 1$) |
| `RECOVERY_TRANSFER_DAYS` | `2` | Assumed calendar days required for inter-warehouse transfers (valid: $\ge 0$) |
| `RECOVERY_TRANSFER_COST_PER_UNIT` | `null` | Optional assumed cost per unit for inter-warehouse transfers in USD (valid: $\ge 0$ or null) |
| `DISPLAY_CURRENCY` | `"USD"` | Target display currency for monetary values (`"USD"` or `"INR"`, default: `"USD"`). All stored data and calculations stay in USD. |
| `USD_TO_INR_RATE` | `null` | Exchange rate used strictly for display conversion if `DISPLAY_CURRENCY="INR"` (e.g. `83.50`). Must be finite and $> 0$ when INR is selected. |
| `ENABLE_WEB_IMPORT` | `false` | Enable web upload of CSV datasets via `/import` (default: `false`, returns 403 when disabled). |
| `IMPORT_MAX_FILE_BYTES` | `5242880` | Maximum allowed size in bytes per uploaded CSV file (default: 5 MB). |
| `IMPORT_MAX_FILES` | `11` | Maximum allowed CSV files in a single import request (default: 11). |
| `IMPORT_MAX_TOTAL_BYTES` | `26214400` | Maximum allowed total payload size across all CSV files (default: 25 MB). |
| `UPLOAD_DB_PATH` | `backend/data/uploaded.db` | Destination SQLite database file for user-supplied data (kept strictly isolated from `sentinel.db`). |

### Currency Display Layer & Presentation

- **Stored Data & Calculations**: All underlying database models, seed records, domain calculations, and API numeric money fields remain strictly in USD (e.g. `85550.00`).
- **Display Layer Conversion**: When `DISPLAY_CURRENCY="INR"` and a valid `USD_TO_INR_RATE` (e.g. `83.50`) are configured, the presentation layer renders monetary amounts in INR using Indian number grouping (`en-IN`) and the `₹` symbol (e.g. `₹71,43,425.00`), alongside an explicit notice: *"Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹83.50 (assumption, not a live exchange rate)"*.
- **Decimal Safety**: All conversions utilize Decimal in Python (`ROUND_HALF_UP`) and BigInt integer mantissa arithmetic in TypeScript (`src/lib/format.ts`) to eliminate floating-point drift.
- **Worked Conversion Example**:
  - Incremental recovery cost: `$85,550.00` × `83.50` = `₹71,43,425.00`
  - Exposed order selling value: `$2,507,110.00` × `83.50` = `₹20,93,43,685.00`

---

## 7. Technology Stack & Package Versions

Exact versions installed in the local environment and verified from git repository history:
- **Python**: 3.13.3
- **FastAPI**: 0.115.12
- **SQLAlchemy**: 2.0.40
- **NumPy**: 2.5.4 (strictly confined to demand forecasting domain)
- **Scikit-learn**: 1.9.1 (strictly confined to demand forecasting domain)
- **React**: 19.2.8
- **React DOM**: 19.2.8
- **React Router DOM**: 7.18.4
- **Vite**: 8.3.4
- **Vitest**: 5.0.5
- **Tailwind CSS**: 4.1.18
- **Oxlint**: 1.48.0

---

## 8. Running Tests & Automated Verification

### Backend Test Suite (275 passing tests)
From `backend/`:
```powershell
& ".\.venv\Scripts\python.exe" -m pytest -q
```

### Frontend Test Suite (142 passing tests)
From `frontend/`:
```powershell
npm test -- --run
```

### Frontend Linting & Production Build
From `frontend/`:
```powershell
npm run lint
npm run build
```

### Automated End-to-End Smoke Test
Run against the active backend (port 8000) and production preview (port 4173):
```powershell
cd backend
& ".\.venv\Scripts\python.exe" scripts/smoke_test.py --api http://localhost:8000 --web http://localhost:4173
```
Validates 54 checks: all API GET endpoints, `/api/import/status`, GET-only enforcement (HTTP 405 on non-import POSTs), web route shells (including `/import`), and deterministic demo story assertions.

---

## 9. Documentation & Run Guides

- **[SAP Hackfest Demo Runbook](docs/DEMO_RUNBOOK.md)**: Full end-to-end presentation script, guided demo walkthrough, printable report generation, and troubleshooting.
- **[Known Limitations & Design Boundaries](docs/KNOWN_LIMITATIONS.md)**: Transparent disclosure of synthetic data, backtest results, single-plant scope, and upper-bound exposure math.
- **[System Architecture](docs/ARCHITECTURE.md)**: Detailed layer decoupling, adapter boundaries, and Pydantic configuration isolation.
- **[User-Supplied CSV Data Import](docs/DATA_IMPORT.md)**: Schema definitions, validation rules, and CLI import guide.


