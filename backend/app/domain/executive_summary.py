"""app/domain/executive_summary.py

Pure domain logic for Executive Summary, Cost Comparison, Why Panels, and Data Quality.
Strictly deterministic and composed ONLY from results of existing domain models.
No database access, no FastAPI dependencies, no external network calls.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Sequence

from app.domain.alerts import (
    DisruptionAlert,
    MANDATORY_EXPOSURE_ASSUMPTION,
    SEVERITY_RANKS,
)
from app.domain.inventory import (
    ComponentRiskResult,
)
from app.domain.recovery import (
    ComponentRecoveryRecommendation,
    RecoveryOption,
)
from app.domain.simulation import (
    SimulationResult,
)
from app.domain.supplier_risk import (
    SupplierRiskResult,
)
from app.domain.money_format import format_money

DEFAULT_EXECUTIVE_SUMMARY_ASSUMPTIONS: List[str] = [
    "Analysis and recovery recommendations evaluate the first shortage window only; subsequent shortages are not covered.",
    "Unmet daily demand in stock projections is not carried forward as backorders (lost consumption model).",
    "Regional warehouse transfer lead time and cost per unit are operational configurations.",
    "Component daily demand is estimated using historical weekday-average heuristics.",
    "Supplier delay figures and late probabilities represent historical empirical frequencies, not predictions.",
    MANDATORY_EXPOSURE_ASSUMPTION,
]


@dataclass(frozen=True)
class WhyItem:
    """A single explanation pair reusing domain explanations."""

    label: str
    text: str


@dataclass(frozen=True)
class TopRiskItem:
    """Summary of a prioritized supply chain component at risk."""

    component_id: int
    component_sku: str
    component_name: str
    severity: str
    shortage_date: Optional[datetime.date]
    days_until_impact: Optional[int]
    units_short_before_next_inbound: float
    first_shortage_window_days: int
    reason: str
    related_alert_id: Optional[str]
    has_later_shortage: bool
    exposed_orders_count: int
    exposed_selling_value: Optional[Decimal]
    why: List[WhyItem] = field(default_factory=list)


@dataclass(frozen=True)
class RunnerUpOption:
    """Alternative option considered during recovery evaluation."""

    id: str
    kind: str
    description: str
    incremental_cost: Optional[Decimal]
    cost_known: bool


@dataclass(frozen=True)
class PriorityDecision:
    """Primary operational recommendation for the most urgent component."""

    component_id: int
    component_sku: str
    component_name: str
    recommended_option_id: str
    recommended_option_kind: str
    recommended_option_description: str
    quantity: int
    arrival_date: Optional[datetime.date]
    incremental_cost: Optional[Decimal]
    cost_known: bool
    residual_unmet_before_next_inbound: float
    later_shortage_note: Optional[str]
    runner_up: Optional[RunnerUpOption]
    scope_note: str = "Fixes the first shortage window only. Later shortages are not covered."
    why: List[WhyItem] = field(default_factory=list)


@dataclass(frozen=True)
class CostComparisonAct:
    """Outcome and exposure when executing the recommended recovery action."""

    cost: Optional[Decimal]
    cost_known: bool
    residual_units_short: float
    affected_orders_count: int
    selling_value: Optional[Decimal]


@dataclass(frozen=True)
class CostComparisonDoNothing:
    """Baseline outcome and exposure under inaction (do nothing)."""

    units_short: float
    affected_orders_count: int
    selling_value: Optional[Decimal]


@dataclass(frozen=True)
class CostComparison:
    """Side-by-side comparison between taking action vs doing nothing."""

    act: CostComparisonAct
    do_nothing: CostComparisonDoNothing
    difference_sentence: str
    exposure_disclaimer: str = MANDATORY_EXPOSURE_ASSUMPTION


@dataclass(frozen=True)
class ComponentExposureItem:
    """Per-component customer order exposure."""

    component_id: int
    component_sku: str
    component_name: str
    orders_count: int
    selling_value: Optional[Decimal]


@dataclass(frozen=True)
class SupplierConfidenceSummary:
    """Confidence summary for a supplier involved in top risks."""

    supplier_id: int
    supplier_code: str
    supplier_name: str
    confidence: str
    n_deliveries: int


@dataclass(frozen=True)
class DataQualityInfo:
    """Audit and data-lineage statistics for decision support transparency."""

    dataset_label: str
    dataset_source: str
    is_live: bool
    components_evaluated: int
    components_unknown_risk: int
    supplier_confidence_counts: Dict[str, int]
    top_risk_supplier_confidence: List[SupplierConfidenceSummary]
    priority_component_demand_history_days: Optional[int]
    flags: List[str]
    data_quality_note: str


@dataclass(frozen=True)
class ExecutiveSummary:
    """Complete executive summary domain model."""

    seeded: bool
    as_of: Optional[datetime.date]
    label: str
    headline: str
    top_risks: List[TopRiskItem]
    priority_decision: Optional[PriorityDecision]
    cost_comparison: Optional[CostComparison]
    exposure_totals: List[ComponentExposureItem]
    exposure_note: str
    data_quality: DataQualityInfo
    assumptions: List[str]
    why: Dict[str, List[WhyItem]]
    note: str = "Decision support only. No orders are created."


@dataclass(frozen=True)
class ExecutiveSummaryInputs:
    """Inputs bundle for constructing the executive summary."""

    as_of: datetime.date
    dataset_label: str
    dataset_source: str
    is_live: bool
    alerts: Sequence[DisruptionAlert]
    recommendations: Sequence[ComponentRecoveryRecommendation]
    priority_simulation: Optional[SimulationResult]
    inventory_results: Dict[int, ComponentRiskResult]
    supplier_results: Dict[int, SupplierRiskResult]
    priority_component_demand_history_days: Optional[int] = None
    flags: List[str] = field(default_factory=list)
    display_currency: str = "USD"
    usd_to_inr_rate: Optional[Decimal] = None


def build_executive_summary(inputs: ExecutiveSummaryInputs) -> ExecutiveSummary:
    """Construct an ExecutiveSummary strictly from existing domain evaluation results.

    Pure, deterministic function with no side effects or external queries.
    """
    # 1. Evaluate top risks (up to 3 distinct components, ranked by existing alert order)
    top_risks: List[TopRiskItem] = []
    seen_comp_ids = set()

    # Match alerts with components
    for alert in inputs.alerts:
        cid = alert.component_id
        if cid is None or cid in seen_comp_ids:
            continue
        inv_res = inputs.inventory_results.get(cid)
        if inv_res is None:
            continue

        # Check if component has shortage or critical/high/medium risk
        if inv_res.shortage_date is not None or inv_res.risk_level in ("critical", "high", "medium"):
            seen_comp_ids.add(cid)

            # Determine window days
            win_days = inv_res.shortage_episodes[0].days if inv_res.shortage_episodes else 0
            has_later = len(inv_res.shortage_episodes) > 1

            # Determine exposure from alerts matching this component
            exp_orders = 0
            exp_rev: Optional[Decimal] = None
            for a in inputs.alerts:
                if a.component_id == cid and a.impact and a.impact.orders_count is not None:
                    exp_orders = a.impact.orders_count
                    exp_rev = a.impact.exposed_revenue
                    break

            # Construct why items for this risk
            risk_why: List[WhyItem] = [
                WhyItem(label="Alert Summary", text=alert.summary),
                WhyItem(label="Inventory Risk", text=inv_res.risk_reason),
            ]
            if alert.supplier_id and alert.supplier_id in inputs.supplier_results:
                s_res = inputs.supplier_results[alert.supplier_id]
                risk_why.append(
                    WhyItem(
                        label="Supplier Risk",
                        text=(
                            f"{s_res.supplier_name} ({s_res.supplier_code}) has {s_res.confidence} confidence "
                            f"({s_res.n_deliveries} deliveries) and is rated '{s_res.risk_band}' risk."
                        ),
                    )
                )

            top_risks.append(
                TopRiskItem(
                    component_id=cid,
                    component_sku=alert.component_sku or inv_res.sku,
                    component_name=alert.component_name or inv_res.name,
                    severity=alert.severity,
                    shortage_date=inv_res.shortage_date,
                    days_until_impact=alert.days_until_impact if alert.days_until_impact is not None else inv_res.days_until_shortage,
                    units_short_before_next_inbound=inv_res.unmet_before_next_inbound or 0.0,
                    first_shortage_window_days=win_days,
                    reason=alert.summary or inv_res.risk_reason,
                    related_alert_id=alert.id,
                    has_later_shortage=has_later,
                    exposed_orders_count=exp_orders,
                    exposed_selling_value=exp_rev,
                    why=risk_why,
                )
            )

        if len(top_risks) >= 3:
            break

    # If top_risks < 3, check inventory_results directly for remaining components with shortage
    if len(top_risks) < 3:
        # Sort remaining components by severity rank descending, days_until_shortage ascending
        remaining_comps = [
            c for cid, c in inputs.inventory_results.items()
            if cid not in seen_comp_ids and c.shortage_date is not None
        ]
        remaining_comps.sort(
            key=lambda c: (-SEVERITY_RANKS.get(c.risk_level, 0), c.days_until_shortage if c.days_until_shortage is not None else 999)
        )
        for c in remaining_comps:
            seen_comp_ids.add(c.component_id)
            win_days = c.shortage_episodes[0].days if c.shortage_episodes else 0
            has_later = len(c.shortage_episodes) > 1
            risk_why = [WhyItem(label="Inventory Risk", text=c.risk_reason)]
            top_risks.append(
                TopRiskItem(
                    component_id=c.component_id,
                    component_sku=c.sku,
                    component_name=c.name,
                    severity=c.risk_level,
                    shortage_date=c.shortage_date,
                    days_until_impact=c.days_until_shortage,
                    units_short_before_next_inbound=c.unmet_before_next_inbound or 0.0,
                    first_shortage_window_days=win_days,
                    reason=c.risk_reason,
                    related_alert_id=None,
                    has_later_shortage=has_later,
                    exposed_orders_count=0,
                    exposed_selling_value=None,
                    why=risk_why,
                )
            )
            if len(top_risks) >= 3:
                break

    # 2. Headline generation (counts only critical, high, or medium shortage risk)
    shortage_count = sum(
        1
        for c in inputs.inventory_results.values()
        if c.risk_level in ("critical", "high", "medium") and c.shortage_date is not None
    )
    if not top_risks or shortage_count == 0:
        headline = "No components currently face shortage risk (none at risk)."
    else:
        most_urgent = top_risks[0]
        days_str = f" ({most_urgent.days_until_impact} days)" if most_urgent.days_until_impact is not None else ""
        headline = (
            f"{shortage_count} components face shortage risk; "
            f"the most urgent is {most_urgent.component_sku}, short from {most_urgent.shortage_date}{days_str}."
        )

    # 3. Priority Decision
    priority_decision: Optional[PriorityDecision] = None
    target_rec: Optional[ComponentRecoveryRecommendation] = None

    # Find the recommendation for the most urgent component in top_risks
    recs_by_cid = {r.component_id: r for r in inputs.recommendations}
    for risk in top_risks:
        if risk.component_id in recs_by_cid:
            target_rec = recs_by_cid[risk.component_id]
            break

    # Fallback to first available recommendation if top_risks had none
    if target_rec is None and inputs.recommendations:
        target_rec = inputs.recommendations[0]

    if target_rec is not None:
        # Find matching recommended option or combined plan
        rec_opt: Optional[RecoveryOption] = None
        for opt in target_rec.options:
            if opt.id == target_rec.recommended_option_id:
                rec_opt = opt
                break

        runner_up_obj: Optional[RunnerUpOption] = None
        # Locate runner up option (first feasible option that is not the recommended one)
        feasible_others = [
            o for o in target_rec.options
            if o.id != target_rec.recommended_option_id and o.feasible
        ]
        if feasible_others:
            ru = feasible_others[0]
            runner_up_obj = RunnerUpOption(
                id=ru.id,
                kind=ru.kind,
                description=ru.description,
                incremental_cost=ru.incremental_cost,
                cost_known=ru.cost_known,
            )

        if rec_opt is not None:
            opt_desc = rec_opt.description
            opt_qty = rec_opt.quantity
            opt_arr = rec_opt.arrival_date
            opt_cost = rec_opt.incremental_cost
            opt_cost_known = rec_opt.cost_known
            opt_residual = rec_opt.residual_unmet_before_next_inbound
        elif target_rec.combined_plan is not None and target_rec.recommended_option_id == "combined_plan":
            cp = target_rec.combined_plan
            opt_desc = cp.description
            opt_qty = cp.total_quantity
            opt_arr = min((s.arrival_date for s in cp.steps if s.arrival_date), default=None)
            opt_cost = cp.total_known_cost
            opt_cost_known = (cp.unknown_cost_steps == 0)
            opt_residual = cp.residual_unmet_before_next_inbound
        else:
            opt_desc = "Recommended recovery action"
            opt_qty = target_rec.need_units
            opt_arr = None
            opt_cost = None
            opt_cost_known = False
            opt_residual = 0.0

        decision_why: List[WhyItem] = [
            WhyItem(label="Recommendation Rationale", text=target_rec.reason),
            WhyItem(label="Alternative Options", text=target_rec.alternatives_note),
        ]
        if target_rec.later_shortage_note:
            decision_why.append(WhyItem(label="Scope & Limitations", text=target_rec.later_shortage_note))
        if runner_up_obj:
            decision_why.append(
                WhyItem(label="Runner-Up Comparison", text=f"Runner-up option is {runner_up_obj.id}: {runner_up_obj.description}")
            )

        priority_decision = PriorityDecision(
            component_id=target_rec.component_id,
            component_sku=target_rec.sku,
            component_name=target_rec.name,
            recommended_option_id=target_rec.recommended_option_id,
            recommended_option_kind=target_rec.recommended_option_kind,
            recommended_option_description=opt_desc,
            quantity=opt_qty,
            arrival_date=opt_arr,
            incremental_cost=opt_cost,
            cost_known=opt_cost_known,
            residual_unmet_before_next_inbound=opt_residual,
            later_shortage_note=target_rec.later_shortage_note,
            runner_up=runner_up_obj,
            why=decision_why,
        )

    # 4. Cost Comparison (taking action vs doing nothing)
    cost_comparison: Optional[CostComparison] = None
    if priority_decision is not None and inputs.priority_simulation is not None:
        sim = inputs.priority_simulation
        act_cost = priority_decision.incremental_cost
        act_cost_known = priority_decision.cost_known
        act_residual = sim.recovered.unmet_before_next_inbound
        act_orders = sim.recovered.exposed_orders_count
        act_rev = sim.recovered.exposed_revenue

        dn_units = sim.baseline.unmet_before_next_inbound
        dn_orders = sim.baseline.exposed_orders_count
        dn_rev = sim.baseline.exposed_revenue

        # Difference sentence (strictly no "savings" or "loss estimate", includes upper bound wording)
        cost_str = (
            format_money(act_cost, inputs.display_currency, inputs.usd_to_inr_rate)
            if (act_cost_known and act_cost is not None)
            else "Unknown"
        )
        dn_rev_str = (
            format_money(dn_rev, inputs.display_currency, inputs.usd_to_inr_rate)
            if dn_rev is not None
            else "Unknown"
        )
        act_rev_str = (
            format_money(act_rev, inputs.display_currency, inputs.usd_to_inr_rate)
            if act_rev is not None
            else "Unknown"
        )

        if act_cost_known and act_cost is not None:
            diff_sentence = (
                f"Acting costs {cost_str}; exposed order value in the first shortage window "
                f"falls from {dn_rev_str} to {act_rev_str} (upper bound, not a loss). "
                f"{MANDATORY_EXPOSURE_ASSUMPTION}"
            )
        else:
            diff_sentence = (
                f"Acting cost is Unknown; exposed order value in the first shortage window "
                f"falls from {dn_rev_str} to {act_rev_str} (upper bound, not a loss). "
                f"{MANDATORY_EXPOSURE_ASSUMPTION}"
            )

        cost_comparison = CostComparison(
            act=CostComparisonAct(
                cost=act_cost,
                cost_known=act_cost_known,
                residual_units_short=act_residual,
                affected_orders_count=act_orders,
                selling_value=act_rev,
            ),
            do_nothing=CostComparisonDoNothing(
                units_short=dn_units,
                affected_orders_count=dn_orders,
                selling_value=dn_rev,
            ),
            difference_sentence=diff_sentence,
            exposure_disclaimer=MANDATORY_EXPOSURE_ASSUMPTION,
        )

    # 5. Exposure Totals (Reported per-component, NEVER summed)
    exposure_totals: List[ComponentExposureItem] = [
        ComponentExposureItem(
            component_id=risk.component_id,
            component_sku=risk.component_sku,
            component_name=risk.component_name,
            orders_count=risk.exposed_orders_count,
            selling_value=risk.exposed_selling_value,
        )
        for risk in top_risks
    ]
    exposure_note = (
        "Order counts and selling values are reported per component and are not summed across components "
        "to avoid double counting orders that depend on multiple disrupted components. "
        + MANDATORY_EXPOSURE_ASSUMPTION
    )

    # 6. Data Quality
    comp_eval_count = len(inputs.inventory_results)
    unknown_count = sum(
        1 for r in inputs.inventory_results.values()
        if r.risk_level == "unknown" or r.forecast_status == "insufficient_history"
    )

    # Supplier confidence counts
    conf_counts = {"high": 0, "medium": 0, "low": 0}
    for s in inputs.supplier_results.values():
        c = s.confidence.lower()
        if c in conf_counts:
            conf_counts[c] += 1

    # Top risk suppliers
    top_risk_suppliers: List[SupplierConfidenceSummary] = []
    seen_sup_ids = set()
    for alert in inputs.alerts:
        if alert.supplier_id and alert.supplier_id in inputs.supplier_results and alert.supplier_id not in seen_sup_ids:
            seen_sup_ids.add(alert.supplier_id)
            s = inputs.supplier_results[alert.supplier_id]
            top_risk_suppliers.append(
                SupplierConfidenceSummary(
                    supplier_id=s.supplier_id,
                    supplier_code=s.supplier_code,
                    supplier_name=s.supplier_name,
                    confidence=s.confidence,
                    n_deliveries=s.n_deliveries,
                )
            )

    # Note generation
    if top_risk_suppliers:
        prime_sup = top_risk_suppliers[0]
        sup_snippet = f"supplier confidence for {prime_sup.supplier_code} is {prime_sup.confidence} ({prime_sup.n_deliveries} deliveries)"
    else:
        sup_snippet = "supplier confidence not evaluated"

    dq_source_str = inputs.dataset_label or "DEMO DATA"
    live_status_str = "live" if inputs.is_live else "not live"
    dq_note = (
        f"Based on {comp_eval_count} components; {unknown_count} have insufficient history; "
        f"{sup_snippet}; data source: {dq_source_str}, {live_status_str}"
    )

    data_quality = DataQualityInfo(
        dataset_label=inputs.dataset_label,
        dataset_source=inputs.dataset_source,
        is_live=inputs.is_live,
        components_evaluated=comp_eval_count,
        components_unknown_risk=unknown_count,
        supplier_confidence_counts=conf_counts,
        top_risk_supplier_confidence=top_risk_suppliers,
        priority_component_demand_history_days=inputs.priority_component_demand_history_days,
        flags=inputs.flags,
        data_quality_note=dq_note,
    )

    # 7. Global Why mapping
    why_map: Dict[str, List[WhyItem]] = {}
    if priority_decision is not None:
        why_map["decision"] = priority_decision.why
    for risk in top_risks:
        why_map[risk.component_sku] = risk.why
        if risk.related_alert_id:
            why_map[risk.related_alert_id] = risk.why

    return ExecutiveSummary(
        seeded=True,
        as_of=inputs.as_of,
        label=inputs.dataset_label,
        headline=headline,
        top_risks=top_risks,
        priority_decision=priority_decision,
        cost_comparison=cost_comparison,
        exposure_totals=exposure_totals,
        exposure_note=exposure_note,
        data_quality=data_quality,
        assumptions=DEFAULT_EXECUTIVE_SUMMARY_ASSUMPTIONS,
        why=why_map,
        note="Decision support only. No orders are created.",
    )
