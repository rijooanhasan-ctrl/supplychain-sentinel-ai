# Demand Forecasting & Evaluation Protocol

## Executive Overview
The Demand Forecasting module in **SupplyChain Sentinel AI** implements an empirical backtesting framework to rigorously evaluate candidate time-series models against historical component consumption. It establishes an evidence-based gatekeeper for promoting new forecasting algorithms into production inventory risk projections.

> [!CAUTION]
> **Synthetic Data Caveat:**
> The dataset provided by the `DemoAdapter` was generated using deterministic weekday profiles, mild linear trends, and additive Gaussian noise. Backtest metrics reflect how effectively models recover synthetic generative structures, not real-world supply chain forecast accuracy.

---

## Forecasting Models

All models operate as pure functions over training slices strictly preceding the forecast origin ($t < \text{origin}$). Forecasts for dates $[ \text{origin}, \text{origin} + h - 1 ]$ are clamped at $\ge 0.0$.

### 1. `seasonal_naive` (Heuristic Baseline)
- **Concept:** Predicts demand on future date $d$ (day of week $w = d.\text{weekday}()$) by copying the most recent observed actual on the same weekday strictly before the origin.
- **Fallback Rule:** If no historical observation on weekday $w$ exists in training, it falls back to the overall training mean. Fallback events are logged.
- **Production Role:** Baseline benchmark.

### 2. `weekday_average` (Production Champion)
- **Concept:** Reuses the core logic of `compute_weekday_average_profile` from `app.domain.inventory`. Calculates the empirical mean demand for each weekday across a 28-day lookback window $[ \text{origin} - 28, \text{origin} - 1 ]$.
- **Fallback Rule:** If a specific weekday has no observations within the 28-day window, falls back to the window's overall daily mean.
- **Production Role:** **Active Model in Inventory Risk**.

### 3. `ridge_weekday_trend` (ML Challenger)
- **Concept:** Regularized linear model using scikit-learn's `Ridge(alpha=1.0, random_state=42)`.
- **Feature Matrix ($X$):**
  - Weekday indicators: 7 binary columns (one-hot encoding for Monday through Sunday).
  - Standardized linear time index: $z_t = \frac{t - \mu_t}{\sigma_t}$, where $t$ is the elapsed day count from the start of the training slice.
- **Leakage Safeguards:** $\mu_t$ and $\sigma_t$ are computed **strictly on the training slice** (up to 120 days before origin). Future forecast dates $d$ use the same training $\mu_t$ and $\sigma_t$.
- **Minimum Data Requirement:** If fewer than 42 training records exist, the component-origin is skipped.
- **Production Role:** Candidate challenger evaluated against the decision rule.

---

## Rolling-Origin Backtest Protocol

Rather than a static train/test split, the engine runs chronological rolling-origin evaluation:
- `min_train_days` = 84
- `horizon_days` = 14
- `step_days` = 14

For a 180-day history window ($[ \text{as\_of} - 180, \text{as\_of} - 1 ]$), the protocol executes **6 chronological folds**:
- **Fold 0:** Origin `2026-07-13`, Horizon `2026-07-13` to `2026-07-26`
- **Fold 1:** Origin `2026-07-27`, Horizon `2026-07-27` to `2026-08-09`
- **Fold 2:** Origin `2026-08-10`, Horizon `2026-08-10` to `2026-08-23`
- **Fold 3:** Origin `2026-08-24`, Horizon `2026-08-24` to `2026-09-06`
- **Fold 4:** Origin `2026-09-07`, Horizon `2026-09-07` to `2026-09-20`
- **Fold 5:** Origin `2026-09-21`, Horizon `2026-09-21` to `2026-10-04`

At each fold, every model is retrained using only earlier data. Missing calendar dates in actuals are skipped, never imputed as zero.

---

## Evaluation Metrics

For actuals $y_i$ and forecasts $\hat{y}_i$ over $n$ evaluated points:
- **Mean Absolute Error (MAE):** $\text{MAE} = \frac{1}{n} \sum_{i=1}^n |\hat{y}_i - y_i|$
- **Root Mean Squared Error (RMSE):** $\text{RMSE} = \sqrt{\frac{1}{n} \sum_{i=1}^n (\hat{y}_i - y_i)^2}$
- **Weighted Absolute Percentage Error (WAPE):** $\text{WAPE} = \frac{\sum_{i=1}^n |\hat{y}_i - y_i|}{\sum_{i=1}^n y_i}$ (undefined / null if $\sum y_i = 0$)
- **Mean Forecast Error (Bias):** $\text{Bias} = \frac{1}{n} \sum_{i=1}^n (\hat{y}_i - y_i)$
- **Pooled WAPE:** Evaluated globally across all components and folds:
  $$\text{Pooled WAPE} = \frac{\sum_{c} \sum_{f} \sum_{d} |\hat{y}_{c,f,d} - y_{c,f,d}|}{\sum_{c} \sum_{f} \sum_{d} y_{c,f,d}}$$
- **Macro WAPE:** Unweighted average of component-level WAPEs for components with non-zero demand.

---

## Champion vs Challenger Decision Rule
Prior to executing the evaluation, the promotion criteria were frozen:
1. **Pooled WAPE Improvement:** The challenger must achieve at least a **5.0% relative reduction** in pooled WAPE compared to `weekday_average`:
   $$\Delta \text{WAPE}_{\text{rel}} = \frac{\text{WAPE}_{\text{champion}} - \text{WAPE}_{\text{challenger}}}{\text{WAPE}_{\text{champion}}} \ge 5.0\%$$
2. **Pairwise Win Rate:** The challenger must achieve a lower absolute error sum in at least **60.0%** of evaluated component-fold pairs:
   $$\text{Win Rate} = \frac{N_{\text{challenger wins}}}{N_{\text{compared pairs}}} \ge 60.0\%$$

If **both** conditions are satisfied, the challenger is marked `recommended: true`. Otherwise, the baseline is retained.

---

## Real Measured Results (`sentinel.db`, As-Of `2026-10-17`)

13 active components evaluated across 6 folds ($13 \times 6 \times 14 = 1,092$ evaluated points per model).
Component `COMP-SPARE-01` has zero recorded demand across all 180 days and was safely skipped.

| Model | Type | Pooled WAPE | Macro WAPE | MAE | RMSE | Bias | Points |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `seasonal_naive` | Heuristic Baseline | **13.57%** | 13.85% | 6.95 | 22.95 | -1.64 | 1,092 |
| `weekday_average` | Production Champion | **11.99%** | 12.08% | 6.14 | 22.72 | -1.76 | 1,092 |
| `ridge_weekday_trend` | ML Challenger | **11.71%** | 11.76% | 6.00 | 22.64 | -1.66 | 1,092 |

### Decision Rule Evaluation:
- **Relative WAPE Reduction:** $\frac{0.1199 - 0.1171}{0.1199} \times 100 = \mathbf{+2.34\%}$ (Threshold $\ge 5.0\% \implies \textbf{FAILED}$)
- **Pairwise Win Rate:** 46 wins out of 78 component-fold pairs $= \mathbf{58.97\%}$ (Threshold $\ge 60.0\% \implies \textbf{FAILED}$)
- **Formal Outcome:**
  > **Baseline model 'weekday_average' retained:** pooled WAPE improvement was 2.34% (required $\ge 5.0\%$); win rate was 59.0% (46/78) (required $\ge 60.0\%$).
- **Benchmark Comparison:** `weekday_average` reduced WAPE by **11.64%** relative to `seasonal_naive`.

---

## Limitations & What Real SAP Data Would Change
In a live SAP S/4HANA or SAP IBP environment:
1. **Demand Volatility & Intermittency:** Spare parts (Croston's method / TSB) require specialized intermittent demand models rather than standard linear regressors.
2. **Promotions & External Regressors:** SAP Advanced Planning and Optimization (APO) / IBP incorporate promotional calendars, price elasticity, and factory shutdown schedules.
3. **Hierarchical Forecasting:** Reconciliation across SKU, plant, region, and product hierarchy levels (bottom-up and top-down reconciliation).
4. **Lead Time Variability:** Forecast horizons should dynamically adjust based on vendor lead times rather than fixed 14-day intervals.
