"""Service layer for supplier risk calculation and aggregation.

Loads database entities and delegates all scoring logic to the pure domain layer.
"""

from collections import defaultdict
from typing import Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings
from app.db.models import DatasetMeta, DeliveryRecord, PurchaseOrder, PurchaseOrderLine, Supplier
from app.domain.supplier_risk import (
    DeliveryInput,
    OpenPoInput,
    SupplierEvaluationInput,
    SupplierRiskConfig,
    SupplierRiskResult,
    evaluate_supplier,
)
from app.schemas.supplier_risk import (
    InformationalPoSchema,
    MetricScoreBreakdownSchema,
    MonthlyPerformanceSchema,
    SupplierRiskConfigSchema,
    SupplierRiskDetailResponse,
    SupplierRiskListItem,
    SupplierRiskListResponse,
    SupplierRiskSummary,
)


def _build_supplier_config(settings: Settings) -> SupplierRiskConfig:
    return SupplierRiskConfig(
        lookback_days=settings.SUPPLIER_RISK_LOOKBACK_DAYS,
        on_time_grace_days=settings.SUPPLIER_RISK_GRACE_DAYS,
        w_on_time=settings.SUPPLIER_RISK_W_ON_TIME,
        w_delay=settings.SUPPLIER_RISK_W_DELAY,
        w_rejection=settings.SUPPLIER_RISK_W_REJECTION,
        w_fill=settings.SUPPLIER_RISK_W_FILL,
        band_medium=settings.SUPPLIER_RISK_BAND_MEDIUM,
        band_high=settings.SUPPLIER_RISK_BAND_HIGH,
    )


def _to_list_item(res: SupplierRiskResult) -> SupplierRiskListItem:
    return SupplierRiskListItem(
        supplier_id=res.supplier_id,
        supplier_code=res.supplier_code,
        supplier_name=res.supplier_name,
        country=res.country,
        n_deliveries=res.n_deliveries,
        risk_score=res.risk_score,
        risk_band=res.risk_band,
        confidence=res.confidence,
        on_time_rate=res.on_time_rate,
        on_time_ci_lower=res.on_time_ci_lower,
        on_time_ci_upper=res.on_time_ci_upper,
        late_delivery_probability=res.late_delivery_probability,
        expected_delay_days_if_late=res.expected_delay_days_if_late,
        avg_delay_days_all=res.avg_delay_days_all,
        avg_delay_days_when_late=res.avg_delay_days_when_late,
        rejection_rate=res.rejection_rate,
        fill_rate=res.fill_rate,
        open_po_count=res.informational_po.open_po_count,
        open_pos_slipped_count=res.informational_po.open_pos_slipped_count,
        open_pos_overdue_count=res.informational_po.open_pos_overdue_count,
        open_remaining_qty=res.informational_po.open_remaining_qty,
    )


def evaluate_all_suppliers(
    session: Session,
    settings: Settings,
    band: Optional[str] = None,
    country: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> SupplierRiskListResponse:
    """Evaluates supplier risk across all active suppliers."""
    meta = session.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None or not meta.as_of:
        return SupplierRiskListResponse(
            seeded=False,
            as_of=None,
            summary=SupplierRiskSummary(counts_by_band={}, total_suppliers=0),
            items=[],
            total=0,
            limit=limit,
            offset=offset,
        )

    as_of = meta.as_of
    cfg = _build_supplier_config(settings)

    # 1. Load all suppliers
    suppliers = session.scalars(select(Supplier).order_by(Supplier.code)).all()
    if not suppliers:
        return SupplierRiskListResponse(
            seeded=True,
            as_of=as_of,
            summary=SupplierRiskSummary(counts_by_band={}, total_suppliers=0),
            items=[],
            total=0,
            limit=limit,
            offset=offset,
        )

    # 2. Bulk load delivery records
    all_deliveries = session.scalars(select(DeliveryRecord)).all()
    deliv_by_supplier: Dict[int, List[DeliveryInput]] = defaultdict(list)
    for d in all_deliveries:
        deliv_by_supplier[d.supplier_id].append(
            DeliveryInput(
                id=d.id,
                supplier_id=d.supplier_id,
                component_id=d.component_id,
                purchase_order_id=d.purchase_order_id,
                promised_date=d.promised_date,
                actual_date=d.actual_date,
                qty_ordered=d.qty_ordered,
                qty_received=d.qty_received,
                qty_rejected=d.qty_rejected,
            )
        )

    # 3. Bulk load open POs with line quantities
    open_statuses = ["open", "in_transit", "partially_received"]
    open_pos = session.scalars(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines))
        .where(PurchaseOrder.status.in_(open_statuses))
    ).all()

    open_by_supplier: Dict[int, List[OpenPoInput]] = defaultdict(list)
    for po in open_pos:
        rem_qty = sum(max(0, line.qty_ordered - line.qty_received) for line in po.lines)
        if rem_qty > 0:
            open_by_supplier[po.supplier_id].append(
                OpenPoInput(
                    po_id=po.id,
                    po_number=po.po_number,
                    status=po.status,
                    promised_date=po.promised_date,
                    latest_estimate_date=po.latest_estimate_date,
                    remaining_qty=rem_qty,
                )
            )

    # 4. Evaluate all suppliers using pure domain logic
    all_results: List[SupplierRiskResult] = []
    counts_by_band = {"low": 0, "medium": 0, "high": 0, "unknown": 0}

    for sup in suppliers:
        s_delivs = deliv_by_supplier.get(sup.id, [])
        s_open = open_by_supplier.get(sup.id, [])
        eval_input = SupplierEvaluationInput(
            as_of=as_of,
            supplier_id=sup.id,
            supplier_code=sup.code,
            supplier_name=sup.name,
            country=sup.country,
            deliveries=s_delivs,
            open_orders=s_open,
            config=cfg,
        )
        res = evaluate_supplier(eval_input)
        all_results.append(res)
        counts_by_band[res.risk_band] = counts_by_band.get(res.risk_band, 0) + 1

    # 5. Apply filters
    filtered = all_results
    if band:
        band_lower = band.lower()
        filtered = [r for r in filtered if r.risk_band.lower() == band_lower]
    if country:
        country_lower = country.lower()
        filtered = [r for r in filtered if r.country.lower() == country_lower]

    # 6. Sort: risk_score descending with nulls last, then supplier_code ascending
    def sort_key(r: SupplierRiskResult):
        # False (0) for score exists, True (1) for score is None
        is_null = r.risk_score is None
        neg_score = -(r.risk_score or 0.0)
        return (is_null, neg_score, r.supplier_code)

    filtered.sort(key=sort_key)

    total = len(filtered)
    paginated_items = filtered[offset : offset + limit]

    return SupplierRiskListResponse(
        seeded=True,
        as_of=as_of,
        summary=SupplierRiskSummary(
            counts_by_band=counts_by_band,
            total_suppliers=len(all_results),
        ),
        items=[_to_list_item(r) for r in paginated_items],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_supplier_risk_detail(
    supplier_id: int,
    session: Session,
    settings: Settings,
) -> Optional[SupplierRiskDetailResponse]:
    """Retrieves full evaluation details for a single supplier."""
    meta = session.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()))
    if not meta or not meta.as_of:
        return None

    sup = session.get(Supplier, supplier_id)
    if not sup:
        return None

    as_of = meta.as_of
    cfg = _build_supplier_config(settings)

    # Deliveries for this supplier
    deliveries = session.scalars(
        select(DeliveryRecord).where(DeliveryRecord.supplier_id == supplier_id)
    ).all()
    deliv_inputs = [
        DeliveryInput(
            id=d.id,
            supplier_id=d.supplier_id,
            component_id=d.component_id,
            purchase_order_id=d.purchase_order_id,
            promised_date=d.promised_date,
            actual_date=d.actual_date,
            qty_ordered=d.qty_ordered,
            qty_received=d.qty_received,
            qty_rejected=d.qty_rejected,
        )
        for d in deliveries
    ]

    # Open POs for this supplier
    open_statuses = ["open", "in_transit", "partially_received"]
    open_pos = session.scalars(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines))
        .where(
            PurchaseOrder.supplier_id == supplier_id,
            PurchaseOrder.status.in_(open_statuses),
        )
    ).all()

    open_inputs = []
    for po in open_pos:
        rem_qty = sum(max(0, line.qty_ordered - line.qty_received) for line in po.lines)
        if rem_qty > 0:
            open_inputs.append(
                OpenPoInput(
                    po_id=po.id,
                    po_number=po.po_number,
                    status=po.status,
                    promised_date=po.promised_date,
                    latest_estimate_date=po.latest_estimate_date,
                    remaining_qty=rem_qty,
                )
            )

    eval_input = SupplierEvaluationInput(
        as_of=as_of,
        supplier_id=sup.id,
        supplier_code=sup.code,
        supplier_name=sup.name,
        country=sup.country,
        deliveries=deliv_inputs,
        open_orders=open_inputs,
        config=cfg,
    )
    res = evaluate_supplier(eval_input)

    thresholds_schema = SupplierRiskConfigSchema(
        lookback_days=cfg.lookback_days,
        on_time_grace_days=cfg.on_time_grace_days,
        w_on_time=cfg.w_on_time,
        w_delay=cfg.w_delay,
        w_rejection=cfg.w_rejection,
        w_fill=cfg.w_fill,
        late_rate_full_penalty=cfg.late_rate_full_penalty,
        delay_full_penalty_days=cfg.delay_full_penalty_days,
        rejection_full_penalty=cfg.rejection_full_penalty,
        fill_shortfall_full_penalty=cfg.fill_shortfall_full_penalty,
        band_medium=cfg.band_medium,
        band_high=cfg.band_high,
        low_confidence_below=cfg.low_confidence_below,
        high_confidence_from=cfg.high_confidence_from,
    )

    return SupplierRiskDetailResponse(
        supplier_id=res.supplier_id,
        supplier_code=res.supplier_code,
        supplier_name=res.supplier_name,
        country=res.country,
        n_deliveries=res.n_deliveries,
        risk_score=res.risk_score,
        risk_band=res.risk_band,
        confidence=res.confidence,
        on_time_rate=res.on_time_rate,
        on_time_ci_lower=res.on_time_ci_lower,
        on_time_ci_upper=res.on_time_ci_upper,
        late_delivery_probability=res.late_delivery_probability,
        expected_delay_days_if_late=res.expected_delay_days_if_late,
        avg_delay_days_all=res.avg_delay_days_all,
        avg_delay_days_when_late=res.avg_delay_days_when_late,
        rejection_rate=res.rejection_rate,
        fill_rate=res.fill_rate,
        open_po_count=res.informational_po.open_po_count,
        open_pos_slipped_count=res.informational_po.open_pos_slipped_count,
        open_pos_overdue_count=res.informational_po.open_pos_overdue_count,
        open_remaining_qty=res.informational_po.open_remaining_qty,
        as_of=res.as_of,
        excluded_future_deliveries=res.excluded_future_deliveries,
        has_excluded_future_deliveries=res.has_excluded_future_deliveries,
        p50_delay_days_when_late=res.p50_delay_days_when_late,
        p90_delay_days_when_late=res.p90_delay_days_when_late,
        max_delay_days=res.max_delay_days,
        total_ordered_qty=res.total_ordered_qty,
        total_received_qty=res.total_received_qty,
        total_rejected_qty=res.total_rejected_qty,
        metrics_breakdown=[
            MetricScoreBreakdownSchema(
                metric_name=b.metric_name,
                raw_value=b.raw_value,
                penalty=b.penalty,
                nominal_weight=b.nominal_weight,
                effective_weight=b.effective_weight,
                contribution_points=round(b.contribution_points, 1),
                dropped=b.dropped,
                dropped_reason=b.dropped_reason,
            )
            for b in res.metrics_breakdown
        ],
        nominal_weights=res.nominal_weights,
        effective_weights=res.effective_weights,
        metrics_used=res.metrics_used,
        metrics_dropped=res.metrics_dropped,
        thresholds_used=thresholds_schema,
        monthly_breakdown=[
            MonthlyPerformanceSchema(
                month=m.month,
                n_deliveries=m.n_deliveries,
                on_time_rate=m.on_time_rate,
            )
            for m in res.monthly_breakdown
        ],
        main_drivers=res.main_drivers,
        explanation=res.explanation,
        assumptions=res.assumptions,
    )
