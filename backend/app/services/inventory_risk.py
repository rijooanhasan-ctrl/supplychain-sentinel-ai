"""Service layer for inventory risk evaluation.

Loads operational records in bulk from the database, builds domain inputs,
and invokes the pure domain evaluation function.
"""

from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings
from app.db.models import (
    Component,
    DatasetMeta,
    DemandRecord,
    InventoryLevel,
    PurchaseOrder,
    PurchaseOrderLine,
    Warehouse,
)
from app.domain.inventory import (
    ComponentEvaluationInput,
    ComponentRiskResult,
    DemandHistoryRecordInput,
    InboundLineInput,
    InventoryRiskConfig,
    PlantInventoryInput,
    RegionalInventoryInput,
    evaluate_component,
    WEEKDAY_NAMES,
)
from app.schemas.inventory_risk import (
    DailyProjectionItemSchema,
    InboundLineDetailSchema,
    InventoryRiskConfigSchema,
    InventoryRiskDetailResponse,
    InventoryRiskItem,
    InventoryRiskListResponse,
    InventoryRiskSummary,
    ModelMetadata,
    RegionalStockSchema,
    ReplenishmentInfoSchema,
    RiskFlagSchema,
    RiskLevelEnum,
    ShortageEpisodeSchema,
    UsableStockBreakdownSchema,
    WeekdayForecastItem,
)

RISK_SEVERITY_ORDER: Dict[str, int] = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "unknown": 4,
    "none": 5,
}

CRITICALITY_ORDER: Dict[str, int] = {
    "critical": 0,
    "high": 1,
    "normal": 2,
}


def build_inventory_risk_config(settings: Settings) -> InventoryRiskConfig:
    """Builds frozen InventoryRiskConfig from current application settings."""
    return InventoryRiskConfig(
        lookback_days=settings.INVENTORY_LOOKBACK_DAYS,
        horizon_days=settings.INVENTORY_HORIZON_DAYS,
        critical_days=settings.INVENTORY_CRITICAL_DAYS,
        high_days=settings.INVENTORY_HIGH_DAYS,
        medium_days=settings.INVENTORY_MEDIUM_DAYS,
    )


def list_inventory_risk(
    db: Session,
    settings: Settings,
    risk_level: Optional[RiskLevelEnum] = None,
    category: Optional[str] = None,
    criticality: Optional[str] = None,
    include_inactive: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> InventoryRiskListResponse:
    """Evaluates inventory risk across components and returns paginated, filtered results."""
    config = build_inventory_risk_config(settings)
    config_schema = InventoryRiskConfigSchema(
        lookback_days=config.lookback_days,
        min_history_days=config.min_history_days,
        min_coverage_ratio=config.min_coverage_ratio,
        horizon_days=config.horizon_days,
        critical_days=config.critical_days,
        high_days=config.high_days,
        medium_days=config.medium_days,
        overdue_inbound_policy=config.overdue_inbound_policy,
    )

    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None:
        return InventoryRiskListResponse(
            seeded=False,
            as_of=None,
            model=ModelMetadata(),
            config=config_schema,
            summary=InventoryRiskSummary(
                counts_by_risk_level={
                    "critical": 0,
                    "high": 0,
                    "medium": 0,
                    "low": 0,
                    "none": 0,
                    "unknown": 0,
                },
                components_evaluated=0,
            ),
            items=[],
            total=0,
            limit=limit,
            offset=offset,
        )

    as_of = meta.as_of

    # 1. Fetch evaluated components
    comp_query = select(Component)
    if not include_inactive:
        comp_query = comp_query.where(Component.is_active == True)
    comp_query = comp_query.order_by(Component.id.asc())
    components = db.scalars(comp_query).all()

    if not components:
        return InventoryRiskListResponse(
            seeded=True,
            as_of=as_of,
            model=ModelMetadata(),
            config=config_schema,
            summary=InventoryRiskSummary(
                counts_by_risk_level={
                    "critical": 0,
                    "high": 0,
                    "medium": 0,
                    "low": 0,
                    "none": 0,
                    "unknown": 0,
                },
                components_evaluated=0,
            ),
            items=[],
            total=0,
            limit=limit,
            offset=offset,
        )

    comp_ids = [c.id for c in components]

    # 2. Bulk load inventory levels
    inv_levels = db.scalars(
        select(InventoryLevel)
        .options(selectinload(InventoryLevel.warehouse))
        .where(InventoryLevel.component_id.in_(comp_ids))
    ).all()

    plant_inv_by_comp: Dict[int, PlantInventoryInput] = {}
    reg_inv_by_comp: Dict[int, List[RegionalInventoryInput]] = defaultdict(list)
    for inv in inv_levels:
        if inv.warehouse.role == "plant":
            plant_inv_by_comp[inv.component_id] = PlantInventoryInput(
                on_hand=inv.on_hand,
                reserved=inv.reserved,
            )
        else:
            reg_inv_by_comp[inv.component_id].append(
                RegionalInventoryInput(
                    warehouse_id=inv.warehouse_id,
                    warehouse_code=inv.warehouse.code,
                    warehouse_name=inv.warehouse.name,
                    on_hand=inv.on_hand,
                    reserved=inv.reserved,
                )
            )

    # 3. Bulk load demand records in lookback window [as_of - lookback_days, as_of - 1]
    window_start = as_of - timedelta(days=config.lookback_days)
    window_end = as_of - timedelta(days=1)
    demand_records = db.scalars(
        select(DemandRecord).where(
            DemandRecord.component_id.in_(comp_ids),
            DemandRecord.date >= window_start,
            DemandRecord.date <= window_end,
        )
    ).all()

    demand_by_comp: Dict[int, List[DemandHistoryRecordInput]] = defaultdict(list)
    for dr in demand_records:
        demand_by_comp[dr.component_id].append(
            DemandHistoryRecordInput(date=dr.date, quantity=float(dr.quantity))
        )

    # 4. Bulk load active inbound PO lines
    active_po_lines = db.scalars(
        select(PurchaseOrderLine)
        .options(
            selectinload(PurchaseOrderLine.purchase_order),
            selectinload(PurchaseOrderLine.warehouse),
        )
        .join(PurchaseOrder)
        .where(
            PurchaseOrderLine.component_id.in_(comp_ids),
            PurchaseOrder.status.in_(["open", "in_transit", "partially_received"]),
        )
    ).all()

    inbound_by_comp: Dict[int, List[InboundLineInput]] = defaultdict(list)
    for pol in active_po_lines:
        inbound_by_comp[pol.component_id].append(
            InboundLineInput(
                po_id=pol.purchase_order.id,
                po_number=pol.purchase_order.po_number,
                po_status=pol.purchase_order.status,
                warehouse_id=pol.warehouse_id,
                warehouse_code=pol.warehouse.code,
                warehouse_name=pol.warehouse.name,
                warehouse_role=pol.warehouse.role,
                qty_ordered=pol.qty_ordered,
                qty_received=pol.qty_received,
                promised_date=pol.purchase_order.promised_date,
                latest_estimate_date=pol.purchase_order.latest_estimate_date,
            )
        )

    # 5. Evaluate all components
    evaluated_results: List[ComponentRiskResult] = []
    summary_counts: Dict[str, int] = {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
        "none": 0,
        "unknown": 0,
    }

    for comp in components:
        domain_input = ComponentEvaluationInput(
            as_of=as_of,
            component_id=comp.id,
            sku=comp.sku,
            name=comp.name,
            category=comp.category,
            criticality=comp.criticality,
            plant_inventory=plant_inv_by_comp.get(comp.id),
            regional_inventories=reg_inv_by_comp.get(comp.id, []),
            demand_records=demand_by_comp.get(comp.id, []),
            inbound_lines=inbound_by_comp.get(comp.id, []),
        )
        result = evaluate_component(domain_input, config)
        evaluated_results.append(result)
        summary_counts[result.risk_level] = summary_counts.get(result.risk_level, 0) + 1

    # 6. Sort according to specified criteria:
    # Severity (critical..none), shortage_date asc (nulls last), criticality (critical first), sku
    def sort_key(r: ComponentRiskResult):
        severity_rank = RISK_SEVERITY_ORDER.get(r.risk_level, 99)
        shortage_null_last = (r.shortage_date is None, r.shortage_date)
        crit_rank = CRITICALITY_ORDER.get(r.criticality, 99)
        return (severity_rank, shortage_null_last, crit_rank, r.sku)

    evaluated_results.sort(key=sort_key)

    # 7. Apply filters
    filtered_results = evaluated_results
    if risk_level is not None:
        target_level = risk_level.value if isinstance(risk_level, RiskLevelEnum) else str(risk_level)
        filtered_results = [r for r in filtered_results if r.risk_level == target_level]
    if category is not None:
        filtered_results = [r for r in filtered_results if r.category.lower() == category.lower()]
    if criticality is not None:
        filtered_results = [r for r in filtered_results if r.criticality.lower() == criticality.lower()]

    total = len(filtered_results)
    paginated = filtered_results[offset : offset + limit]

    # 8. Transform to response models
    items = [_to_list_item(r) for r in paginated]

    return InventoryRiskListResponse(
        seeded=True,
        as_of=as_of,
        model=ModelMetadata(),
        config=config_schema,
        summary=InventoryRiskSummary(
            counts_by_risk_level=summary_counts,
            components_evaluated=len(evaluated_results),
        ),
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


def get_inventory_risk_detail(
    component_id: int,
    db: Session,
    settings: Settings,
) -> Optional[InventoryRiskDetailResponse]:
    """Evaluates a single component by ID and returns comprehensive detail."""
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None:
        return None

    component = db.get(Component, component_id)
    if component is None:
        return None

    as_of = meta.as_of
    config = build_inventory_risk_config(settings)
    config_schema = InventoryRiskConfigSchema(
        lookback_days=config.lookback_days,
        min_history_days=config.min_history_days,
        min_coverage_ratio=config.min_coverage_ratio,
        horizon_days=config.horizon_days,
        critical_days=config.critical_days,
        high_days=config.high_days,
        medium_days=config.medium_days,
        overdue_inbound_policy=config.overdue_inbound_policy,
    )

    # Load inventory levels for this component
    inv_levels = db.scalars(
        select(InventoryLevel)
        .options(selectinload(InventoryLevel.warehouse))
        .where(InventoryLevel.component_id == component_id)
    ).all()

    plant_inv: Optional[PlantInventoryInput] = None
    reg_invs: List[RegionalInventoryInput] = []
    for inv in inv_levels:
        if inv.warehouse.role == "plant":
            plant_inv = PlantInventoryInput(on_hand=inv.on_hand, reserved=inv.reserved)
        else:
            reg_invs.append(
                RegionalInventoryInput(
                    warehouse_id=inv.warehouse_id,
                    warehouse_code=inv.warehouse.code,
                    warehouse_name=inv.warehouse.name,
                    on_hand=inv.on_hand,
                    reserved=inv.reserved,
                )
            )

    # Load demand history in window
    window_start = as_of - timedelta(days=config.lookback_days)
    window_end = as_of - timedelta(days=1)
    demand_records = db.scalars(
        select(DemandRecord).where(
            DemandRecord.component_id == component_id,
            DemandRecord.date >= window_start,
            DemandRecord.date <= window_end,
        )
    ).all()
    demand_inputs = [
        DemandHistoryRecordInput(date=dr.date, quantity=float(dr.quantity))
        for dr in demand_records
    ]

    # Load active inbound PO lines
    po_lines = db.scalars(
        select(PurchaseOrderLine)
        .options(
            selectinload(PurchaseOrderLine.purchase_order),
            selectinload(PurchaseOrderLine.warehouse),
        )
        .join(PurchaseOrder)
        .where(
            PurchaseOrderLine.component_id == component_id,
            PurchaseOrder.status.in_(["open", "in_transit", "partially_received"]),
        )
    ).all()

    inbound_inputs = [
        InboundLineInput(
            po_id=pol.purchase_order.id,
            po_number=pol.purchase_order.po_number,
            po_status=pol.purchase_order.status,
            warehouse_id=pol.warehouse_id,
            warehouse_code=pol.warehouse.code,
            warehouse_name=pol.warehouse.name,
            warehouse_role=pol.warehouse.role,
            qty_ordered=pol.qty_ordered,
            qty_received=pol.qty_received,
            promised_date=pol.purchase_order.promised_date,
            latest_estimate_date=pol.purchase_order.latest_estimate_date,
        )
        for pol in po_lines
    ]

    domain_input = ComponentEvaluationInput(
        as_of=as_of,
        component_id=component.id,
        sku=component.sku,
        name=component.name,
        category=component.category,
        criticality=component.criticality,
        plant_inventory=plant_inv,
        regional_inventories=reg_invs,
        demand_records=demand_inputs,
        inbound_lines=inbound_inputs,
    )
    result = evaluate_component(domain_input, config)

    # Usable stock breakdown
    breakdown_schema: Optional[UsableStockBreakdownSchema] = None
    if result.usable_stock_breakdown is not None:
        breakdown_schema = UsableStockBreakdownSchema(
            on_hand=result.usable_stock_breakdown.on_hand,
            reserved=result.usable_stock_breakdown.reserved,
            usable=result.usable_stock_breakdown.usable,
            reserved_exceeds_on_hand=result.usable_stock_breakdown.reserved_exceeds_on_hand,
        )

    # Weekday forecast items
    weekday_items: Optional[List[WeekdayForecastItem]] = None
    if result.weekday_forecast is not None:
        weekday_items = []
        for w in range(7):
            weekday_items.append(
                WeekdayForecastItem(
                    weekday=w,
                    weekday_name=WEEKDAY_NAMES[w],
                    mean_demand=round(result.weekday_forecast[w], 1),
                )
            )

    # Replenishment
    next_rep: Optional[ReplenishmentInfoSchema] = None
    if result.next_replenishment is not None:
        next_rep = ReplenishmentInfoSchema(
            date=result.next_replenishment.date,
            qty=result.next_replenishment.qty,
            po_number=result.next_replenishment.po_number,
            date_basis=result.next_replenishment.date_basis,
        )

    # Inbound lines details
    def map_inbound(items):
        return [
            InboundLineDetailSchema(
                po_id=i.po_id,
                po_number=i.po_number,
                status=i.status,
                warehouse_code=i.warehouse_code,
                qty_ordered=i.qty_ordered,
                qty_received=i.qty_received,
                remaining_qty=i.remaining_qty,
                promised_date=i.promised_date,
                latest_estimate_date=i.latest_estimate_date,
                expected_date=i.expected_date,
                date_basis=i.date_basis,
            )
            for i in items
        ]

    # Regional stock
    regional_stock = [
        RegionalStockSchema(
            warehouse_id=r.warehouse_id,
            warehouse_code=r.warehouse_code,
            warehouse_name=r.warehouse_name,
            on_hand=r.on_hand,
            reserved=r.reserved,
            usable=r.usable,
        )
        for r in result.regional_usable_stock
    ]

    # Daily projections
    projections = [
        DailyProjectionItemSchema(
            day_index=p.day_index,
            date=p.date,
            forecast_demand=round(p.forecast_demand, 1),
            receipts=round(p.receipts, 1),
            ending_balance=round(p.ending_balance, 1),
            unmet=round(p.unmet, 1),
        )
        for p in result.daily_projection
    ]

    return InventoryRiskDetailResponse(
        component_id=result.component_id,
        sku=result.sku,
        name=result.name,
        category=result.category,
        criticality=result.criticality,
        plant_usable_stock=result.plant_usable_stock,
        plant_on_hand=result.plant_on_hand,
        plant_reserved=result.plant_reserved,
        mean_daily_demand=round(result.mean_daily_demand, 1) if result.mean_daily_demand is not None else None,
        coverage_days=round(result.coverage_days, 1) if result.coverage_days is not None else None,
        next_replenishment=next_rep,
        shortage_date=result.shortage_date,
        days_until_shortage=result.days_until_shortage,
        unmet_demand_units=round(result.unmet_demand_units, 1),
        runout_date_without_inbound=result.runout_date_without_inbound,
        unmet_before_next_inbound=result.unmet_before_next_inbound,
        first_episode_start_date=result.first_episode_start_date,
        first_episode_end_date=result.first_episode_end_date,
        risk_level=result.risk_level,
        risk_reason=result.risk_reason,
        forecast_status=result.forecast_status,
        flags=[RiskFlagSchema(code=f.code, message=f.message) for f in result.flags],
        as_of=as_of,
        model=ModelMetadata(),
        config=config_schema,
        explanation=result.explanation,
        usable_stock_breakdown=breakdown_schema,
        forecast_by_weekday=weekday_items,
        counted_inbound=map_inbound(result.counted_inbound),
        unconfirmed_inbound=map_inbound(result.unconfirmed_inbound),
        out_of_horizon_inbound=map_inbound(result.out_of_horizon_inbound),
        regional_usable_stock=regional_stock,
        regional_total_usable=result.regional_total_usable,
        daily_projection=projections,
        shortage_episodes=[
            ShortageEpisodeSchema(
                start_date=ep.start_date,
                end_date=ep.end_date,
                days=ep.days,
                unmet_units=ep.unmet_units,
                ends_because=ep.ends_because,
            )
            for ep in result.shortage_episodes
        ],
        assumptions=result.assumptions,
    )


def _to_list_item(r: ComponentRiskResult) -> InventoryRiskItem:
    next_rep: Optional[ReplenishmentInfoSchema] = None
    if r.next_replenishment is not None:
        next_rep = ReplenishmentInfoSchema(
            date=r.next_replenishment.date,
            qty=r.next_replenishment.qty,
            po_number=r.next_replenishment.po_number,
            date_basis=r.next_replenishment.date_basis,
        )

    return InventoryRiskItem(
        component_id=r.component_id,
        sku=r.sku,
        name=r.name,
        category=r.category,
        criticality=r.criticality,
        plant_usable_stock=r.plant_usable_stock,
        plant_on_hand=r.plant_on_hand,
        plant_reserved=r.plant_reserved,
        mean_daily_demand=round(r.mean_daily_demand, 1) if r.mean_daily_demand is not None else None,
        coverage_days=round(r.coverage_days, 1) if r.coverage_days is not None else None,
        next_replenishment=next_rep,
        shortage_date=r.shortage_date,
        days_until_shortage=r.days_until_shortage,
        unmet_demand_units=round(r.unmet_demand_units, 1),
        runout_date_without_inbound=r.runout_date_without_inbound,
        unmet_before_next_inbound=r.unmet_before_next_inbound,
        first_episode_start_date=r.first_episode_start_date,
        first_episode_end_date=r.first_episode_end_date,
        risk_level=r.risk_level,
        risk_reason=r.risk_reason,
        forecast_status=r.forecast_status,
        flags=[RiskFlagSchema(code=f.code, message=f.message) for f in r.flags],
    )
