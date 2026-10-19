# Scenario Simulator

## Overview

The **What-If Disruption Simulator** allows supply-chain analysts to interactively explore how upstream shocks—supplier delays, demand surges, and inventory adjustments—affect projected stock positions and customer exposure. It is a **decision-support tool only**: nothing is saved, no orders are created, and no real system is modified.

---

## Page Location

- **URL**: `/simulator`
- **Navigation**: Sidebar ? "Simulator" (between Recommendations and Inventory Risk)
- **Deep-link**: `/simulator?component_id=<id>` — pre-selects a component.

Cross-links from:
- **Alerts** page: each *Inventory Shortage* row has a **Simulate ?** link.
- **Recommendations** page: each component card header has a **Simulate ?** link.

---

## API Endpoint

```
GET /api/simulation
```

### Query Parameters

| Parameter              | Type    | Default | Range / Notes                        |
|------------------------|---------|---------|--------------------------------------|
| `component_id`         | int     | —       | **Required**. Must be a known component. |
| `supplier_delay_days`  | int     | 0       | 0 – 60                               |
| `demand_multiplier`    | float   | 1.0     | 0.5 – 3.0                            |
| `on_hand_delta`        | int     | 0       | -10 000 – +10 000 units              |
| `alt_supplier_available` | bool  | true    | Include alternative suppliers in recovery search |

### Error responses

| HTTP | Condition |
|------|-----------|
| 404  | `component_id` not found |
| 422  | Out-of-range parameter or `on_hand_delta` would push plant stock negative |
| 200  | `{"seeded": false}` when database is empty |

---

## Scenario Calculation Logic

The simulation evaluates **three scenarios** for the selected component:

### 1. Baseline
Evaluates the component using current snapshot data unchanged via `evaluate_component(inputs)`.

### 2. Disrupted
Applies shock parameters to inputs before evaluation:
- `supplier_delay_days > 0`: `shift_all_inbound(inputs, days)` — moves every inbound line forward by N days.
- `demand_multiplier ? 1.0`: `scale_demand(inputs, multiplier)` — scales mean daily demand.
- `on_hand_delta ? 0`: `adjust_plant_on_hand(inputs, delta)` — adjusts plant usable stock; raises ValueError (? 422) if result is negative.

### 3. With Recovery
Starts from disrupted inputs, then applies `evaluate_component_recovery(disrupted_inputs, ...)`.
`alt_supplier_available=false` excludes alt-supplier options from the recovery search.

### Target Window Definition & Headline Resolution (Phase 9 Fix)
Headline measures (`unmet_before_next_inbound`, `shortage_date`, `days_until_shortage`, and `risk_level`) evaluate the **first shortage episode of that scenario**:
- **Target cutoff**: The arrival date of the next replenishment inbound line in the disrupted scenario.
- **Recovered scenario**: When the intervention eliminates unmet demand prior to `target_cutoff`, the headline reports:
  - `unmet_before_next_inbound = 0.0`
  - `shortage_resolved_for_first_window = true`
  - `risk_level = "low"`
- **Later Shortages**: Any later shortage starting on or after the target cutoff is reported separately in `later_shortage`:
  - `date`, `days`, `units`, and text: *"Later shortage not covered by this recovery"*.
  - This prevents confusing the analyst by conflating a secondary shortage episode weeks later with the immediate disruption window being solved.
  - The UI comparison table surfaces this in a dedicated row: `Later shortage (not covered)`.

### `what_changed` sentences
Plain-language sentences dynamically generated based on changes between baseline?disrupted?recovered.

### Order exposure
`exposed_orders_count` and `exposed_revenue` from `compute_order_exposure_impact()`.
When `shortage_date is None`, exposure defaults to 0 orders / $0.00.

> **Upper-bound note**: Exposed Revenue is selling price of at-risk orders—not an estimate of loss.

---

## Assumptions & Limitations

1. **Delay shifts all inbound lines** regardless of supplier.
2. **Demand scaling is uniform** across all 30 projection days.
3. **Unmet demand is not carried forward** day-to-day.
4. **Recovery targets only the first shortage window**; later episodes are noted but not resolved.
5. **Transfer option costs are unknown**; alt-supplier and expedite options have known costs.
6. **All data is synthetic DEMO DATA** — fixed `as_of` date 2026-10-17. No real SAP connection.
7. **Nothing is saved** — scenarios are evaluated on-demand.

---

## Worked Example: CPU-X7 with +7-Day Supplier Delay

**Component**: CPU-X7 — High-Performance Processor 8-Core | **As-of**: 2026-10-17

| Metric | Baseline | Disrupted (+7d) | With Recovery |
|--------|----------|-----------------|---------------|
| Risk Level | Critical | Critical | Low |
| First Shortage Date | 2026-10-21 | 2026-10-21 | Eliminated |
| Shortage Window | 3 days | 10 days | — |
| Units Short (pre-inbound) | 289.5 | 1008.0 | 0 |
| Exposed Revenue | ~$125 000 | ~$300 000 | $0 |

**What changed**: The 7-day delay pushed the next inbound past the shortage window, extending it from 3 ? 10 days. Recovery via alt-supplier order eliminates the shortage.

### Currency Display Presentation (INR Mode)
All scenario evaluations and exposed revenue computations are performed strictly in USD. When `DISPLAY_CURRENCY="INR"` and a valid `USD_TO_INR_RATE` (e.g. `83.50`) are configured:
- Baseline Selling Value: `$125,000.00` × `83.50` = `₹1,04,37,500.00`
- Disrupted Selling Value: `$300,000.00` × `83.50` = `₹2,50,50,000.00`
- Recovery Action Incremental Cost (e.g. `$297,360.00`): `$297,360.00` × `83.50` = `₹2,48,29,560.00`
- Presented with the currency notice banner: *"Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹83.50 (assumption, not a live exchange rate)"*.

---

## Frontend Controls

| Control | Range | Default |
|---------|-------|---------|
| Component | All active | First (or `?component_id` URL) |
| Supplier Delay (days) | 0 – 60 | 0 |
| Demand Level (multiplier) | 0.5x – 3.0x, step 0.1 | 1.0 |
| Stock Change (units) | -10 000 – +10 000, step 10 | 0 |
| Alternative Supplier Available | Checkbox | ? checked |

### Presets
- **Example: supplier +7 days late** — fills delay=7, others default.
- **Example: demand +30%** — fills multiplier=1.3, others default.

Presets fill controls only; click **Run Simulation** to execute.

---

## SVG Line Chart (No External Libraries)

Hand-built accessible SVG, 30-day ending inventory balance:

- **Solid blue**: Baseline
- **Dashed red**: Disrupted
- **Dotted green**: With Recovery

Accompanied by an accessible projection table (`data-testid="projection-table"`).

---

## Reused Domain Components

| Module | What is reused |
|--------|---------------|
| `app/domain/inventory.py` | `evaluate_component`, `scale_demand`, `adjust_plant_on_hand`, `shift_all_inbound` |
| `app/domain/recovery.py` | `evaluate_component_recovery` |
| `app/domain/alerts.py` | `compute_order_exposure_impact` |
| `app/services/inventory_risk.py` | `build_component_inputs` |
