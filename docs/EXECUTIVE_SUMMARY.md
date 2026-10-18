# Executive Summary & Decision Tradeoff

## Overview
The **Executive Summary** (`/executive-summary`) is a decision-support briefing designed for supply chain leaders and procurement managers at a fictional laptop manufacturer. It aggregates critical alerts, projected inventory runouts, recovery interventions, and supplier performance metrics into a unified, actionable overview.

> [!IMPORTANT]
> **Decision Support Only — No Real Orders Created**
> SupplyChain Sentinel AI is strictly a decision-support tool. All data is synthetic **DEMO DATA** (anchored to `2026-10-17`), and the system never creates purchase orders, modifies ERP records, or connects to live production SAP instances.

---

## What Each Section Shows

### 1. Headline & Dataset Lineage Banner
- **Headline Sentence**: A dynamically generated briefing statement summarizing active component shortages, identifying the single most urgent component SKU, its projected shortage date, and days until impact (e.g. `9 components face shortage risk; the most urgent is CPU-X7, short from 2026-10-21 (4 days).`). If no shortages are present, it clearly states `No components currently face shortage risk (none at risk).`
- **Data Source Badge**: Displays `DEMO DATA` or `SAP-STYLE-SAMPLE` along with the snapshot `as_of` date (`2026-10-17`) and confirmation that live ERP connectivity is inactive.

### 2. Top Priority Risks (Up to 3 Cards)
Displays the top 3 highest-priority components facing inventory shortages, ranked deterministically by alert severity (Critical > High > Medium > Low), shortest days until shortage, and component criticality.
- **Component SKU & Name**: Clear identification.
- **Severity Badge**: Plain-text badge (`CRITICAL`, `HIGH`, etc.).
- **Shortage Runway**: Projected shortage date and days away from snapshot.
- **Pre-Inbound Deficit**: Projected units short before the next scheduled replenishment arrives.
- **Window Duration**: Duration (in calendar days) of the primary shortage episode.
- **One-Line Reason**: Transparent rationale extracted from domain alert summaries.
- **"Why this?" Panel**: Expandable breakdown explaining why this risk was escalated.
- **Navigation Shortcuts**: Direct links to detailed view in `/alerts` and `/simulator?component_id=...`.

### 3. Recommended Action Card
Focuses on the single most urgent component with a feasible recovery recommendation.
- **Recommended Badge**: Plain-text `RECOMMENDED` badge.
- **Scope Limitation**: Explicitly states `Fixes the first shortage window only. Later shortages are not covered.`
- **Intervention Details**: Action kind (`alternative_supplier`, `expedite_existing`, or `transfer`), recommended order quantity, and expected arrival date.
- **Incremental Cost**: Computed incremental cost of taking the action. If cost cannot be estimated (e.g. inter-warehouse regional transfer), it displays `Unknown` rather than fabricating numbers.
- **Residual Unmet Demand**: Projected shortage remaining in the primary window after applying the action (ideally `0.0 units`).
- **Later Shortage Note**: Clear notification if later shortages exist outside the primary window.
- **Runner-Up Option**: Summarizes the next-best alternative considered during recovery evaluation.

### 4. Cost of Acting vs. Doing Nothing
A comparative two-column tradeoff matrix evaluating the immediate operational choice:
| Metric / Dimension | Act (Execute Recovery) | Do Nothing (Accept Delay) |
| :--- | :--- | :--- |
| **Intervention Cost** | Incremental cost of the recommended recovery option (or `Unknown`). | `—` ($0.00 direct procurement outlay). |
| **Units Short (Pre-Inbound)** | Residual deficit after intervention (e.g. `0.0`). | Full deficit before next inbound (e.g. `289.5 units`). |
| **Affected Customer Orders** | Customer orders with unfulfilled demand in the window after action. | Customer orders exposed to delay without intervention. |
| **Selling Value of Orders** | Aggregate selling price of remaining affected customer orders. | Aggregate selling price of all customer orders exposed to shortage. |

#### Difference Sentence & Upper-Bound Disclaimer
The system automatically generates a factual comparison sentence:
> *"Acting costs $85,550.00; exposed order value in the first shortage window falls from $2,507,110.00 to $1,709,176.00 (upper bound, not a loss)."*

> [!WARNING]
> **Why Cost Comparison is NOT a Savings Claim**
> Sentinel AI explicitly forbids labeling the difference between exposed revenue and recovery cost as "savings" or "loss estimate":
> 1. **Upper Bound of Exposure**: Production lead times, factory rescheduling, buffer stock, and customer order allocation rules are unknown to this model. Orders are potentially exposed to delay, not guaranteed to be canceled or lost.
> 2. **Revenue vs Margin**: Exposed order value represents gross customer order selling price, whereas intervention cost represents incremental component procurement expense. Comparing these values directly as a "net saving" or "ROI" is financially inaccurate.
> 3. **Mandatory Disclaimer**: Every presentation of exposed order value includes the mandatory statement:
>    *"Upper bound: production lead time and stock allocation are unknown, so these orders are potentially exposed, not predicted to be late. The value shown is the selling price of those orders, not an estimate of loss."*

### 5. Data Quality Lineage
Audits the integrity of the underlying data to maintain transparency:
- **One-Line Audit Note**: Plain-language summary (e.g. `Based on 14 components; 0 have insufficient history; supplier confidence for SUP-HELIX is high (40 deliveries); data source: DEMO DATA, not live`).
- **Expandable Metrics**: Total components evaluated, number with insufficient history (`unknown` risk), lookback window depth, and supplier confidence distribution (High / Medium / Low).
- **No Accuracy Claims**: The system never fabricates predictive accuracy percentages.

### 6. Transparent "Why this?" Panels
The reusable `<WhyThis />` component exposes the exact strings generated by domain services:
- No client-side recalculation or fixed explanatory numbers.
- Accessible keyboard navigation with `aria-expanded` and `aria-controls`.
- Reused across Executive Summary, Recommendations, and Alerts pages.

---

## Worked Example: CPU-X7 (NovaCore X7 Processor)

The default seed 42 dataset produces the following computed metrics for CPU-X7:

1. **Baseline State (Do Nothing)**:
   - Plant Usable On-Hand: `420` units
   - Mean Daily Demand: `102.5` units/day
   - Projected Runout Date: `2026-10-21` (4 days from snapshot `2026-10-17`)
   - Next Replenishment: `800` units on `2026-10-24` (PO-CPU-701 from SUP-HELIX)
   - Baseline Unmet Deficit (First Window): `289.5` units across 3 days (`2026-10-21` to `2026-10-23`)
   - Customer Order Exposure: `15` customer orders totaling `$2,507,110.00` in gross selling value.

2. **Recovery Recommendation (Act)**:
   - Selected Intervention: `alt_supplier.SUP-NEXUS` (Nexus Micro Devices Corp)
   - Order Quantity: `290` units (rounded up from 289.5)
   - Unit Cost: `$295.00`
   - Total Incremental Cost: `290 × $295.00 = $85,550.00`
   - Arrival Date: `2026-10-21`
   - Residual Deficit (First Window): `0.0` units (100% resolved)
   - Exposed Orders Remaining: `10` orders totaling `$1,709,176.00` (orders due during later episodes).
   - Later Shortage: Episode begins `2026-11-02` (44 days, `4,498.0` units unmet); explicitly documented as not covered by this recommendation.

---

## Key Assumptions & Limitations

1. **First Shortage Window Only**: Recovery recommendations and what-if evaluations target the primary shortage window ending at the next replenishment receipt. Subsequent shortage episodes are logged but require distinct planning cycles.
2. **Lost Consumption Model**: Unmet daily demand in stock projections is not carried forward as backorders.
3. **Operational Configuration**: Warehouse transfer lead times and costs are configured constants, not live logistics estimates.
4. **Demand Estimation**: Daily demand forecasts use a 28-day historical weekday-average heuristic.
5. **Supplier Delays**: Delay days and late rates represent historical empirical delivery frequencies, not predictive probabilities of future deliveries.
