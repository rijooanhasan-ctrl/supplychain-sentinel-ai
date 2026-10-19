# SupplyChain Sentinel AI — Known Limitations & Design Boundaries

This document transparently records the architectural boundaries, analytical assumptions, and operational limitations of **SupplyChain Sentinel AI** as presented for SAP Hackfest 2026.

---

## 1. Synthetic Demo Dataset
- **Nature of Data**: The default dataset loaded in `backend\sentinel.db` is completely synthetic and generated deterministically using seed 42 with snapshot as-of date `2026-10-17`.
- **Purpose**: Designed to exhibit realistic laptop manufacturing supply chain disruptions (e.g. processor shortages, supplier lead time delays, surge demand) without exposing proprietary commercial information.

---

## 2. Demand Forecasting Model & Backtest Outcome
- **Production Baseline (Champion)**: Demand forecasting for inventory projections uses the `weekday_average` baseline model (computes weekday-specific mean consumption over a 28-day lookback window).
- **Challenger Model**: A machine learning challenger model (`ridge_weekday_trend`, Ridge regression with alpha=1.0 and linear trend features) was evaluated using rolling-origin backtesting across 14 components and multiple forward folds.
- **Decision Rule & Live API Metrics**:
  The pre-set decision rule requires:
  > *"The challenger ('ridge_weekday_trend') is recommended over the production champion ('weekday_average') only if its pooled WAPE is at least 5.0% lower (relative) than the champion AND it achieves a lower absolute error sum in at least 60.0% of evaluated component-fold pairs."*
- **Actual Evaluation Results (Quoted from `/api/forecasting/evaluation`)**:
  - **Champion (`weekday_average`)**: Pooled WAPE = `0.1199`, MAE = `6.14`, RMSE = `22.72`.
  - **Challenger (`ridge_weekday_trend`)**: Pooled WAPE = `0.1171`, MAE = `6.00`, RMSE = `22.64`.
  - **Pooled WAPE Improvement**: `2.34%` (required >= `5.0%`).
  - **Win Rate**: `58.97%` (46/78 component-fold pairs) (required >= `60.0%`).
  - **Outcome**: The baseline champion `weekday_average` was retained because the challenger did not satisfy the dual thresholds. The system transparently exposes this backtest evaluation on `/forecasting`.

---

## 3. Supplier Delay What-If Scenarios vs Predictive Probabilities
- **Descriptive, Not Predictive**: Supplier delay scenarios (e.g. typical +2 days, severe +7 days) represent historical empirical percentiles (e.g. p50, p90) observed across past shipments.
- **No Delivery Probability Claims**: Delays are simulated as what-if scenarios to stress-test stock exhaustion; they do not represent predictive probabilistic forecasts for any individual in-flight shipment.

---

## 4. Exposed Order Value as an Upper Bound (Not an Estimated Loss)
- **Upper Bound Definition**: When component stock runs out, customer orders due before the replenishment arrival date are flagged as potentially exposed.
- **Unknown Variables**: Precise production line scheduling, sub-assembly buffers, customer order priority allocation, and expediting are unknown to the high-level inventory model.
- **Language Constraint**: Exposed revenue is the total selling value of those affected orders (e.g. `2507110.00` USD / ₹`20,93,43,685.00` INR for CPU-X7). It is strictly an upper bound of financial exposure and must never be interpreted as an estimate of lost revenue or profit loss.

---

## 5. Scope: First Shortage Window Resolution
- **Targeted Scope**: Recovery recommendations (e.g. `alt_supplier.SUP-NEXUS` arriving 2026-10-21) are sized and timed specifically to eliminate the *first shortage window* (until the next scheduled inbound delivery).
- **Subsequent Shortages**: In the demo dataset, CPU-X7 faces a subsequent shortage episode beginning on `2026-11-02` (4,498.5 units over 44 days). The system explicitly flags this later episode in the recommendation details as not covered by the immediate tactical action.

---

## 6. Inter-Warehouse Transfer Parameters
- **Fixed Assumptions**: Inter-warehouse transfer lead time is configured as a fixed baseline parameter (`RECOVERY_TRANSFER_DAYS = 2` days).
- **Transfer Cost**: Transfer cost per unit is treated as unknown/unconfigured (`None`) by default, causing transfer options to be prioritized after options with known contractual costs.

---

## 7. Currency Conversion Rate
- **Configured, Not Live**: Display prices in INR are converted from stored USD values using a statically configured exchange rate (`USD_TO_INR_RATE` in `backend\.env`, benchmarked at 83.50).
- **No Live Forex Feed**: The system does not connect to live currency exchange APIs; real-time fluctuations are out of scope.

---

## 8. No Live SAP Connection (Sample Adapter is Illustrative)
- **Simulation Environment**: Sentinel AI does not connect to live SAP S/4HANA or ERP systems.
- **Sample Adapter**: The `sap-sample` data adapter reads bundled illustrative sample fixtures modeled after SAP OData schemas (`A_PurchaseOrder`, `A_Product`, `A_MaterialStock`).

---

## 9. Web CSV Upload Boundaries & Limitations
- **Local-Only & No Authentication**: The web upload pipeline (`/import`) is designed for local evaluation and demonstration. It does not include authentication, authorization, or multi-tenant user account isolation.
- **Single Uploaded Dataset**: The system maintains at most one uploaded dataset (`backend\data\uploaded.db`). Each subsequent dataset load completely replaces the previous uploaded dataset in an atomic operation.
- **Transient Active Selection**: The toggle between `demo` and `uploaded` is stored strictly in application process memory (`app.state`). Restarting the backend automatically reverts to the default `demo` dataset; the user's dataset selection is intentionally not persisted.
- **Zero Live Writes to Demo DB**: Web uploads are written exclusively to `backend\data\uploaded.db`. The primary demonstration database `backend\sentinel.db` is strictly protected and never written to by upload operations.

---

## 10. Single Plant Architecture
- **Manufacturing Plant**: The supply chain topology assumes a single primary laptop assembly plant (`WH-PLANT-01`) alongside regional distribution warehouses (`WH-REG-EAST`, `WH-REG-WEST`). Multi-plant bill-of-materials scheduling is outside the current domain model.

---

## 11. Read-Only API Enforcement & Explicit POST Allowlist
- **Strictly Controlled Write Surface**: All analytical and reporting endpoints under `/api/*` are strictly GET-only.
- **POST Allowlist**: Exactly three POST endpoints are permitted when `ENABLE_WEB_IMPORT=true`:
  - `POST /api/import/validate` (stateless in-memory validation; touches no DB)
  - `POST /api/import/load` (loads validated data into separate `uploaded.db`)
  - `POST /api/import/activate` (switches active dataset in-memory)
- **405 Method Not Allowed**: Any POST, PUT, PATCH, or DELETE to any other API endpoint is strictly rejected with HTTP 405 by the server framework.

---

## 12. Production Build Recommendation for Presentations
- **Stale Dev Server Behavior**: During development, Vite's development server (`npm run dev`) occasionally served cached bundle states after rapid dependency updates or browser state restores. The root cause in local developer environments was never conclusively demonstrated.
- **Production Standard**: All presentations and demonstrations must be run using the optimized production preview build (`npm run build` and `npm run preview -- --port 4173`), which guarantees deterministic asset loading.
