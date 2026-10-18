"""app/domain/recovery.py

Pure domain logic for supply-chain recovery recommendations.
Evaluates potential interventions (regional transfers, inbound expedites,
alternative suppliers, and delay acceptance) for components facing stockouts.

Zero dependencies on FastAPI, SQLAlchemy, or system wall clock.
Operates strictly over plain, frozen dataclasses with deterministic calculations.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import datetime
from decimal import Decimal
import math
from typing import Dict, List, Optional, Sequence, Tuple

from app.domain.inventory import (
    ComponentEvaluationInput,
    ComponentRiskResult,
    InboundLineInput,
    InventoryRiskConfig,
    RegionalStockItem,
    add_inbound,
    evaluate_component,
    expedite_inbound,
)
from app.domain.alerts import (
    AlertImpact,
    BomLineInput,
    CustomerOrderInput,
    MANDATORY_EXPOSURE_ASSUMPTION,
    ProductInput,
    compute_order_exposure_impact,
)


@dataclass(frozen=True)
class RecoveryConfig:
    """Configuration parameters and assumptions for recovery evaluation."""

    transfer_days: int = 2
    transfer_cost_per_unit: Optional[Decimal] = None

    def __post_init__(self) -> None:
        if self.transfer_days < 0:
            raise ValueError(f"transfer_days must be non-negative, got {self.transfer_days}")
        if self.transfer_cost_per_unit is not None and self.transfer_cost_per_unit < Decimal("0"):
            raise ValueError(
                f"transfer_cost_per_unit cannot be negative, got {self.transfer_cost_per_unit}"
            )


@dataclass(frozen=True)
class SupplierOfferInput:
    """Domain representation of a supplier procurement agreement for a component."""

    supplier_id: int
    supplier_code: str
    supplier_name: str
    component_id: int
    unit_cost: Decimal
    lead_time_days: int
    min_order_qty: int
    max_weekly_capacity: Optional[int]
    is_preferred: bool
    expedite_available: bool
    expedite_lead_time_days: Optional[int]
    expedite_cost_premium_pct: Optional[Decimal]


@dataclass(frozen=True)
class RecoveryOption:
    """A single evaluated recovery intervention option."""

    id: str
    kind: str  # "transfer" | "expedite_existing" | "alternative_supplier" | "accept_delay"
    description: str
    source_code: Optional[str]
    source_name: Optional[str]
    quantity: int
    arrival_date: Optional[datetime.date]
    arrival_within_time: bool
    incremental_cost: Optional[Decimal]
    cost_known: bool
    unit_premium_vs_shortage_supplier: Optional[Decimal]
    residual_unmet_before_next_inbound: float
    new_shortage_date: Optional[datetime.date]
    remaining_total_unmet: float
    constraints_applied: List[str]
    assumptions: List[str]
    flags: List[str]
    feasible: bool
    infeasible_reason: Optional[str]
    impact: Optional[AlertImpact] = None


@dataclass(frozen=True)
class CombinedPlanStep:
    """Individual step within a combined recovery plan."""

    option_id: str
    kind: str
    source_code: str
    source_name: str
    quantity: int
    arrival_date: Optional[datetime.date]
    incremental_cost: Optional[Decimal]
    cost_known: bool


@dataclass(frozen=True)
class CombinedPlan:
    """Greedy combination of multiple recovery options when no single option reaches residual 0."""

    id: str = "combined_plan"
    description: str = "Combined multi-action recovery plan"
    steps: List[CombinedPlanStep] = field(default_factory=list)
    total_quantity: int = 0
    total_known_cost: Optional[Decimal] = None
    unknown_cost_steps: int = 0
    residual_unmet_before_next_inbound: float = 0.0
    new_shortage_date: Optional[datetime.date] = None
    remaining_total_unmet: float = 0.0
    feasible: bool = True


@dataclass(frozen=True)
class ComponentRecoveryRecommendation:
    """Comprehensive recovery recommendations for a component facing inventory shortage."""

    component_id: int
    sku: str
    name: str
    risk_level: str
    baseline_shortage_date: datetime.date
    baseline_unmet_before_next_inbound: float
    need_units: int
    baseline_summary: str
    options: List[RecoveryOption]
    combined_plan: Optional[CombinedPlan]
    recommended_option_id: str
    recommended_option_kind: str
    reason: str
    alternatives_note: str
    later_shortage_note: Optional[str]


def _extract_residual_unmet(
    mod_res: ComponentRiskResult,
    target_cutoff: Optional[datetime.date],
) -> float:
    """Extracts residual unmet demand for the targeted shortage window.

    If an intervention completely covers or delays the shortage to or past the
    next scheduled inbound replenishment date, residual unmet demand for this
    shortage window is 0.0. Later shortage episodes are not covered by this recommendation.
    """
    if mod_res.shortage_date is None:
        return 0.0
    if target_cutoff is not None and mod_res.shortage_date >= target_cutoff:
        return 0.0
    return mod_res.unmet_before_next_inbound or 0.0


def evaluate_component_recovery(
    component_input: ComponentEvaluationInput,
    baseline_result: ComponentRiskResult,
    supplier_offers: Sequence[SupplierOfferInput],
    regional_stocks: Sequence[RegionalStockItem],
    customer_orders: Sequence[CustomerOrderInput],
    bom_by_product: Dict[int, Dict[int, int]],
    products_by_id: Dict[int, ProductInput],
    inventory_config: InventoryRiskConfig,
    recovery_config: RecoveryConfig,
) -> Optional[ComponentRecoveryRecommendation]:
    """Pure domain evaluation of recovery options for a single component.

    Returns None if component does not have a projected shortage.
    """
    # Target validation: need_units = unmet_before_next_inbound of baseline rounded up
    if (
        baseline_result.shortage_date is None
        or baseline_result.unmet_before_next_inbound is None
        or baseline_result.unmet_before_next_inbound <= 0.0
        or baseline_result.risk_level in ("low", "none", "unknown")
    ):
        return None

    as_of = component_input.as_of
    shortage_date = baseline_result.shortage_date
    raw_unmet = baseline_result.unmet_before_next_inbound
    need_units = math.ceil(raw_unmet)
    target_cutoff: Optional[datetime.date] = (
        baseline_result.next_replenishment.date
        if baseline_result.next_replenishment is not None
        else None
    )

    # Later shortage note
    later_shortage_note: Optional[str] = None
    if len(baseline_result.shortage_episodes) > 1:
        ep2 = baseline_result.shortage_episodes[1]
        later_shortage_note = (
            f"Later shortage episode begins {ep2.start_date.isoformat()} "
            f"({ep2.unmet_units:.1f} units over {ep2.days} days); not covered by this recommendation."
        )

    # Identify shortage supplier from earliest counted inbound PO line if present
    shortage_inbound_line: Optional[InboundLineInput] = None
    shortage_supplier_code: Optional[str] = None
    counted_inbounds = [
        line
        for line in component_input.inbound_lines
        if line.warehouse_role == "plant"
        and line.po_status in ("open", "in_transit", "partially_received")
        and (line.qty_ordered - line.qty_received) > 0
    ]
    if counted_inbounds:
        sorted_inbounds = sorted(
            counted_inbounds,
            key=lambda l: (l.latest_estimate_date or l.promised_date, -(l.qty_ordered - l.qty_received)),
        )
        shortage_inbound_line = sorted_inbounds[0]
        shortage_supplier_code = shortage_inbound_line.supplier_code

    # Shortage supplier offer
    shortage_supplier_unit_cost: Optional[Decimal] = None
    if shortage_supplier_code:
        for offer in supplier_offers:
            if offer.supplier_code == shortage_supplier_code:
                shortage_supplier_unit_cost = offer.unit_cost
                break

    options: List[RecoveryOption] = []

    # -------------------------------------------------------------------------
    # 1. OPTION KIND: expedite_existing
    # -------------------------------------------------------------------------
    if shortage_inbound_line is not None and shortage_inbound_line.supplier_code:
        matching_offer: Optional[SupplierOfferInput] = None
        for offer in supplier_offers:
            if offer.supplier_code == shortage_inbound_line.supplier_code:
                matching_offer = offer
                break

        current_exp_date = shortage_inbound_line.latest_estimate_date or shortage_inbound_line.promised_date
        rem_qty = shortage_inbound_line.qty_ordered - shortage_inbound_line.qty_received

        if matching_offer and matching_offer.expedite_available and matching_offer.expedite_lead_time_days is not None:
            new_arrival = as_of + datetime.timedelta(days=matching_offer.expedite_lead_time_days)
            is_earlier = new_arrival < current_exp_date

            constraints: List[str] = [
                f"Expedites existing purchase order {shortage_inbound_line.po_number} "
                f"with {matching_offer.supplier_name}."
            ]
            assumptions: List[str] = [
                f"Supplier expedite lead time is {matching_offer.expedite_lead_time_days} days from as-of date.",
                "Expedited supply is available at start of arrival day.",
            ]
            flags: List[str] = []

            cost_known = True
            incremental_cost: Optional[Decimal] = None
            if matching_offer.expedite_cost_premium_pct is not None:
                incremental_cost = (
                    Decimal(str(rem_qty)) * matching_offer.unit_cost * matching_offer.expedite_cost_premium_pct
                )
                constraints.append(
                    f"Cost premium applied: {matching_offer.expedite_cost_premium_pct * Decimal('100'):.1f}% "
                    f"over base unit cost of ${matching_offer.unit_cost}."
                )
            else:
                cost_known = False
                flags.append("expedite_premium_unknown")
                assumptions.append("Supplier expedite premium percentage is unknown (None).")

            if is_earlier:
                feasible = True
                infeasible_reason = None
                expedited_inputs = expedite_inbound(component_input, shortage_inbound_line.po_number, new_arrival)
                mod_res = evaluate_component(expedited_inputs, inventory_config)
                residual = _extract_residual_unmet(mod_res, target_cutoff)
                new_shortage = mod_res.shortage_date
                tot_unmet = mod_res.unmet_demand_units
            else:
                feasible = False
                infeasible_reason = (
                    f"Expedited arrival date ({new_arrival.isoformat()}) is not earlier than "
                    f"currently scheduled date ({current_exp_date.isoformat()})."
                )
                residual = raw_unmet
                new_shortage = shortage_date
                tot_unmet = baseline_result.unmet_demand_units

            options.append(
                RecoveryOption(
                    id=f"expedite.{shortage_inbound_line.po_number}",
                    kind="expedite_existing",
                    description=(
                        f"Expedite PO {shortage_inbound_line.po_number} from {matching_offer.supplier_code} "
                        f"to arrive on {new_arrival.isoformat()} ({rem_qty} units)."
                    ),
                    source_code=matching_offer.supplier_code,
                    source_name=matching_offer.supplier_name,
                    quantity=rem_qty,
                    arrival_date=new_arrival,
                    arrival_within_time=(new_arrival <= shortage_date),
                    incremental_cost=incremental_cost,
                    cost_known=cost_known,
                    unit_premium_vs_shortage_supplier=Decimal("0.00"),
                    residual_unmet_before_next_inbound=residual,
                    new_shortage_date=new_shortage,
                    remaining_total_unmet=tot_unmet,
                    constraints_applied=constraints,
                    assumptions=assumptions,
                    flags=flags,
                    feasible=feasible,
                    infeasible_reason=infeasible_reason,
                )
            )

    # -------------------------------------------------------------------------
    # 2. OPTION KIND: alternative_supplier
    # -------------------------------------------------------------------------
    for offer in supplier_offers:
        # Exclude the shortage supplier
        if shortage_supplier_code and offer.supplier_code == shortage_supplier_code:
            continue

        target_qty = max(need_units, offer.min_order_qty)
        arrival_date = as_of + datetime.timedelta(days=offer.lead_time_days)
        arrival_within_time = arrival_date <= shortage_date

        constraints = [
            f"Procure from alternative supplier {offer.supplier_code} ({offer.supplier_name}).",
            f"Standard procurement lead time: {offer.lead_time_days} days.",
        ]
        assumptions = [
            "Order would be placed immediately on snapshot date.",
            "Receipts are available at the start of the arrival day.",
        ]
        flags = []

        # Capacity check
        feasible = True
        infeasible_reason = None
        order_qty = target_qty

        if offer.max_weekly_capacity is not None:
            if offer.max_weekly_capacity < offer.min_order_qty or offer.max_weekly_capacity <= 0:
                feasible = False
                infeasible_reason = (
                    f"Supplier weekly capacity ({offer.max_weekly_capacity}) is less than "
                    f"minimum order quantity ({offer.min_order_qty})."
                )
                order_qty = 0
            elif target_qty > offer.max_weekly_capacity:
                order_qty = offer.max_weekly_capacity
                flags.append("capped_at_max_weekly_capacity")
                constraints.append(
                    f"Order quantity capped at supplier's declared maximum weekly capacity of {offer.max_weekly_capacity} units."
                )
        else:
            flags.append("capacity_unknown_assumed_available")
            assumptions.append("Supplier weekly capacity is unstated (null); full order quantity assumed available.")

        if offer.min_order_qty > need_units and feasible:
            constraints.append(
                f"Order quantity increased from needed {need_units} to meet supplier MOQ of {offer.min_order_qty} units."
            )

        # Unit premium vs shortage supplier
        unit_premium: Optional[Decimal] = None
        if shortage_supplier_unit_cost is not None:
            unit_premium = offer.unit_cost - shortage_supplier_unit_cost

        cost: Optional[Decimal] = None
        if feasible and order_qty > 0:
            cost = Decimal(str(order_qty)) * offer.unit_cost
            mod_input = add_inbound(
                component_input,
                order_qty,
                arrival_date,
                f"PO-REC-ALT-{offer.supplier_code}",
                offer.supplier_code,
            )
            mod_res = evaluate_component(mod_input, inventory_config)
            residual = _extract_residual_unmet(mod_res, target_cutoff)
            new_shortage = mod_res.shortage_date
            tot_unmet = mod_res.unmet_demand_units
        else:
            residual = raw_unmet
            new_shortage = shortage_date
            tot_unmet = baseline_result.unmet_demand_units

        options.append(
            RecoveryOption(
                id=f"alt_supplier.{offer.supplier_code}",
                kind="alternative_supplier",
                description=(
                    f"Place order of {order_qty} units with {offer.supplier_code} ({offer.supplier_name}) "
                    f"arriving {arrival_date.isoformat()}."
                ),
                source_code=offer.supplier_code,
                source_name=offer.supplier_name,
                quantity=order_qty,
                arrival_date=arrival_date,
                arrival_within_time=arrival_within_time,
                incremental_cost=cost,
                cost_known=True if cost is not None else False,
                unit_premium_vs_shortage_supplier=unit_premium,
                residual_unmet_before_next_inbound=residual,
                new_shortage_date=new_shortage,
                remaining_total_unmet=tot_unmet,
                constraints_applied=constraints,
                assumptions=assumptions,
                flags=flags,
                feasible=feasible,
                infeasible_reason=infeasible_reason,
            )
        )

    # -------------------------------------------------------------------------
    # 3. OPTION KIND: transfer
    # -------------------------------------------------------------------------
    for reg_wh in regional_stocks:
        arrival_date = as_of + datetime.timedelta(days=recovery_config.transfer_days)
        arrival_within_time = arrival_date <= shortage_date

        constraints = [
            f"Inter-warehouse transfer from {reg_wh.warehouse_code} ({reg_wh.warehouse_name}) to plant.",
            f"Transfer duration assumption: {recovery_config.transfer_days} days.",
        ]
        assumptions = [
            "Assumes inter-warehouse freight lane is operational.",
            "Transfer stock arrives and becomes usable at start of arrival day.",
        ]
        flags = []

        if reg_wh.usable <= 0:
            feasible = False
            infeasible_reason = f"Warehouse {reg_wh.warehouse_code} has zero usable inventory."
            xfer_qty = 0
            cost = None
            cost_known = False
            residual = raw_unmet
            new_shortage = shortage_date
            tot_unmet = baseline_result.unmet_demand_units
        else:
            feasible = True
            infeasible_reason = None
            xfer_qty = min(reg_wh.usable, need_units)
            if xfer_qty < need_units:
                constraints.append(
                    f"Transfer quantity limited to available usable stock of {reg_wh.usable} units at {reg_wh.warehouse_code}."
                )

            if recovery_config.transfer_cost_per_unit is not None:
                cost = Decimal(str(xfer_qty)) * recovery_config.transfer_cost_per_unit
                cost_known = True
            else:
                cost = None
                cost_known = False
                flags.append("transfer_cost_unknown")
                assumptions.append("Transfer cost per unit is unconfigured (None); financial impact is unknown.")

            mod_input = add_inbound(
                component_input,
                xfer_qty,
                arrival_date,
                f"TR-{reg_wh.warehouse_code}",
                None,
            )
            mod_res = evaluate_component(mod_input, inventory_config)
            residual = _extract_residual_unmet(mod_res, target_cutoff)
            new_shortage = mod_res.shortage_date
            tot_unmet = mod_res.unmet_demand_units

        options.append(
            RecoveryOption(
                id=f"transfer.{reg_wh.warehouse_code}",
                kind="transfer",
                description=(
                    f"Transfer {xfer_qty} units from regional hub {reg_wh.warehouse_code} "
                    f"arriving {arrival_date.isoformat()}."
                ),
                source_code=reg_wh.warehouse_code,
                source_name=reg_wh.warehouse_name,
                quantity=xfer_qty,
                arrival_date=arrival_date,
                arrival_within_time=arrival_within_time,
                incremental_cost=cost,
                cost_known=cost_known,
                unit_premium_vs_shortage_supplier=None,
                residual_unmet_before_next_inbound=residual,
                new_shortage_date=new_shortage,
                remaining_total_unmet=tot_unmet,
                constraints_applied=constraints,
                assumptions=assumptions,
                flags=flags,
                feasible=feasible,
                infeasible_reason=infeasible_reason,
            )
        )

    # -------------------------------------------------------------------------
    # 4. OPTION KIND: accept_delay
    # -------------------------------------------------------------------------
    accept_impact = compute_order_exposure_impact(
        as_of=as_of,
        horizon_days=inventory_config.horizon_days,
        shortage_date=shortage_date,
        component_id=component_input.component_id,
        customer_orders=customer_orders,
        bom_by_product=bom_by_product,
        products_by_id=products_by_id,
    )

    options.append(
        RecoveryOption(
            id="accept_delay",
            kind="accept_delay",
            description="Take no recovery action; accept projected shortage and absorb supplier delivery schedule.",
            source_code=None,
            source_name=None,
            quantity=0,
            arrival_date=None,
            arrival_within_time=False,
            incremental_cost=Decimal("0.00"),
            cost_known=True,
            unit_premium_vs_shortage_supplier=None,
            residual_unmet_before_next_inbound=raw_unmet,
            new_shortage_date=shortage_date,
            remaining_total_unmet=baseline_result.unmet_demand_units,
            constraints_applied=["No procurement or transfer intervention applied."],
            assumptions=[
                "Assumes plant absorbs shortage delay without expedited replenishment.",
                MANDATORY_EXPOSURE_ASSUMPTION,
            ],
            flags=[],
            feasible=True,
            infeasible_reason=None,
            impact=accept_impact,
        )
    )

    # -------------------------------------------------------------------------
    # 5. COMBINED PLAN
    # Build ONE greedy plan if no single feasible option reaches residual 0.0
    # -------------------------------------------------------------------------
    has_zero_residual = any(opt.feasible and opt.residual_unmet_before_next_inbound <= 0.0 for opt in options)
    combined_plan: Optional[CombinedPlan] = None

    if not has_zero_residual:
        plan_steps: List[CombinedPlanStep] = []
        curr_input = component_input
        rem_need = need_units

        # Step 1: Transfers (known cost first, then by warehouse_code)
        valid_transfers = [
            opt for opt in options if opt.kind == "transfer" and opt.feasible and opt.quantity > 0
        ]
        sorted_transfers = sorted(
            valid_transfers,
            key=lambda o: (0 if o.cost_known else 1, o.source_code or ""),
        )
        for t_opt in sorted_transfers:
            if rem_need <= 0:
                break
            take_qty = min(t_opt.quantity, rem_need)
            if take_qty <= 0:
                continue
            curr_input = add_inbound(
                curr_input,
                take_qty,
                t_opt.arrival_date or as_of,
                f"TR-COMBINED-{t_opt.source_code}",
                None,
            )
            step_cost = (
                Decimal(str(take_qty)) * recovery_config.transfer_cost_per_unit
                if recovery_config.transfer_cost_per_unit is not None
                else None
            )
            plan_steps.append(
                CombinedPlanStep(
                    option_id=t_opt.id,
                    kind="transfer",
                    source_code=t_opt.source_code or "",
                    source_name=t_opt.source_name or "",
                    quantity=take_qty,
                    arrival_date=t_opt.arrival_date,
                    incremental_cost=step_cost,
                    cost_known=t_opt.cost_known,
                )
            )
            rem_need -= take_qty

        # Step 2: Expedite (if still needed)
        if rem_need > 0:
            exp_opts = [opt for opt in options if opt.kind == "expedite_existing" and opt.feasible]
            if exp_opts:
                exp_opt = exp_opts[0]
                if shortage_inbound_line is not None and exp_opt.arrival_date:
                    curr_input = expedite_inbound(
                        curr_input,
                        shortage_inbound_line.po_number,
                        exp_opt.arrival_date,
                    )
                    plan_steps.append(
                        CombinedPlanStep(
                            option_id=exp_opt.id,
                            kind="expedite_existing",
                            source_code=exp_opt.source_code or "",
                            source_name=exp_opt.source_name or "",
                            quantity=exp_opt.quantity,
                            arrival_date=exp_opt.arrival_date,
                            incremental_cost=exp_opt.incremental_cost,
                            cost_known=exp_opt.cost_known,
                        )
                    )
                    # Check updated residual
                    tmp_res = evaluate_component(curr_input, inventory_config)
                    rem_need = math.ceil(_extract_residual_unmet(tmp_res, target_cutoff))

        # Step 3: Alternative supplier (if still needed)
        if rem_need > 0:
            alt_opts = [opt for opt in options if opt.kind == "alternative_supplier" and opt.feasible]
            sorted_alts = sorted(alt_opts, key=lambda o: (o.incremental_cost or Decimal("999999999")))
            for a_opt in sorted_alts:
                if rem_need <= 0:
                    break
                offer = next(o for o in supplier_offers if o.supplier_code == a_opt.source_code)
                take_qty = max(rem_need, offer.min_order_qty)
                if offer.max_weekly_capacity is not None:
                    take_qty = min(take_qty, offer.max_weekly_capacity)
                if take_qty <= 0:
                    continue
                curr_input = add_inbound(
                    curr_input,
                    take_qty,
                    a_opt.arrival_date or as_of,
                    f"PO-REC-COMBINED-{offer.supplier_code}",
                    offer.supplier_code,
                )
                step_cost = Decimal(str(take_qty)) * offer.unit_cost
                plan_steps.append(
                    CombinedPlanStep(
                        option_id=a_opt.id,
                        kind="alternative_supplier",
                        source_code=a_opt.source_code or "",
                        source_name=a_opt.source_name or "",
                        quantity=take_qty,
                        arrival_date=a_opt.arrival_date,
                        incremental_cost=step_cost,
                        cost_known=True,
                    )
                )
                tmp_res = evaluate_component(curr_input, inventory_config)
                rem_need = math.ceil(_extract_residual_unmet(tmp_res, target_cutoff))

        if plan_steps:
            comb_res = evaluate_component(curr_input, inventory_config)
            tot_qty = sum(s.quantity for s in plan_steps)
            known_costs = [s.incremental_cost for s in plan_steps if s.cost_known and s.incremental_cost is not None]
            tot_cost = sum(known_costs, Decimal("0.00")) if known_costs else Decimal("0.00")
            unknown_count = sum(1 for s in plan_steps if not s.cost_known)
            combined_plan = CombinedPlan(
                id="combined_plan",
                description=(
                    f"Multi-source recovery plan combining {len(plan_steps)} action(s) totaling {tot_qty} units."
                ),
                steps=plan_steps,
                total_quantity=tot_qty,
                total_known_cost=tot_cost if unknown_count == 0 else None,
                unknown_cost_steps=unknown_count,
                residual_unmet_before_next_inbound=_extract_residual_unmet(comb_res, target_cutoff),
                new_shortage_date=comb_res.shortage_date,
                remaining_total_unmet=comb_res.unmet_demand_units,
                feasible=True,
            )

    # -------------------------------------------------------------------------
    # 6. RECOMMENDATION SELECTION RULE
    # Among feasible options (and combined plan if present):
    # 1. Smallest residual_unmet_before_next_inbound
    # 2. Lowest known incremental cost (known cost sorts before unknown cost)
    # 3. Earliest arrival_date (None sorts last)
    # 4. Deterministic option ID
    # -------------------------------------------------------------------------
    candidate_pool: List[Tuple[str, float, int, Decimal, datetime.date, str]] = []
    # Entry tuple: (opt_id, residual, cost_known_flag (0=known, 1=unknown), cost_value, arrival_date_sort, opt_id)

    far_future = datetime.date(2099, 12, 31)

    for opt in options:
        if not opt.feasible:
            continue
        c_known = 0 if opt.cost_known and opt.incremental_cost is not None else 1
        c_val = opt.incremental_cost if (opt.cost_known and opt.incremental_cost is not None) else Decimal("999999999")
        arr_val = opt.arrival_date if opt.arrival_date is not None else far_future
        candidate_pool.append((opt.id, opt.residual_unmet_before_next_inbound, c_known, c_val, arr_val, opt.id))

    if combined_plan is not None and combined_plan.feasible:
        c_known = 0 if combined_plan.unknown_cost_steps == 0 and combined_plan.total_known_cost is not None else 1
        c_val = (
            combined_plan.total_known_cost
            if (combined_plan.unknown_cost_steps == 0 and combined_plan.total_known_cost is not None)
            else Decimal("999999999")
        )
        arr_val = min(s.arrival_date for s in combined_plan.steps if s.arrival_date) if combined_plan.steps else far_future
        candidate_pool.append((combined_plan.id, combined_plan.residual_unmet_before_next_inbound, c_known, c_val, arr_val, combined_plan.id))

    candidate_pool.sort(key=lambda item: (item[1], item[2], item[3], item[4], item[5]))
    recommended_id = candidate_pool[0][0] if candidate_pool else "accept_delay"

    # Find recommended item details
    recommended_kind = "accept_delay"
    rec_residual = raw_unmet
    rec_cost: Optional[Decimal] = None
    rec_desc = ""

    if recommended_id == "combined_plan" and combined_plan is not None:
        recommended_kind = "combined_plan"
        rec_residual = combined_plan.residual_unmet_before_next_inbound
        rec_cost = combined_plan.total_known_cost
        rec_desc = combined_plan.description
    else:
        for opt in options:
            if opt.id == recommended_id:
                recommended_kind = opt.kind
                rec_residual = opt.residual_unmet_before_next_inbound
                rec_cost = opt.incremental_cost
                rec_desc = opt.description
                break

    # Runner-up comparison for reason statement
    runner_up_id: Optional[str] = None
    runner_up_desc: Optional[str] = None
    for cand in candidate_pool:
        if cand[0] != recommended_id:
            runner_up_id = cand[0]
            if runner_up_id == "combined_plan" and combined_plan is not None:
                runner_up_desc = combined_plan.description
            else:
                for opt in options:
                    if opt.id == runner_up_id:
                        runner_up_desc = opt.description
                        break
            break

    # Build reasoned explanation
    if rec_residual <= 0.0:
        residual_text = f"Eliminates 100% of the {raw_unmet:.1f} units unmet demand before the next inbound replenishment."
    else:
        residual_text = (
            f"Reduces unmet demand before next inbound from {raw_unmet:.1f} to {rec_residual:.1f} units "
            f"({(raw_unmet - rec_residual):.1f} units covered)."
        )

    cost_text = f"Incremental cost: ${rec_cost:,.2f}." if rec_cost is not None else "Incremental cost is unknown."

    if runner_up_id:
        reason = (
            f"Recommended '{recommended_id}' because it achieves the lowest residual unmet demand ({rec_residual:.1f} units) "
            f"at the lowest known cost. Preferred over runner-up '{runner_up_id}' ({runner_up_desc}). {residual_text} {cost_text}"
        )
        alternatives_note = f"Runner-up option is '{runner_up_id}'. Evaluated {len(candidate_pool)} feasible candidate option(s)."
    else:
        reason = (
            f"Recommended '{recommended_id}' as the primary feasible recovery path. {residual_text} {cost_text}"
        )
        alternatives_note = "No other feasible candidate options available."

    baseline_summary = (
        f"Component {component_input.sku} faces a projected shortage starting {shortage_date.isoformat()} "
        f"with {raw_unmet:.1f} units unmet before the next scheduled inbound receipt."
    )

    return ComponentRecoveryRecommendation(
        component_id=component_input.component_id,
        sku=component_input.sku,
        name=component_input.name,
        risk_level=baseline_result.risk_level,
        baseline_shortage_date=shortage_date,
        baseline_unmet_before_next_inbound=raw_unmet,
        need_units=need_units,
        baseline_summary=baseline_summary,
        options=options,
        combined_plan=combined_plan,
        recommended_option_id=recommended_id,
        recommended_option_kind=recommended_kind,
        reason=reason,
        alternatives_note=alternatives_note,
        later_shortage_note=later_shortage_note,
    )
