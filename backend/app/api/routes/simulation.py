"""app/api/routes/simulation.py

Read-only API endpoints for What-If Supply Chain Disruption Simulation.
GET /api/simulation
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.domain.simulation import (
    AppliedRecoveryAction,
    ScenarioResult,
    SimulationDailyProjectionItem,
    SimulationParams,
    SimulationResult,
)
from app.schemas.simulation import (
    AppliedRecoveryActionSchema,
    ComponentBriefSchema,
    InboundSummarySchema,
    ScenarioResultSchema,
    ShortageEpisodeSummarySchema,
    SimulationDailyProjectionItemSchema,
    SimulationParamsSchema,
    SimulationResponse,
)
from app.services.simulation import (
    ComponentNotFoundError,
    InvalidOnHandAdjustmentError,
    run_component_simulation,
)

router = APIRouter(prefix="/simulation", tags=["Simulation"])


def _to_scenario_schema(scenario: ScenarioResult) -> ScenarioResultSchema:
    """Helper to convert domain ScenarioResult into ScenarioResultSchema."""
    first_ep = None
    if scenario.first_shortage_episode is not None:
        first_ep = ShortageEpisodeSummarySchema(
            start_date=scenario.first_shortage_episode.start_date,
            end_date=scenario.first_shortage_episode.end_date,
            days=scenario.first_shortage_episode.days,
            unmet_units=scenario.first_shortage_episode.unmet_units,
        )

    next_inb = None
    if scenario.next_inbound is not None:
        next_inb = InboundSummarySchema(
            date=scenario.next_inbound.date,
            qty=scenario.next_inbound.qty,
            po_number=scenario.next_inbound.po_number,
            date_basis=scenario.next_inbound.date_basis,
        )

    proj = [
        SimulationDailyProjectionItemSchema(
            day_index=d.day_index,
            date=d.date,
            forecast_demand=d.forecast_demand,
            receipts=d.receipts,
            ending_balance=d.ending_balance,
            unmet=d.unmet,
        )
        for d in scenario.daily_projection_30d
    ]

    actions = [
        AppliedRecoveryActionSchema(
            id=a.id,
            kind=a.kind,
            description=a.description,
            source_code=a.source_code,
            quantity=a.quantity,
            arrival_date=a.arrival_date,
            incremental_cost=f"{a.incremental_cost:.2f}" if a.incremental_cost is not None else None,
            cost_known=a.cost_known,
        )
        for a in scenario.applied_actions
    ]

    return ScenarioResultSchema(
        risk_level=scenario.risk_level,
        shortage_date=scenario.shortage_date,
        days_until_shortage=scenario.days_until_shortage,
        first_shortage_episode=first_ep,
        unmet_before_next_inbound=scenario.unmet_before_next_inbound,
        later_episodes_note=scenario.later_episodes_note,
        next_inbound=next_inb,
        mean_daily_demand=scenario.mean_daily_demand,
        plant_usable_stock=scenario.plant_usable_stock,
        daily_projection_30d=proj,
        exposed_orders_count=scenario.exposed_orders_count,
        exposed_revenue=f"{scenario.exposed_revenue:.2f}" if scenario.exposed_revenue is not None else None,
        exposed_orders_summary=scenario.exposed_orders_summary,
        applied_actions=actions,
        recovery_note=scenario.recovery_note,
    )


@router.get("", response_model=SimulationResponse)
def simulate_disruption(
    component_id: int = Query(..., description="ID of the component to simulate"),
    supplier_delay_days: int = Query(0, ge=0, le=60, description="Supplier delay in calendar days (0..60)"),
    demand_multiplier: float = Query(1.0, ge=0.5, le=3.0, description="Demand multiplier scaling lookback demand (0.5..3.0)"),
    on_hand_delta: int = Query(0, ge=-10000, le=10000, description="Manual plant on-hand adjustment (-10000..10000)"),
    alt_supplier_available: bool = Query(True, description="Whether alternative supplier offers are included in recovery"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SimulationResponse:
    """Execute a what-if disruption simulation comparing Baseline, Disrupted, and Recovered scenarios.

    Purely computational decision-support tool. Nothing is saved and no orders are created.
    """
    params = SimulationParams(
        supplier_delay_days=supplier_delay_days,
        demand_multiplier=demand_multiplier,
        on_hand_delta=on_hand_delta,
        alt_supplier_available=alt_supplier_available,
    )

    try:
        sim_result = run_component_simulation(db, settings, component_id, params)
    except ComponentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InvalidOnHandAdjustmentError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if sim_result is None:
        return SimulationResponse(
            seeded=False,
            as_of=None,
            component=None,
            params=None,
            baseline=None,
            disrupted=None,
            recovered=None,
            what_changed=[],
            assumptions=[],
            note="What-if simulation. Nothing is saved and no orders are created.",
        )

    return SimulationResponse(
        seeded=True,
        as_of=sim_result.as_of,
        component=ComponentBriefSchema(
            id=sim_result.component_id,
            sku=sim_result.sku,
            name=sim_result.name,
        ),
        params=SimulationParamsSchema(
            supplier_delay_days=sim_result.params.supplier_delay_days,
            demand_multiplier=sim_result.params.demand_multiplier,
            on_hand_delta=sim_result.params.on_hand_delta,
            alt_supplier_available=sim_result.params.alt_supplier_available,
        ),
        baseline=_to_scenario_schema(sim_result.baseline),
        disrupted=_to_scenario_schema(sim_result.disrupted),
        recovered=_to_scenario_schema(sim_result.recovered),
        what_changed=sim_result.what_changed,
        assumptions=sim_result.assumptions,
        note=sim_result.note,
    )
