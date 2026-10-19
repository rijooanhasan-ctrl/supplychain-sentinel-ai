"""app/services/executive_summary.py

Service layer for Executive Summary.
Orchestrates existing domain calls (alerts, recommendations, simulation, inventory risk, supplier risk),
and delegates summary assembly to pure domain logic in app.domain.executive_summary.
"""

from __future__ import annotations

from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import (
    Component,
    DatasetMeta,
    Supplier,
)
from app.domain.executive_summary import (
    ExecutiveSummary,
    ExecutiveSummaryInputs,
    build_executive_summary,
)
from app.domain.inventory import evaluate_component
from app.domain.simulation import SimulationParams
from app.services.alerts import run_alert_detection
from app.services.inventory_risk import (
    build_component_evaluation_inputs,
    build_inventory_risk_config,
)
from app.services.recovery import compute_recovery_recommendations
from app.services.simulation import run_component_simulation
from app.services.supplier_risk import (
    build_supplier_risk_config,
    compute_all_supplier_risk_results,
)


def get_executive_summary_data(
    db: Session,
    settings: Settings,
) -> Optional[ExecutiveSummary]:
    """Load records, run existing domain calculations, and construct the ExecutiveSummary.

    Returns None if the dataset is unseeded.
    """
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None or not meta.as_of:
        return None

    as_of = meta.as_of
    inv_config = build_inventory_risk_config(settings)
    sup_config = build_supplier_risk_config(settings)

    # 1. Run alerts detection
    alert_tuple = run_alert_detection(db, settings)
    alerts = alert_tuple[2].alerts if alert_tuple else []

    # 2. Run recovery recommendations
    rec_tuple = compute_recovery_recommendations(db, settings)
    recs = rec_tuple[2] if rec_tuple else []

    # 3. Components & inventory evaluations
    components = db.scalars(select(Component).order_by(Component.id.asc())).all()
    comp_lookback = max(inv_config.lookback_days, 42)
    comp_inputs = build_component_evaluation_inputs(db, as_of, components, comp_lookback)
    inventory_results = {
        c.id: evaluate_component(comp_inputs[c.id], inv_config)
        for c in components
        if c.id in comp_inputs
    }

    # 4. Suppliers & supplier risk evaluations
    suppliers = db.scalars(select(Supplier).order_by(Supplier.code.asc())).all()
    supplier_results = compute_all_supplier_risk_results(db, as_of, suppliers, sup_config)

    # 5. Identify priority component
    rec_comp_ids = {r.component_id for r in recs}
    priority_comp_id: Optional[int] = None
    for alert in alerts:
        if alert.component_id and alert.component_id in rec_comp_ids:
            priority_comp_id = alert.component_id
            break

    if priority_comp_id is None and recs:
        priority_comp_id = recs[0].component_id

    # 6. Run simulation with default parameters for the priority component
    priority_sim = None
    if priority_comp_id is not None:
        priority_sim = run_component_simulation(
            db=db,
            settings=settings,
            component_id=priority_comp_id,
            params=SimulationParams(),
        )

    # 7. Collect metadata/flags for priority component
    demand_days = None
    flags = []
    if priority_comp_id is not None and priority_comp_id in comp_inputs:
        comp_in = comp_inputs[priority_comp_id]
        demand_days = len(set(r.date for r in comp_in.demand_records))
        if priority_comp_id in inventory_results:
            flags = [f.code for f in inventory_results[priority_comp_id].flags]

    # 8. Assemble domain inputs and build summary
    inputs = ExecutiveSummaryInputs(
        as_of=as_of,
        dataset_label=meta.label or "DEMO DATA",
        dataset_source=meta.source or "demo",
        is_live=False,
        alerts=alerts,
        recommendations=recs,
        priority_simulation=priority_sim,
        inventory_results=inventory_results,
        supplier_results=supplier_results,
        priority_component_demand_history_days=demand_days,
        flags=flags,
        display_currency=settings.DISPLAY_CURRENCY,
        usd_to_inr_rate=settings.USD_TO_INR_RATE,
    )

    return build_executive_summary(inputs)
