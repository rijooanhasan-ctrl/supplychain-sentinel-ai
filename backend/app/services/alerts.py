"""Service layer for Disruption Detection and Alerts.

Loads operational records in bulk, prepares pure domain DTOs, and invokes
the pure domain detect_alerts() function.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Dict, List, Optional, Sequence, Tuple
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings
from app.db.models import (
    BomLine,
    Component,
    CustomerOrder,
    DatasetMeta,
    DeliveryRecord,
    Product,
    PurchaseOrder,
    PurchaseOrderLine,
    Supplier,
    SupplierComponent,
)
from app.domain.alerts import (
    ALERT_TYPES,
    SEVERITY_ORDER,
    AlertConfig,
    AlertResult,
    BomLineInput,
    ComponentAlertInfo,
    CustomerOrderInput,
    DeliveryRecordInput,
    DisruptionAlert,
    ProductInput,
    PurchaseOrderInput,
    SupplierOfferInput,
    detect_alerts,
)
from app.domain.inventory import evaluate_component
from app.schemas.alerts import (
    AlertConfigSchema,
    AlertDetailResponse,
    AlertImpactDetailSchema,
    AlertListItemSchema,
    AlertListResponse,
    AlertSeverityEnum,
    AlertSummary,
    AlertTypeEnum,
    DelayScenarioItemSchema,
    EvidenceItemSchema,
    ExposedCustomerOrderSchema,
)
from app.services.inventory_risk import (
    build_component_evaluation_inputs,
    build_inventory_risk_config,
)
from app.services.supplier_risk import (
    build_supplier_risk_config,
    compute_all_supplier_risk_results,
)


def build_alert_config(settings: Settings) -> AlertConfig:
    """Builds frozen AlertConfig from current application settings."""
    return AlertConfig(
        surge_recent_days=settings.ALERT_SURGE_RECENT_DAYS,
        surge_baseline_days=settings.ALERT_SURGE_BASELINE_DAYS,
        surge_ratio_medium=settings.ALERT_SURGE_RATIO_MEDIUM,
        surge_ratio_high=settings.ALERT_SURGE_RATIO_HIGH,
        quality_rejection_threshold=settings.ALERT_QUALITY_REJECTION_THRESHOLD,
        delay_min_late_probability=settings.ALERT_DELAY_MIN_LATE_PROBABILITY,
        delay_min_deliveries=settings.ALERT_DELAY_MIN_DELIVERIES,
    )


def run_alert_detection(
    db: Session,
    settings: Settings,
) -> Optional[Tuple[date, AlertConfig, AlertResult]]:
    """Internal helper to load all records and execute pure domain alert detection."""
    meta = db.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None or not meta.as_of:
        return None

    as_of = meta.as_of
    alert_config = build_alert_config(settings)
    inv_config = build_inventory_risk_config(settings)
    sup_config = build_supplier_risk_config(settings)

    # 1. Components & inventory evaluations
    components = db.scalars(select(Component).order_by(Component.id.asc())).all()
    comp_lookback = max(
        inv_config.lookback_days,
        alert_config.surge_recent_days + alert_config.surge_baseline_days,
    )
    comp_inputs = build_component_evaluation_inputs(db, as_of, components, comp_lookback)
    component_results = {
        comp.id: evaluate_component(comp_inputs[comp.id], inv_config)
        for comp in components
        if comp.id in comp_inputs
    }

    comp_alert_infos = [
        ComponentAlertInfo(
            id=c.id,
            sku=c.sku,
            name=c.name,
            criticality=c.criticality,
            is_active=c.is_active,
        )
        for c in components
    ]

    # 2. Suppliers & supplier risk evaluations
    suppliers = db.scalars(select(Supplier).order_by(Supplier.code.asc())).all()
    supplier_results = compute_all_supplier_risk_results(db, as_of, suppliers, sup_config)

    # 3. Active purchase orders with lines
    active_pos = db.scalars(
        select(PurchaseOrder)
        .options(
            selectinload(PurchaseOrder.lines),
            selectinload(PurchaseOrder.supplier),
        )
        .where(PurchaseOrder.status.in_(["open", "in_transit", "partially_received"]))
    ).all()

    components_by_id = {c.id: c for c in components}
    po_inputs: List[PurchaseOrderInput] = []
    for po in active_pos:
        rem = sum(max(0, l.qty_ordered - l.qty_received) for l in po.lines)
        c_ids = list({l.component_id for l in po.lines})
        c_skus = [components_by_id[cid].sku for cid in c_ids if cid in components_by_id]
        po_inputs.append(
            PurchaseOrderInput(
                po_id=po.id,
                po_number=po.po_number,
                supplier_id=po.supplier_id,
                supplier_code=po.supplier.code if po.supplier else "",
                status=po.status,
                promised_date=po.promised_date,
                latest_estimate_date=po.latest_estimate_date,
                remaining_qty=rem,
                component_ids=c_ids,
                component_skus=c_skus,
            )
        )

    # 4. Open/in_production customer orders
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

    # 5. Products & BOM lines
    products = db.scalars(select(Product)).all()
    product_inputs = [
        ProductInput(
            id=p.id,
            sku=p.sku,
            name=p.name,
            selling_price=p.selling_price,
        )
        for p in products
    ]

    bom_lines = db.scalars(select(BomLine)).all()
    bom_inputs = [
        BomLineInput(
            product_id=bl.product_id,
            component_id=bl.component_id,
            quantity_per_unit=bl.quantity_per_unit,
        )
        for bl in bom_lines
    ]

    # 6. Supplier offers
    offers = db.scalars(
        select(SupplierComponent).options(selectinload(SupplierComponent.supplier))
    ).all()
    offer_inputs = [
        SupplierOfferInput(
            supplier_id=off.supplier_id,
            supplier_code=off.supplier.code if off.supplier else "",
            component_id=off.component_id,
            max_weekly_capacity=off.max_weekly_capacity,
        )
        for off in offers
    ]

    # 7. Delivery records
    deliveries = db.scalars(
        select(DeliveryRecord).options(selectinload(DeliveryRecord.supplier))
    ).all()
    deliv_inputs = [
        DeliveryRecordInput(
            id=d.id,
            supplier_id=d.supplier_id,
            supplier_code=d.supplier.code if d.supplier else "",
            component_id=d.component_id,
            promised_date=d.promised_date,
            actual_date=d.actual_date,
            qty_ordered=d.qty_ordered,
            qty_received=d.qty_received,
            qty_rejected=d.qty_rejected,
        )
        for d in deliveries
    ]

    # Detect alerts via pure domain logic
    alert_result = detect_alerts(
        as_of=as_of,
        config=alert_config,
        inventory_config=inv_config,
        components=comp_alert_infos,
        component_inputs=comp_inputs,
        component_results=component_results,
        supplier_results=supplier_results,
        purchase_orders=po_inputs,
        customer_orders=co_inputs,
        bom_lines=bom_inputs,
        products=product_inputs,
        supplier_offers=offer_inputs,
        deliveries=deliv_inputs,
    )

    return as_of, alert_config, alert_result


class Tuple_Result:
    pass


def list_alerts(
    db: Session,
    settings: Settings,
    severity: Optional[AlertSeverityEnum] = None,
    alert_type: Optional[AlertTypeEnum] = None,
    component_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> AlertListResponse:
    """Lists alerts with server-side filtering, pagination, and global summary counts."""
    detection = run_alert_detection(db, settings)
    if detection is None:
        return AlertListResponse(
            seeded=False,
            as_of=None,
            config=None,
            summary=AlertSummary(
                counts_by_severity={s: 0 for s in SEVERITY_ORDER},
                counts_by_type={t: 0 for t in ALERT_TYPES},
                total_alerts=0,
            ),
            items=[],
            total=0,
            limit=limit,
            offset=offset,
        )

    as_of, alert_config, alert_result = detection

    config_schema = AlertConfigSchema(
        surge_recent_days=alert_config.surge_recent_days,
        surge_baseline_days=alert_config.surge_baseline_days,
        surge_ratio_medium=alert_config.surge_ratio_medium,
        surge_ratio_high=alert_config.surge_ratio_high,
        surge_min_baseline_mean=alert_config.surge_min_baseline_mean,
        surge_min_coverage=alert_config.surge_min_coverage,
        quality_recent_days=alert_config.quality_recent_days,
        quality_rejection_threshold=alert_config.quality_rejection_threshold,
        quality_min_received_units=alert_config.quality_min_received_units,
        delay_min_late_probability=alert_config.delay_min_late_probability,
        delay_min_deliveries=alert_config.delay_min_deliveries,
        compound_min_types=alert_config.compound_min_types,
        compound_escalate_at_types=alert_config.compound_escalate_at_types,
    )

    # Summary counts are computed over ALL alerts, completely independent of filters and pagination
    summary_schema = AlertSummary(
        counts_by_severity=alert_result.counts_by_severity,
        counts_by_type=alert_result.counts_by_type,
        total_alerts=alert_result.total_alerts,
    )

    # Filter items
    filtered = alert_result.alerts
    if severity is not None:
        filtered = [a for a in filtered if a.severity == severity.value]
    if alert_type is not None:
        filtered = [a for a in filtered if a.type == alert_type.value]
    if component_id is not None:
        filtered = [a for a in filtered if a.component_id == component_id]
    if supplier_id is not None:
        filtered = [a for a in filtered if a.supplier_id == supplier_id]

    total_filtered = len(filtered)
    paged = filtered[offset : offset + limit]

    items: List[AlertListItemSchema] = []
    for a in paged:
        items.append(
            AlertListItemSchema(
                id=a.id,
                type=a.type,
                severity=a.severity,
                title=a.title,
                summary=a.summary,
                component_id=a.component_id,
                component_sku=a.component_sku,
                component_name=a.component_name,
                supplier_id=a.supplier_id,
                supplier_code=a.supplier_code,
                po_number=a.po_number,
                days_until_impact=a.days_until_impact,
                affected_orders_count=a.impact.orders_count if a.impact else None,
                exposed_revenue=str(a.impact.exposed_revenue) if a.impact else None,
                related_alert_ids=list(a.related_alert_ids),
                flags=list(a.flags),
            )
        )

    return AlertListResponse(
        seeded=True,
        as_of=as_of,
        config=config_schema,
        summary=summary_schema,
        items=items,
        total=total_filtered,
        limit=limit,
        offset=offset,
    )


def get_alert_detail(
    db: Session,
    settings: Settings,
    alert_id: str,
) -> Optional[AlertDetailResponse]:
    """Retrieves full details for a single disruption alert by ID."""
    detection = run_alert_detection(db, settings)
    if detection is None:
        return None

    _, _, alert_result = detection
    alert = next((a for a in alert_result.alerts if a.id == alert_id), None)
    if alert is None:
        return None

    # Map evidence
    evidence_schemas = [
        EvidenceItemSchema(label=e.label, value=e.value, unit=e.unit)
        for e in alert.evidence
    ]

    # Map impact
    impact_schema: Optional[AlertImpactDetailSchema] = None
    if alert.impact is not None:
        exposed_orders_schemas = [
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
            for o in alert.impact.exposed_orders
        ]
        impact_schema = AlertImpactDetailSchema(
            orders_count=alert.impact.orders_count,
            count_by_priority=alert.impact.count_by_priority,
            total_component_units_required=alert.impact.total_component_units_required,
            exposed_revenue=str(alert.impact.exposed_revenue),
            exposed_orders=exposed_orders_schemas,
        )

    # Map delay scenarios
    scenario_schemas: Optional[List[DelayScenarioItemSchema]] = None
    if alert.delay_scenarios is not None:
        scenario_schemas = [
            DelayScenarioItemSchema(
                scenario_name=s.scenario_name,
                shift_days=s.shift_days,
                expected_date=s.expected_date,
                shortage_date=s.shortage_date,
                first_episode_start=s.first_episode_start,
                first_episode_end=s.first_episode_end,
                first_episode_days=s.first_episode_days,
                unmet_before_next_inbound=s.unmet_before_next_inbound,
                total_unmet_demand=s.total_unmet_demand,
                incremental_total_unmet=s.incremental_total_unmet,
                change_in_shortage_days=s.change_in_shortage_days,
            )
            for s in alert.delay_scenarios
        ]

    return AlertDetailResponse(
        id=alert.id,
        type=alert.type,
        severity=alert.severity,
        title=alert.title,
        summary=alert.summary,
        component_id=alert.component_id,
        component_sku=alert.component_sku,
        component_name=alert.component_name,
        supplier_id=alert.supplier_id,
        supplier_code=alert.supplier_code,
        po_number=alert.po_number,
        days_until_impact=alert.days_until_impact,
        detected_on=alert.detected_on,
        evidence=evidence_schemas,
        assumptions=list(alert.assumptions),
        impact=impact_schema,
        impact_null_reason=alert.impact_null_reason,
        related_alert_ids=list(alert.related_alert_ids),
        flags=list(alert.flags),
        delay_scenarios=scenario_schemas,
    )
