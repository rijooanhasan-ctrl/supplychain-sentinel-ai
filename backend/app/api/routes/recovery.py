"""app/api/routes/recovery.py

Read-only API endpoints for supply-chain recovery recommendations.
GET /api/recommendations
"""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.alerts import (
    AlertImpactDetailSchema,
    ExposedCustomerOrderSchema,
)
from app.schemas.recovery import (
    CombinedPlanSchema,
    CombinedPlanStepSchema,
    ComponentRecoveryRecommendationSchema,
    RecommendationsResponse,
    RecoveryConfigSchema,
    RecoveryOptionSchema,
)
from app.services.recovery import compute_recovery_recommendations

router = APIRouter(prefix="/recommendations", tags=["Recovery Recommendations"])


@router.get("", response_model=RecommendationsResponse)
def list_recovery_recommendations(
    component_id: Optional[int] = Query(None, description="Filter recommendations by component ID"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RecommendationsResponse:
    """Returns evaluated recovery interventions (transfers, expedites, alternative suppliers)

    for components facing projected inventory shortages within the planning horizon.
    Decision-support only; never creates or executes real orders.
    """
    res = compute_recovery_recommendations(db, settings, component_id=component_id)
    if res is None:
        return RecommendationsResponse(
            seeded=False,
            as_of=None,
            config=RecoveryConfigSchema(
                transfer_days=settings.RECOVERY_TRANSFER_DAYS,
                transfer_cost_per_unit=(
                    f"{settings.RECOVERY_TRANSFER_COST_PER_UNIT:.2f}"
                    if settings.RECOVERY_TRANSFER_COST_PER_UNIT is not None
                    else None
                ),
            ),
            items=[],
            total=0,
            note="Decision support only. No orders are created.",
        )

    as_of, rec_config, rec_items = res

    config_schema = RecoveryConfigSchema(
        transfer_days=rec_config.transfer_days,
        transfer_cost_per_unit=(
            f"{rec_config.transfer_cost_per_unit:.2f}"
            if rec_config.transfer_cost_per_unit is not None
            else None
        ),
    )

    items_schema = []
    for item in rec_items:
        options_schema = []
        for opt in item.options:
            impact_schema = None
            if opt.impact is not None:
                orders_list = [
                    ExposedCustomerOrderSchema(
                        order_number=o.order_number,
                        customer_name=o.customer_name,
                        product_sku=o.product_sku,
                        product_name=o.product_name,
                        quantity=o.quantity,
                        due_date=o.due_date,
                        priority=o.priority,
                        component_units_required=o.component_units_required,
                    )
                    for o in opt.impact.exposed_orders
                ]
                impact_schema = AlertImpactDetailSchema(
                    orders_count=opt.impact.orders_count,
                    count_by_priority=dict(opt.impact.count_by_priority),
                    total_component_units_required=opt.impact.total_component_units_required,
                    exposed_revenue=f"{opt.impact.exposed_revenue:.2f}",
                    exposed_orders=orders_list,
                )

            options_schema.append(
                RecoveryOptionSchema(
                    id=opt.id,
                    kind=opt.kind,
                    description=opt.description,
                    source_code=opt.source_code,
                    source_name=opt.source_name,
                    quantity=opt.quantity,
                    arrival_date=opt.arrival_date,
                    arrival_within_time=opt.arrival_within_time,
                    incremental_cost=f"{opt.incremental_cost:.2f}" if opt.incremental_cost is not None else None,
                    cost_known=opt.cost_known,
                    unit_premium_vs_shortage_supplier=(
                        f"{opt.unit_premium_vs_shortage_supplier:.2f}"
                        if opt.unit_premium_vs_shortage_supplier is not None
                        else None
                    ),
                    residual_unmet_before_next_inbound=opt.residual_unmet_before_next_inbound,
                    new_shortage_date=opt.new_shortage_date,
                    remaining_total_unmet=opt.remaining_total_unmet,
                    constraints_applied=list(opt.constraints_applied),
                    assumptions=list(opt.assumptions),
                    flags=list(opt.flags),
                    feasible=opt.feasible,
                    infeasible_reason=opt.infeasible_reason,
                    impact=impact_schema,
                )
            )

        comb_plan_schema = None
        if item.combined_plan is not None:
            comb_steps_schema = [
                CombinedPlanStepSchema(
                    option_id=s.option_id,
                    kind=s.kind,
                    source_code=s.source_code,
                    source_name=s.source_name,
                    quantity=s.quantity,
                    arrival_date=s.arrival_date,
                    incremental_cost=f"{s.incremental_cost:.2f}" if s.incremental_cost is not None else None,
                    cost_known=s.cost_known,
                )
                for s in item.combined_plan.steps
            ]
            comb_plan_schema = CombinedPlanSchema(
                id=item.combined_plan.id,
                description=item.combined_plan.description,
                steps=comb_steps_schema,
                total_quantity=item.combined_plan.total_quantity,
                total_known_cost=(
                    f"{item.combined_plan.total_known_cost:.2f}"
                    if item.combined_plan.total_known_cost is not None
                    else None
                ),
                unknown_cost_steps=item.combined_plan.unknown_cost_steps,
                residual_unmet_before_next_inbound=item.combined_plan.residual_unmet_before_next_inbound,
                new_shortage_date=item.combined_plan.new_shortage_date,
                remaining_total_unmet=item.combined_plan.remaining_total_unmet,
                feasible=item.combined_plan.feasible,
            )

        items_schema.append(
            ComponentRecoveryRecommendationSchema(
                component_id=item.component_id,
                sku=item.sku,
                name=item.name,
                risk_level=item.risk_level,
                baseline_shortage_date=item.baseline_shortage_date,
                baseline_unmet_before_next_inbound=item.baseline_unmet_before_next_inbound,
                need_units=item.need_units,
                baseline_summary=item.baseline_summary,
                options=options_schema,
                combined_plan=comb_plan_schema,
                recommended_option_id=item.recommended_option_id,
                recommended_option_kind=item.recommended_option_kind,
                reason=item.reason,
                alternatives_note=item.alternatives_note,
                later_shortage_note=item.later_shortage_note,
            )
        )

    return RecommendationsResponse(
        seeded=True,
        as_of=as_of,
        config=config_schema,
        items=items_schema,
        total=len(items_schema),
        note="Decision support only. No orders are created.",
    )
