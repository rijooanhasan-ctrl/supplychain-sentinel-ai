# System Architecture — SupplyChain Sentinel AI

## 1. Overview and Core Philosophy
"SupplyChain Sentinel AI" is an AI/ML-powered decision-support platform designed for the **SAP Hackfest 2026** (theme: *Resilient Supply Chains*). Its primary purpose is to provide early warning supply network risk prediction, scenario impact analysis, and actionable recovery recommendations for enterprise manufacturers (modeled as a high-complexity laptop manufacturer).

### Core Governance Constraints
- **Decision-Support Only:** The system is strictly an analytical and decision-support assistant. It **never** creates live purchase orders, modifies ERP transaction ledgers, or directly writes back mutations to operational business systems.
- **No Hidden Network Calls:** All external data flows through well-defined, isolated adapter boundaries. In Phase 2A, deterministic synthetic data is generated via `DemoAdapter`. Real SAP connectivity is decoupled behind an integration boundary.
- **Deterministic Pure Logic:** Business policies, metrics calculation, and ML scoring are decoupled from web delivery and database drivers.

---

## 2. Layered Backend Architecture

```
[ Frontend (React + Vite) ]
             |
             v  HTTP / JSON (/api/*)
+-------------------------------------------------------+
| FastAPI Application (backend/app/main.py)             |
|                                                       |
|  [ API Layer ] (backend/app/api/routes/)              |
|  Thin request handling, pagination validation,       |
|  and Pydantic response models (app/schemas/).        |
|                           |                           |
|                           v                           |
|  [ Domain Layer ] (backend/app/domain/)               |
|  Pure, testable business logic and risk algorithms.   |
|  Zero dependencies on HTTP frameworks or database.   |
|                           |                           |
|                           v                           |
|  [ Services Layer ] (backend/app/services/)           |
|  Dataset ingestion and use-case workflows.            |
|              |                         |              |
|              v                         v              |
|   [ Integrations Layer ]        [ Database Layer ]    |
|   (backend/app/integrations/)   (backend/app/db/)     |
|   SourceAdapter interface:      Local persistence:    |
|   - DemoAdapter (active)        SQLite (SQLAlchemy)   |
|   - SAPAdapter (future)                               |
+-------------------------------------------------------+
```

### Layer Responsibilities & Rules

1. **API Layer (`backend/app/api/`):**
   - **Routes stay thin:** Route functions parse query parameters (e.g. `limit`, `offset`, filters), execute optimized queries via services, and return typed Pydantic response schemas (`app/schemas/`).
   - No risk scoring, threshold logic, or data-fabrication calculations occur in route handlers.
   - **Read-Only:** The API exposes raw stored facts and domain analytical projections via GET requests only. Non-GET methods (POST, PUT, DELETE) are unrouted and return HTTP 405 Method Not Allowed.
   - Route modules:
     - `routes/meta.py`, `routes/components.py`, `routes/inventory.py`, `routes/suppliers.py`, `routes/purchase_orders.py`, `routes/data_sources.py`
     - `routes/inventory_risk.py` (`/api/inventory-risk`, `/api/inventory-risk/{id}`)
     - `routes/supplier_risk.py` (`/api/supplier-risk`, `/api/supplier-risk/{id}`)
     - `routes/forecasting.py` (`/api/forecasting/evaluation`, `/api/forecasting/components/{id}`)
     - `routes/alerts.py` (`/api/alerts`, `/api/alerts/{alert_id}`)

2. **Domain Layer (`backend/app/domain/`):**
   - Implemented across four focused pure modules:
     - `backend/app/domain/inventory.py`: Deterministic intra-day stockout projections, weekday-aware consumption profiles, multi-episode shortage segmentation, immutable pure helpers `scale_demand`, `adjust_plant_on_hand`, `shift_all_inbound` (used by simulator), and component risk classification.
     - `backend/app/domain/supplier_risk.py`: Supplier delivery performance scoring, 95% Wilson score confidence intervals, delay distribution percentiles (nearest-rank p50/p90), penalty transformations, dynamic weight renormalization, and transparent rule-based explanation generation.
     - `backend/app/domain/forecasting.py`: Pure forecast models (`seasonal_naive`, `weekday_average`, `ridge_weekday_trend`), rolling-origin backtest evaluation engine, error metrics (MAE, RMSE, WAPE, Bias, Pooled WAPE, Macro WAPE), and frozen decision-rule logic.
     - `backend/app/domain/alerts.py`: Deterministic multi-tier disruption alert engine across 9 alert types, empirical what-if delay scenario simulation, customer order exposure calculation with exact Decimal revenue arithmetic, compound risk escalation, and deterministic multi-criteria sorting.
   - **Pure Functions Only:** Zero side-effects, zero imports from FastAPI, SQLAlchemy, or system clock. Operates strictly over plain, frozen dataclasses.
   - **Strict Dependency Confinement:** `numpy` and `scikit-learn` are permitted and imported **strictly** inside `backend/app/domain/forecasting.py`. No other module in the codebase (API, services, DB, or other domain modules) imports numpy or scikit-learn. Pandas is strictly prohibited.

3. **Services Layer (`backend/app/services/`):**
   - `ingest.py`: Orchestrates loading `SourceDataset` into the relational database. Resolves business keys to internal IDs, validates all entity references, enforces all-or-nothing transactional guarantees, and guards against accidental data overwrites without explicit `--reset`.
   - `inventory_risk.py`: Batches inventory levels, demand history windows, and inbound supply lines using modular shared input builders (`build_component_inputs`, `build_all_component_inputs`); calls `domain/inventory.py`; and formats API responses.
   - `supplier_risk.py`: Bulk-loads delivery records within lookback windows and open PO lines, invokes `domain/supplier_risk.py`, and maps metrics to API schemas.
   - `forecasting.py`: Extracts component consumption series, runs rolling-origin backtests, and maintains an in-process cache keyed by `(as_of, generated_at, config)`.
   - `alerts.py`: Disruption alerts service bulk-loading component inventory, inbound lines with supplier tags, delivery records, customer orders, and BOM lines; orchestrates pure `detect_alerts` domain detection. All services handle unseeded database states gracefully (`seeded=false`).

4. **Integrations Layer (`backend/app/integrations/`):**
   - External systems are accessed **only** through a formal adapter interface (`SourceAdapter`).
   - Implementations:
     - `DemoAdapter`: Generates deterministic, synthetic supply chain datasets from `(seed, as_of)` using Python stdlib `random.Random`.
     - `SapSampleAdapter` (`sap_sample_adapter.py`): Ingests illustrative, static SAP OData fixtures (`sap_style_sample.json`) with zero network calls and `is_live = False`. Provides an entity coverage report detailing covered vs missing dataset records.
     - `sap_mapping.py`: Pure mapping functions transforming illustrative SAP Material, Supplier, Plant, Stock, and Purchase Order structures into domain DTOs.
     - `LiveSapAdapter` (future production connector): Reserved boundary for authenticated SAP BTP / S/4HANA OData integration (see `docs/SAP_INTEGRATION.md`).
   - Integration status and connectivity prerequisites are surfaced via `GET /api/integration-status` and displayed on the Data Sources page.
   - High-level business logic is completely insulated from ERP communication details.

5. **Database Layer (`backend/app/db/`):**
   - Manages relational models (`models.py`) and connection pooling (`session.py`).
   - Enforces SQLite foreign keys on every connection via `PRAGMA foreign_keys=ON`.

6. **Executive Summary & Decision Tradeoff Layer (Phase 10):**
   - Implemented in `backend/app/domain/executive_summary.py`, `backend/app/services/executive_summary.py`, and `backend/app/api/routes/executive_summary.py` (`GET /api/executive-summary`).
   - Synthesizes top disruption risks, priority recovery recommendations, data quality lineage, and an acting vs doing nothing comparative tradeoff table. Reuses results from existing pure domain modules without recalculating shortage or cost formulas. Employs a strict upper-bound framing for exposed order values, completely avoiding ungrounded "savings" or "loss" claims.


---

## 3. Relational Entity Model

The relational schema represents the operational facts of the laptop manufacturing network:

1. **`DatasetMeta`**: Metadata record for the active dataset (`label="DEMO DATA"`, `source="demo"`, `seed`, `as_of`, `generator_version`, `generated_at`).
2. **`Warehouse`**: Facilities with roles (`plant` for Austin assembly, `regional` for distribution depots).
3. **`Product`**: Finished laptop models (`sku`, `name`, `selling_price`).
4. **`Component`**: Bill-of-materials components (`sku`, `name`, `category`, `unit_of_measure`, `criticality`, `is_active`).
5. **`BomLine`**: Product-to-component assembly mapping (`product_id`, `component_id`, `quantity_per_unit`).
6. **`Supplier`**: Component vendor partners (`code`, `name`, `country`).
7. **`SupplierComponent`**: Commercial procurement offer (`supplier_id`, `component_id`, `unit_cost`, `lead_time_days`, `min_order_qty`, `max_weekly_capacity`, `is_preferred`, `expedite_available`, `expedite_lead_time_days`, `expedite_cost_premium_pct`).
8. **`InventoryLevel`**: Stock levels per warehouse (`component_id`, `warehouse_id`, `on_hand`, `reserved`, `as_of_ts`). Usable stock is derived dynamically as `on_hand - reserved`.
9. **`PurchaseOrder`**: Inbound procurement orders (`po_number`, `supplier_id`, `status`, `order_date`, `promised_date`, `latest_estimate_date`).
10. **`PurchaseOrderLine`**: PO line items with destination warehouse and fulfillment tracking (`qty_ordered`, `qty_received`, `unit_price`).
11. **`CustomerOrder`**: Finished laptop customer demand book (`order_number`, `customer_name`, `product_id`, `quantity`, `due_date`, `priority`, `status`).
12. **`DemandRecord`**: Daily component consumption history at the plant warehouse (`component_id`, `date`, `quantity`).
13. **`DeliveryRecord`**: Historical shipment delivery records used to evaluate supplier on-time performance and quality rejection rates (`supplier_id`, `component_id`, `promised_date`, `actual_date`, `qty_ordered`, `qty_received`, `qty_rejected`).

---

## 4. Key Architectural Decisions

### A. Schema Creation vs. Migrations
- **Decision:** Schema tables are created lazily at application startup lifespan via `Base.metadata.create_all(engine)`.
- **Rationale:** During early hackathon prototyping (Phases 1 and 2), keeping dependencies minimal (no Alembic, no migration scripts) accelerates model iteration and keeps the SQLite database lightweight. Formal database migration tooling is deferred to a later operational phase.

### B. Money and Decimal Precision Handling
- **Decision:** Monetary amounts (unit costs, selling prices) use `Numeric(12, 2, asdecimal=True)`. Percentages use `Numeric(5, 4, asdecimal=True)`. In API JSON schemas, Decimal values serialize consistently as strings (e.g. `"250.00"`).
- **Rationale:** Financial calculations and procurement costs must remain exact without IEEE-754 binary floating-point roundoff errors. Using `Numeric(12, 2)` in SQLAlchemy 2.x with Python 3.13 sqlite3 avoids dialect warnings while preserving exact precision across all layers.

### C. Adapter Boundary & Business Keys
- **Decision:** `SourceDataset` DTOs reference entities using business keys (`sku`, `code`, `po_number`) rather than database primary key IDs.
- **Rationale:** External systems like SAP ERP or synthetic demo generators do not know internal auto-increment database integer keys. Translating business keys in `app/services/ingest.py` keeps adapters completely decoupled from internal database storage concerns.

---

## 5. Frontend Architecture & Layering

The frontend application is structured with strict separation of concerns, zero ad-hoc fetches, declarative client routing, and no third-party state managers:

```
[ App.tsx (BrowserRouter + MetaProvider) ]
                    │
                    ▼
[ AppLayout.tsx (Responsive Nav Sidebar + DemoBanner) ]
                    │
                    ▼  Route Outlet
[ Page Views (src/pages/) ]
  ├── OverviewPage        (Master counts, priority shortage list, active alerts summary)
  ├── AlertsPage          (Disruption alerts, what-if delay scenarios, order exposure, Simulate/Recover links)
  ├── RecommendationsPage (Per-component recovery options, combined plan, Simulate links)
  ├── SimulatorPage       (What-if disruption simulator: controls, presets, 3-column comparison, SVG chart)
  ├── InventoryRiskPage   (Stockout projections, critical risk alerts, shortage episodes table)
  ├── SupplierRiskPage    (Transparent vendor risk scoring, penalty weights, monthly history)
  ├── ForecastingPage     (Evaluation protocol, aggregate WAPE, challenger decision, projections)
  ├── InventoryPage       (Stock levels, warehouse/component filters, usable stock)
  ├── SuppliersPage       (Supplier directory, expandable procurement terms)
  ├── PurchaseOrdersPage  (Inbound PO book, status/supplier filters, timing labels, lines)
  ├── DataSourcesPage     (Backend health, connector metadata, record counts)
  └── NotFoundPage        (404 unknown path handler)
          │
          ▼  shared primitives
[ Components (src/components/) ]   &   [ Utility Libraries (src/lib/) ]
  ├── DataTable (semantic accessible table) ├── format.ts (USD formatting without float math)
  ├── Pagination (accessible range & limit)  └── dates.ts  (UTC calendar math, as_of comparisons)
  ├── StateViews (Loading, Error, Empty, Unseeded)
  ├── Badge (accessible text badges)
  └── PageHeader (accessible titles)
          │
          ▼  data hooks
[ useApi (src/api/useApi.ts) ]  &  [ useMeta (src/hooks/useMeta.ts) ]
          │
          ▼  typed endpoints
[ endpoints.ts (src/api/endpoints.ts) ]
          │
          ▼  fetch wrapper
[ http.ts (src/api/http.ts) ]
          │
          ▼  HTTP GET (/api/*)
[ Backend FastAPI ]
```

### Layer Responsibilities & Strict Governance Rules

1. **HTTP Layer (`src/api/http.ts`):**
   - Core `getJson<T>(path, { params, signal })` wrapper.
   - Clean query parameter stringification omitting `null` and `undefined`.
   - Normalizes errors:
     - Throws `ApiError` with status and parsed message (normalizing FastAPI string details and 422 validation array details).
     - Throws `NetworkError` when fetch fails to connect.
     - Supports `AbortSignal` for in-flight cancellation; aborted requests throw standard `AbortError` without masquerading as user-facing network errors.

2. **Types Layer (`src/api/types.ts`):**
   - Strict TypeScript interfaces directly mirroring backend Pydantic models.
   - Exact pagination envelopes (`Paginated<T>`) and custom envelopes (`DemandHistoryResponse`).
   - Nullable fields typed with `| null`.
   - **Monetary & Decimal Precision:** Money fields (`unit_cost`, `selling_price`, `unit_price`) and percentages are strictly typed as `string` (e.g. `"250.00"`), maintaining exact decimal precision without floating-point degradation.

3. **Endpoints Layer (`src/api/endpoints.ts`):**
   - Thin typed functions for every GET API route (`getHealth`, `getMeta`, `listComponents`, `listInventory`, `listPurchaseOrders`, etc.).
   - Standardizes URL paths and query parameters.

4. **Hooks Layer (`src/api/useApi.ts` & `src/hooks/useMeta.ts`):**
   - `useApi<T>(fetcher, deps)`: Lightweight generic hook returning `{ data, error, loading, reload }`. Manages `AbortController` internally to cancel in-flight requests on dependency changes or component unmount. Guarantees zero state updates after unmount.
   - `useMeta()`: Consumes `MetaContext`, loading `/api/meta` once centrally. Distributes active dataset information (dataset label, snapshot `as_of` date, and seed status) across the navigation banner and all pages without duplicate network requests.

5. **Utility Libraries (`src/lib/`):**
   - **`format.ts`**: Pure formatters. `formatUsd` parses string decimal amounts and formats them with thousands commas and two decimal places (e.g. `"$1,499.50"`) without performing any binary floating-point calculations. `formatPercentFromFraction` formats decimal fraction strings into percentages.
   - **`dates.ts`**: Implements UTC-safe calendar math anchored to `meta.as_of`. `daysBetween(asOf, targetDate)` eliminates local browser timezone offsets and Daylight Saving Time (DST) discrepancies. `isOverdue` and `timingLabel` calculate schedule deltas strictly relative to the synthetic dataset snapshot date.

6. **Presentation & Page Layer (`src/pages/`):**
   - **Strict Read-Only & Display Derivation Rule:** Pages display raw stored facts directly from the backend API. No business logic (risk scores, coverage calculations, forecast extrapolations, or recovery recommendations) is computed or displayed in this phase.
   - The only arithmetic permitted in the presentation layer is simple display derivation:
     - Usable stock: `on_hand - reserved` per warehouse/component row.
     - Quantity remaining: `qty_ordered - qty_received` per purchase order line.
     - Aggregated counts and calendar date deltas against `meta.as_of`.
   - **Accessible State Handling:** Every data view handles loading (`aria-live="polite"`), error with actionable retry (`role="alert"`), empty states, and unseeded database guidance (`python -m app.cli seed`).
   - **Responsive Shell:** Layout remains fully usable across mobile (360px) and wide desktop (1280px+) screens, with tables scrolling inside isolated horizontal wrappers rather than overflowing the page body.

---

## 11. Recovery Recommendations & Scenario Simulator (Phases 7 & 8)

The **Phase 7** Recovery Recommendation engine (`app/domain/recovery.py`, `app/services/recovery.py`, `GET /api/recommendations`) evaluates interventions through pure input cloning and deterministic re-evaluation. Pure domain helpers (`add_inbound`, `expedite_inbound`) return fresh, immutable `ComponentEvaluationInput` objects without mutating baseline operational states.

The **Phase 8** What-If Disruption Simulator (`app/domain/simulation.py`, `app/services/simulation.py`, `GET /api/simulation`) builds directly on this foundation. It calls the same pure evaluation functions with user-modified inputs to compute counterfactual risk outcomes in real time:

- **Three scenarios**: baseline (unchanged), disrupted (shock applied), with recovery (best recovery option applied to disrupted inputs).
- **Pure immutable helpers** `scale_demand`, `adjust_plant_on_hand`, `shift_all_inbound` produce new inputs without mutating existing ones.
- **No database writes**: no orders created, no saved scenarios, no history tables.
- **Frontend**: `SimulatorPage.tsx` at `/simulator` with controls, presets, 3-column comparison table (text risk badges), `what_changed` sentence list, hand-built accessible SVG line chart (30-day stock balance, solid/dashed/dotted lines), and accessible projection table.
- **Cross-links**: Inventory shortage alerts and recommendation cards each carry `Simulate →` deep-links to `/simulator?component_id=<id>`.
- **Order exposure upper-bound disclosure**: The exposed revenue figure is the selling price of potentially affected orders—not a modelled financial loss estimate.
