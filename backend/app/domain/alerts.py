"""Pure domain logic for Disruption Detection and Alerts.

Pure functions only. Strictly no database, no FastAPI, no system clock, no unseeded randomness.
All calculations are anchored to the provided `as_of` date.

Alert Types:
1. inventory_shortage: From evaluate_component when risk_level is critical, high, or medium.
2. data_quality: From evaluate_component when risk_level is unknown (flags insufficient_history or no_plant_inventory).
3. supplier_delay_exposure: What-if shift of inbound lines for suppliers with high late delivery probability.
4. po_slipped: Active purchase orders with latest_estimate_date > promised_date.
5. po_overdue: Active purchase orders with expected_date < as_of.
6. demand_surge: Active components whose recent 14-day consumption significantly exceeds 28-day baseline.
7. quality_issue: Suppliers with elevated rejection rates in the recent quality window.
8. capacity_constraint: Components with critical/high/medium risk whose suppliers have insufficient or unknown capacity.
9. compound_risk: Components converging multiple distinct disruption types with severity >= medium.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import math
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from app.domain.inventory import (
    ComponentEvaluationInput,
    ComponentRiskResult,
    InventoryRiskConfig,
    evaluate_component,
    shift_inbound_for_supplier,
)
from app.domain.supplier_risk import SupplierRiskResult


# Severity ordering (critical > high > medium > low > info)
SEVERITY_ORDER = ("critical", "high", "medium", "low", "info")
SEVERITY_RANKS: Dict[str, int] = {
    "critical": 5,
    "high": 4,
    "medium": 3,
    "low": 2,
    "info": 1,
}

CRITICALITY_RANKS: Dict[Optional[str], int] = {
    "critical": 3,
    "high": 2,
    "normal": 1,
    "low": 1,
    None: 0,
}

ALERT_TYPES = (
    "inventory_shortage",
    "data_quality",
    "supplier_delay_exposure",
    "po_slipped",
    "po_overdue",
    "demand_surge",
    "quality_issue",
    "capacity_constraint",
    "compound_risk",
)

MANDATORY_EXPOSURE_ASSUMPTION = (
    "Upper bound of exposure: production lead time and stock allocation to orders are unknown, "
    "so these orders are potentially exposed, not predicted to be late. "
    "Exposed revenue is the selling value of those orders, not an estimate of loss."
)


def rank_severity(sev: str) -> int:
    """Returns integer rank for a severity level (critical=5, high=4, medium=3, low=2, info=1)."""
    return SEVERITY_RANKS.get(sev, 0)


def round_half_up(val: float) -> int:
    """Rounds a float to the nearest integer using standard half-up arithmetic."""
    return int(Decimal(str(round(val, 6))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def escalate_severity(sev: str) -> str:
    """Escalates severity by one rank, capped at critical."""
    if sev == "info":
        return "low"
    if sev == "low":
        return "medium"
    if sev == "medium":
        return "high"
    return "critical"


@dataclass(frozen=True)
class AlertConfig:
    """Frozen configuration for disruption detection thresholds."""

    surge_recent_days: int = 14
    surge_baseline_days: int = 28
    surge_ratio_medium: float = 1.25
    surge_ratio_high: float = 1.5
    surge_min_baseline_mean: float = 5.0  # units/day
    surge_min_coverage: float = 0.8
    quality_recent_days: int = 90
    quality_rejection_threshold: float = 0.02
    quality_min_received_units: int = 500
    delay_min_late_probability: float = 0.20
    delay_min_deliveries: int = 10
    delay_scenarios: Tuple[str, ...] = ("typical", "severe")
    compound_min_types: int = 2
    compound_escalate_at_types: int = 3

    def __post_init__(self) -> None:
        if self.surge_recent_days <= 0:
            raise ValueError(f"surge_recent_days must be positive, got {self.surge_recent_days}")
        if self.surge_baseline_days <= 0:
            raise ValueError(f"surge_baseline_days must be positive, got {self.surge_baseline_days}")
        if self.surge_ratio_medium <= 1.0:
            raise ValueError(f"surge_ratio_medium must be > 1.0, got {self.surge_ratio_medium}")
        if self.surge_ratio_high <= self.surge_ratio_medium:
            raise ValueError(
                f"surge_ratio_high ({self.surge_ratio_high}) must be > surge_ratio_medium ({self.surge_ratio_medium})"
            )
        if self.surge_min_baseline_mean < 0:
            raise ValueError("surge_min_baseline_mean cannot be negative")
        if not (0.0 < self.surge_min_coverage <= 1.0):
            raise ValueError("surge_min_coverage must be in (0, 1.0]")
        if self.quality_recent_days <= 0:
            raise ValueError("quality_recent_days must be positive")
        if not (0.0 < self.quality_rejection_threshold <= 1.0):
            raise ValueError("quality_rejection_threshold must be in (0, 1.0]")
        if self.quality_min_received_units < 0:
            raise ValueError("quality_min_received_units cannot be negative")
        if not (0.0 < self.delay_min_late_probability <= 1.0):
            raise ValueError("delay_min_late_probability must be in (0, 1.0]")
        if self.delay_min_deliveries < 1:
            raise ValueError("delay_min_deliveries must be >= 1")
        if self.compound_min_types < 2:
            raise ValueError("compound_min_types must be >= 2")
        if self.compound_escalate_at_types <= self.compound_min_types:
            raise ValueError(
                f"compound_escalate_at_types ({self.compound_escalate_at_types}) must be > compound_min_types ({self.compound_min_types})"
            )


@dataclass(frozen=True)
class EvidenceItem:
    label: str
    value: Any
    unit: Optional[str] = None


@dataclass(frozen=True)
class ExposedCustomerOrder:
    order_number: str
    customer_name: str
    product_sku: str
    product_name: str
    quantity: int
    due_date: date
    priority: str
    component_units_required: int


@dataclass(frozen=True)
class AlertImpact:
    orders_count: int
    count_by_priority: Dict[str, int]
    total_component_units_required: int
    exposed_revenue: Decimal
    exposed_orders: List[ExposedCustomerOrder]


@dataclass(frozen=True)
class DelayScenarioItem:
    scenario_name: str  # "baseline", "typical", "severe"
    shift_days: int
    expected_date: Optional[date]
    shortage_date: Optional[date]
    first_episode_start: Optional[date]
    first_episode_end: Optional[date]
    first_episode_days: int
    unmet_before_next_inbound: Optional[float]
    total_unmet_demand: float
    incremental_total_unmet: float
    change_in_shortage_days: int


@dataclass(frozen=True)
class DisruptionAlert:
    id: str
    type: str
    severity: str
    title: str
    summary: str
    component_id: Optional[int]
    component_sku: Optional[str]
    component_name: Optional[str]
    supplier_id: Optional[int]
    supplier_code: Optional[str]
    po_number: Optional[str]
    days_until_impact: Optional[int]
    detected_on: date
    evidence: List[EvidenceItem]
    assumptions: List[str]
    impact: Optional[AlertImpact]
    impact_null_reason: Optional[str]
    related_alert_ids: List[str] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)
    delay_scenarios: Optional[List[DelayScenarioItem]] = None


@dataclass(frozen=True)
class AlertResult:
    as_of: date
    alerts: List[DisruptionAlert]
    counts_by_severity: Dict[str, int]
    counts_by_type: Dict[str, int]
    total_alerts: int


# Domain DTOs for inputs to detect_alerts
@dataclass(frozen=True)
class PurchaseOrderInput:
    po_id: int
    po_number: str
    supplier_id: int
    supplier_code: str
    status: str
    promised_date: date
    latest_estimate_date: Optional[date]
    remaining_qty: int
    component_ids: List[int]
    component_skus: List[str]


@dataclass(frozen=True)
class CustomerOrderInput:
    id: int
    order_number: str
    customer_name: str
    product_id: int
    quantity: int
    due_date: date
    priority: str
    status: str


@dataclass(frozen=True)
class ProductInput:
    id: int
    sku: str
    name: str
    selling_price: Decimal


@dataclass(frozen=True)
class BomLineInput:
    product_id: int
    component_id: int
    quantity_per_unit: int


@dataclass(frozen=True)
class SupplierOfferInput:
    supplier_id: int
    supplier_code: str
    component_id: int
    max_weekly_capacity: Optional[int]


@dataclass(frozen=True)
class DeliveryRecordInput:
    id: int
    supplier_id: int
    supplier_code: str
    component_id: int
    promised_date: date
    actual_date: date
    qty_ordered: int
    qty_received: int
    qty_rejected: int


@dataclass(frozen=True)
class ComponentAlertInfo:
    id: int
    sku: str
    name: str
    criticality: str
    is_active: bool


def compute_order_exposure_impact(
    as_of: date,
    horizon_days: int,
    shortage_date: Optional[date],
    component_id: int,
    customer_orders: Sequence[CustomerOrderInput],
    bom_by_product: Dict[int, Dict[int, int]],
    products_by_id: Dict[int, ProductInput],
) -> Optional[AlertImpact]:
    """Calculates customer order exposure for a given component and shortage date."""
    if shortage_date is None:
        return None

    horizon_end = as_of + timedelta(days=horizon_days)
    exposed: List[ExposedCustomerOrder] = []
    priority_counts: Dict[str, int] = {"critical": 0, "high": 0, "normal": 0, "low": 0}
    total_revenue = Decimal("0.00")
    total_units_required = 0

    for co in customer_orders:
        if co.status not in ("open", "in_production"):
            continue
        if not (shortage_date <= co.due_date < horizon_end):
            continue
        comp_map = bom_by_product.get(co.product_id, {})
        if component_id not in comp_map:
            continue
        qty_per_unit = comp_map[component_id]
        units_req = co.quantity * qty_per_unit
        prod = products_by_id.get(co.product_id)
        if prod is None:
            continue
        line_rev = Decimal(co.quantity) * prod.selling_price
        total_revenue += line_rev
        total_units_required += units_req
        priority_counts[co.priority] = priority_counts.get(co.priority, 0) + 1

        exposed.append(
            ExposedCustomerOrder(
                order_number=co.order_number,
                customer_name=co.customer_name,
                product_sku=prod.sku,
                product_name=prod.name,
                quantity=co.quantity,
                due_date=co.due_date,
                priority=co.priority,
                component_units_required=units_req,
            )
        )

    exposed.sort(key=lambda o: (o.due_date, o.order_number))

    return AlertImpact(
        orders_count=len(exposed),
        count_by_priority=priority_counts,
        total_component_units_required=total_units_required,
        exposed_revenue=total_revenue,
        exposed_orders=exposed,
    )


def detect_alerts(
    as_of: date,
    config: AlertConfig,
    inventory_config: InventoryRiskConfig,
    components: Sequence[ComponentAlertInfo],
    component_inputs: Dict[int, ComponentEvaluationInput],
    component_results: Dict[int, ComponentRiskResult],
    supplier_results: Dict[int, SupplierRiskResult],
    purchase_orders: Sequence[PurchaseOrderInput],
    customer_orders: Sequence[CustomerOrderInput],
    bom_lines: Sequence[BomLineInput],
    products: Sequence[ProductInput],
    supplier_offers: Sequence[SupplierOfferInput],
    deliveries: Sequence[DeliveryRecordInput],
) -> AlertResult:
    """Pure domain function detecting all disruption alerts across components and suppliers.

    Produces a deterministic list of alerts sorted by:
    1. Severity rank descending (critical > high > medium > low > info)
    2. Days until impact ascending (nulls last)
    3. Component criticality descending (critical > high > normal/low > null)
    4. Deterministic alert ID ascending.
    """
    alerts: List[DisruptionAlert] = []

    products_by_id = {p.id: p for p in products}
    bom_by_product: Dict[int, Dict[int, int]] = {}
    for bl in bom_lines:
        if bl.product_id not in bom_by_product:
            bom_by_product[bl.product_id] = {}
        bom_by_product[bl.product_id][bl.component_id] = bl.quantity_per_unit

    offers_by_component: Dict[int, List[SupplierOfferInput]] = {}
    for off in supplier_offers:
        offers_by_component.setdefault(off.component_id, []).append(off)

    components_by_id = {c.id: c for c in components}
    active_components = [c for c in components if c.is_active]

    # Map supplier code to supplier ID from supplier_results
    supplier_id_by_code: Dict[str, int] = {
        sr.supplier_code: sr.supplier_id for sr in supplier_results.values()
    }

    # -------------------------------------------------------------------------
    # 1. INVENTORY SHORTAGE & 2. DATA QUALITY
    # -------------------------------------------------------------------------
    for comp in active_components:
        comp_res = component_results.get(comp.id)
        if comp_res is None:
            continue

        if comp_res.risk_level in ("critical", "high", "medium"):
            # inventory_shortage alert
            alert_id = f"inventory_shortage.{comp.sku}"
            first_ep = comp_res.shortage_episodes[0] if comp_res.shortage_episodes else None
            first_ep_desc = (
                f"{first_ep.start_date.isoformat()} to {first_ep.end_date.isoformat()} ({first_ep.days} days)"
                if first_ep
                else "None"
            )
            first_ep_unmet = first_ep.unmet_units if first_ep else 0.0

            next_rep_str = "None"
            if comp_res.next_replenishment:
                next_rep_str = (
                    f"{comp_res.next_replenishment.qty:.0f} units on "
                    f"{comp_res.next_replenishment.date.isoformat()} "
                    f"({comp_res.next_replenishment.date_basis})"
                )

            evidence = [
                EvidenceItem("Usable Plant Stock", comp_res.plant_usable_stock, "units"),
                EvidenceItem(
                    "Mean Daily Demand",
                    round(comp_res.mean_daily_demand, 2) if comp_res.mean_daily_demand is not None else None,
                    "units/day",
                ),
                EvidenceItem(
                    "Projected Shortage Date",
                    comp_res.shortage_date.isoformat() if comp_res.shortage_date else None,
                ),
                EvidenceItem("Days Until Shortage", comp_res.days_until_shortage, "days"),
                EvidenceItem("First Episode Window", first_ep_desc),
                EvidenceItem("First Episode Unmet", round(first_ep_unmet, 1), "units"),
                EvidenceItem(
                    "Unmet Before Next Inbound",
                    round(comp_res.unmet_before_next_inbound, 1)
                    if comp_res.unmet_before_next_inbound is not None
                    else None,
                    "units",
                ),
                EvidenceItem("Next Inbound Replenishment", next_rep_str),
                EvidenceItem("Total Shortage Episodes", len(comp_res.shortage_episodes)),
            ]

            summary = (
                f"Usable plant stock of {comp_res.plant_usable_stock} units for {comp.sku} is projected to "
                f"run out on {comp_res.shortage_date.isoformat()} ({comp_res.days_until_shortage} days from as-of {as_of.isoformat()}). "
                f"Projected unmet demand over horizon is {comp_res.unmet_demand_units:.1f} units across "
                f"{len(comp_res.shortage_episodes)} episode(s). Next inbound: {next_rep_str}."
            )

            impact = compute_order_exposure_impact(
                as_of=as_of,
                horizon_days=inventory_config.horizon_days,
                shortage_date=comp_res.shortage_date,
                component_id=comp.id,
                customer_orders=customer_orders,
                bom_by_product=bom_by_product,
                products_by_id=products_by_id,
            )

            assumptions = [
                MANDATORY_EXPOSURE_ASSUMPTION,
                "Demand projection assumes the 28-day weekday-average consumption profile continues without structural shifts.",
                "Inbound supply assumes confirmed plant purchase orders arrive on expected dates.",
                "Orders due before the shortage date are assumed to be served from existing stock.",
            ]

            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="inventory_shortage",
                    severity=comp_res.risk_level,
                    title=f"Projected Inventory Shortage for {comp.sku}",
                    summary=summary,
                    component_id=comp.id,
                    component_sku=comp.sku,
                    component_name=comp.name,
                    supplier_id=None,
                    supplier_code=None,
                    po_number=None,
                    days_until_impact=comp_res.days_until_shortage,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=impact,
                    impact_null_reason=None if impact is not None else "no_exposed_orders",
                    flags=[(f.code if hasattr(f, "code") else str(f)) for f in comp_res.flags],
                )
            )

        elif comp_res.risk_level == "unknown":
            # data_quality alert
            alert_id = f"data_quality.{comp.sku}"
            flag_codes = [(f.code if hasattr(f, "code") else str(f)) for f in comp_res.flags]
            flag_desc = ", ".join(flag_codes) if flag_codes else "insufficient_data"

            evidence = [
                EvidenceItem("Evaluation Status", comp_res.forecast_status),
                EvidenceItem("Risk Level", comp_res.risk_level),
                EvidenceItem("Data Quality Flags", flag_desc),
            ]

            summary = (
                f"Component {comp.sku} ({comp.name}) has an unknown inventory risk level due to "
                f"data quality constraints ({flag_desc}). Stock coverage and shortage runway cannot be reliably projected."
            )

            assumptions = [
                "Missing historical demand or warehouse balance records are flagged explicitly rather than guessed as zero."
            ]

            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="data_quality",
                    severity="low",
                    title=f"Data Quality Flag for {comp.sku}",
                    summary=summary,
                    component_id=comp.id,
                    component_sku=comp.sku,
                    component_name=comp.name,
                    supplier_id=None,
                    supplier_code=None,
                    po_number=None,
                    days_until_impact=None,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=None,
                    impact_null_reason="not applicable",
                    flags=flag_codes,
                )
            )

    # -------------------------------------------------------------------------
    # 3. SUPPLIER DELAY EXPOSURE
    # -------------------------------------------------------------------------
    for comp in active_components:
        comp_input = component_inputs.get(comp.id)
        baseline_res = component_results.get(comp.id)
        if comp_input is None or baseline_res is None:
            continue

        # Find suppliers whose COUNTED inbound lines feed this component
        counted_supplier_codes: Set[str] = set()
        for item in baseline_res.counted_inbound:
            if item.supplier_code:
                counted_supplier_codes.add(item.supplier_code)

        for sup_code in sorted(counted_supplier_codes):
            sup_res = next(
                (sr for sr in supplier_results.values() if sr.supplier_code == sup_code),
                None,
            )
            if sup_res is None:
                continue

            n_delivs = sup_res.n_deliveries
            late_prob = sup_res.late_delivery_probability
            avg_delay = sup_res.avg_delay_days_when_late
            p90_delay = sup_res.p90_delay_days_when_late

            # Check eligibility threshold
            if (
                n_delivs < 1
                or late_prob is None
                or round(late_prob, 6) < config.delay_min_late_probability
                or avg_delay is None
            ):
                continue

            typical_shift = max(1, round_half_up(avg_delay))
            severe_shift = (
                max(1, math.ceil(p90_delay))
                if p90_delay is not None
                else max(1, math.ceil(avg_delay))
            )

            # Evaluate typical scenario
            typ_input = shift_inbound_for_supplier(comp_input, sup_code, typical_shift)
            typ_res = evaluate_component(typ_input, inventory_config)

            # Evaluate severe scenario
            sev_input = shift_inbound_for_supplier(comp_input, sup_code, severe_shift)
            sev_res = evaluate_component(sev_input, inventory_config)

            # Scenario metrics
            base_first_ep = baseline_res.shortage_episodes[0] if baseline_res.shortage_episodes else None
            typ_first_ep = typ_res.shortage_episodes[0] if typ_res.shortage_episodes else None
            sev_first_ep = sev_res.shortage_episodes[0] if sev_res.shortage_episodes else None

            base_ep_days = base_first_ep.days if base_first_ep else 0
            typ_ep_days = typ_first_ep.days if typ_first_ep else 0
            sev_ep_days = sev_first_ep.days if sev_first_ep else 0

            typ_inc_unmet = typ_res.unmet_demand_units - baseline_res.unmet_demand_units
            sev_inc_unmet = sev_res.unmet_demand_units - baseline_res.unmet_demand_units

            typ_chg_days = typ_res.shortage_days - baseline_res.shortage_days
            sev_chg_days = sev_res.shortage_days - baseline_res.shortage_days

            # Eligibility test: incremental_total_unmet > 0 or first-episode window duration > baseline
            typ_qualifies = (typ_inc_unmet > 0) or (typ_ep_days > base_ep_days)
            sev_qualifies = (sev_inc_unmet > 0) or (sev_ep_days > base_ep_days)

            if not (typ_qualifies or sev_qualifies):
                continue

            # Earliest shifted inbound expected dates
            def earliest_expected(res: ComponentRiskResult) -> Optional[date]:
                lines = [line.expected_date for line in res.counted_inbound if line.supplier_code == sup_code]
                return min(lines) if lines else None

            base_exp = earliest_expected(baseline_res)
            typ_exp = earliest_expected(typ_res)
            sev_exp = earliest_expected(sev_res)

            scenario_items = [
                DelayScenarioItem(
                    scenario_name="baseline",
                    shift_days=0,
                    expected_date=base_exp,
                    shortage_date=baseline_res.shortage_date,
                    first_episode_start=base_first_ep.start_date if base_first_ep else None,
                    first_episode_end=base_first_ep.end_date if base_first_ep else None,
                    first_episode_days=base_ep_days,
                    unmet_before_next_inbound=baseline_res.unmet_before_next_inbound,
                    total_unmet_demand=baseline_res.unmet_demand_units,
                    incremental_total_unmet=0.0,
                    change_in_shortage_days=0,
                ),
                DelayScenarioItem(
                    scenario_name="typical",
                    shift_days=typical_shift,
                    expected_date=typ_exp,
                    shortage_date=typ_res.shortage_date,
                    first_episode_start=typ_first_ep.start_date if typ_first_ep else None,
                    first_episode_end=typ_first_ep.end_date if typ_first_ep else None,
                    first_episode_days=typ_ep_days,
                    unmet_before_next_inbound=typ_res.unmet_before_next_inbound,
                    total_unmet_demand=typ_res.unmet_demand_units,
                    incremental_total_unmet=typ_inc_unmet,
                    change_in_shortage_days=typ_chg_days,
                ),
                DelayScenarioItem(
                    scenario_name="severe",
                    shift_days=severe_shift,
                    expected_date=sev_exp,
                    shortage_date=sev_res.shortage_date,
                    first_episode_start=sev_first_ep.start_date if sev_first_ep else None,
                    first_episode_end=sev_first_ep.end_date if sev_first_ep else None,
                    first_episode_days=sev_ep_days,
                    unmet_before_next_inbound=sev_res.unmet_before_next_inbound,
                    total_unmet_demand=sev_res.unmet_demand_units,
                    incremental_total_unmet=sev_inc_unmet,
                    change_in_shortage_days=sev_chg_days,
                ),
            ]

            # Severity = WORST scenario level under InventoryRiskConfig
            worst_rank = max(SEVERITY_RANKS.get(typ_res.risk_level, 1), SEVERITY_RANKS.get(sev_res.risk_level, 1))
            raw_severity = "low"
            for sev_name, rank_val in SEVERITY_RANKS.items():
                if rank_val == worst_rank:
                    raw_severity = sev_name
                    break

            flags: List[str] = []
            if n_delivs < config.delay_min_deliveries:
                if SEVERITY_RANKS.get(raw_severity, 1) > SEVERITY_RANKS["medium"]:
                    raw_severity = "medium"
                flags.append("low_confidence")

            # Days until impact: worst scenario's days_until_shortage (or typical)
            days_until_impact = (
                typ_res.days_until_shortage
                if typ_res.days_until_shortage is not None
                else baseline_res.days_until_shortage
            )

            # Impact calculated using worst scenario shortage date (or typical if baseline is None)
            impact_shortage_date = typ_res.shortage_date or sev_res.shortage_date or baseline_res.shortage_date
            impact = compute_order_exposure_impact(
                as_of=as_of,
                horizon_days=inventory_config.horizon_days,
                shortage_date=impact_shortage_date,
                component_id=comp.id,
                customer_orders=customer_orders,
                bom_by_product=bom_by_product,
                products_by_id=products_by_id,
            )

            alert_id = f"supplier_delay_exposure.{comp.sku}.{sup_code}"
            summary = (
                f"Supplier {sup_code} ({sup_res.supplier_name}) has an observed historical late delivery frequency of "
                f"{late_prob*100:.1f}% (historical average delay: {avg_delay:.1f} days, p90: {p90_delay:.1f} days "
                f"across {n_delivs} deliveries). "
                f"What-if scenario analysis: a typical delay (+{typical_shift} days) causes first episode to span "
                f"{typ_ep_days} days with {typ_res.unmet_demand_units:.1f} total unmet units (+{typ_inc_unmet:.1f} incremental vs baseline); "
                f"a severe delay (+{severe_shift} days) yields {sev_res.unmet_demand_units:.1f} unmet units (+{sev_inc_unmet:.1f} incremental). "
                f"Scenarios are what-if cases derived from historical delays, NOT predictions or probabilities of this delivery."
            )

            evidence = [
                EvidenceItem("Supplier Historical Late Rate", f"{late_prob*100:.1f}%"),
                EvidenceItem("Supplier Deliveries Evaluated", n_delivs),
                EvidenceItem("Avg Delay When Late", round(avg_delay, 2), "days"),
                EvidenceItem("P90 Delay When Late", round(p90_delay, 2) if p90_delay else None, "days"),
                EvidenceItem("Typical Scenario Shift", f"+{typical_shift} days"),
                EvidenceItem("Typical Incremental Unmet", round(typ_inc_unmet, 1), "units"),
                EvidenceItem("Severe Scenario Shift", f"+{severe_shift} days"),
                EvidenceItem("Severe Incremental Unmet", round(sev_inc_unmet, 1), "units"),
            ]

            assumptions = [
                "What-if cases from historical delays, not predictions.",
                "Scenarios shift supplier inbound receipt dates prospectively by historical empirical percentiles.",
                MANDATORY_EXPOSURE_ASSUMPTION,
            ]

            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="supplier_delay_exposure",
                    severity=raw_severity,
                    title=f"Supplier Delay Exposure for {comp.sku} ({sup_code})",
                    summary=summary,
                    component_id=comp.id,
                    component_sku=comp.sku,
                    component_name=comp.name,
                    supplier_id=sup_res.supplier_id,
                    supplier_code=sup_code,
                    po_number=None,
                    days_until_impact=days_until_impact,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=impact,
                    impact_null_reason=None if impact is not None else "no_exposed_orders",
                    flags=flags,
                    delay_scenarios=scenario_items,
                )
            )

    # -------------------------------------------------------------------------
    # 4. PO SLIPPED & 5. PO OVERDUE
    # -------------------------------------------------------------------------
    for po in purchase_orders:
        if po.status not in ("open", "in_transit", "partially_received"):
            continue

        exp_date = po.latest_estimate_date if po.latest_estimate_date else po.promised_date
        comp_sku_str = ", ".join(po.component_skus)

        # First component as primary subject ref
        primary_comp_id = po.component_ids[0] if po.component_ids else None
        primary_comp = components_by_id.get(primary_comp_id) if primary_comp_id else None

        # Check po_slipped
        if po.latest_estimate_date is not None and po.latest_estimate_date > po.promised_date:
            slip_days = (po.latest_estimate_date - po.promised_date).days
            # Severity rule: high if feeds a component with baseline shortage_date and PO's estimate > shortage_date; else low
            feeds_shortage = False
            for cid in po.component_ids:
                c_res = component_results.get(cid)
                if c_res and c_res.shortage_date and po.latest_estimate_date > c_res.shortage_date:
                    feeds_shortage = True
                    break

            severity = "high" if feeds_shortage else "low"
            alert_id = f"po_slipped.{po.po_number}"

            evidence = [
                EvidenceItem("Promised Date", po.promised_date.isoformat()),
                EvidenceItem("Latest Estimate Date", po.latest_estimate_date.isoformat()),
                EvidenceItem("Slip Duration", slip_days, "days"),
                EvidenceItem("Remaining Quantity", po.remaining_qty, "units"),
                EvidenceItem("Components", comp_sku_str),
                EvidenceItem("Supplier", po.supplier_code),
            ]

            summary = (
                f"PO {po.po_number} from {po.supplier_code} has slipped by {slip_days} days "
                f"(promised: {po.promised_date.isoformat()}, latest estimate: {po.latest_estimate_date.isoformat()}). "
                f"Remaining open quantity: {po.remaining_qty} units across components ({comp_sku_str})."
            )

            assumptions = [
                "Slipped delivery date reflects latest revised tracking estimates provided by logistics or supplier."
            ]

            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="po_slipped",
                    severity=severity,
                    title=f"Purchase Order Delivery Date Slipped: {po.po_number}",
                    summary=summary,
                    component_id=primary_comp.id if primary_comp else None,
                    component_sku=primary_comp.sku if primary_comp else None,
                    component_name=primary_comp.name if primary_comp else None,
                    supplier_id=po.supplier_id,
                    supplier_code=po.supplier_code,
                    po_number=po.po_number,
                    days_until_impact=None,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=None,
                    impact_null_reason="not applicable",
                )
            )

        # Check po_overdue
        if exp_date < as_of:
            days_overdue = (as_of - exp_date).days
            # Severity: high if any fed component risk is critical or high, else medium
            feeds_high_risk = False
            for cid in po.component_ids:
                c_res = component_results.get(cid)
                if c_res and c_res.risk_level in ("critical", "high"):
                    feeds_high_risk = True
                    break

            severity = "high" if feeds_high_risk else "medium"
            alert_id = f"po_overdue.{po.po_number}"

            evidence = [
                EvidenceItem("Expected Date", exp_date.isoformat()),
                EvidenceItem("Days Overdue", days_overdue, "days"),
                EvidenceItem("Remaining Quantity", po.remaining_qty, "units"),
                EvidenceItem("Components", comp_sku_str),
                EvidenceItem("Supplier", po.supplier_code),
                EvidenceItem("Supply Policy", "Excluded from projected available stock"),
            ]

            summary = (
                f"PO {po.po_number} from {po.supplier_code} was expected on {exp_date.isoformat()} "
                f"({days_overdue} days before as-of {as_of.isoformat()}). Remaining open quantity: {po.remaining_qty} units. "
                f"Under conservative inventory policy, overdue supply is excluded from forward projections until actual receipt."
            )

            assumptions = [
                "Overdue purchase orders are excluded from projected supply cover until physically booked into plant usable inventory."
            ]

            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="po_overdue",
                    severity=severity,
                    title=f"Overdue Purchase Order: {po.po_number}",
                    summary=summary,
                    component_id=primary_comp.id if primary_comp else None,
                    component_sku=primary_comp.sku if primary_comp else None,
                    component_name=primary_comp.name if primary_comp else None,
                    supplier_id=po.supplier_id,
                    supplier_code=po.supplier_code,
                    po_number=po.po_number,
                    days_until_impact=0,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=None,
                    impact_null_reason="not applicable",
                )
            )

    # -------------------------------------------------------------------------
    # 6. DEMAND SURGE
    # -------------------------------------------------------------------------
    for comp in active_components:
        comp_input = component_inputs.get(comp.id)
        if comp_input is None:
            continue

        demands_by_date = {d.date: d.quantity for d in comp_input.demand_records}

        recent_start = as_of - timedelta(days=config.surge_recent_days)
        recent_end = as_of - timedelta(days=1)
        baseline_start = as_of - timedelta(days=config.surge_recent_days + config.surge_baseline_days)
        baseline_end = as_of - timedelta(days=config.surge_recent_days + 1)

        recent_vals = [demands_by_date[recent_start + timedelta(days=i)] for i in range(config.surge_recent_days) if (recent_start + timedelta(days=i)) in demands_by_date]
        baseline_vals = [demands_by_date[baseline_start + timedelta(days=i)] for i in range(config.surge_baseline_days) if (baseline_start + timedelta(days=i)) in demands_by_date]

        recent_cov = len(recent_vals) / float(config.surge_recent_days)
        baseline_cov = len(baseline_vals) / float(config.surge_baseline_days)

        if (
            recent_cov >= config.surge_min_coverage
            and baseline_cov >= config.surge_min_coverage
            and len(baseline_vals) > 0
        ):
            recent_mean = sum(recent_vals) / len(recent_vals)
            baseline_mean = sum(baseline_vals) / len(baseline_vals)

            if baseline_mean >= config.surge_min_baseline_mean:
                ratio = recent_mean / baseline_mean
                if ratio >= config.surge_ratio_medium:
                    severity = "high" if ratio >= config.surge_ratio_high else "medium"
                    alert_id = f"demand_surge.{comp.sku}"

                    evidence = [
                        EvidenceItem("Recent Mean Demand", round(recent_mean, 2), "units/day"),
                        EvidenceItem("Baseline Mean Demand", round(baseline_mean, 2), "units/day"),
                        EvidenceItem("Surge Ratio", round(ratio, 4)),
                        EvidenceItem("Recent Window", f"{recent_start.isoformat()} to {recent_end.isoformat()}"),
                        EvidenceItem("Baseline Window", f"{baseline_start.isoformat()} to {baseline_end.isoformat()}"),
                        EvidenceItem("Recent Coverage", round(recent_cov, 2)),
                        EvidenceItem("Baseline Coverage", round(baseline_cov, 2)),
                    ]

                    summary = (
                        f"Recent 14-day average consumption for {comp.sku} is {recent_mean:.1f} units/day compared to "
                        f"a 28-day baseline of {baseline_mean:.1f} units/day (surge ratio: {ratio:.2f}x). "
                        f"Inventory projections currently rely on 28-day weekday averages, which means projected shortage "
                        f"dates may be optimistic if this surge persists."
                    )

                    assumptions = [
                        "Surge ratio compares mean daily demand between consecutive balanced multi-week windows (14d recent vs 28d baseline).",
                        "Windows span full weeks, ensuring identical day-of-week composition.",
                        "Ratio heuristic ignores day-to-day noise and linear trends.",
                        "Standard inventory projection uses the 28-day weekday average profile, so a surge indicates potential optimism in projected runway.",
                    ]

                    alerts.append(
                        DisruptionAlert(
                            id=alert_id,
                            type="demand_surge",
                            severity=severity,
                            title=f"Demand Surge Detected for {comp.sku}",
                            summary=summary,
                            component_id=comp.id,
                            component_sku=comp.sku,
                            component_name=comp.name,
                            supplier_id=None,
                            supplier_code=None,
                            po_number=None,
                            days_until_impact=None,
                            detected_on=as_of,
                            evidence=evidence,
                            assumptions=assumptions,
                            impact=None,
                            impact_null_reason="not applicable",
                        )
                    )

    # -------------------------------------------------------------------------
    # 7. QUALITY ISSUE
    # -------------------------------------------------------------------------
    quality_start = as_of - timedelta(days=config.quality_recent_days)
    delivs_by_supplier: Dict[str, List[DeliveryRecordInput]] = {}
    for d in deliveries:
        delivs_by_supplier.setdefault(d.supplier_code, []).append(d)

    for sup_code, sup_delivs in sorted(delivs_by_supplier.items()):
        recent_delivs = [
            d for d in sup_delivs
            if quality_start <= d.actual_date <= as_of
        ]
        rec_units = sum(d.qty_received for d in recent_delivs)
        rej_units = sum(d.qty_rejected for d in recent_delivs)

        if rec_units >= config.quality_min_received_units:
            rate = rej_units / float(rec_units)
            if rate >= config.quality_rejection_threshold:
                severity = "high" if rate >= 2.0 * config.quality_rejection_threshold else "medium"
                alert_id = f"quality_issue.{sup_code}"

                sup_res = next((sr for sr in supplier_results.values() if sr.supplier_code == sup_code), None)
                full_rate = sup_res.rejection_rate if sup_res else None
                sup_name = sup_res.supplier_name if sup_res else sup_code
                sup_id = supplier_id_by_code.get(sup_code)

                evidence = [
                    EvidenceItem("Recent Rejection Rate", round(rate, 4)),
                    EvidenceItem("Total Received Units", rec_units, "units"),
                    EvidenceItem("Total Rejected Units", rej_units, "units"),
                    EvidenceItem("Lookback Window", config.quality_recent_days, "days"),
                    EvidenceItem("Full Lookback Rejection Rate", round(full_rate, 4) if full_rate is not None else None),
                ]

                summary = (
                    f"Supplier {sup_code} ({sup_name}) has an elevated quality rejection rate of {rate*100:.2f}% "
                    f"({rej_units} rejected out of {rec_units} received units) over the last {config.quality_recent_days} days. "
                    f"Full 365-day lookback rejection rate: {full_rate*100:.2f}% if available."
                )

                assumptions = [
                    "Rejection rate calculated as rejected units divided by received units for deliveries within the quality evaluation window.",
                    "Deliveries with actual arrival dates after as-of are excluded.",
                ]

                alerts.append(
                    DisruptionAlert(
                        id=alert_id,
                        type="quality_issue",
                        severity=severity,
                        title=f"Elevated Quality Rejections for Supplier {sup_code}",
                        summary=summary,
                        component_id=None,
                        component_sku=None,
                        component_name=None,
                        supplier_id=sup_id,
                        supplier_code=sup_code,
                        po_number=None,
                        days_until_impact=None,
                        detected_on=as_of,
                        evidence=evidence,
                        assumptions=assumptions,
                        impact=None,
                        impact_null_reason="not applicable",
                    )
                )

    # -------------------------------------------------------------------------
    # 8. CAPACITY CONSTRAINT
    # -------------------------------------------------------------------------
    for comp in active_components:
        comp_res = component_results.get(comp.id)
        if comp_res is None or comp_res.risk_level not in ("critical", "high", "medium"):
            continue

        mean_demand = comp_res.mean_daily_demand
        if mean_demand is None or mean_demand <= 0:
            continue

        weekly_demand = 7.0 * mean_demand
        offers = offers_by_component.get(comp.id, [])
        if not offers:
            continue

        any_null_capacity = any(off.max_weekly_capacity is None for off in offers)
        total_capacity = sum(off.max_weekly_capacity for off in offers if off.max_weekly_capacity is not None)
        known_count = sum(1 for off in offers if off.max_weekly_capacity is not None)

        if not any_null_capacity and total_capacity < weekly_demand:
            # Subkind "insufficient"
            alert_id = f"capacity_constraint.{comp.sku}.insufficient"
            evidence = [
                EvidenceItem("Total Contracted Weekly Capacity", total_capacity, "units/week"),
                EvidenceItem("Projected Weekly Demand", round(weekly_demand, 1), "units/week"),
                EvidenceItem("Offers Count", len(offers)),
                EvidenceItem("Offers With Capacity", known_count),
            ]
            summary = (
                f"Total contracted supplier nominal weekly capacity for {comp.sku} is {total_capacity} units/week, "
                f"which is insufficient to cover projected weekly demand of {weekly_demand:.1f} units/week "
                f"(shortfall: {weekly_demand - total_capacity:.1f} units/week). "
                f"Compares nominal weekly capacity to mean weekly demand and ignores current commitments."
            )
            assumptions = [
                "Compares nominal contracted weekly supplier capacity to average weekly demand.",
                "Ignores existing commitments to other customers or internal orders.",
            ]
            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="capacity_constraint",
                    severity="medium",
                    title=f"Supplier Capacity Constraint for {comp.sku}",
                    summary=summary,
                    component_id=comp.id,
                    component_sku=comp.sku,
                    component_name=comp.name,
                    supplier_id=None,
                    supplier_code=None,
                    po_number=None,
                    days_until_impact=None,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=None,
                    impact_null_reason="not applicable",
                )
            )

        elif any_null_capacity:
            # Subkind "unknown"
            alert_id = f"capacity_constraint.{comp.sku}.unknown"
            evidence = [
                EvidenceItem("Total Offers Count", len(offers)),
                EvidenceItem("Offers With Specified Capacity", known_count),
                EvidenceItem("Projected Weekly Demand", round(weekly_demand, 1), "units/week"),
            ]
            summary = (
                f"At least one supplier offer for {comp.sku} does not specify max weekly capacity "
                f"({known_count}/{len(offers)} offers state capacity). "
                f"Replenishment capacity is unknown and no capacity limit is assumed."
            )
            assumptions = [
                "Capacity is unknown for unstated offers; zero capacity is not assumed."
            ]
            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="capacity_constraint",
                    severity="low",
                    title=f"Unknown Supplier Capacity for {comp.sku}",
                    summary=summary,
                    component_id=comp.id,
                    component_sku=comp.sku,
                    component_name=comp.name,
                    supplier_id=None,
                    supplier_code=None,
                    po_number=None,
                    days_until_impact=None,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=None,
                    impact_null_reason="not applicable",
                )
            )

    # -------------------------------------------------------------------------
    # 9. COMPOUND RISK
    # -------------------------------------------------------------------------
    # Map quality_issue alerts by supplier_code
    quality_alerts_by_supplier: Dict[str, DisruptionAlert] = {
        a.supplier_code: a
        for a in alerts
        if a.type == "quality_issue" and a.supplier_code and SEVERITY_RANKS[a.severity] >= SEVERITY_RANKS["medium"]
    }

    # Map supplier codes offering each component
    suppliers_for_comp: Dict[int, Set[str]] = {}
    for off in supplier_offers:
        suppliers_for_comp.setdefault(off.component_id, set()).add(off.supplier_code)

    for comp in active_components:
        # Collect constituent alerts for this component with severity >= medium
        constituent_alerts: List[DisruptionAlert] = []
        constituent_types: Set[str] = set()

        for a in alerts:
            if a.component_id == comp.id and SEVERITY_RANKS[a.severity] >= SEVERITY_RANKS["medium"]:
                if a.type in (
                    "inventory_shortage",
                    "supplier_delay_exposure",
                    "po_slipped",
                    "po_overdue",
                    "demand_surge",
                    "capacity_constraint",
                ):
                    constituent_alerts.append(a)
                    constituent_types.add(a.type)

        # Include quality_issue through component's suppliers if severity >= medium
        comp_sups = suppliers_for_comp.get(comp.id, set())
        for sc in sorted(comp_sups):
            qa = quality_alerts_by_supplier.get(sc)
            if qa and "quality_issue" not in constituent_types:
                constituent_alerts.append(qa)
                constituent_types.add("quality_issue")

        if len(constituent_types) >= config.compound_min_types:
            # Highest constituent severity
            max_rank = max(SEVERITY_RANKS[a.severity] for a in constituent_alerts)
            max_sev = "medium"
            for sev_name, rank_val in SEVERITY_RANKS.items():
                if rank_val == max_rank:
                    max_sev = sev_name
                    break

            escalated = len(constituent_types) >= config.compound_escalate_at_types
            final_severity = escalate_severity(max_sev) if escalated else max_sev

            alert_id = f"compound_risk.{comp.sku}"
            sorted_types = sorted(constituent_types)
            constituent_ids = sorted(a.id for a in constituent_alerts)

            days_impact_candidates = [
                a.days_until_impact for a in constituent_alerts if a.days_until_impact is not None
            ]
            compound_days = min(days_impact_candidates) if days_impact_candidates else None

            summary = (
                f"Component {comp.sku} ({comp.name}) exhibits multiple converging disruptions across "
                f"{len(constituent_types)} distinct categories ({', '.join(sorted_types)}). "
                f"Severity assessed as {final_severity}"
                f"{' (escalated from ' + max_sev + ' due to ' + str(len(constituent_types)) + ' concurrent risk categories)' if escalated else ''}."
            )

            evidence = [
                EvidenceItem("Distinct Disruption Types Count", len(constituent_types)),
                EvidenceItem("Constituent Alert Types", ", ".join(sorted_types)),
                EvidenceItem("Highest Base Severity", max_sev),
                EvidenceItem("Escalated", "Yes" if escalated else "No"),
                EvidenceItem("Constituent Alerts Count", len(constituent_alerts)),
            ]

            assumptions = [
                "Compound risk aggregates distinct disruption signals (severity medium or higher) converging on the same component.",
                "Constituent alerts remain individual action items; summary counts include compound alerts.",
            ]

            alerts.append(
                DisruptionAlert(
                    id=alert_id,
                    type="compound_risk",
                    severity=final_severity,
                    title=f"Compound Disruption Risk for {comp.sku}",
                    summary=summary,
                    component_id=comp.id,
                    component_sku=comp.sku,
                    component_name=comp.name,
                    supplier_id=None,
                    supplier_code=None,
                    po_number=None,
                    days_until_impact=compound_days,
                    detected_on=as_of,
                    evidence=evidence,
                    assumptions=assumptions,
                    impact=None,
                    impact_null_reason="not applicable",
                    related_alert_ids=constituent_ids,
                )
            )

    # -------------------------------------------------------------------------
    # SORTING:
    # 1. severity rank descending (critical > high > medium > low > info)
    # 2. days_until_impact ascending (nulls last)
    # 3. component criticality descending (critical > high > normal/low > null)
    # 4. alert id ascending
    # -------------------------------------------------------------------------
    def alert_sort_key(a: DisruptionAlert):
        sev_rank = -SEVERITY_RANKS.get(a.severity, 0)
        days_key = (0, a.days_until_impact) if a.days_until_impact is not None else (1, 999999)
        comp = components_by_id.get(a.component_id) if a.component_id else None
        crit_rank = -CRITICALITY_RANKS.get(comp.criticality if comp else None, 0)
        return (sev_rank, days_key, crit_rank, a.id)

    alerts.sort(key=alert_sort_key)

    # Compute summary counts
    counts_by_severity = {sev: 0 for sev in SEVERITY_ORDER}
    counts_by_type = {t: 0 for t in ALERT_TYPES}

    for a in alerts:
        counts_by_severity[a.severity] = counts_by_severity.get(a.severity, 0) + 1
        counts_by_type[a.type] = counts_by_type.get(a.type, 0) + 1

    return AlertResult(
        as_of=as_of,
        alerts=alerts,
        counts_by_severity=counts_by_severity,
        counts_by_type=counts_by_type,
        total_alerts=len(alerts),
    )
