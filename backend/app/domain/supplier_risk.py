"""Domain logic for Supplier Risk Scoring.

Pure functions only. No database, no FastAPI, no system clock, no unseeded randomness.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
import math
from typing import Dict, List, Optional


DEFAULT_SUPPLIER_RISK_ASSUMPTIONS = [
    "Score is a transparent weighted formula summarizing historical delivery performance over the lookback window; it is descriptive and does not predict individual delivery outcomes.",
    "Late delivery probability (1 - on_time_rate) and expected delay days if late represent historical empirical frequencies.",
    "Early deliveries arriving prior to promised dates are not penalized (lateness is clamped at 0).",
    "Undefined metrics (e.g. rejection rate when total received units = 0) are dropped and remaining weights are renormalized, lowering the confidence rating by one tier.",
    "Open purchase order status, slips, and overdue counts are informational current-state metrics and are not factored into the historical score.",
]


@dataclass(frozen=True)
class SupplierRiskConfig:
    """Configuration for supplier risk calculation with default thresholds."""

    lookback_days: int = 365
    on_time_grace_days: int = 0
    w_on_time: float = 0.40
    w_delay: float = 0.25
    w_rejection: float = 0.20
    w_fill: float = 0.15
    late_rate_full_penalty: float = 0.50
    delay_full_penalty_days: float = 7.0
    rejection_full_penalty: float = 0.05
    fill_shortfall_full_penalty: float = 0.20
    band_medium: float = 25.0
    band_high: float = 50.0
    low_confidence_below: int = 10
    high_confidence_from: int = 30

    def __post_init__(self):
        if self.lookback_days <= 0:
            raise ValueError(f"lookback_days must be positive, got {self.lookback_days}")
        if self.on_time_grace_days < 0:
            raise ValueError(f"on_time_grace_days cannot be negative, got {self.on_time_grace_days}")

        weights = [self.w_on_time, self.w_delay, self.w_rejection, self.w_fill]
        if any(w < 0 for w in weights):
            raise ValueError(f"Weights cannot be negative: {weights}")
        total_w = sum(weights)
        if abs(total_w - 1.0) > 1e-9:
            raise ValueError(f"Weights must sum to 1 within 1e-9, got {total_w}")

        if self.late_rate_full_penalty <= 0:
            raise ValueError("late_rate_full_penalty must be positive")
        if self.delay_full_penalty_days <= 0:
            raise ValueError("delay_full_penalty_days must be positive")
        if self.rejection_full_penalty <= 0:
            raise ValueError("rejection_full_penalty must be positive")
        if self.fill_shortfall_full_penalty <= 0:
            raise ValueError("fill_shortfall_full_penalty must be positive")

        if not (0 < self.band_medium < self.band_high <= 100):
            raise ValueError(
                f"Bands must satisfy 0 < band_medium ({self.band_medium}) < band_high ({self.band_high}) <= 100"
            )

        if self.low_confidence_below <= 0 or self.high_confidence_from <= self.low_confidence_below:
            raise ValueError("Confidence thresholds must satisfy 0 < low_confidence_below < high_confidence_from")


@dataclass(frozen=True)
class DeliveryInput:
    id: int
    supplier_id: int
    component_id: int
    purchase_order_id: Optional[int]
    promised_date: date
    actual_date: date
    qty_ordered: int
    qty_received: int
    qty_rejected: int


@dataclass(frozen=True)
class OpenPoInput:
    po_id: int
    po_number: str
    status: str
    promised_date: date
    latest_estimate_date: Optional[date]
    remaining_qty: int


@dataclass(frozen=True)
class SupplierEvaluationInput:
    as_of: date
    supplier_id: int
    supplier_code: str
    supplier_name: str
    country: str
    deliveries: List[DeliveryInput]
    open_orders: List[OpenPoInput]
    config: SupplierRiskConfig = field(default_factory=SupplierRiskConfig)


@dataclass(frozen=True)
class MetricScoreBreakdown:
    metric_name: str
    raw_value: Optional[float]
    penalty: Optional[float]
    nominal_weight: float
    effective_weight: float
    contribution_points: float
    dropped: bool
    dropped_reason: Optional[str] = None


@dataclass(frozen=True)
class MonthlyPerformance:
    month: str  # YYYY-MM
    n_deliveries: int
    on_time_rate: Optional[float]


@dataclass(frozen=True)
class InformationalCurrentState:
    open_po_count: int
    open_pos_slipped_count: int
    open_pos_overdue_count: int
    open_remaining_qty: int


@dataclass(frozen=True)
class SupplierRiskResult:
    supplier_id: int
    supplier_code: str
    supplier_name: str
    country: str
    as_of: date

    # Delivery volume & filtering
    n_deliveries: int
    excluded_future_deliveries: int
    has_excluded_future_deliveries: bool

    # On-time performance & Wilson CI
    on_time_count: int
    on_time_rate: Optional[float]
    on_time_ci_lower: Optional[float]
    on_time_ci_upper: Optional[float]

    # Descriptive historical metrics
    late_delivery_probability: Optional[float]
    expected_delay_days_if_late: Optional[float]

    # Delays
    avg_delay_days_all: Optional[float]
    avg_delay_days_when_late: Optional[float]
    p50_delay_days_when_late: Optional[float]
    p90_delay_days_when_late: Optional[float]
    max_delay_days: Optional[float]

    # Quantities & Quality
    total_ordered_qty: int
    total_received_qty: int
    total_rejected_qty: int
    rejection_rate: Optional[float]
    fill_rate: Optional[float]

    # Scoring & Classification
    risk_score: Optional[float]
    risk_band: str
    confidence: str

    # Metrics Breakdown & Weights
    metrics_breakdown: List[MetricScoreBreakdown]
    nominal_weights: Dict[str, float]
    effective_weights: Dict[str, float]
    metrics_used: List[str]
    metrics_dropped: List[str]
    main_drivers: List[str]

    # Monthly breakdown & Informational state
    monthly_breakdown: List[MonthlyPerformance]
    informational_po: InformationalCurrentState

    # Text & Audit
    explanation: str
    assumptions: List[str]


def compute_wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Calculates the 95% Wilson score interval for a binomial proportion."""
    if total <= 0:
        raise ValueError("Total must be positive for Wilson score interval")
    p_hat = successes / total
    z2 = z * z
    denom = 1.0 + z2 / total
    center = (p_hat + z2 / (2.0 * total)) / denom
    margin = (z * math.sqrt((p_hat * (1.0 - p_hat) / total) + (z2 / (4.0 * total * total)))) / denom
    ci_lower = max(0.0, center - margin)
    ci_upper = min(1.0, center + margin)
    return ci_lower, ci_upper


def compute_nearest_rank_percentile(sorted_values: List[float], percentile: float) -> float:
    """Computes nearest-rank percentile (1-indexed rank = ceil(P/100 * N))."""
    if not sorted_values:
        raise ValueError("Cannot compute percentile of empty list")
    n = len(sorted_values)
    rank = math.ceil((percentile / 100.0) * n)
    idx = max(0, min(n - 1, rank - 1))
    return sorted_values[idx]


def evaluate_supplier(inputs: SupplierEvaluationInput) -> SupplierRiskResult:
    """Pure domain function to evaluate a supplier's historical risk profile."""
    cfg = inputs.config
    as_of = inputs.as_of
    window_start = as_of - timedelta(days=cfg.lookback_days)

    # 1. Filter deliveries by window [as_of - lookback_days, as_of]
    valid_deliveries: List[DeliveryInput] = []
    excluded_future = 0
    for d in inputs.deliveries:
        if d.actual_date > as_of:
            excluded_future += 1
        elif d.actual_date >= window_start:
            valid_deliveries.append(d)

    has_excluded_future = excluded_future > 0
    n = len(valid_deliveries)

    # 2. Informational open PO calculations
    open_po_count = len(inputs.open_orders)
    open_pos_slipped_count = sum(
        1
        for po in inputs.open_orders
        if po.latest_estimate_date is not None and po.latest_estimate_date > po.promised_date
    )
    open_pos_overdue_count = sum(
        1
        for po in inputs.open_orders
        if (po.latest_estimate_date or po.promised_date) < as_of
    )
    open_remaining_qty = sum(po.remaining_qty for po in inputs.open_orders)

    info_po = InformationalCurrentState(
        open_po_count=open_po_count,
        open_pos_slipped_count=open_pos_slipped_count,
        open_pos_overdue_count=open_pos_overdue_count,
        open_remaining_qty=open_remaining_qty,
    )

    # 3. Monthly Breakdown for last 12 calendar months relative to as_of
    # Months: YYYY-MM from 11 months ago to current month
    monthly_performance: List[MonthlyPerformance] = []
    cur_year = as_of.year
    cur_month = as_of.month
    months_list: List[str] = []
    for i in range(11, -1, -1):
        # Calculate year and month i months before (cur_year, cur_month)
        m_offset = cur_month - 1 - i
        y = cur_year + (m_offset // 12)
        m = (m_offset % 12) + 1
        months_list.append(f"{y:04d}-{m:02d}")

    # Map deliveries into months
    deliv_by_month: Dict[str, List[DeliveryInput]] = {m_str: [] for m_str in months_list}
    for d in valid_deliveries:
        m_str = f"{d.actual_date.year:04d}-{d.actual_date.month:02d}"
        if m_str in deliv_by_month:
            deliv_by_month[m_str].append(d)

    for m_str in months_list:
        m_delivs = deliv_by_month[m_str]
        m_n = len(m_delivs)
        if m_n == 0:
            monthly_performance.append(MonthlyPerformance(month=m_str, n_deliveries=0, on_time_rate=None))
        else:
            m_ontime = sum(
                1
                for d in m_delivs
                if max(0, (d.actual_date - d.promised_date).days) <= cfg.on_time_grace_days
            )
            monthly_performance.append(
                MonthlyPerformance(
                    month=m_str,
                    n_deliveries=m_n,
                    on_time_rate=round(m_ontime / m_n, 4),
                )
            )

    nominal_weights = {
        "on_time": cfg.w_on_time,
        "delay": cfg.w_delay,
        "rejection": cfg.w_rejection,
        "fill": cfg.w_fill,
    }

    # Handle n = 0 edge case
    if n == 0:
        breakdown = [
            MetricScoreBreakdown(
                metric_name="on_time",
                raw_value=None,
                penalty=None,
                nominal_weight=cfg.w_on_time,
                effective_weight=0.0,
                contribution_points=0.0,
                dropped=True,
                dropped_reason="No deliveries recorded in lookback window",
            ),
            MetricScoreBreakdown(
                metric_name="delay",
                raw_value=None,
                penalty=None,
                nominal_weight=cfg.w_delay,
                effective_weight=0.0,
                contribution_points=0.0,
                dropped=True,
                dropped_reason="No deliveries recorded in lookback window",
            ),
            MetricScoreBreakdown(
                metric_name="rejection",
                raw_value=None,
                penalty=None,
                nominal_weight=cfg.w_rejection,
                effective_weight=0.0,
                contribution_points=0.0,
                dropped=True,
                dropped_reason="No deliveries recorded in lookback window",
            ),
            MetricScoreBreakdown(
                metric_name="fill",
                raw_value=None,
                penalty=None,
                nominal_weight=cfg.w_fill,
                effective_weight=0.0,
                contribution_points=0.0,
                dropped=True,
                dropped_reason="No deliveries recorded in lookback window",
            ),
        ]
        explanation = (
            f"Supplier {inputs.supplier_code} ({inputs.supplier_name}) has 0 delivery records within the "
            f"{cfg.lookback_days}-day lookback window (as of {as_of.isoformat()}). "
            "Risk score is unknown (confidence: none). "
            f"Currently tracks {open_po_count} open purchase orders totaling {open_remaining_qty} units."
        )

        return SupplierRiskResult(
            supplier_id=inputs.supplier_id,
            supplier_code=inputs.supplier_code,
            supplier_name=inputs.supplier_name,
            country=inputs.country,
            as_of=as_of,
            n_deliveries=0,
            excluded_future_deliveries=excluded_future,
            has_excluded_future_deliveries=has_excluded_future,
            on_time_count=0,
            on_time_rate=None,
            on_time_ci_lower=None,
            on_time_ci_upper=None,
            late_delivery_probability=None,
            expected_delay_days_if_late=None,
            avg_delay_days_all=None,
            avg_delay_days_when_late=None,
            p50_delay_days_when_late=None,
            p90_delay_days_when_late=None,
            max_delay_days=None,
            total_ordered_qty=0,
            total_received_qty=0,
            total_rejected_qty=0,
            rejection_rate=None,
            fill_rate=None,
            risk_score=None,
            risk_band="unknown",
            confidence="none",
            metrics_breakdown=breakdown,
            nominal_weights=nominal_weights,
            effective_weights={k: 0.0 for k in nominal_weights},
            metrics_used=[],
            metrics_dropped=list(nominal_weights.keys()),
            main_drivers=[],
            monthly_breakdown=monthly_performance,
            informational_po=info_po,
            explanation=explanation,
            assumptions=DEFAULT_SUPPLIER_RISK_ASSUMPTIONS,
        )

    # 4. Compute On-Time & Delay Metrics
    lateness_list: List[int] = []
    late_delays: List[float] = []
    on_time_count = 0

    for d in valid_deliveries:
        days_diff = (d.actual_date - d.promised_date).days
        lateness_i = max(0, days_diff)
        lateness_list.append(lateness_i)
        if lateness_i <= cfg.on_time_grace_days:
            on_time_count += 1
        else:
            late_delays.append(float(lateness_i))

    on_time_rate = on_time_count / n
    ci_lower, ci_upper = compute_wilson_interval(on_time_count, n)
    late_delivery_prob = 1.0 - on_time_rate

    avg_delay_days_all = sum(lateness_list) / n
    if late_delays:
        late_delays_sorted = sorted(late_delays)
        avg_delay_when_late = sum(late_delays) / len(late_delays)
        p50_delay = compute_nearest_rank_percentile(late_delays_sorted, 50.0)
        p90_delay = compute_nearest_rank_percentile(late_delays_sorted, 90.0)
        max_delay = float(max(late_delays))
    else:
        avg_delay_when_late = None
        p50_delay = None
        p90_delay = None
        max_delay = None

    expected_delay_days_if_late = avg_delay_when_late

    # 5. Compute Rejection & Fill Rates
    total_ordered = sum(d.qty_ordered for d in valid_deliveries)
    total_received = sum(d.qty_received for d in valid_deliveries)
    total_rejected = sum(d.qty_rejected for d in valid_deliveries)

    rejection_rate = (total_rejected / total_received) if total_received > 0 else None
    fill_rate = (total_received / total_ordered) if total_ordered > 0 else None

    # 6. Calculate Penalties in [0, 1]
    # On-Time Penalty
    penalty_on_time = min(1.0, max(0.0, (1.0 - on_time_rate) / cfg.late_rate_full_penalty))

    # Delay Penalty
    penalty_delay = min(1.0, max(0.0, avg_delay_days_all / cfg.delay_full_penalty_days))

    # Rejection Penalty
    if rejection_rate is not None:
        penalty_rejection = min(1.0, max(0.0, rejection_rate / cfg.rejection_full_penalty))
    else:
        penalty_rejection = None

    # Fill Penalty
    if fill_rate is not None:
        shortfall = max(0.0, 1.0 - fill_rate)
        penalty_fill = min(1.0, max(0.0, shortfall / cfg.fill_shortfall_full_penalty))
    else:
        penalty_fill = None

    # 7. Renormalize weights if any metric is dropped
    raw_penalties = {
        "on_time": penalty_on_time,
        "delay": penalty_delay,
        "rejection": penalty_rejection,
        "fill": penalty_fill,
    }
    raw_values_map = {
        "on_time": on_time_rate,
        "delay": avg_delay_days_all,
        "rejection": rejection_rate,
        "fill": fill_rate,
    }

    used_metrics = [m for m, p in raw_penalties.items() if p is not None]
    dropped_metrics = [m for m, p in raw_penalties.items() if p is None]

    sum_used_nominal = sum(nominal_weights[m] for m in used_metrics)
    effective_weights: Dict[str, float] = {}
    for m in nominal_weights:
        if m in used_metrics:
            effective_weights[m] = nominal_weights[m] / sum_used_nominal
        else:
            effective_weights[m] = 0.0

    # 8. Compute Score and Contributions
    breakdown_list: List[MetricScoreBreakdown] = []
    total_score = 0.0

    for m in ["on_time", "delay", "rejection", "fill"]:
        pen = raw_penalties[m]
        val = raw_values_map[m]
        w_eff = effective_weights[m]
        if pen is not None:
            pts = w_eff * pen * 100.0
            total_score += pts
            breakdown_list.append(
                MetricScoreBreakdown(
                    metric_name=m,
                    raw_value=val,
                    penalty=pen,
                    nominal_weight=nominal_weights[m],
                    effective_weight=w_eff,
                    contribution_points=pts,
                    dropped=False,
                    dropped_reason=None,
                )
            )
        else:
            reason = "No received units recorded" if m == "rejection" else "No ordered units recorded"
            breakdown_list.append(
                MetricScoreBreakdown(
                    metric_name=m,
                    raw_value=None,
                    penalty=None,
                    nominal_weight=nominal_weights[m],
                    effective_weight=0.0,
                    contribution_points=0.0,
                    dropped=True,
                    dropped_reason=reason,
                )
            )

    rounded_score = round(total_score, 1)

    # Risk Band
    if total_score < cfg.band_medium:
        risk_band = "low"
    elif total_score < cfg.band_high:
        risk_band = "medium"
    else:
        risk_band = "high"

    # Base Confidence
    if n < cfg.low_confidence_below:
        base_confidence = "low"
    elif n < cfg.high_confidence_from:
        base_confidence = "medium"
    else:
        base_confidence = "high"

    # Drop confidence one tier if any metric was dropped
    if dropped_metrics:
        tier_downgrade = {"high": "medium", "medium": "low", "low": "low"}
        final_confidence = tier_downgrade[base_confidence]
    else:
        final_confidence = base_confidence

    # 9. Main Drivers
    used_breakdowns = [b for b in breakdown_list if not b.dropped]
    sorted_drivers = sorted(used_breakdowns, key=lambda b: b.contribution_points, reverse=True)
    main_drivers = [
        f"{b.metric_name} ({b.contribution_points:.1f} pts)"
        for b in sorted_drivers
        if b.contribution_points > 0.0
    ]

    # 10. Generate factual explanation text
    ci_pct_lower = ci_lower * 100.0
    ci_pct_upper = ci_upper * 100.0
    ontime_pct = on_time_rate * 100.0

    driver_desc = ", ".join(main_drivers) if main_drivers else "no penalty drivers (clean performance)"
    delay_desc = f"{avg_delay_when_late:.1f} days" if avg_delay_when_late is not None else "N/A (0 late deliveries)"
    rej_desc = f"{rejection_rate * 100.0:.2f}%" if rejection_rate is not None else "N/A"
    fill_desc = f"{fill_rate * 100.0:.1f}%" if fill_rate is not None else "N/A"

    explanation = (
        f"Supplier {inputs.supplier_code} ({inputs.supplier_name}) evaluated over {n} deliveries in the last "
        f"{cfg.lookback_days} days. On-time delivery rate is {ontime_pct:.1f}% (95% Wilson CI: [{ci_pct_lower:.1f}%, {ci_pct_upper:.1f}%]). "
        f"Average lateness across all deliveries is {avg_delay_days_all:.1f} days; average delay when late is {delay_desc}. "
        f"Rejection rate is {rej_desc} and order fill rate is {fill_desc}. "
        f"Overall risk score is {rounded_score:.1f}/100 ({risk_band} risk band, {final_confidence} confidence). "
        f"Primary score drivers: {driver_desc}. "
        f"Current open pipeline: {open_po_count} POs ({open_pos_slipped_count} slipped, {open_pos_overdue_count} overdue) with {open_remaining_qty} units remaining."
    )
    if has_excluded_future:
        explanation += f" Note: {excluded_future} delivery record(s) with actual dates after dataset as_of ({as_of.isoformat()}) were excluded from historical scoring."

    return SupplierRiskResult(
        supplier_id=inputs.supplier_id,
        supplier_code=inputs.supplier_code,
        supplier_name=inputs.supplier_name,
        country=inputs.country,
        as_of=as_of,
        n_deliveries=n,
        excluded_future_deliveries=excluded_future,
        has_excluded_future_deliveries=has_excluded_future,
        on_time_count=on_time_count,
        on_time_rate=round(on_time_rate, 4),
        on_time_ci_lower=round(ci_lower, 4),
        on_time_ci_upper=round(ci_upper, 4),
        late_delivery_probability=round(late_delivery_prob, 4),
        expected_delay_days_if_late=round(expected_delay_days_if_late, 2) if expected_delay_days_if_late is not None else None,
        avg_delay_days_all=round(avg_delay_days_all, 2),
        avg_delay_days_when_late=round(avg_delay_when_late, 2) if avg_delay_when_late is not None else None,
        p50_delay_days_when_late=round(p50_delay, 1) if p50_delay is not None else None,
        p90_delay_days_when_late=round(p90_delay, 1) if p90_delay is not None else None,
        max_delay_days=round(max_delay, 1) if max_delay is not None else None,
        total_ordered_qty=total_ordered,
        total_received_qty=total_received,
        total_rejected_qty=total_rejected,
        rejection_rate=round(rejection_rate, 4) if rejection_rate is not None else None,
        fill_rate=round(fill_rate, 4) if fill_rate is not None else None,
        risk_score=rounded_score,
        risk_band=risk_band,
        confidence=final_confidence,
        metrics_breakdown=breakdown_list,
        nominal_weights=nominal_weights,
        effective_weights={k: round(v, 4) for k, v in effective_weights.items()},
        metrics_used=used_metrics,
        metrics_dropped=dropped_metrics,
        main_drivers=main_drivers,
        monthly_breakdown=monthly_performance,
        informational_po=info_po,
        explanation=explanation,
        assumptions=DEFAULT_SUPPLIER_RISK_ASSUMPTIONS,
    )
