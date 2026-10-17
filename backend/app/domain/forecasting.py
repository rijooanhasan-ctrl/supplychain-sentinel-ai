"""Pure domain logic for demand forecasting models, rolling-origin backtest evaluation, and decision rules.

Conventions and Rules:
1. Pure business logic: strictly no database, no FastAPI, no system clock access.
   Anchored strictly to provided training slices and calendar dates.
2. Forecasting models:
   - seasonal_naive: most recent actual on same weekday before origin; fallback to training mean; clips >= 0.
   - weekday_average: reuses compute_weekday_average_profile from domain/inventory (lookback 28 days); clips >= 0.
   - ridge_weekday_trend: scikit-learn Ridge(alpha=1.0) on weekday one-hot features plus linear time index
     standardized strictly with training-only statistics; trained on up to last 120 training days; clips >= 0.
3. Leakage safeguards:
   - For every origin, training data is strictly date < origin.
   - Normalizers / standardizers are fit strictly on training slice.
4. Evaluation:
   - Chronological rolling-origin folds.
   - Per-fold and per-component metrics: MAE, RMSE, WAPE, Bias.
   - Aggregates: Pooled WAPE, Macro WAPE, MAE, RMSE, Bias.
   - Frozen decision rule: Challenger recommended only if relative pooled WAPE improvement >= 5% AND win rate >= 60%.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, List, Optional, Sequence, Tuple
import numpy as np
from sklearn.linear_model import Ridge

from app.domain.inventory import (
    DemandHistoryRecordInput,
    compute_weekday_average_profile,
)

DATA_CAVEAT = (
    "The synthetic dataset was generated with structural weekday patterns, trend, and noise. "
    "Evaluation metrics measure how effectively models recover synthetic data structures, "
    "not real-world supply chain forecasting accuracy."
)

DECISION_RULE_DESCRIPTION = (
    "The challenger ('ridge_weekday_trend') is recommended over the production champion "
    "('weekday_average') only if its pooled WAPE is at least 5.0% lower (relative) than the champion "
    "AND it achieves a lower absolute error sum in at least 60.0% of evaluated component-fold pairs."
)


@dataclass(frozen=True)
class ForecastEvalConfig:
    """Configuration parameters for demand forecasting evaluation."""

    min_train_days: int = 84
    horizon_days: int = 14
    step_days: int = 14
    min_improvement_pct: float = 5.0
    min_win_rate: float = 0.60
    lookback_weekday_days: int = 28
    ridge_max_train_days: int = 120
    ridge_min_train_days: int = 42
    ridge_alpha: float = 1.0

    def __post_init__(self) -> None:
        if self.min_train_days < 14:
            raise ValueError(f"min_train_days must be at least 14, got {self.min_train_days}")
        if self.horizon_days <= 0:
            raise ValueError(f"horizon_days must be positive, got {self.horizon_days}")
        if self.step_days <= 0:
            raise ValueError(f"step_days must be positive, got {self.step_days}")
        if self.min_improvement_pct < 0.0:
            raise ValueError(f"min_improvement_pct cannot be negative, got {self.min_improvement_pct}")
        if not (0.0 <= self.min_win_rate <= 1.0):
            raise ValueError(f"min_win_rate must be in [0.0, 1.0], got {self.min_win_rate}")


@dataclass(frozen=True)
class ComponentDemandInput:
    """Demand history for a single component."""

    component_id: int
    sku: str
    name: str
    demand_records: List[DemandHistoryRecordInput]


@dataclass(frozen=True)
class ModelMetricSummary:
    """Error metrics for a model over a set of evaluated points."""

    n_points: int
    mae: float
    rmse: float
    wape: Optional[float]
    bias: float


@dataclass(frozen=True)
class AggregateModelSummary:
    """Aggregate evaluation summary across all components and folds for one model."""

    model_name: str
    model_type: str
    description: str
    used_by_inventory_risk: bool
    pooled_wape: Optional[float]
    macro_wape: Optional[float]
    mae: float
    rmse: float
    bias: float
    n_points: int
    n_components: int


@dataclass(frozen=True)
class ProtocolInfo:
    """Rolling origin protocol specification."""

    min_train_days: int
    horizon_days: int
    step_days: int
    folds: int
    origin_dates: List[date]


@dataclass(frozen=True)
class ModelMetadata:
    """Metadata describing a forecasting model."""

    name: str
    type: str
    description: str
    used_by_inventory_risk: bool


@dataclass(frozen=True)
class DecisionResult:
    """Outcome of evaluating champion vs challenger against the decision rule."""

    rule_text: str
    champion: str
    challenger: str
    recommended: bool
    pooled_wape_improvement_pct: Optional[float]
    win_rate: Optional[float]
    reason: str


@dataclass(frozen=True)
class ComponentEvaluationResult:
    """Per-component backtest results across all models."""

    component_id: int
    sku: str
    name: str
    zero_demand: bool
    models: Dict[str, ModelMetricSummary]
    best_model: Optional[str]


@dataclass(frozen=True)
class SkippedComponentInfo:
    """Information regarding a component skipped during evaluation."""

    component_id: int
    sku: str
    name: str
    reason: str


@dataclass(frozen=True)
class ForecastEvaluationReport:
    """Full backtest evaluation response."""

    as_of: date
    data_caveat: str
    protocol: ProtocolInfo
    models: List[ModelMetadata]
    aggregate: Dict[str, AggregateModelSummary]
    decision: DecisionResult
    per_component: List[ComponentEvaluationResult]
    skipped: List[SkippedComponentInfo]


@dataclass(frozen=True)
class DayForecast:
    """Forecast for a single future day."""

    date: date
    weekday: str
    forecasts: Dict[str, float]


@dataclass(frozen=True)
class BacktestPoint:
    """Point in the backtest fold comparison."""

    date: date
    actual: float
    forecasts: Dict[str, float]


@dataclass(frozen=True)
class ComponentForecastDetail:
    """Forecasts for next N days plus last fold comparison."""

    component_id: int
    sku: str
    name: str
    as_of: date
    days: int
    forecast_days: List[DayForecast]
    backtest_last_fold: List[BacktestPoint]


# Model Descriptions
MODEL_METADATA_LIST = [
    ModelMetadata(
        name="seasonal_naive",
        type="heuristic_baseline",
        description="Uses the most recent actual demand observation on the same weekday before origin; falls back to training mean if weekday missing.",
        used_by_inventory_risk=False,
    ),
    ModelMetadata(
        name="weekday_average",
        type="production_champion",
        description="Computes weekday-specific mean demand over the 28-day lookback window; reuses production inventory logic.",
        used_by_inventory_risk=True,
    ),
    ModelMetadata(
        name="ridge_weekday_trend",
        type="challenger",
        description="Ridge regression (alpha=1.0) with weekday one-hot features and linear time trend standardized strictly on training slice (up to 120 days).",
        used_by_inventory_risk=False,
    ),
]


def forecast_seasonal_naive(
    training_records: Sequence[DemandHistoryRecordInput],
    origin: date,
    horizon_days: int,
) -> Tuple[List[float], int]:
    """Pure seasonal naive model.

    For date d in [origin, origin+h-1], forecast is the most recent actual on same weekday before origin.
    If missing, falls back to overall training mean.
    Returns (forecasts, fallback_count).
    """
    valid_train = [r for r in training_records if r.date < origin]
    if not valid_train:
        return [0.0] * horizon_days, horizon_days

    # Map each weekday to sorted list of records
    weekday_records: Dict[int, List[DemandHistoryRecordInput]] = {i: [] for i in range(7)}
    for r in valid_train:
        weekday_records[r.date.weekday()].append(r)

    overall_mean = sum(r.quantity for r in valid_train) / len(valid_train)

    forecasts: List[float] = []
    fallbacks = 0
    for k in range(horizon_days):
        target_date = origin + timedelta(days=k)
        w = target_date.weekday()
        samples = weekday_records[w]
        if samples:
            # Most recent actual before origin
            latest = max(samples, key=lambda x: x.date)
            forecasts.append(max(0.0, float(latest.quantity)))
        else:
            fallbacks += 1
            forecasts.append(max(0.0, float(overall_mean)))

    return forecasts, fallbacks


def forecast_weekday_average(
    training_records: Sequence[DemandHistoryRecordInput],
    origin: date,
    horizon_days: int,
    lookback_days: int = 28,
) -> Optional[List[float]]:
    """Pure production weekday-average model.

    Reuses compute_weekday_average_profile from app.domain.inventory.
    Returns None if history is insufficient.
    """
    profile = compute_weekday_average_profile(
        demand_records=training_records,
        as_of=origin,
        lookback_days=lookback_days,
        min_history_days=14,
        min_coverage_ratio=0.5,
    )

    if profile.status == "insufficient_history":
        return None

    if profile.status == "no_demand":
        return [0.0] * horizon_days

    weekday_forecast = profile.weekday_forecast
    if weekday_forecast is None:
        return None

    forecasts: List[float] = []
    for k in range(horizon_days):
        target_date = origin + timedelta(days=k)
        forecasts.append(max(0.0, float(weekday_forecast[target_date.weekday()])))

    return forecasts


def forecast_ridge_weekday_trend(
    training_records: Sequence[DemandHistoryRecordInput],
    origin: date,
    horizon_days: int,
    max_train_days: int = 120,
    min_train_days: int = 42,
    alpha: float = 1.0,
) -> Optional[List[float]]:
    """Pure Ridge regression model with weekday one-hot indicators and standardized linear time index.

    Standardization parameters (mean, std) are fit strictly on training slice.
    Returns None if fewer than min_train_days are present.
    """
    window_start = origin - timedelta(days=max_train_days)
    train_slice = [r for r in training_records if window_start <= r.date < origin]

    # Sort chronologically
    train_slice.sort(key=lambda r: r.date)
    if len(train_slice) < min_train_days:
        return None

    # Time index relative to first date in training slice
    ref_date = train_slice[0].date
    t_train = np.array([(r.date - ref_date).days for r in train_slice], dtype=float)
    mu_t = float(np.mean(t_train))
    sig_t = float(np.std(t_train))
    if sig_t <= 1e-9:
        sig_t = 1.0

    z_train = (t_train - mu_t) / sig_t

    X_train = []
    for i, r in enumerate(train_slice):
        w = r.date.weekday()
        row = [1.0 if w == k else 0.0 for k in range(7)]
        row.append(z_train[i])
        X_train.append(row)

    y_train = [float(r.quantity) for r in train_slice]

    model = Ridge(alpha=alpha, random_state=42)
    model.fit(X_train, y_train)

    forecasts: List[float] = []
    for k in range(horizon_days):
        target_date = origin + timedelta(days=k)
        t_d = float((target_date - ref_date).days)
        z_d = (t_d - mu_t) / sig_t
        w_d = target_date.weekday()
        feat = [1.0 if w_d == j else 0.0 for j in range(7)] + [z_d]
        pred = float(model.predict([feat])[0])
        forecasts.append(max(0.0, pred))

    return forecasts


def compute_metrics(actuals: Sequence[float], forecasts: Sequence[float]) -> ModelMetricSummary:
    """Computes MAE, RMSE, WAPE, Bias for paired actuals and forecasts."""
    n = len(actuals)
    if n == 0:
        return ModelMetricSummary(n_points=0, mae=0.0, rmse=0.0, wape=None, bias=0.0)

    act = np.array(actuals, dtype=float)
    pred = np.array(forecasts, dtype=float)
    err = pred - act
    abs_err = np.abs(err)

    mae = float(np.mean(abs_err))
    rmse = float(np.sqrt(np.mean(err**2)))
    sum_act = float(np.sum(act))
    wape = float(np.sum(abs_err) / sum_act) if sum_act > 1e-9 else None
    bias = float(np.mean(err))

    return ModelMetricSummary(
        n_points=n,
        mae=round(mae, 2),
        rmse=round(rmse, 2),
        wape=round(wape, 4) if wape is not None else None,
        bias=round(bias, 2),
    )


def run_forecast_evaluation(
    components: Sequence[ComponentDemandInput],
    as_of: date,
    config: Optional[ForecastEvalConfig] = None,
) -> ForecastEvaluationReport:
    """Performs full rolling-origin backtest evaluation and decision rule calculation."""
    if config is None:
        config = ForecastEvalConfig()

    # Determine global fold origins from common date range
    all_dates = set()
    for comp in components:
        for r in comp.demand_records:
            all_dates.add(r.date)

    if not all_dates:
        return ForecastEvaluationReport(
            as_of=as_of,
            data_caveat=DATA_CAVEAT,
            protocol=ProtocolInfo(
                min_train_days=config.min_train_days,
                horizon_days=config.horizon_days,
                step_days=config.step_days,
                folds=0,
                origin_dates=[],
            ),
            models=MODEL_METADATA_LIST,
            aggregate={},
            decision=DecisionResult(
                rule_text=DECISION_RULE_DESCRIPTION,
                champion="weekday_average",
                challenger="ridge_weekday_trend",
                recommended=False,
                pooled_wape_improvement_pct=None,
                win_rate=None,
                reason="No demand history available for evaluation.",
            ),
            per_component=[],
            skipped=[],
        )

    min_date = min(all_dates)
    max_date = max(all_dates)

    origin_dates: List[date] = []
    curr_origin = min_date + timedelta(days=config.min_train_days)
    while curr_origin + timedelta(days=config.horizon_days - 1) <= max_date:
        origin_dates.append(curr_origin)
        curr_origin += timedelta(days=config.step_days)

    protocol = ProtocolInfo(
        min_train_days=config.min_train_days,
        horizon_days=config.horizon_days,
        step_days=config.step_days,
        folds=len(origin_dates),
        origin_dates=origin_dates,
    )

    model_names = ["seasonal_naive", "weekday_average", "ridge_weekday_trend"]

    # Global error storage for pooling
    global_errors: Dict[str, Dict[str, List[float]]] = {
        m: {"actual": [], "forecast": []} for m in model_names
    }

    per_component_results: List[ComponentEvaluationResult] = []
    skipped_components: List[SkippedComponentInfo] = []

    # Track fold-level wins: challenger vs champion
    challenger_wins = 0
    total_compared_pairs = 0

    # Macro WAPE tracking
    component_wapes: Dict[str, List[float]] = {m: [] for m in model_names}
    component_counts: Dict[str, int] = {m: 0 for m in model_names}

    for comp in components:
        records_by_date = {r.date: r.quantity for r in comp.demand_records}
        total_quantity = sum(records_by_date.values())
        zero_demand = (total_quantity == 0.0)

        if zero_demand:
            skipped_components.append(
                SkippedComponentInfo(
                    component_id=comp.component_id,
                    sku=comp.sku,
                    name=comp.name,
                    reason="Component has zero recorded demand across all history days.",
                )
            )

        comp_model_pairs: Dict[str, Tuple[List[float], List[float]]] = {
            m: ([], []) for m in model_names
        }

        for origin in origin_dates:
            # Training slice: strictly date < origin
            train_recs = [r for r in comp.demand_records if r.date < origin]

            # Horizon actuals: missing actual dates are skipped
            horizon_dates = [origin + timedelta(days=k) for k in range(config.horizon_days)]
            eval_indices = [k for k, d in enumerate(horizon_dates) if d in records_by_date]
            if not eval_indices:
                continue

            fold_actuals = [records_by_date[horizon_dates[k]] for k in eval_indices]

            # Generate forecasts
            preds_sn, _ = forecast_seasonal_naive(train_recs, origin, config.horizon_days)
            preds_wka = forecast_weekday_average(train_recs, origin, config.horizon_days, config.lookback_weekday_days)
            preds_rg = forecast_ridge_weekday_trend(
                train_recs,
                origin,
                config.horizon_days,
                config.ridge_max_train_days,
                config.ridge_min_train_days,
                config.ridge_alpha,
            )

            # Record points
            eval_sn = [preds_sn[k] for k in eval_indices]
            comp_model_pairs["seasonal_naive"][0].extend(fold_actuals)
            comp_model_pairs["seasonal_naive"][1].extend(eval_sn)

            if preds_wka is not None:
                eval_wka = [preds_wka[k] for k in eval_indices]
                comp_model_pairs["weekday_average"][0].extend(fold_actuals)
                comp_model_pairs["weekday_average"][1].extend(eval_wka)

            if preds_rg is not None:
                eval_rg = [preds_rg[k] for k in eval_indices]
                comp_model_pairs["ridge_weekday_trend"][0].extend(fold_actuals)
                comp_model_pairs["ridge_weekday_trend"][1].extend(eval_rg)

            # Decision rule fold pairwise comparison
            if not zero_demand and preds_wka is not None and preds_rg is not None:
                eval_wka = [preds_wka[k] for k in eval_indices]
                eval_rg = [preds_rg[k] for k in eval_indices]
                err_wka_sum = sum(abs(p - y) for p, y in zip(eval_wka, fold_actuals))
                err_rg_sum = sum(abs(p - y) for p, y in zip(eval_rg, fold_actuals))

                total_compared_pairs += 1
                if err_rg_sum < err_wka_sum:
                    challenger_wins += 1

        # Component metrics per model
        comp_metrics: Dict[str, ModelMetricSummary] = {}
        for m in model_names:
            acts, preds = comp_model_pairs[m]
            if acts:
                m_summary = compute_metrics(acts, preds)
                comp_metrics[m] = m_summary
                if not zero_demand:
                    global_errors[m]["actual"].extend(acts)
                    global_errors[m]["forecast"].extend(preds)
                    component_counts[m] += 1
                    if m_summary.wape is not None:
                        component_wapes[m].append(m_summary.wape)
            else:
                comp_metrics[m] = ModelMetricSummary(n_points=0, mae=0.0, rmse=0.0, wape=None, bias=0.0)

        # Best model for component (lowest WAPE, breaking ties with MAE)
        best_model: Optional[str] = None
        if not zero_demand:
            valid_models = [m for m in model_names if comp_metrics[m].wape is not None]
            if valid_models:
                best_model = min(valid_models, key=lambda m: (comp_metrics[m].wape, comp_metrics[m].mae))

        per_component_results.append(
            ComponentEvaluationResult(
                component_id=comp.component_id,
                sku=comp.sku,
                name=comp.name,
                zero_demand=zero_demand,
                models=comp_metrics,
                best_model=best_model,
            )
        )

    # Global aggregate metrics
    aggregate: Dict[str, AggregateModelSummary] = {}
    meta_dict = {m.name: m for m in MODEL_METADATA_LIST}

    for m in model_names:
        acts = global_errors[m]["actual"]
        preds = global_errors[m]["forecast"]
        summary = compute_metrics(acts, preds)
        macro_wape = float(np.mean(component_wapes[m])) if component_wapes[m] else None
        meta = meta_dict[m]

        aggregate[m] = AggregateModelSummary(
            model_name=m,
            model_type=meta.type,
            description=meta.description,
            used_by_inventory_risk=meta.used_by_inventory_risk,
            pooled_wape=summary.wape,
            macro_wape=round(macro_wape, 4) if macro_wape is not None else None,
            mae=summary.mae,
            rmse=summary.rmse,
            bias=summary.bias,
            n_points=summary.n_points,
            n_components=component_counts[m],
        )

    # Decision rule calculation
    champ_wape = aggregate["weekday_average"].pooled_wape
    chall_wape = aggregate["ridge_weekday_trend"].pooled_wape

    wape_improvement_pct: Optional[float] = None
    if champ_wape is not None and chall_wape is not None and champ_wape > 0:
        wape_improvement_pct = round(((champ_wape - chall_wape) / champ_wape) * 100, 2)

    win_rate: Optional[float] = None
    if total_compared_pairs > 0:
        win_rate = round(challenger_wins / total_compared_pairs, 4)

    cond_wape = (wape_improvement_pct is not None and wape_improvement_pct >= config.min_improvement_pct)
    cond_win = (win_rate is not None and win_rate >= config.min_win_rate)
    recommended = bool(cond_wape and cond_win)

    if recommended:
        reason = (
            f"Challenger model 'ridge_weekday_trend' recommended: achieved {wape_improvement_pct:.2f}% "
            f"relative pooled WAPE reduction (threshold >= {config.min_improvement_pct:.1f}%) and "
            f"{win_rate * 100:.1f}% win rate across component-fold backtest pairs (threshold >= {config.min_win_rate * 100:.1f}%)."
        )
    else:
        failure_reasons = []
        if wape_improvement_pct is None or wape_improvement_pct < config.min_improvement_pct:
            val_str = f"{wape_improvement_pct:.2f}%" if wape_improvement_pct is not None else "N/A"
            failure_reasons.append(
                f"pooled WAPE improvement was {val_str} (required >= {config.min_improvement_pct:.1f}%)"
            )
        if win_rate is None or win_rate < config.min_win_rate:
            val_str = f"{win_rate * 100:.1f}% ({challenger_wins}/{total_compared_pairs})" if win_rate is not None else "N/A"
            failure_reasons.append(
                f"win rate was {val_str} (required >= {config.min_win_rate * 100:.1f}%)"
            )
        reason = (
            f"Baseline model 'weekday_average' retained: " + "; ".join(failure_reasons) + "."
        )

    decision = DecisionResult(
        rule_text=DECISION_RULE_DESCRIPTION,
        champion="weekday_average",
        challenger="ridge_weekday_trend",
        recommended=recommended,
        pooled_wape_improvement_pct=wape_improvement_pct,
        win_rate=win_rate,
        reason=reason,
    )

    return ForecastEvaluationReport(
        as_of=as_of,
        data_caveat=DATA_CAVEAT,
        protocol=protocol,
        models=MODEL_METADATA_LIST,
        aggregate=aggregate,
        decision=decision,
        per_component=per_component_results,
        skipped=skipped_components,
    )


def compute_component_forecast_detail(
    component: ComponentDemandInput,
    as_of: date,
    days: int = 14,
    config: Optional[ForecastEvalConfig] = None,
) -> ComponentForecastDetail:
    """Computes future N-day forecasts from as_of, plus backtest comparison on the last fold."""
    if config is None:
        config = ForecastEvalConfig()

    weekday_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    # 1. Future forecasts: training = all history strictly before as_of
    train_recs = [r for r in component.demand_records if r.date < as_of]

    sn_future, _ = forecast_seasonal_naive(train_recs, as_of, days)
    wka_future = forecast_weekday_average(train_recs, as_of, days, config.lookback_weekday_days)
    if wka_future is None:
        wka_future = [0.0] * days
    rg_future = forecast_ridge_weekday_trend(
        train_recs, as_of, days, config.ridge_max_train_days, config.ridge_min_train_days, config.ridge_alpha
    )
    if rg_future is None:
        rg_future = [0.0] * days

    forecast_days: List[DayForecast] = []
    for k in range(days):
        d = as_of + timedelta(days=k)
        forecast_days.append(
            DayForecast(
                date=d,
                weekday=weekday_names[d.weekday()],
                forecasts={
                    "seasonal_naive": round(sn_future[k], 2),
                    "weekday_average": round(wka_future[k], 2),
                    "ridge_weekday_trend": round(rg_future[k], 2),
                },
            )
        )

    # 2. Backtest last fold points
    records_by_date = {r.date: r.quantity for r in component.demand_records}
    all_dates = sorted(records_by_date.keys())
    backtest_last_fold: List[BacktestPoint] = []

    if all_dates:
        min_date = all_dates[0]
        max_date = all_dates[-1]
        origin_dates: List[date] = []
        curr_origin = min_date + timedelta(days=config.min_train_days)
        while curr_origin + timedelta(days=config.horizon_days - 1) <= max_date:
            origin_dates.append(curr_origin)
            curr_origin += timedelta(days=config.step_days)

        if origin_dates:
            last_origin = origin_dates[-1]
            last_train = [r for r in component.demand_records if r.date < last_origin]
            sn_fold, _ = forecast_seasonal_naive(last_train, last_origin, config.horizon_days)
            wka_fold = forecast_weekday_average(last_train, last_origin, config.horizon_days, config.lookback_weekday_days)
            if wka_fold is None:
                wka_fold = [0.0] * config.horizon_days
            rg_fold = forecast_ridge_weekday_trend(
                last_train, last_origin, config.horizon_days, config.ridge_max_train_days, config.ridge_min_train_days, config.ridge_alpha
            )
            if rg_fold is None:
                rg_fold = [0.0] * config.horizon_days

            for k in range(config.horizon_days):
                d = last_origin + timedelta(days=k)
                if d in records_by_date:
                    backtest_last_fold.append(
                        BacktestPoint(
                            date=d,
                            actual=round(records_by_date[d], 2),
                            forecasts={
                                "seasonal_naive": round(sn_fold[k], 2),
                                "weekday_average": round(wka_fold[k], 2),
                                "ridge_weekday_trend": round(rg_fold[k], 2),
                            },
                        )
                    )

    return ComponentForecastDetail(
        component_id=component.component_id,
        sku=component.sku,
        name=component.name,
        as_of=as_of,
        days=days,
        forecast_days=forecast_days,
        backtest_last_fold=backtest_last_fold,
    )
