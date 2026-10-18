"""app/domain/simulation.py

Pure domain logic for What-If Supply Chain Disruption Simulation.
Evaluates three comparative scenarios for a component:
1. Baseline: unchanged current data.
2. Disrupted: baseline with delay, demand multiplier, and on-hand delta applied.
3. Recovered: existing recovery engine applied to the disrupted inputs.

Strictly pure functions with no database, no FastAPI, no system clock access.
All calculations are deterministic and anchored to the dataset `as_of` date.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Sequence

from app.domain.inventory import (
    ComponentEvaluationInput,
    ComponentRiskResult,
    DailyProjectionItem,
    InboundLineInput,
    InventoryRiskConfig,
    RegionalStockItem,
    add_inbound,
    adjust_plant_on_hand,
    evaluate_component,
    expedite_inbound,
    scale_demand,
    shift_all_inbound,
)
from app.domain.alerts import (
    AlertImpact,
    CustomerOrderInput,
    MANDATORY_EXPOSURE_ASSUMPTION,
    ProductInput,
    compute_order_exposure_impact,
)
from app.domain.recovery import (
    ComponentRecoveryRecommendation,
    RecoveryConfig,
    SupplierOfferInput,
    evaluate_component_recovery,
)


SIMULATION_ASSUMPTIONS = [
    "Supplier delay applies uniformly to all counted inbound purchase order lines of this component.",
    "Demand multiplier scales all daily demand quantities in the 28-day historical lookback window.",
    "Unmet demand in daily simulation is not carried forward as backorders (lost consumption model).",
    "What-if simulation for decision support only; this is not a forecast, optimization, or commitment.",
    MANDATORY_EXPOSURE_ASSUMPTION,
]


@dataclass(frozen=True)
class SimulationParams:
    """Parameters governing the what-if disruption simulation."""

    supplier_delay_days: int = 0
    demand_multiplier: float = 1.0
    on_hand_delta: int = 0
    alt_supplier_available: bool = True

    def __post_init__(self) -> None:
        if not (0 <= self.supplier_delay_days <= 60):
            raise ValueError(
                f"supplier_delay_days must be between 0 and 60, got {self.supplier_delay_days}"
            )
        if not (0.5 <= self.demand_multiplier <= 3.0):
            raise ValueError(
                f"demand_multiplier must be between 0.5 and 3.0, got {self.demand_multiplier}"
            )
        if not (-10000 <= self.on_hand_delta <= 10000):
            raise ValueError(
                f"on_hand_delta must be between -10000 and 10000, got {self.on_hand_delta}"
            )
        if not isinstance(self.alt_supplier_available, bool):
            raise ValueError("alt_supplier_available must be a boolean")

    @property
    def is_default(self) -> bool:
        """Return True if all parameters match baseline defaults."""
        return (
            self.supplier_delay_days == 0
            and self.demand_multiplier == 1.0
            and self.on_hand_delta == 0
            and self.alt_supplier_available is True
        )


@dataclass(frozen=True)
class SimulationDailyProjectionItem:
    """Single-day inventory projection item for simulation chart and table."""

    day_index: int
    date: datetime.date
    forecast_demand: float
    receipts: float
    ending_balance: float
    unmet: float


@dataclass(frozen=True)
class ShortageEpisodeSummary:
    """Summary of the primary shortage episode."""

    start_date: datetime.date
    end_date: datetime.date
    days: int
    unmet_units: float


@dataclass(frozen=True)
class LaterShortageSummary:
    """Summary of a later shortage episode not covered by recovery intervention."""

    date: datetime.date
    days: int
    units: float
    note: str = "Later shortage not covered by this recovery"


@dataclass(frozen=True)
class InboundSummary:
    """Summary of next scheduled replenishment."""

    date: datetime.date
    qty: float
    po_number: str
    date_basis: str


@dataclass(frozen=True)
class AppliedRecoveryAction:
    """Recovery intervention applied in the recovered scenario."""

    id: str
    kind: str
    description: str
    source_code: Optional[str]
    quantity: int
    arrival_date: Optional[datetime.date]
    incremental_cost: Optional[Decimal]
    cost_known: bool


@dataclass(frozen=True)
class ScenarioResult:
    """Outcome of a single evaluated scenario (baseline, disrupted, or recovered)."""

    risk_level: str
    shortage_date: Optional[datetime.date]
    days_until_shortage: Optional[int]
    first_shortage_episode: Optional[ShortageEpisodeSummary]
    unmet_before_next_inbound: float
    later_episodes_note: Optional[str]
    next_inbound: Optional[InboundSummary]
    mean_daily_demand: Optional[float]
    plant_usable_stock: Optional[int]
    daily_projection_30d: List[SimulationDailyProjectionItem]
    exposed_orders_count: int
    exposed_revenue: Optional[Decimal]
    exposed_orders_summary: str
    applied_actions: List[AppliedRecoveryAction] = field(default_factory=list)
    recovery_note: Optional[str] = None
    shortage_resolved_for_first_window: bool = False
    later_shortage: Optional[LaterShortageSummary] = None


@dataclass(frozen=True)
class SimulationResult:
    """Complete comparative simulation result for a component."""

    as_of: datetime.date
    component_id: int
    sku: str
    name: str
    params: SimulationParams
    baseline: ScenarioResult
    disrupted: ScenarioResult
    recovered: ScenarioResult
    what_changed: List[str]
    assumptions: List[str]
    note: str = "What-if simulation. Nothing is saved and no orders are created."


def _build_scenario_result(
    evaluation: ComponentRiskResult,
    impact: AlertImpact,
    applied_actions: Optional[List[AppliedRecoveryAction]] = None,
    recovery_note: Optional[str] = None,
    target_cutoff: Optional[datetime.date] = None,
    is_recovered: bool = False,
) -> ScenarioResult:
    """Build a ScenarioResult from evaluation and order exposure impact.

    Headlines for all scenarios focus on the primary target window. For the recovered
    scenario, if the first shortage episode from the disrupted case's timeframe is eliminated
    (no shortage prior to target_cutoff), residual unmet demand is reported as 0.0,
    shortage_resolved_for_first_window is set to True, and subsequent shortage is isolated
    in later_shortage.
    """
    first_episode = None
    later_shortage = None
    later_note = None
    shortage_resolved = False

    risk_level = evaluation.risk_level
    shortage_date = evaluation.shortage_date
    days_until = evaluation.days_until_shortage
    unmet_units = evaluation.unmet_before_next_inbound or 0.0

    if is_recovered and target_cutoff is not None:
        # Check if any shortage episode exists prior to target_cutoff
        episodes_in_window = [
            ep for ep in evaluation.shortage_episodes
            if ep.start_date < target_cutoff
        ]
        if not episodes_in_window:
            # First shortage window is completely resolved!
            shortage_resolved = True
            first_episode = None
            shortage_date = None
            days_until = None
            unmet_units = 0.0
            risk_level = "low"

            if evaluation.shortage_episodes:
                # Any episode starting >= target_cutoff is recorded as later shortage
                lat_ep = evaluation.shortage_episodes[0]
                later_shortage = LaterShortageSummary(
                    date=lat_ep.start_date,
                    days=lat_ep.days,
                    units=lat_ep.unmet_units,
                    note="Later shortage not covered by this recovery",
                )
                later_note = (
                    f"Later shortage episode begins {lat_ep.start_date.isoformat()} "
                    f"({lat_ep.unmet_units:.1f} units over {lat_ep.days} days); not covered by this recovery."
                )
        else:
            # First episode still exists but might be reduced
            p_ep = episodes_in_window[0]
            first_episode = ShortageEpisodeSummary(
                start_date=p_ep.start_date,
                end_date=p_ep.end_date,
                days=p_ep.days,
                unmet_units=p_ep.unmet_units,
            )
            shortage_date = p_ep.start_date
            unmet_units = p_ep.unmet_units
            shortage_resolved = False

            # Later episodes (e.g. beyond first window or 2nd episode)
            later_candidates = [
                ep for ep in evaluation.shortage_episodes if ep.start_date >= target_cutoff or ep != p_ep
            ]
            if later_candidates:
                lat_ep = later_candidates[0]
                later_shortage = LaterShortageSummary(
                    date=lat_ep.start_date,
                    days=lat_ep.days,
                    units=lat_ep.unmet_units,
                    note="Later shortage not covered by this recovery",
                )
                later_note = (
                    f"Later shortage episode begins {lat_ep.start_date.isoformat()} "
                    f"({lat_ep.unmet_units:.1f} units over {lat_ep.days} days); not covered by this recovery."
                )
    else:
        # Baseline or disrupted scenario
        if evaluation.shortage_episodes:
            ep = evaluation.shortage_episodes[0]
            first_episode = ShortageEpisodeSummary(
                start_date=ep.start_date,
                end_date=ep.end_date,
                days=ep.days,
                unmet_units=ep.unmet_units,
            )

        if len(evaluation.shortage_episodes) > 1:
            ep2 = evaluation.shortage_episodes[1]
            later_shortage = LaterShortageSummary(
                date=ep2.start_date,
                days=ep2.days,
                units=ep2.unmet_units,
                note="Later shortage not covered by this recovery",
            )
            later_note = (
                f"Later shortage episode begins {ep2.start_date.isoformat()} "
                f"({ep2.unmet_units:.1f} units over {ep2.days} days); not covered by this recommendation."
            )

    next_inb = None
    if evaluation.next_replenishment is not None:
        next_inb = InboundSummary(
            date=evaluation.next_replenishment.date,
            qty=evaluation.next_replenishment.qty,
            po_number=evaluation.next_replenishment.po_number,
            date_basis=evaluation.next_replenishment.date_basis,
        )

    proj_30d = [
        SimulationDailyProjectionItem(
            day_index=d.day_index,
            date=d.date,
            forecast_demand=d.forecast_demand,
            receipts=d.receipts,
            ending_balance=d.ending_balance,
            unmet=d.unmet,
        )
        for d in evaluation.daily_projection[:30]
    ]

    exp_count = impact.orders_count if impact is not None else 0
    exp_rev = impact.exposed_revenue if impact is not None else None
    if impact is not None and impact.orders_count > 0:
        crit = impact.count_by_priority.get("critical", 0)
        high = impact.count_by_priority.get("high", 0)
        norm = impact.count_by_priority.get("normal", 0)
        low = impact.count_by_priority.get("low", 0)
        exp_sum = (
            f"{impact.orders_count} customer orders potentially exposed: "
            f"{crit} critical, {high} high, {norm} normal, {low} low priority. "
            f"Upper bound selling value: ${impact.exposed_revenue:,.2f}."
        )
    else:
        exp_sum = "No customer orders exposed within the planning horizon."

    return ScenarioResult(
        risk_level=risk_level,
        shortage_date=shortage_date,
        days_until_shortage=days_until,
        first_shortage_episode=first_episode,
        unmet_before_next_inbound=unmet_units,
        later_episodes_note=later_note,
        next_inbound=next_inb,
        mean_daily_demand=evaluation.mean_daily_demand,
        plant_usable_stock=evaluation.plant_usable_stock,
        daily_projection_30d=proj_30d,
        exposed_orders_count=exp_count,
        exposed_revenue=exp_rev,
        exposed_orders_summary=exp_sum,
        applied_actions=applied_actions or [],
        recovery_note=recovery_note,
        shortage_resolved_for_first_window=shortage_resolved,
        later_shortage=later_shortage,
    )


def _build_what_changed(
    baseline: ScenarioResult,
    disrupted: ScenarioResult,
    recovered: ScenarioResult,
    params: SimulationParams,
) -> List[str]:
    """Generate dynamic plain-language sentences describing computed changes."""
    if params.is_default:
        return ["No changes applied; disrupted equals baseline."]

    changes: List[str] = []

    # 1. Parameter adjustments
    if params.supplier_delay_days > 0:
        changes.append(
            f"Inbound replenishment delayed by {params.supplier_delay_days} days across all counted purchase orders."
        )
    if params.demand_multiplier != 1.0:
        pct = int(round((params.demand_multiplier - 1.0) * 100))
        sign = "+" if pct > 0 else ""
        changes.append(
            f"Demand scaled to {params.demand_multiplier:.1f}x ({sign}{pct}% vs baseline history)."
        )
    if params.on_hand_delta != 0:
        sign = "+" if params.on_hand_delta > 0 else ""
        b_stock = baseline.plant_usable_stock if baseline.plant_usable_stock is not None else 0
        d_stock = disrupted.plant_usable_stock if disrupted.plant_usable_stock is not None else 0
        changes.append(
            f"Plant on-hand inventory adjusted by {sign}{params.on_hand_delta} units "
            f"({b_stock} to {d_stock} usable units)."
        )
    if not params.alt_supplier_available:
        changes.append("Alternative suppliers excluded from recovery evaluation.")

    # 2. Shortage date changes (baseline -> disrupted)
    if baseline.shortage_date and disrupted.shortage_date:
        if baseline.shortage_date != disrupted.shortage_date:
            diff_days = (disrupted.shortage_date - baseline.shortage_date).days
            sign = "+" if diff_days > 0 else ""
            changes.append(
                f"Shortage date moved from {baseline.shortage_date.isoformat()} to "
                f"{disrupted.shortage_date.isoformat()} ({sign}{diff_days} days)."
            )
        else:
            changes.append(f"Shortage date remains unchanged at {baseline.shortage_date.isoformat()}.")
    elif baseline.shortage_date is None and disrupted.shortage_date is not None:
        changes.append(
            f"New shortage introduced on {disrupted.shortage_date.isoformat()} "
            f"({disrupted.days_until_shortage} days from as-of date)."
        )
    elif baseline.shortage_date is not None and disrupted.shortage_date is None:
        changes.append("Projected shortage eliminated across the 60-day horizon.")

    # 3. First shortage window duration
    b_ep = baseline.first_shortage_episode
    d_ep = disrupted.first_shortage_episode
    if b_ep and d_ep and b_ep.days != d_ep.days:
        diff_ep = d_ep.days - b_ep.days
        sign = "+" if diff_ep > 0 else ""
        changes.append(
            f"First shortage window duration changed from {b_ep.days} days "
            f"({b_ep.start_date.isoformat()}..{b_ep.end_date.isoformat()}) to "
            f"{d_ep.days} days ({d_ep.start_date.isoformat()}..{d_ep.end_date.isoformat()}) ({sign}{diff_ep} days)."
        )

    # 4. Unmet before next inbound (baseline -> disrupted)
    if abs(baseline.unmet_before_next_inbound - disrupted.unmet_before_next_inbound) > 0.05:
        diff_u = disrupted.unmet_before_next_inbound - baseline.unmet_before_next_inbound
        sign = "+" if diff_u > 0 else ""
        changes.append(
            f"Unmet demand before next inbound changed from {baseline.unmet_before_next_inbound:.1f} to "
            f"{disrupted.unmet_before_next_inbound:.1f} units ({sign}{diff_u:.1f} units)."
        )

    # 5. Recovery effect
    if recovered.applied_actions:
        action_desc = ", ".join(f"'{a.id}'" for a in recovered.applied_actions)
        if recovered.shortage_resolved_for_first_window:
            changes.append(
                f"Recovery intervention ({action_desc}) eliminates 100% of the "
                f"{disrupted.unmet_before_next_inbound:.1f} units projected shortage in the first shortage window."
            )
        elif recovered.unmet_before_next_inbound < disrupted.unmet_before_next_inbound:
            cov = disrupted.unmet_before_next_inbound - recovered.unmet_before_next_inbound
            changes.append(
                f"Recovery intervention ({action_desc}) reduces unmet demand before next inbound from "
                f"{disrupted.unmet_before_next_inbound:.1f} to {recovered.unmet_before_next_inbound:.1f} units "
                f"({cov:.1f} units recovered)."
            )
        else:
            changes.append(
                f"Recovery intervention ({action_desc}) applied; unmet demand before next inbound remains "
                f"{recovered.unmet_before_next_inbound:.1f} units."
            )
        if recovered.shortage_date != disrupted.shortage_date:
            if recovered.shortage_date is not None:
                changes.append(
                    f"Recovery extends coverage: projected shortage date shifted from "
                    f"{disrupted.shortage_date.isoformat()} to {recovered.shortage_date.isoformat()}."
                )
            else:
                changes.append("Recovery eliminates projected shortage across the first shortage window.")
        if recovered.later_shortage is not None:
            changes.append(
                f"Note: Later shortage beginning {recovered.later_shortage.date.isoformat()} "
                f"({recovered.later_shortage.units:.1f} units over {recovered.later_shortage.days} days) "
                "is not covered by this recovery."
            )
    else:
        if recovered.recovery_note:
            changes.append(f"Recovery status: {recovered.recovery_note}")

    return changes


def simulate(
    component_inputs: ComponentEvaluationInput,
    supplier_offers: Sequence[SupplierOfferInput],
    regional_stocks: Sequence[RegionalStockItem],
    customer_orders: Sequence[CustomerOrderInput],
    bom_by_product: Dict[int, Dict[int, int]],
    products_by_id: Dict[int, ProductInput],
    params: SimulationParams,
    inventory_config: Optional[InventoryRiskConfig] = None,
    recovery_config: Optional[RecoveryConfig] = None,
) -> SimulationResult:
    """Run comparative 3-scenario simulation (baseline, disrupted, recovered).

    Reuses evaluate_component and evaluate_component_recovery with zero code duplication.
    Pure and deterministic function.
    """
    inv_cfg = inventory_config or InventoryRiskConfig()
    rec_cfg = recovery_config or RecoveryConfig()
    as_of = component_inputs.as_of

    # -------------------------------------------------------------------------
    # 1. BASELINE SCENARIO (Unchanged data)
    # -------------------------------------------------------------------------
    baseline_res = evaluate_component(component_inputs, inv_cfg)
    baseline_impact = compute_order_exposure_impact(
        as_of=as_of,
        horizon_days=inv_cfg.horizon_days,
        shortage_date=baseline_res.shortage_date,
        component_id=component_inputs.component_id,
        customer_orders=customer_orders,
        bom_by_product=bom_by_product,
        products_by_id=products_by_id,
    )
    baseline_scenario = _build_scenario_result(baseline_res, baseline_impact)

    # -------------------------------------------------------------------------
    # 2. DISRUPTED SCENARIO (Apply params to baseline inputs)
    # -------------------------------------------------------------------------
    disrupted_inputs = component_inputs

    # Apply on-hand adjustment
    if params.on_hand_delta != 0:
        disrupted_inputs = adjust_plant_on_hand(disrupted_inputs, params.on_hand_delta)

    # Apply demand scaling
    if params.demand_multiplier != 1.0:
        disrupted_inputs = scale_demand(disrupted_inputs, params.demand_multiplier)

    # Apply supplier delay to all counted inbound lines
    if params.supplier_delay_days > 0:
        disrupted_inputs = shift_all_inbound(disrupted_inputs, params.supplier_delay_days)

    disrupted_res = evaluate_component(disrupted_inputs, inv_cfg)
    disrupted_impact = compute_order_exposure_impact(
        as_of=as_of,
        horizon_days=inv_cfg.horizon_days,
        shortage_date=disrupted_res.shortage_date,
        component_id=component_inputs.component_id,
        customer_orders=customer_orders,
        bom_by_product=bom_by_product,
        products_by_id=products_by_id,
    )
    disrupted_scenario = _build_scenario_result(disrupted_res, disrupted_impact)

    # Determine target cutoff window from disrupted scenario
    target_cutoff: Optional[datetime.date] = None
    if disrupted_res.next_replenishment is not None:
        target_cutoff = disrupted_res.next_replenishment.date
    elif disrupted_res.shortage_episodes:
        target_cutoff = disrupted_res.shortage_episodes[0].end_date

    # -------------------------------------------------------------------------
    # 3. RECOVERED SCENARIO (Apply recovery engine to disrupted inputs)
    # -------------------------------------------------------------------------
    # If no shortage exists in disrupted scenario, recovered equals disrupted
    if (
        disrupted_res.shortage_date is None
        or disrupted_res.unmet_before_next_inbound is None
        or disrupted_res.unmet_before_next_inbound <= 0.0
        or disrupted_res.risk_level in ("low", "none", "unknown")
    ):
        recovered_scenario = _build_scenario_result(
            disrupted_res,
            disrupted_impact,
            applied_actions=[],
            recovery_note="No recovery action needed: no shortage projected in the disrupted scenario.",
            target_cutoff=target_cutoff,
            is_recovered=True,
        )
    else:
        # Prepare supplier offers based on alt_supplier_available parameter
        active_offers: List[SupplierOfferInput] = []
        if params.alt_supplier_available:
            active_offers = list(supplier_offers)
        else:
            # Find supplier code from earliest counted plant inbound PO line
            shortage_supplier: Optional[str] = None
            for line in disrupted_inputs.inbound_lines:
                if (
                    line.warehouse_role == "plant"
                    and line.po_status in ("open", "in_transit", "partially_received")
                    and (line.qty_ordered - line.qty_received) > 0
                ):
                    shortage_supplier = line.supplier_code
                    break
            # Retain only shortage supplier offers (e.g. expedite still possible, but no alternate offers)
            active_offers = [
                o for o in supplier_offers
                if shortage_supplier is not None and o.supplier_code == shortage_supplier
            ]

        # Evaluate recovery on disrupted state
        rec = evaluate_component_recovery(
            component_input=disrupted_inputs,
            baseline_result=disrupted_res,
            supplier_offers=active_offers,
            regional_stocks=regional_stocks,
            customer_orders=customer_orders,
            bom_by_product=bom_by_product,
            products_by_id=products_by_id,
            inventory_config=inv_cfg,
            recovery_config=rec_cfg,
        )

        if rec is None or not rec.recommended_option_id:
            recovered_scenario = _build_scenario_result(
                disrupted_res,
                disrupted_impact,
                applied_actions=[],
                recovery_note="No feasible recovery options available to mitigate the projected shortage.",
                target_cutoff=target_cutoff,
                is_recovered=True,
            )
        else:
            applied_actions: List[AppliedRecoveryAction] = []
            recovered_inputs = disrupted_inputs

            if rec.recommended_option_id == "combined_plan" and rec.combined_plan is not None:
                for step in rec.combined_plan.steps:
                    if step.kind == "transfer":
                        recovered_inputs = add_inbound(
                            recovered_inputs,
                            step.quantity,
                            step.arrival_date,
                            f"TRANS-{step.source_code}",
                        )
                    elif step.kind in ("expedite", "expedite_existing"):
                        po_num = (
                            step.option_id.split(".", 1)[1]
                            if step.option_id.startswith("expedite.")
                            else step.source_code
                        )
                        recovered_inputs = expedite_inbound(
                            recovered_inputs,
                            po_num,
                            step.arrival_date,
                        )
                    elif step.kind == "alternative_supplier":
                        recovered_inputs = add_inbound(
                            recovered_inputs,
                            step.quantity,
                            step.arrival_date,
                            f"PO-ALT-{step.source_code}",
                            supplier_code=step.source_code,
                        )

                    applied_actions.append(
                        AppliedRecoveryAction(
                            id=step.option_id,
                            kind=step.kind,
                            description=f"Combined plan step: {step.kind} {step.quantity} units from {step.source_code}",
                            source_code=step.source_code,
                            quantity=step.quantity,
                            arrival_date=step.arrival_date,
                            incremental_cost=step.incremental_cost,
                            cost_known=step.cost_known,
                        )
                    )
            elif rec.recommended_option_id == "accept_delay":
                recovered_inputs = disrupted_inputs
                applied_actions.append(
                    AppliedRecoveryAction(
                        id="accept_delay",
                        kind="accept_delay",
                        description="Accept delay; no recovery intervention applied.",
                        source_code=None,
                        quantity=0,
                        arrival_date=None,
                        incremental_cost=Decimal("0.00"),
                        cost_known=True,
                    )
                )
            else:
                # Single recommended option
                chosen_opt = next((o for o in rec.options if o.id == rec.recommended_option_id), None)
                if chosen_opt is not None:
                    applied_actions.append(
                        AppliedRecoveryAction(
                            id=chosen_opt.id,
                            kind=chosen_opt.kind,
                            description=chosen_opt.description,
                            source_code=chosen_opt.source_code,
                            quantity=chosen_opt.quantity,
                            arrival_date=chosen_opt.arrival_date,
                            incremental_cost=chosen_opt.incremental_cost,
                            cost_known=chosen_opt.cost_known,
                        )
                    )

                    if (
                        chosen_opt.kind in ("expedite", "expedite_existing")
                        and chosen_opt.arrival_date
                    ):
                        po_num = (
                            chosen_opt.id.split(".", 1)[1]
                            if chosen_opt.id.startswith("expedite.")
                            else chosen_opt.source_code
                        )
                        recovered_inputs = expedite_inbound(
                            recovered_inputs,
                            po_num,
                            chosen_opt.arrival_date,
                        )
                    elif (
                        chosen_opt.kind == "alternative_supplier"
                        and chosen_opt.arrival_date
                        and chosen_opt.source_code
                    ):
                        recovered_inputs = add_inbound(
                            recovered_inputs,
                            chosen_opt.quantity,
                            chosen_opt.arrival_date,
                            f"PO-ALT-{chosen_opt.source_code}",
                            supplier_code=chosen_opt.source_code,
                        )
                    elif chosen_opt.kind == "transfer" and chosen_opt.arrival_date and chosen_opt.source_code:
                        recovered_inputs = add_inbound(
                            recovered_inputs,
                            chosen_opt.quantity,
                            chosen_opt.arrival_date,
                            f"TRANS-{chosen_opt.source_code}",
                        )
                    elif chosen_opt.kind == "accept_delay":
                        recovered_inputs = disrupted_inputs

            # Re-evaluate component with recovered inputs applied
            recovered_res = evaluate_component(recovered_inputs, inv_cfg)
            recovered_impact = compute_order_exposure_impact(
                as_of=as_of,
                horizon_days=inv_cfg.horizon_days,
                shortage_date=recovered_res.shortage_date,
                component_id=component_inputs.component_id,
                customer_orders=customer_orders,
                bom_by_product=bom_by_product,
                products_by_id=products_by_id,
            )
            recovered_scenario = _build_scenario_result(
                recovered_res,
                recovered_impact,
                applied_actions=applied_actions,
                recovery_note=rec.reason,
                target_cutoff=target_cutoff,
                is_recovered=True,
            )

    what_changed = _build_what_changed(
        baseline_scenario,
        disrupted_scenario,
        recovered_scenario,
        params,
    )

    return SimulationResult(
        as_of=as_of,
        component_id=component_inputs.component_id,
        sku=component_inputs.sku,
        name=component_inputs.name,
        params=params,
        baseline=baseline_scenario,
        disrupted=disrupted_scenario,
        recovered=recovered_scenario,
        what_changed=what_changed,
        assumptions=list(SIMULATION_ASSUMPTIONS),
        note="What-if simulation. Nothing is saved and no orders are created.",
    )
