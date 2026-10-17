# Supplier Risk Scoring Model

## Executive Overview
The Supplier Risk Scoring engine provides objective, transparent, and reproducible evaluation of supplier delivery reliability for SupplyChain Sentinel AI. Designed for SAP Hackfest 2026, it translates historical delivery execution into a normalized composite risk score $[0, 100]$ accompanied by statistical confidence intervals and risk band classifications.

> [!IMPORTANT]
> **Descriptive, Not Predictive:**
> The risk score and derived metrics (such as `late_delivery_probability` and `expected_delay_days_if_late`) reflect observed historical delivery frequencies and empirical averages over the evaluation lookback window. They do not simulate machine-learned future probability distributions or guarantee future delivery timing.

---

## Configuration & Default Parameters
All scoring parameters are encapsulated in the immutable domain dataclass `SupplierRiskConfig`, overridable via environment variables:

| Parameter | Env Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| `lookback_days` | `SUPPLIER_RISK_LOOKBACK_DAYS` | `365` | Evaluation window $[ \text{as\_of} - 365, \text{as\_of} ]$ |
| `on_time_grace_days` | `SUPPLIER_RISK_GRACE_DAYS` | `0` | Lateness $\le \text{grace}$ is considered on time |
| `w_on_time` | `SUPPLIER_RISK_W_ON_TIME` | `0.40` | Nominal weight for on-time delivery rate penalty |
| `w_delay` | `SUPPLIER_RISK_W_DELAY` | `0.25` | Nominal weight for average delay severity penalty |
| `w_rejection` | `SUPPLIER_RISK_W_REJECTION` | `0.20` | Nominal weight for parts quality rejection rate penalty |
| `w_fill` | `SUPPLIER_RISK_W_FILL` | `0.15` | Nominal weight for order quantity fulfillment shortfall penalty |
| `late_rate_full_penalty` | — | `0.50` | On-time rate shortfall reaching 50% incurs full penalty (1.0) |
| `delay_full_penalty_days` | — | `7.0` | Average lateness reaching 7.0 days incurs full penalty (1.0) |
| `rejection_full_penalty` | — | `0.05` | Rejection rate reaching 5.0% incurs full penalty (1.0) |
| `fill_shortfall_full_penalty` | — | `0.20` | Fill rate shortfall reaching 20% incurs full penalty (1.0) |
| `band_medium` | `SUPPLIER_RISK_BAND_MEDIUM` | `25.0` | Score threshold between Low and Medium risk |
| `band_high` | `SUPPLIER_RISK_BAND_HIGH` | `50.0` | Score threshold between Medium and High risk |
| `low_confidence_below` | — | `10` | Delivery count threshold for Low confidence |
| `high_confidence_from` | — | `30` | Delivery count threshold for High confidence |

---

## Mathematical Formulation

### 1. Delivery Metrics
For each delivery $i \in \{1, \dots, n\}$ within the lookback window:
- **Lateness:** $\text{lateness}_i = \max(0, (\text{actual\_date}_i - \text{promised\_date}_i).\text{days})$
- **On-Time Condition:** $\text{on\_time}_i = 1$ if $\text{lateness}_i \le \text{grace\_days}$, else $0$ (early deliveries are not penalized)
- **On-Time Rate:** $\text{on\_time\_rate} = \frac{1}{n} \sum_{i=1}^n \text{on\_time}_i$
- **Wilson Score 95% Confidence Interval ($z = 1.96$):**
  $$\text{center} = \frac{p + \frac{z^2}{2n}}{1 + \frac{z^2}{n}}, \quad \text{margin} = \frac{z}{1 + \frac{z^2}{n}} \sqrt{\frac{p(1-p)}{n} + \frac{z^2}{4n^2}}$$
  $$\text{CI}_{95\%} = [\max(0, \text{center} - \text{margin}), \min(1, \text{center} + \text{margin})]$$
- **Average Delay Across All Deliveries:** $\text{avg\_delay\_all} = \frac{1}{n} \sum_{i=1}^n \text{lateness}_i$
- **Average Delay When Late:** Mean lateness over late deliveries only (null if no late deliveries)
- **Percentiles (Nearest-Rank Method):** $p50$ and $p90$ lateness among late deliveries
- **Rejection Rate:** $\text{rejection\_rate} = \frac{\sum \text{qty\_rejected}}{\sum \text{qty\_received}}$ (null if total received is 0)
- **Fill Rate:** $\text{fill\_rate} = \frac{\sum \text{qty\_received}}{\sum \text{qty\_ordered}}$

### 2. Penalty Transformation $[0, 1]$
Each metric is linearly penalized up to a saturation threshold:
- **On-Time Penalty:** $P_{\text{on\_time}} = \min\left(1.0, \frac{1.0 - \text{on\_time\_rate}}{\text{late\_rate\_full\_penalty}}\right) = \min\left(1.0, \frac{1.0 - \text{on\_time\_rate}}{0.50}\right)$
- **Delay Penalty:** $P_{\text{delay}} = \min\left(1.0, \frac{\text{avg\_delay\_all}}{\text{delay\_full\_penalty\_days}}\right) = \min\left(1.0, \frac{\text{avg\_delay\_all}}{7.0}\right)$
- **Rejection Penalty:** $P_{\text{rejection}} = \min\left(1.0, \frac{\text{rejection\_rate}}{\text{rejection\_full\_penalty}}\right) = \min\left(1.0, \frac{\text{rejection\_rate}}{0.05}\right)$
- **Fill Penalty:** $P_{\text{fill}} = \min\left(1.0, \frac{\max(0, 1.0 - \text{fill\_rate})}{\text{fill\_shortfall\_full\_penalty}}\right) = \min\left(1.0, \frac{\max(0, 1.0 - \text{fill\_rate})}{0.20}\right)$

### 3. Dynamic Weight Renormalization
If a metric is undefined (e.g. 0 received units makes rejection rate undefined):
1. The undefined metric is dropped.
2. The remaining nominal weights $w_j$ are renormalized: $w_{\text{eff}, j} = \frac{w_j}{\sum_{k \in \text{valid}} w_k}$.
3. The confidence rating is downgraded by one tier (e.g., high $\to$ medium, medium $\to$ low).

### 4. Composite Risk Score & Classification
$$\text{risk\_score} = 100 \times \sum_{j} w_{\text{eff}, j} \cdot P_j$$
- **Score Range:** $[0, 100]$ (rounded to 1 decimal place for UI presentation)
- **Risk Bands:**
  - $\text{score} < 25.0 \implies \textbf{Low}$
  - $25.0 \le \text{score} < 50.0 \implies \textbf{Medium}$
  - $\text{score} \ge 50.0 \implies \textbf{High}$
- **Zero Delivery Handling:** If $n = 0$, score is `null`, band is `"unknown"`, confidence is `"none"`.

---

## Worked Example: SUP-HELIX (Helix Silicon Technologies)
Real values computed from `sentinel.db` (as of `2026-10-17`):

### Raw Evidence:
- **Total Deliveries ($n$):** 40 deliveries over the last 365 days
- **On-Time Deliveries:** 22 on time, 18 late $\implies \text{on\_time\_rate} = 55.0\%$
- **95% Wilson Score Interval:** $[39.8\%, 69.3\%]$
- **Lateness:** Total late days $= 134 \implies \text{avg\_delay\_all} = 3.35$ days; $\text{avg\_delay\_when\_late} = 7.44$ days; $p50 = 6.0$, $p90 = 14.0$, $\max = 18$ days
- **Units:** Ordered 29,500; Received 29,526; Rejected 280
- **Rejection Rate:** $\frac{280}{29,526} = 0.948\%$
- **Fill Rate:** $\frac{29,526}{29,500} = 1.000$ (100.0%)

### Penalty and Contribution Calculation:
1. **On-Time Delivery:**
   - Penalty: $\frac{1 - 0.550}{0.50} = \frac{0.450}{0.50} = 0.9000$
   - Contribution: $0.40 \times 0.9000 \times 100 = \mathbf{36.0\text{ pts}}$
2. **Delay Severity:**
   - Penalty: $\frac{3.35}{7.0} = 0.4786$
   - Contribution: $0.25 \times 0.4786 \times 100 = \mathbf{12.0\text{ pts}}$
3. **Quality Rejection:**
   - Penalty: $\frac{0.00948}{0.05} = 0.1897$
   - Contribution: $0.20 \times 0.1897 \times 100 = \mathbf{3.8\text{ pts}}$
4. **Order Fulfillment:**
   - Penalty: $0.0000$
   - Contribution: $0.15 \times 0.0000 \times 100 = \mathbf{0.0\text{ pts}}$

### Final Score:
$$\text{risk\_score} = 36.0 + 12.0 + 3.8 + 0.0 = \mathbf{51.8} \implies \textbf{High Risk Band}$$
Confidence: **High** ($n = 40 \ge 30$). Primary drivers: `on_time` ($36.0$ pts) and `delay` ($12.0$ pts).
