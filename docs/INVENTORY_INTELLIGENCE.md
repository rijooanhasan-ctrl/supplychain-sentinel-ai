# Inventory Intelligence — SupplyChain Sentinel AI

## 1. Purpose and Overview
The **Inventory Intelligence** module (`backend/app/domain/inventory.py`, `backend/app/services/inventory_risk.py`, `/api/inventory-risk`) delivers forward-looking stockout risk classification and daily shortage projections for manufacturing components consumed at the Austin assembly plant.

It provides early warning intelligence to procurement and supply chain operators regarding impending production halts, quantifying:
- Plant usable stock availability
- Demand forecasts based on historical weekday consumption patterns
- Expected inbound purchase order shipments (respecting delivery estimates and overdue policies)
- First shortage date and cumulative unmet demand units across a 60-day planning horizon
- Actionable, transparent risk classifications and evidence-based explanations

---

## 2. Core Conventions and Domain Principles

### Pure Domain Logic
- All risk classification, demand estimation, daily stock projection, and explanation construction logic lives strictly in `backend/app/domain/inventory.py`.
- Domain functions are **pure functions** operating on frozen Python dataclasses. They have **zero** dependencies on FastAPI, SQLAlchemy, HTTP clients, or the operating system clock.

### Time Anchoring
- **"Today" = `as_of` (date):** Projections are anchored to the dataset's `as_of` date (`2026-10-17`), retrieved from `DatasetMeta`. The system never queries the system or browser clock.
- **Projection horizon:** Day $k = \text{as\_of} + k$ days for $k = 0 \dots \text{horizon\_days} - 1$ (default horizon: 60 days).

### Inventory Boundaries
- **Plant Usable Stock:** Only inventory stored at facilities with role `"plant"` (the Austin assembly facility) is counted toward production coverage:
  $$\text{usable\_stock} = \max(0, \text{on\_hand} - \text{reserved})$$
  - If $\text{reserved} > \text{on\_hand}$, usable stock is clamped to $0$ and the flag `reserved_exceeds_on_hand` is raised.
  - If a component has no inventory record at the plant warehouse, usable stock is unknown: forecast status `"no_plant_inventory"`, risk `"unknown"`, and flag `no_plant_inventory` is raised. Zero is never assumed.
- **Regional Stock:** Inventory at non-plant warehouses (e.g. East Hub, West Hub) is **not** counted toward plant cover. It is reported separately as informational context (`"potentially transferable; no transfer assumed"`) alongside flag `regional_stock_available`.

### Demand Estimation Baseline ("weekday_average")
- **Window:** Considers `DemandRecord` rows in $[\text{as\_of} - \text{lookback\_days}, \text{as\_of} - 1]$ (default lookback: 28 days).
- **History Validation:**
  - Distinct calendar dates present must be $\ge \text{min\_history\_days}$ (default: 14 days).
  - Coverage ratio $\frac{\text{distinct dates present}}{\text{lookback\_days}}$ must be $\ge \text{min\_coverage\_ratio}$ (default: 0.8).
  - If either condition fails: status `"insufficient_history"`, risk `"unknown"`, flag `insufficient_history`. Missing dates are treated as missing, never zero.
- **Weekday Forecast:**
  - For each day of the week (Monday through Sunday), the forecast demand is the arithmetic mean of observed consumption for that weekday within the lookback window.
  - If a specific weekday has no samples in the window, it falls back to the overall window mean and flags `weekday_fallback`.
  - Overall mean daily demand is reported as $\text{mean\_daily\_demand} = \frac{\sum \text{quantities}}{\text{total observed dates}}$.
- **Zero Demand:**
  - Components with an overall window mean of exactly $0$ have status `"no_demand"`, risk `"none"`, no shortage, $\text{coverage\_days} = \text{null}$, and flag `zero_demand`.

### Inbound Supply and PO Timing
- **Eligibility:** Counted from `PurchaseOrderLine` where `po.status` is `'open'`, `'in_transit'`, or `'partially_received'`, and destination warehouse has role `'plant'`.
- **Remaining Quantity:** $\text{remaining} = \text{qty\_ordered} - \text{qty\_received} > 0$.
- **Expected Date:** Uses `latest_estimate_date` if present (`date_basis="estimated"`), else falls back to `promised_date` (`date_basis="promised"`).
  - Flag `inbound_promise_only` is raised when any counted inbound PO relies solely on the promised date without a supplier update.
- **Overdue Inbound Policy:**
  - Under `overdue_inbound_policy="exclude"`, any inbound line with $\text{expected\_date} < \text{as\_of}$ is **excluded** from supply projections. It is reported separately as `unconfirmed_inbound` with flag `overdue_inbound_excluded`.
- **Out of Horizon:** Inbound lines with $\text{expected\_date} \ge \text{as\_of} + \text{horizon\_days}$ are excluded from projection and listed as `out_of_horizon_inbound` with flag `inbound_outside_horizon`.
- **Non-Plant Inbound:** Purchase orders destined for regional distribution hubs are not counted toward plant replenishment.

---

## 3. Projection Timing and Mathematical Formulas

### Intra-Day Sequencing
Receipts dated day $D$ arrive at the **start** of day $D$. Demand for day $D$ is consumed **during** day $D$.

For projection day $k \in [0, \text{horizon\_days} - 1]$:
$$\text{available\_stock}_k = \text{balance}_{k-1} + \text{receipts}_k \quad (\text{where } \text{balance}_{-1} = \text{plant\_usable\_stock})$$
$$\text{ending\_balance}_k = \max(0, \text{available\_stock}_k - \text{forecast\_demand}_k)$$
$$\text{unmet}_k = \max(0, \text{forecast\_demand}_k - \text{available\_stock}_k)$$

- **Stock exactly equal to demand** ($\text{available\_stock}_k = \text{forecast\_demand}_k$) yields $\text{ending\_balance}_k = 0$ and $\text{unmet}_k = 0$; this is **not** a shortage.
- **Shortage condition:** A day has a shortage if and only if $\text{unmet}_k > 0$.
- **`shortage_date`:** The earliest projection date where $\text{unmet}_k > 0$ with counted inbound.
- **`days_until_shortage`:** $(\text{shortage\_date} - \text{as\_of}).\text{days}$.
- **`unmet_demand_units`:** $\sum_{k=0}^{\text{horizon}-1} \text{unmet}_k$.
- **`shortage_days`:** Count of days in the horizon with $\text{unmet}_k > 0$.
- **`runout_date_without_inbound`:** Shortage date when evaluating the exact same demand projection with all receipts forced to $0$.

### Why `coverage_days` Differs from Projected Shortage Date
- **Simple Coverage Days:**
  $$\text{coverage\_days} = \frac{\text{plant\_usable\_stock}}{\text{mean\_daily\_demand}}$$
  Assumes flat, continuous daily consumption equal to the overall mean.
- **Projected Shortage Date:**
  Evaluates consumption day-by-day taking into account actual day-of-week demand variance (e.g., weekday consumption ~125 units/day vs. weekend consumption ~40 units/day) as well as scheduled inbound receipts.
- **Example:** For CPU-X7, usable stock is 420 units and mean daily demand is 101.4 units/day. The simple ratio gives $\frac{420}{101.36} \approx 4.1$ days. However, because `as_of` (2026-10-17) is a Saturday, weekend consumption is light (40 on Sat, 39.5 on Sun), leaving 340.5 units for Monday and Tuesday (126.5 and 126.0), causing stock to run out on Wednesday 2026-10-21 (Day 4).

---

## 4. Risk Classification Rules and Configurable Thresholds

Risk classification evaluates the timing of the projected shortage against configured operational thresholds:

| Risk Level | Trigger Condition | Default Threshold |
| :--- | :--- | :--- |
| **`critical`** | Shortage projected with $\text{days\_until\_shortage} \le \text{critical\_days}$ | $\le 7$ days |
| **`high`** | Shortage projected with $\text{critical\_days} < \text{days\_until\_shortage} \le \text{high\_days}$ | $\le 14$ days |
| **`medium`** | Shortage projected with $\text{high\_days} < \text{days\_until\_shortage} \le \text{medium\_days}$ | $\le 30$ days |
| **`low`** | No shortage within horizon, or shortage occurs $> \text{medium\_days}$ | $> 30$ days or no shortage |
| **`none`** | Forecast status is `"no_demand"` (window consumption is 0) | N/A |
| **`unknown`** | Forecast status `"insufficient_history"` or `"no_plant_inventory"` | N/A |

### Configuration Parameters and Environment Overrides
Configured via `app.core.config.Settings`:
- `INVENTORY_LOOKBACK_DAYS` (default: 28, valid: 14..365)
- `INVENTORY_MIN_HISTORY_DAYS` (default: 14)
- `INVENTORY_MIN_COVERAGE_RATIO` (default: 0.8)
- `INVENTORY_HORIZON_DAYS` (default: 60, valid: 7..180)
- `INVENTORY_CRITICAL_DAYS` (default: 7)
- `INVENTORY_HIGH_DAYS` (default: 14)
- `INVENTORY_MEDIUM_DAYS` (default: 30)
- `INVENTORY_OVERDUE_INBOUND_POLICY` (default: `"exclude"`)

Validation guarantees $0 < \text{critical} < \text{high} < \text{medium} \le \text{horizon}$. Startup fails with clear error messages if invalid combinations are supplied.

---

## 5. Machine-Readable Flags Catalogue

| Flag Code | Severity | Description / Meaning |
| :--- | :--- | :--- |
| `zero_demand` | Info | Demand history in the lookback window is exactly zero. |
| `insufficient_history` | Warning | Insufficient distinct dates or low coverage ratio in demand window; cannot forecast. |
| `weekday_fallback` | Info | One or more weekdays had no demand records; fell back to overall window mean. |
| `reserved_exceeds_on_hand` | Warning | Plant inventory reserved quantity exceeds on-hand quantity; usable stock clamped to 0. |
| `no_plant_inventory` | Warning | No inventory level record found at the plant warehouse for this component. |
| `no_open_inbound` | Info | No open, in-transit, or partially received purchase orders destined for the plant. |
| `inbound_promise_only` | Info | Counted inbound POs rely solely on supplier promised date without updated estimate. |
| `overdue_inbound_excluded` | Warning | Inbound purchase orders have expected arrival dates prior to today (`as_of`) and are excluded from supply. |
| `inbound_outside_horizon` | Info | Inbound purchase orders exist but arrive after the 60-day projection horizon. |
| `regional_stock_available` | Info | Stock exists at regional distribution warehouses; potentially transferable (no transfer assumed). |

---

## 6. Worked Example: CPU-X7 Benchmark Scenario

Using the active benchmark dataset (`seed=42`, `as_of="2026-10-17"`, Saturday):

### Stored Facts
- **Component:** CPU-X7 (id: 1, Category: Processor, Criticality: Critical)
- **Plant Stock:** On Hand = 520, Reserved = 100 $\implies$ **Usable = 420**
- **Regional Stock:** East Hub = 150, West Hub = 50 $\implies$ **Total Regional = 200**
- **Demand History (last 28 days):** 28 dates present (100% coverage ratio)
  - Monday mean: 126.50
  - Tuesday mean: 126.00
  - Wednesday mean: 124.25
  - Thursday mean: 128.50
  - Friday mean: 124.75
  - Saturday mean: 40.00
  - Sunday mean: 39.50
  - Overall Mean Daily Demand: **101.36 units/day**
- **Inbound Orders:** `PO-CPU-701`, qty_ordered = 800, qty_received = 0, status = `in_transit`, promised_date = `2026-10-24`, latest_estimate_date = `null` (basis: `"promised"`).

### Projection Walkthrough
| Day | Date | Day Name | Demand | Receipts | Ending Balance | Unmet | Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 0 | 2026-10-17 | Sat | 40.00 | 0.00 | 380.00 | 0.00 | Weekend demand consumed |
| 1 | 2026-10-18 | Sun | 39.50 | 0.00 | 340.50 | 0.00 | Weekend demand consumed |
| 2 | 2026-10-19 | Mon | 126.50 | 0.00 | 214.00 | 0.00 | Weekday assembly rate |
| 3 | 2026-10-20 | Tue | 126.00 | 0.00 | 88.00 | 0.00 | Stock drops to 88 units |
| 4 | 2026-10-21 | Wed | 124.25 | 0.00 | 0.00 | **36.25** | **SHORTAGE OCCURS** ($88 - 124.25 = -36.25$) |
| 5 | 2026-10-22 | Thu | 128.50 | 0.00 | 0.00 | **128.50** | Stockout persists |
| 6 | 2026-10-23 | Fri | 124.75 | 0.00 | 0.00 | **124.75** | Stockout persists |
| 7 | 2026-10-24 | Sat | 40.00 | 800.00 | 760.00 | 0.00 | PO-CPU-701 arrives at start of day; replenishes stock |

### Evaluation Summary
- **First Shortage Date:** `2026-10-21` (Day 4)
- **Days Until Shortage:** 4 days
- **Coverage Days (simple):** $\frac{420}{101.36} \approx 4.1$ days
- **Runout Date Without Inbound:** `2026-10-21`
- **Next Replenishment:** 800 units on `2026-10-24` (PO-CPU-701, date_basis: `"promised"`)
- **Risk Level:** **`critical`** (Shortage projected in 4 days $\le 7$ days)
- **Explanation:**
  > "Usable plant stock 420 (on hand 520 − reserved 100). Expected demand ~101.4/day (weekday-aware: ~126.0 weekdays, ~39.8 weekends). Stock runs out on 2026-10-21 (in 4 days). Next inbound: 800 units on 2026-10-24 (promised date; supplier gave no updated estimate), 3 days after the projected shortage. Estimated unmet demand: 4788.0 units across the 60-day horizon."

---

## 7. Assumptions and Limitations

1. **Heuristic Baseline:** Demand estimation is a weekday-average arithmetic heuristic, not a trained machine-learning model or neural network.
2. **Single Plant Focus:** Stockout projections currently model the primary manufacturing plant. Inter-warehouse transfers are not automatically scheduled.
3. **Deterministic Lead Times:** Assumes inbound shipments arrive on their promised or estimated date; supplier historical delivery variability is not yet dynamically factored into delivery dates (planned for Phase 5).
4. **No Intra-Week Seasonality:** Captures recurring day-of-week patterns, but does not model monthly, quarterly, or promotional demand spikes.
