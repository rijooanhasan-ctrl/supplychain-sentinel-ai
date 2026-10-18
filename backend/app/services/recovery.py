"""app/services/recovery.py

Service layer for recovery recommendations.
Queries data models, orchestrates pure domain recovery evaluations, and formats API DTOs.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Dict, List, Optional, Tuple
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings
from app.db.models import (
    BomLine,
    Component,
    CustomerOrder,
    DatasetMeta,
    Product,
    SupplierComponent,
)
from app.domain.alerts import (
    BomLineInput,
    CustomerOrderInput,
    ProductInput,
    SEVERITY_RANKS,
)
from app.domain.recovery import (
    ComponentRecoveryRecommendation,
    RecoveryConfig,
    SupplierOfferInput,
    evaluate_component_recovery,
)
from app.domain.inventory import evaluate_component
from app.services.inventory_risk import (
    build_component_evaluation_inputs,
    build_inventory_risk_config,
)


def build_recovery_config(settings: Settings) -> RecoveryConfig:
    """Builds frozen RecoveryConfig from application settings."""
    return RecoveryConfig(
        transfer_days=settings.RECOVERY_TRANSFER_DAYS,
        transfer_cost_per_unit=settings.RECOVERY_TRANSFER_COST_PER_UNIT,
    )


def compute_recovery_recommendations(
    db: Session,
    settings: Settings,
    component_id: Optional[int] = None,
) -> Optional[Tuple[date, RecoveryConfig, List[ComponentRecoveryRecommendation]]]:
    """Computes recovery recommendations for components facing projected inventory shortages.

    Returns None if dataset is unseeded or metadata is missing.
    """
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None or not meta.as_of:
        return None

    as_of = meta.as_of
    inv_config = build_inventory_risk_config(settings)
    rec_config = build_recovery_config(settings)

    # 1. Load active components
    comp_query = select(Component).order_by(Component.id.asc())
    if component_id is not None:
        comp_query = comp_query.where(Component.id == component_id)
    components = db.scalars(comp_query).all()

    if not components:
        return as_of, rec_config, []

    # 2. Build component evaluation inputs and run baseline evaluations
    comp_inputs = build_component_evaluation_inputs(db, as_of, components, inv_config.lookback_days)
    baseline_results = {
        comp.id: evaluate_component(comp_inputs[comp.id], inv_config)
        for comp in components
        if comp.id in comp_inputs
    }

    # Filter to shortage components only
    shortage_components = [
        comp
        for comp in components
        if comp.id in baseline_results
        and baseline_results[comp.id].shortage_date is not None
        and baseline_results[comp.id].unmet_before_next_inbound is not None
        and baseline_results[comp.id].unmet_before_next_inbound > 0.0
        and baseline_results[comp.id].risk_level in ("critical", "high", "medium")
    ]

    if not shortage_components:
        return as_of, rec_config, []

    # 3. Load supplier agreements/offers
    shortage_comp_ids = {c.id for c in shortage_components}
    raw_offers = db.scalars(
        select(SupplierComponent)
        .options(selectinload(SupplierComponent.supplier))
        .where(SupplierComponent.component_id.in_(shortage_comp_ids))
    ).all()

    offers_by_component: Dict[int, List[SupplierOfferInput]] = defaultdict(list)
    for o in raw_offers:
        offers_by_component[o.component_id].append(
            SupplierOfferInput(
                supplier_id=o.supplier_id,
                supplier_code=o.supplier.code if o.supplier else "",
                supplier_name=o.supplier.name if o.supplier else "",
                component_id=o.component_id,
                unit_cost=o.unit_cost,
                lead_time_days=o.lead_time_days,
                min_order_qty=o.min_order_qty,
                max_weekly_capacity=o.max_weekly_capacity,
                is_preferred=o.is_preferred,
                expedite_available=o.expedite_available,
                expedite_lead_time_days=o.expedite_lead_time_days,
                expedite_cost_premium_pct=o.expedite_cost_premium_pct,
            )
        )

    # 4. Load customer orders, products, and BOM lines (for accept_delay impact)
    customer_orders = db.scalars(
        select(CustomerOrder)
        .where(CustomerOrder.status.in_(["open", "in_production"]))
        .order_by(CustomerOrder.due_date.asc())
    ).all()
    co_inputs = [
        CustomerOrderInput(
            id=co.id,
            order_number=co.order_number,
            customer_name=co.customer_name,
            product_id=co.product_id,
            quantity=co.quantity,
            due_date=co.due_date,
            priority=co.priority,
            status=co.status,
        )
        for co in customer_orders
    ]

    products = db.scalars(select(Product)).all()
    products_by_id = {
        p.id: ProductInput(
            id=p.id,
            sku=p.sku,
            name=p.name,
            selling_price=p.selling_price,
        )
        for p in products
    }

    bom_rows = db.scalars(select(BomLine)).all()
    bom_by_product: Dict[int, Dict[int, int]] = defaultdict(dict)
    for b in bom_rows:
        bom_by_product[b.product_id][b.component_id] = b.quantity_per_unit

    # 5. Evaluate recovery recommendations per shortage component
    recommendations: List[ComponentRecoveryRecommendation] = []
    for comp in shortage_components:
        comp_in = comp_inputs[comp.id]
        base_res = baseline_results[comp.id]
        offers = offers_by_component.get(comp.id, [])
        reg_stocks = base_res.regional_usable_stock

        rec = evaluate_component_recovery(
            component_input=comp_in,
            baseline_result=base_res,
            supplier_offers=offers,
            regional_stocks=reg_stocks,
            customer_orders=co_inputs,
            bom_by_product=bom_by_product,
            products_by_id=products_by_id,
            inventory_config=inv_config,
            recovery_config=rec_config,
        )
        if rec is not None:
            recommendations.append(rec)

    # Sort recommendations: severity rank descending, then shortage date ascending, then sku
    recommendations.sort(
        key=lambda r: (
            -SEVERITY_RANKS.get(r.risk_level, 0),
            r.baseline_shortage_date,
            r.sku,
        )
    )

    return as_of, rec_config, recommendations
