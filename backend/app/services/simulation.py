"""app/services/simulation.py

Service layer for What-If Disruption Simulation.
Reuses shared input builders, offer loaders, and recovery engine pieces.
Strictly read-only computations: nothing is written to the database.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
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
    CustomerOrderInput,
    ProductInput,
)
from app.domain.recovery import (
    RecoveryConfig,
    SupplierOfferInput,
)
from app.domain.inventory import (
    RegionalStockItem,
)
from app.domain.simulation import (
    SimulationParams,
    SimulationResult,
    simulate,
)
from app.services.inventory_risk import (
    build_component_evaluation_inputs,
    build_inventory_risk_config,
)
from app.services.recovery import build_recovery_config


class ComponentNotFoundError(Exception):
    """Raised when the specified component_id does not exist."""

    def __init__(self, component_id: int) -> None:
        self.component_id = component_id
        super().__init__(f"Component with id {component_id} not found.")


class InvalidOnHandAdjustmentError(Exception):
    """Raised when on_hand_delta would make plant stock negative."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


def run_component_simulation(
    db: Session,
    settings: Settings,
    component_id: int,
    params: SimulationParams,
) -> Optional[SimulationResult]:
    """Execute a 3-scenario what-if disruption simulation for a single component.

    Returns None if dataset is unseeded.
    Raises ComponentNotFoundError if component_id is not in database.
    Raises InvalidOnHandAdjustmentError if on_hand_delta produces negative on-hand.
    """
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None or not meta.as_of:
        return None

    as_of = meta.as_of
    inv_config = build_inventory_risk_config(settings)
    rec_config = build_recovery_config(settings)

    # 1. Fetch component
    component = db.scalar(select(Component).where(Component.id == component_id))
    if component is None:
        raise ComponentNotFoundError(component_id)

    # 2. Build component evaluation inputs
    comp_inputs_map = build_component_evaluation_inputs(db, as_of, [component], inv_config.lookback_days)
    if component.id not in comp_inputs_map:
        raise ComponentNotFoundError(component_id)

    comp_input = comp_inputs_map[component.id]

    # Validate on_hand_delta feasibility
    if params.on_hand_delta != 0:
        if comp_input.plant_inventory is None:
            raise InvalidOnHandAdjustmentError("Component has no plant inventory record; cannot adjust on-hand.")
        new_on_hand = comp_input.plant_inventory.on_hand + params.on_hand_delta
        if new_on_hand < 0:
            raise InvalidOnHandAdjustmentError(
                f"Adjusting plant on-hand by {params.on_hand_delta} would result in negative on-hand inventory "
                f"({comp_input.plant_inventory.on_hand} + ({params.on_hand_delta}) = {new_on_hand} < 0)."
            )

    # 3. Load supplier offers for this component
    raw_offers = db.scalars(
        select(SupplierComponent)
        .options(selectinload(SupplierComponent.supplier))
        .where(SupplierComponent.component_id == component_id)
    ).all()

    supplier_offers = [
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
        for o in raw_offers
    ]

    # 4. Regional stock items
    regional_stocks = [
        RegionalStockItem(
            warehouse_id=w.warehouse_id,
            warehouse_code=w.warehouse_code,
            warehouse_name=w.warehouse_name,
            on_hand=w.on_hand,
            reserved=w.reserved,
            usable=max(0, w.on_hand - w.reserved),
        )
        for w in comp_input.regional_inventories
    ]

    # 5. Load customer orders, products, and BOM lines (for exposure calculation)
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

    # 6. Run pure domain simulation
    return simulate(
        component_inputs=comp_input,
        supplier_offers=supplier_offers,
        regional_stocks=regional_stocks,
        customer_orders=co_inputs,
        bom_by_product=bom_by_product,
        products_by_id=products_by_id,
        params=params,
        inventory_config=inv_config,
        recovery_config=rec_config,
    )
