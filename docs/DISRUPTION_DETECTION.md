# SupplyChain Sentinel AI — Disruption Detection & Alerts (Phase 6)

## 1. Overview & Purpose

**SupplyChain Sentinel AI** is an AI/ML-driven supply-chain risk intelligence and decision-support tool created for **SAP Hackfest 2026** under the theme **Resilient Supply Chains**.

The Disruption Detection & Alerting engine monitors the entire multi-tier supply network for emerging disruptions. It synthesizes inventory projections, supplier reliability metrics, purchase order status changes, demand anomalies, quality trends, and nominal supplier capacities into a unified, prioritized alert stream.

### Decision-Support Boundaries
- **Stateless & Read-Only:** Disruption alerts are evaluated purely on request from the system's current snapshot (`GET /api/alerts`). There are no database tables, no acknowledge/dismiss mutations, and no write paths.
- **Strictly Decision Support:** The system never creates purchase orders, triggers transfers, or interfaces with real enterprise transactional ERP systems.
- **Synthetic Demo Data:** All calculations operate on deterministic synthetic data generated via `DemoAdapter`. All time operations anchor to `as_of` (`2026-10-17`), never the system wall clock.

---

## 2. Alert Types & Rules Matrix

Every alert is identified by a deterministic identifier formatted as `{type}.{key}` (or `{type}.{key}.{subkind}`), ensuring stable references across reloads and related alert links.

Alert severity follows a standard 5-level scale: `critical` > `high` > `medium` > `low` > `info`.

| Alert Type | Subject Scope | Trigger Condition | Severity Mapping | Fixed Pre-Registered Thresholds |
| :--- | :--- | :--- | :--- | :--- |
| **`inventory_shortage`** | Component | Projected plant stock runs below zero within the 30-day planning horizon based on daily inventory projection. | Matches `risk_level` from `evaluate_component` (`critical`, `high`, `medium`). Components with `low` or `none` risk do not generate shortage alerts. | Critical: shortage within 7 days; High: shortage within 14 days or days of supply < 7; Medium: shortage within 30 days or DOS < 14. |
| **`data_quality`** | Component | Component risk level cannot be evaluated reliably (`risk_level == "unknown"`). | Always **`low`**. Never guesses data; explicitly enumerates data quality flags. | Flags: `insufficient_demand_history` (history < 14 days), `no_plant_inventory` (no usable stock record). |
| **`supplier_delay_exposure`** | Component & Supplier | Evaluates counted inbound purchase orders from a supplier with a history of delivery tardiness. Run what-if delay scenarios against inventory projection. | Mapped to the inventory risk severity of the worst scenario (using standard inventory risk thresholds). Capped at **`medium`** with `low_confidence_supplier_history` flag if supplier deliveries $N < 10$. | $N_{\text{deliveries}} \ge 1$; $P(\text{late}) = 1 - \text{on\_time\_rate} \ge 0.20$; average delay when late is non-null. Triggered only if incremental unmet demand $> 0$ or first-episode duration increases. |
| **`po_slipped`** | Purchase Order | Open, in-transit, or partially received PO whose latest estimated delivery date has slipped past the promised date (`latest_estimate_date > promised_date`). | **`high`** if the PO feeds a component with a baseline shortage date and the slipped estimate falls *after* the shortage date; otherwise **`low`**. | Slipped days $> 0$; status in (`open`, `in_transit`, `partially_received`). |
| **`po_overdue`** | Purchase Order | Open, in-transit, or partially received PO whose effective expected delivery date (estimate if present, else promised) is strictly before `as_of`. | **`high`** if the fed component has `critical` or `high` inventory risk; otherwise **`medium`**. | Effective delivery date $< \text{as\_of}$. Overdue inbound lines are excluded from forward supply projections. |
| **`demand_surge`** | Component | Recent consumption significantly exceeds historical baseline consumption. Compares mean daily demand over recent 14 days against prior 28 days. | **`high`** if ratio $\ge 1.50$; **`medium`** if ratio $\ge 1.25$. No alert if ratio $< 1.25$. | `surge_recent_days = 14`, `surge_baseline_days = 28`, `surge_min_baseline_mean = 5.0` units/day, `surge_min_coverage = 0.80` (80% non-null days). Both windows are whole-week multiples (2 and 4 weeks) to preserve day-of-week balance. |
| **`quality_issue`** | Supplier | Supplier delivery rejection rate in the recent 90-day window exceeds quality tolerance. Compares $\sum \text{qty\_rejected} / \sum \text{qty\_received}$. | **`high`** if rejection rate $\ge 2 \times \text{threshold}$ ($\ge 4.0\%$); **`medium`** if rate $\ge 2.0\%$. | `quality_recent_days = 90`, `quality_rejection_threshold = 0.02` (2%), `quality_min_received_units = 500`. Deliveries with $\text{actual\_date} > \text{as\_of}$ are excluded. |
| **`capacity_constraint`** | Component | Analyzes whether contracted suppliers can replenish demand based on supplier component offers. Evaluated only for active components with baseline risk in `critical`, `high`, or `medium`. | **`medium`** for subkind `insufficient` (all suppliers have declared capacity, but $\sum \text{capacity} < 7 \times \text{mean daily demand}$). **`low`** for subkind `unknown` (any supplier has null capacity). | Subkind `insufficient`: nominal total weekly capacity < 7x mean daily demand. Subkind `unknown`: incomplete capacity visibility. |
| **`compound_risk`** | Component | Multi-factor vulnerability convergence. Evaluated per component when multiple distinct disruption types intersect with severity $\ge \text{medium}$. | Highest constituent severity. Escalated by one level (e.g. `medium` $\to$ `high`, `high` $\to$ `critical`) if 3 or more distinct disruption types converge. | `compound_min_types = 2`, `compound_escalate_at_types = 3`. Eligible constituent types: `inventory_shortage`, `supplier_delay_exposure`, `po_slipped`, `po_overdue`, `demand_surge`, `quality_issue`, `capacity_constraint`. |

---

## 3. What-If Delay Scenarios vs. Predictions

The `supplier_delay_exposure` alert models the consequence of supplier unreliability on inbound replenishment lines.

### Empirical What-If Methodology
For each counted open purchase order line feeding a vulnerable component:
1. **Baseline Scenario:** Uses the PO's current expected date (the vendor's latest estimate if provided, otherwise the promised date).
2. **Typical Delay Scenario:** Shifts the expected arrival date later by $\text{round\_half\_up}(\text{avg\_delay\_days\_when\_late})$ days (minimum 1 day).
3. **Severe Delay Scenario:** Shifts the expected arrival date later by $\lceil \text{p90\_delay\_days\_when\_late} \rceil$ days (minimum 1 day).

The inventory projection engine (`evaluate_component`) is executed independently with these shifted dates using the pure helper `shift_inbound_for_supplier(inputs, supplier_code, days)`. The resulting shortage dates, first-episode duration, unmet demand before next inbound, and total unmet demand across the planning horizon are recorded.

### Primary Metric vs. Horizon Total
- **Headline Operational Measure:** Alert summaries and recovery recommendations lead directly with `unmet_before_next_inbound` and the duration of the first shortage window. This represents the immediate operational crisis confronting planners before any scheduled supply arrives.
- **Horizon Total Label:** Total unmet demand over the full planning horizon is explicitly labeled: *"total over horizon, assuming no further supply; unchanged by delays because unmet demand is not carried forward"*. Because unmet demand is non-accumulating in standard stockout simulations, postponing an inbound delivery widens the first outage window without changing total horizon consumption.

### Why This Is NOT a Prediction
> **Crucial Analytical Principle:** The typical and severe delay scenarios are **deterministic stress tests**, NOT probabilistic predictions of a specific shipment's outcome.
> 
> The system explicitly **does not multiply the potential unmet demand or financial loss by the supplier's late probability**. In operational supply chain management, multiplying consequence by probability produces a misleading "expected loss" number that obscures the true binary cliff edge: if the shipment slips by its historical average of 7 days, the plant runs out of parts for 10 days, not a fraction of 10 days. The alert surfaces the observed empirical frequency alongside the deterministic what-if consequence, allowing planners to evaluate realistic downside exposure.

---

## 4. Customer Order Exposure & Upper-Bound Assumptions

For actionable decision support, alerts of type `inventory_shortage` and `supplier_delay_exposure` quantify the downstream impact on open customer orders.

### Order Exposure Criteria
A customer order is classified as exposed if all of the following hold:
1. **Status:** Order status is either `open` or `in_production` (orders already `shipped` or `cancelled` are excluded).
2. **Bill of Materials (BOM):** The finished product ordered contains the disrupted component in its BOM (`BomLine.component_id == component.id`).
3. **Due Date Window:** The order's `due_date` falls on or after the projected shortage date (`due_date >= shortage_date`) and within the planning horizon (`due_date < as_of + horizon_days`). Orders due *before* the shortage date are assumed to be fulfilled from existing on-hand stock.

### Exposure Metrics
- **Component Units Required:** $\sum (\text{order.quantity} \times \text{bom\_line.quantity\_per\_unit})$ across exposed orders.
- **Exposed Revenue:** $\sum (\text{order.quantity} \times \text{product.selling\_price})$, calculated using exact `Decimal` arithmetic.
- **Priority Breakdown:** Breakdown of affected customer orders by priority (`critical`, `high`, `normal`, `low`).

### Mandatory Analytical Assumptions
Every impact-bearing alert carries the following explicit statement:
> *"Upper bound of exposure: production lead time and stock allocation to orders are unknown, so these orders are potentially exposed, not predicted to be late. Exposed revenue is the selling value of those orders, not an estimate of loss."*

---

## 5. Compound Risk Convergence

Supply chain failures rarely occur in isolation. A delay from a reliable supplier may be manageable, but the same delay coupled with an active inventory shortage, a demand surge, or a quality crisis creates acute disruption.

The `compound_risk` alert detects these multi-tier intersections:
- **Constituents:** Only alerts with severity $\ge \text{medium}$ qualify as constituents. A `low`-severity `po_slipped` or `capacity_constraint.unknown` does not contribute to compound risk.
- **Thresholds:**
  - $\ge 2$ distinct disruption types: Compound alert created with severity equal to the highest constituent severity.
  - $\ge 3$ distinct disruption types: Severity is escalated by one level (e.g., `medium` $\to$ `high`, `high` $\to$ `critical`).
- **Transparency:** The compound alert names its constituent disruption facets and provides direct navigable links (`related_alert_ids`) to each constituent alert.

---

## 6. Stateless Evaluation & Future Persistence Considerations

### Current Stateless Architecture
Alerts are computed statelessly on each HTTP `GET /api/alerts` and `GET /api/alerts/{id}` request:
- No database tables for alerts exist.
- No write endpoints, background cron jobs, or database locking are required.
- Ensures total consistency with the underlying transactional state and zero stale cache artifacts.

### Enterprise Persistence Capabilities
In a production SAP S/4HANA or supply chain control tower deployment, a persistent alert layer would add:
1. **Planner Workflow State:** Alert assignment to inventory planners, acknowledgment, triage status, and resolution sign-offs.
2. **Audit Trails & Event Logs:** Tracking when an alert was first raised, duration of disruption exposure, and historical mitigation efficacy.
3. **Suppression & Snoozing:** Rules to mute recurring alerts during planned factory shutdowns or negotiated supplier variance windows.
4. **Push Telemetry & Webhooks:** Real-time webhooks dispatching high-severity alerts to enterprise messaging systems (e.g. Microsoft Teams, Slack, SAP Fiori notifications).

---

## 7. Known Limitations & Heuristics

1. **Heuristic Thresholds:** Fixed thresholds (e.g., 14-day surge window, 20% delay probability gate, 2% rejection rate) are calibrated for demo sensitivity. They serve as transparent decision rules rather than black-box statistical anomalies.
2. **Demand Surge Ignores Stochastic Noise:** The 14-day / 28-day ratio evaluates step changes in demand, but does not perform formal hypothesis testing against Poisson or negative binomial variance.
3. **Capacity Ignores Commitments:** The capacity constraint check compares nominal vendor weekly capacity against plant consumption, but has no visibility into the supplier's commitments to other competing OEMs.
4. **No Financial Loss Model:** Exposed revenue reflects gross customer order value, not gross margin loss, expedited freight costs, or contractual late penalty fees.
5. **No Production Shop-Floor Scheduling:** The exposure model assumes immediate component assembly on order due dates, abstracting away manufacturing queue times and work-in-progress buffers.

---

## 8. Worked Verification Example: CPU-X7 & SUP-HELIX

The flagship disruption scenario in the demo dataset centers on component **`CPU-X7`** (Core Processor X7) and key supplier **`SUP-HELIX`** (Helix Microelectronics).

### Baseline Situation (as of 2026-10-17)
- **Usable Plant Inventory:** 420 units at Plant Alpha (`WH-PLANT-01`).
- **Mean Daily Demand:** 101.43 units/day (Weekday average: ~126.0 units/day; Weekend average: ~40.0 units/day).
- **Projected Days of Supply:** 4.14 days.
- **Baseline Shortage Date:** **2026-10-21**.
- **First Shortage Episode:** 2026-10-21 through 2026-10-23 (3 days of shortage; 289.5 units unmet).
- **Inbound Replenishment:** Purchase order `PO-CPU-701` (800 units, promised **2026-10-24**, supplier `SUP-HELIX`). Receipt ends the first shortage episode, but a second shortage begins on 2026-11-02.

### Supplier Delay What-If Scenarios
- **Supplier Performance:** SUP-HELIX has 40 historical delivery records, 55.0% on-time delivery rate ($P(\text{late}) = 0.45 \ge 0.20$), average delay when late of 7.44 days, and 90th percentile delay of 13.0 days.
- **Typical Scenario (+7 Days Delay):**
  - Shifted expected date for PO-CPU-701: $\text{round\_half\_up}(7.44) = 7$ days $\to$ **2026-10-31**.
  - First shortage episode expands to **2026-10-21 through 2026-10-30** (10 days).
  - Unmet demand before receipt: **999.0 units** (+709.5 units unmet before next inbound).
- **Severe Scenario (+13 Days Delay):**
  - Shifted expected date for PO-CPU-701: $\lceil 13.0 \rceil = 13$ days $\to$ **2026-11-06**.
  - First shortage episode expands to **2026-10-21 through 2026-11-05** (16 days).
  - Unmet demand before receipt: **1,583.8 units** (+1,294.3 units unmet before next inbound).

### Downstream Customer Order Exposure
- **Exposed Orders:** 15 open and in-production customer orders are due between 2026-10-21 and the 30-day horizon (2026-11-16).
- **Component Units Required:** 1,390 units of CPU-X7.
- **Exposed Revenue:** **$2,507,110.00**.
- **Breakdown by Priority:**
  - Critical: 8 orders
  - High: 5 orders
  - Normal: 0 orders
  - Low: 2 orders

### Currency Display Presentation (INR Mode)
- Stored records, underlying calculations, and raw API responses maintain customer order selling prices in USD.
- When `DISPLAY_CURRENCY="INR"` and a valid `USD_TO_INR_RATE` (e.g. `83.50`) are configured:
  - Stored USD exposed revenue: `$2,507,110.00`
  - Displayed INR exposed revenue: `$2,507,110.00` × `83.50` = `₹20,93,43,685.00`
- Presented with the mandatory upper-bound exposure notice and currency conversion disclaimer (*1 USD = ₹83.50*).

