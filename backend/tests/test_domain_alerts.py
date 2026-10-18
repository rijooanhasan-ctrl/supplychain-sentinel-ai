"""Unit tests for app.domain.alerts.

Pure domain tests with hand-built inputs.
Verifies config validation, severity ranking, all 9 alert types, delay what-if scenarios,
impact/exposure calculations, compound alerts, determinism, and ordering.
"""

from datetime import date, timedelta
from decimal import Decimal
import math
import pytest

from app.domain.inventory import (
    InventoryRiskConfig,
    ComponentEvaluationInput,
    InboundLineInput,
    PlantInventoryInput,
    DemandHistoryRecordInput,
    ShortageEpisode,
    ComponentRiskResult,
    InboundSummaryItem,
    shift_inbound_for_supplier,
    evaluate_component,
)
from app.domain.supplier_risk import SupplierRiskResult, InformationalCurrentState
from app.domain.alerts import (
    AlertConfig,
    AlertResult,
    DisruptionAlert,
    EvidenceItem,
    DelayScenarioItem,
    AlertImpact,
    ExposedCustomerOrder,
    ComponentAlertInfo,
    PurchaseOrderInput,
    CustomerOrderInput,
    ProductInput,
    BomLineInput,
    SupplierOfferInput,
    DeliveryRecordInput,
    detect_alerts,
    rank_severity,
    escalate_severity,
    round_half_up,
)


def make_eval_result(
    component_id: int = 1,
    sku: str = "COMP-A",
    risk_level: str = "critical",
    usable_stock: int = 100,
    mean_demand: float = 20.0,
    shortage_date: date | None = date(2026, 10, 22),
    days_until_shortage: int | None = 5,
    episodes: list | None = None,
    unmet_before_next_inbound: float | None = 50.0,
    unmet_demand_units: float = 150.0,
    shortage_days: int = 10,
    flags: list[str] | None = None,
    counted_inbound: list | None = None,
) -> ComponentRiskResult:
    if episodes is None and shortage_date is not None:
        episodes = [
            ShortageEpisode(
                start_date=shortage_date,
                end_date=date(2026, 10, 26),
                days=5,
                unmet_units=50.0,
                ends_because="inbound_receipt",
            )
        ]
    return ComponentRiskResult(
        component_id=component_id,
        sku=sku,
        name=f"Name {sku}",
        category="Processors",
        criticality="critical",
        plant_usable_stock=usable_stock,
        plant_on_hand=usable_stock,
        plant_reserved=0,
        usable_stock_breakdown=None,
        forecast_status="ok",
        mean_daily_demand=mean_demand,
        weekday_forecast={0: mean_demand},
        coverage_days=usable_stock / mean_demand if mean_demand else None,
        next_replenishment=None,
        shortage_date=shortage_date,
        days_until_shortage=days_until_shortage,
        unmet_demand_units=unmet_demand_units,
        shortage_days=shortage_days,
        runout_date_without_inbound=shortage_date,
        shortage_episodes=episodes or [],
        unmet_before_next_inbound=unmet_before_next_inbound,
        first_episode_start_date=episodes[0].start_date if episodes else None,
        first_episode_end_date=episodes[0].end_date if episodes else None,
        risk_level=risk_level,
        risk_reason="Test risk reason",
        explanation="Test explanation",
        flags=flags or [],
        assumptions=[],
        counted_inbound=counted_inbound or [],
        unconfirmed_inbound=[],
        out_of_horizon_inbound=[],
        non_plant_inbound_count=0,
        non_plant_inbound_qty=0,
        regional_usable_stock=[],
        regional_total_usable=0,
        daily_projection=[],
    )


def make_supplier_result(
    supplier_id: int = 10,
    supplier_code: str = "SUP-A",
    supplier_name: str = "Supplier A",
    n_deliveries: int = 20,
    on_time_rate: float = 0.55,
    avg_delay_days_when_late: float = 7.44,
    p90_delay_days_when_late: float = 14.0,
) -> SupplierRiskResult:
    return SupplierRiskResult(
        supplier_id=supplier_id,
        supplier_code=supplier_code,
        supplier_name=supplier_name,
        country="DE",
        as_of=date(2026, 10, 17),
        n_deliveries=n_deliveries,
        excluded_future_deliveries=0,
        has_excluded_future_deliveries=False,
        on_time_count=int(n_deliveries * on_time_rate),
        on_time_rate=on_time_rate,
        on_time_ci_lower=0.4,
        on_time_ci_upper=0.7,
        late_delivery_probability=1.0 - on_time_rate,
        expected_delay_days_if_late=avg_delay_days_when_late,
        avg_delay_days_all=avg_delay_days_when_late * (1.0 - on_time_rate),
        avg_delay_days_when_late=avg_delay_days_when_late,
        p50_delay_days_when_late=5.0,
        p90_delay_days_when_late=p90_delay_days_when_late,
        max_delay_days=20.0,
        total_ordered_qty=1000,
        total_received_qty=1000,
        total_rejected_qty=10,
        rejection_rate=0.01,
        fill_rate=1.0,
        risk_score=50.0,
        risk_band="medium",
        confidence="high",
        metrics_breakdown=[],
        nominal_weights={},
        effective_weights={},
        metrics_used=[],
        metrics_dropped=[],
        main_drivers=[],
        monthly_breakdown=[],
        informational_po=InformationalCurrentState(0, 0, 0, 0),
        explanation="Test supplier explanation",
        assumptions=[],
    )


# =====================================================================
# 1. Config Validation and Severity Ranking
# =====================================================================

def test_alert_config_defaults_and_validation():
    cfg = AlertConfig()
    assert cfg.surge_recent_days == 14
    assert cfg.surge_baseline_days == 28
    assert cfg.surge_ratio_medium == 1.25
    assert cfg.surge_ratio_high == 1.5
    assert cfg.quality_rejection_threshold == 0.02
    assert cfg.delay_min_late_probability == 0.20
    assert cfg.delay_min_deliveries == 10

    # surge_ratio_medium <= 1
    with pytest.raises(ValueError, match="surge_ratio_medium"):
        AlertConfig(surge_ratio_medium=1.0)

    # surge_ratio_high <= surge_ratio_medium
    with pytest.raises(ValueError, match="surge_ratio_high"):
        AlertConfig(surge_ratio_medium=1.5, surge_ratio_high=1.5)

    # window <= 0
    with pytest.raises(ValueError, match="surge_recent_days"):
        AlertConfig(surge_recent_days=0)

    # rate not in (0, 1]
    with pytest.raises(ValueError, match="quality_rejection_threshold"):
        AlertConfig(quality_rejection_threshold=0.0)

    with pytest.raises(ValueError, match="delay_min_late_probability"):
        AlertConfig(delay_min_late_probability=1.5)

    # delay_min_deliveries < 1
    with pytest.raises(ValueError, match="delay_min_deliveries"):
        AlertConfig(delay_min_deliveries=0)

    # compound_min_types < 2
    with pytest.raises(ValueError, match="compound_min_types"):
        AlertConfig(compound_min_types=1)

    # compound_escalate_at_types <= compound_min_types
    with pytest.raises(ValueError, match="compound_escalate_at_types"):
        AlertConfig(compound_min_types=3, compound_escalate_at_types=3)


def test_severity_ranking_and_escalation():
    assert rank_severity("critical") > rank_severity("high")
    assert rank_severity("high") > rank_severity("medium")
    assert rank_severity("medium") > rank_severity("low")
    assert rank_severity("low") > rank_severity("info")

    assert escalate_severity("info") == "low"
    assert escalate_severity("low") == "medium"
    assert escalate_severity("medium") == "high"
    assert escalate_severity("high") == "critical"
    assert escalate_severity("critical") == "critical"


def test_round_half_up():
    assert round_half_up(7.44) == 7
    assert round_half_up(7.5) == 8
    assert round_half_up(7.50001) == 8
    assert round_half_up(0.5) == 1
    assert round_half_up(0.49) == 0


# =====================================================================
# 2. Inventory Shortage & Data Quality
# =====================================================================

def test_inventory_shortage_severity_mapping_and_filtering():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig()
    inv_cfg = InventoryRiskConfig()

    comps = [
        ComponentAlertInfo(1, "SKU-CRIT", "Name Crit", "critical", True),
        ComponentAlertInfo(2, "SKU-HIGH", "Name High", "high", True),
        ComponentAlertInfo(3, "SKU-MED", "Name Med", "normal", True),
        ComponentAlertInfo(4, "SKU-LOW", "Name Low", "low", True),
        ComponentAlertInfo(5, "SKU-NONE", "Name None", "low", True),
    ]

    res_map = {
        1: make_eval_result(1, "SKU-CRIT", "critical"),
        2: make_eval_result(2, "SKU-HIGH", "high"),
        3: make_eval_result(3, "SKU-MED", "medium"),
        4: make_eval_result(4, "SKU-LOW", "low"),
        5: make_eval_result(5, "SKU-NONE", "none"),
    }

    res = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results=res_map,
        supplier_results={},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )
    shortage_alerts = [a for a in res.alerts if a.type == "inventory_shortage"]
    assert len(shortage_alerts) == 3
    severities = {a.component_sku: a.severity for a in shortage_alerts}
    assert severities["SKU-CRIT"] == "critical"
    assert severities["SKU-HIGH"] == "high"
    assert severities["SKU-MED"] == "medium"
    assert "SKU-LOW" not in severities
    assert "SKU-NONE" not in severities


def test_data_quality_alert_for_unknown():
    as_of = date(2026, 10, 17)
    comps = [ComponentAlertInfo(1, "SKU-UNK", "Name Unk", "normal", True)]
    res_map = {1: make_eval_result(1, "SKU-UNK", "unknown", flags=["insufficient_demand_history"])}

    res = detect_alerts(
        as_of=as_of,
        config=AlertConfig(),
        inventory_config=InventoryRiskConfig(),
        components=comps,
        component_inputs={},
        component_results=res_map,
        supplier_results={},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )
    dq_alerts = [a for a in res.alerts if a.type == "data_quality"]
    assert len(dq_alerts) == 1
    assert dq_alerts[0].severity == "low"
    assert dq_alerts[0].component_sku == "SKU-UNK"
    assert "insufficient_demand_history" in dq_alerts[0].flags


# =====================================================================
# 3. Supplier Delay Exposure & What-If Scenarios
# =====================================================================

def make_inbound_line(
    po_id: int = 1,
    po_number: str = "PO-1",
    promised_date: date = date(2026, 10, 24),
    latest_estimate_date: date | None = None,
    qty_ordered: int = 100,
    qty_received: int = 0,
    supplier_code: str | None = "SUP-A",
) -> InboundLineInput:
    return InboundLineInput(
        po_id=po_id,
        po_number=po_number,
        po_status="open",
        warehouse_id=1,
        warehouse_code="WH-PLANT",
        warehouse_name="Plant",
        warehouse_role="plant",
        qty_ordered=qty_ordered,
        qty_received=qty_received,
        promised_date=promised_date,
        latest_estimate_date=latest_estimate_date,
        supplier_code=supplier_code,
    )


def make_comp_input(
    as_of: date,
    component_id: int = 1,
    sku: str = "COMP-1",
    name: str = "Component 1",
    plant_usable: int = 50,
    demand_records: list | None = None,
    inbound_lines: list | None = None,
) -> ComponentEvaluationInput:
    return ComponentEvaluationInput(
        as_of=as_of,
        component_id=component_id,
        sku=sku,
        name=name,
        category="Processors",
        criticality="critical",
        plant_inventory=PlantInventoryInput(on_hand=plant_usable, reserved=0),
        regional_inventories=[],
        demand_records=demand_records or [],
        inbound_lines=inbound_lines or [],
    )


def test_shift_inbound_helper_immutability_and_selective_shift():
    as_of = date(2026, 10, 17)
    inbound1 = make_inbound_line(
        po_number="PO-1",
        promised_date=date(2026, 10, 24),
        supplier_code="SUP-A",
    )
    inbound2 = make_inbound_line(
        po_number="PO-2",
        promised_date=date(2026, 10, 25),
        supplier_code="SUP-B",
    )
    comp_input = make_comp_input(
        as_of=as_of,
        component_id=10,
        sku="COMP-10",
        name="Component 10",
        plant_usable=50,
        demand_records=[],
        inbound_lines=[inbound1, inbound2],
    )

    shifted = shift_inbound_for_supplier(comp_input, "SUP-A", 5)
    # Original unchanged
    assert (comp_input.inbound_lines[0].latest_estimate_date or comp_input.inbound_lines[0].promised_date) == date(2026, 10, 24)
    assert (comp_input.inbound_lines[1].latest_estimate_date or comp_input.inbound_lines[1].promised_date) == date(2026, 10, 25)

    # Shifted has SUP-A shifted by 5 days, SUP-B untouched
    assert (shifted.inbound_lines[0].latest_estimate_date or shifted.inbound_lines[0].promised_date) == date(2026, 10, 29)
    assert (shifted.inbound_lines[1].latest_estimate_date or shifted.inbound_lines[1].promised_date) == date(2026, 10, 25)


def test_supplier_delay_exposure_rules():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig()
    inv_cfg = InventoryRiskConfig()

    inbound = make_inbound_line(
        po_number="PO-1",
        promised_date=date(2026, 10, 22),
        qty_ordered=1000,
        supplier_code="SUP-LATE",
    )
    demand_recs = [
        DemandHistoryRecordInput(date=as_of - timedelta(days=i), quantity=10.0)
        for i in range(1, 29)
    ]
    comp_input = make_comp_input(
        as_of=as_of,
        component_id=1,
        sku="COMP-1",
        name="Component 1",
        plant_usable=50,
        demand_records=demand_recs,
        inbound_lines=[inbound],
    )
    base_res = evaluate_component(comp_input, inv_cfg)
    assert base_res.unmet_demand_units == 0.0
    assert base_res.shortage_date is None

    comps = [ComponentAlertInfo(1, "COMP-1", "Component 1", "critical", True)]

    # 1. Below late probability threshold (0.199 < 0.20) -> no alert
    sup_low = make_supplier_result(10, "SUP-LATE", "Late Supplier", 20, on_time_rate=0.81, avg_delay_days_when_late=5.0)
    res_low = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={1: comp_input},
        component_results={1: base_res},
        supplier_results={10: sup_low},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )
    assert len([a for a in res_low.alerts if a.type == "supplier_delay_exposure"]) == 0

    # 2. Exactly at late probability threshold (0.20) -> alert generated
    sup_at = make_supplier_result(
        10, "SUP-LATE", "Late Supplier", 20,
        on_time_rate=0.80, # late prob = 0.20
        avg_delay_days_when_late=5.4, # rounds to 5
        p90_delay_days_when_late=10.2, # ceils to 11
    )
    res_at = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={1: comp_input},
        component_results={1: base_res},
        supplier_results={10: sup_at},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )
    delay_alerts = [a for a in res_at.alerts if a.type == "supplier_delay_exposure"]
    assert len(delay_alerts) == 1
    alert = delay_alerts[0]
    scenarios = {s.scenario_name: s for s in alert.delay_scenarios}
    assert scenarios["typical"].shift_days == 5
    assert scenarios["severe"].shift_days == 11
    assert scenarios["typical"].incremental_total_unmet > 0

    # 3. Low confidence cap at medium when n < 10
    sup_few = make_supplier_result(
        10, "SUP-LATE", "Late Supplier", 5, # < 10 deliveries
        on_time_rate=0.50,
        avg_delay_days_when_late=10.0,
        p90_delay_days_when_late=20.0,
    )
    res_few = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={1: comp_input},
        component_results={1: base_res},
        supplier_results={10: sup_few},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )
    alert_few = [a for a in res_few.alerts if a.type == "supplier_delay_exposure"][0]
    assert alert_few.severity in ("medium", "low")
    assert "low_confidence" in alert_few.flags


# =====================================================================
# 4. Purchase Order Slipped & Overdue
# =====================================================================

def test_po_slipped_and_overdue_rules():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig()
    inv_cfg = InventoryRiskConfig()

    comps = [ComponentAlertInfo(1, "COMP-1", "Component 1", "critical", True)]

    # Baseline component risk: critical with shortage on 2026-10-19
    res_crit = make_eval_result(1, "COMP-1", "critical", shortage_date=date(2026, 10, 19))

    # PO-OVERDUE: promised 2026-10-10, estimate 2026-10-15 (< as_of 2026-10-17)
    po_overdue = PurchaseOrderInput(
        po_id=1,
        po_number="PO-OVERDUE",
        supplier_id=10,
        supplier_code="SUP-A",
        status="open",
        promised_date=date(2026, 10, 10),
        latest_estimate_date=None,
        remaining_qty=100,
        component_ids=[1],
        component_skus=["COMP-1"],
    )

    # PO-SLIPPED: promised 2026-10-13, estimate 2026-10-20 (>= as_of)
    po_slipped = PurchaseOrderInput(
        po_id=2,
        po_number="PO-SLIPPED",
        supplier_id=10,
        supplier_code="SUP-A",
        status="open",
        promised_date=date(2026, 10, 13),
        latest_estimate_date=date(2026, 10, 20),
        remaining_qty=50,
        component_ids=[1],
        component_skus=["COMP-1"],
    )

    res = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results={1: res_crit},
        supplier_results={},
        purchase_orders=[po_overdue, po_slipped],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )

    # PO-OVERDUE: expected date 2026-10-15 < 2026-10-17 -> po_overdue
    # Component is critical -> severity high!
    overdue_alerts = [a for a in res.alerts if a.type == "po_overdue"]
    assert len(overdue_alerts) == 1
    assert overdue_alerts[0].severity == "high"

    # PO-SLIPPED: estimate 2026-10-20 is AFTER shortage_date 2026-10-19 -> severity high!
    slipped_alerts = [a for a in res.alerts if a.type == "po_slipped"]
    assert len(slipped_alerts) == 1
    assert slipped_alerts[0].severity == "high"

    # If component has shortage on 2026-10-25 (after PO estimate 2026-10-20) -> severity low
    res_crit_late = make_eval_result(1, "COMP-1", "critical", shortage_date=date(2026, 10, 25))
    res2 = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results={1: res_crit_late},
        supplier_results={},
        purchase_orders=[po_slipped],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )
    slipped2 = [a for a in res2.alerts if a.type == "po_slipped"]
    assert slipped2[0].severity == "low"


# =====================================================================
# 5. Demand Surge Detection
# =====================================================================

def test_demand_surge_rules():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig(
        surge_recent_days=14,
        surge_baseline_days=28,
        surge_ratio_medium=1.25,
        surge_ratio_high=1.5,
        surge_min_baseline_mean=5.0,
        surge_min_coverage=0.8,
    )
    inv_cfg = InventoryRiskConfig()

    def run_surge_test(comp_sku: str, recs: list[DemandHistoryRecordInput]):
        comps = [ComponentAlertInfo(1, comp_sku, "Name", "normal", True)]
        comp_in = make_comp_input(as_of, 1, comp_sku, "Name", 100, demand_records=recs)
        return detect_alerts(
            as_of=as_of,
            config=cfg,
            inventory_config=inv_cfg,
            components=comps,
            component_inputs={1: comp_in},
            component_results={1: make_eval_result(1, comp_sku, "low")},
            supplier_results={},
            purchase_orders=[],
            customer_orders=[],
            bom_lines=[],
            products=[],
            supplier_offers=[],
            deliveries=[],
        )

    # 1. Exact 1.25 ratio -> medium (12.5 / 10.0 = 1.25)
    recs_125 = [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=12.5)
        for d in range(1, 15)
    ] + [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=10.0)
        for d in range(15, 43)
    ]
    res_125 = run_surge_test("SKU-125", recs_125)
    surge_125 = [a for a in res_125.alerts if a.type == "demand_surge"]
    assert len(surge_125) == 1
    assert surge_125[0].severity == "medium"

    # 2. Exact 1.50 ratio -> high (15.0 / 10.0 = 1.50)
    recs_150 = [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=15.0)
        for d in range(1, 15)
    ] + [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=10.0)
        for d in range(15, 43)
    ]
    res_150 = run_surge_test("SKU-150", recs_150)
    surge_150 = [a for a in res_150.alerts if a.type == "demand_surge"]
    assert len(surge_150) == 1
    assert surge_150[0].severity == "high"

    # 3. 1.24 ratio (< 1.25) -> no alert
    recs_124 = [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=12.4)
        for d in range(1, 15)
    ] + [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=10.0)
        for d in range(15, 43)
    ]
    res_124 = run_surge_test("SKU-124", recs_124)
    assert len([a for a in res_124.alerts if a.type == "demand_surge"]) == 0

    # 4. Low baseline mean (< 5.0) -> no alert
    recs_low = [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=8.0)
        for d in range(1, 15)
    ] + [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=4.0)
        for d in range(15, 43)
    ]
    res_low = run_surge_test("SKU-LOW", recs_low)
    assert len([a for a in res_low.alerts if a.type == "demand_surge"]) == 0

    # 5. Coverage gap in baseline (< 0.8) -> no alert
    recs_gap = [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=20.0)
        for d in range(1, 15)
    ] + [
        DemandHistoryRecordInput(date=as_of - timedelta(days=d), quantity=10.0)
        for d in range(15, 35)  # only 20 of 28 days = 71.4% < 80%
    ]
    res_gap = run_surge_test("SKU-GAP", recs_gap)
    assert len([a for a in res_gap.alerts if a.type == "demand_surge"]) == 0


# =====================================================================
# 6. Quality Issue Detection
# =====================================================================

def test_quality_issue_rules():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig(
        quality_recent_days=90,
        quality_rejection_threshold=0.02,
        quality_min_received_units=500,
    )
    inv_cfg = InventoryRiskConfig()

    def run_quality_test(delivs: list[DeliveryRecordInput]):
        sup = make_supplier_result(1, "SUP-Q", "Quality Supplier")
        return detect_alerts(
            as_of=as_of,
            config=cfg,
            inventory_config=inv_cfg,
            components=[],
            component_inputs={},
            component_results={},
            supplier_results={1: sup},
            purchase_orders=[],
            customer_orders=[],
            bom_lines=[],
            products=[],
            supplier_offers=[],
            deliveries=delivs,
        )

    # 1. Below threshold (< 0.02): 5 rejected / 500 = 0.01 -> none
    delivs_low = [
        DeliveryRecordInput(1, 1, "SUP-Q", 1, as_of - timedelta(days=10), as_of - timedelta(days=10), 500, 500, 5)
    ]
    res_low = run_quality_test(delivs_low)
    assert len([a for a in res_low.alerts if a.type == "quality_issue"]) == 0

    # 2. At threshold (0.02): 10 rejected / 500 = 0.02 -> medium
    delivs_med = [
        DeliveryRecordInput(2, 1, "SUP-Q", 1, as_of - timedelta(days=10), as_of - timedelta(days=10), 500, 500, 10)
    ]
    res_med = run_quality_test(delivs_med)
    q_med = [a for a in res_med.alerts if a.type == "quality_issue"]
    assert len(q_med) == 1
    assert q_med[0].severity == "medium"

    # 3. High severity (>= 2x threshold = 0.04): 25 rejected / 500 = 0.05 -> high
    delivs_high = [
        DeliveryRecordInput(3, 1, "SUP-Q", 1, as_of - timedelta(days=10), as_of - timedelta(days=10), 500, 500, 25)
    ]
    res_high = run_quality_test(delivs_high)
    q_high = [a for a in res_high.alerts if a.type == "quality_issue"]
    assert len(q_high) == 1
    assert q_high[0].severity == "high"

    # 4. Under min received units (< 500): 10 rejected / 400 = 0.025 -> no alert
    delivs_small = [
        DeliveryRecordInput(4, 1, "SUP-Q", 1, as_of - timedelta(days=10), as_of - timedelta(days=10), 400, 400, 10)
    ]
    res_small = run_quality_test(delivs_small)
    assert len([a for a in res_small.alerts if a.type == "quality_issue"]) == 0

    # 5. Delivery after as_of excluded
    delivs_future = [
        DeliveryRecordInput(5, 1, "SUP-Q", 1, as_of + timedelta(days=1), as_of + timedelta(days=1), 1000, 1000, 100)
    ]
    res_future = run_quality_test(delivs_future)
    assert len([a for a in res_future.alerts if a.type == "quality_issue"]) == 0


# =====================================================================
# 7. Capacity Constraint Detection
# =====================================================================

def test_capacity_constraint_rules():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig()
    inv_cfg = InventoryRiskConfig()

    comps = [ComponentAlertInfo(1, "COMP-1", "Component 1", "critical", True)]
    res_high = make_eval_result(1, "COMP-1", "high", mean_demand=20.0) # 7 * 20 = 140

    def run_cap_test(offers: list[SupplierOfferInput], comp_res=res_high):
        return detect_alerts(
            as_of=as_of,
            config=cfg,
            inventory_config=inv_cfg,
            components=comps,
            component_inputs={},
            component_results={1: comp_res},
            supplier_results={},
            purchase_orders=[],
            customer_orders=[],
            bom_lines=[],
            products=[],
            supplier_offers=offers,
            deliveries=[],
        )

    # 1. All non-null, sum < 140 -> insufficient (medium)
    offers_ins = [
        SupplierOfferInput(10, "SUP-A", 1, 50),
        SupplierOfferInput(11, "SUP-B", 1, 60),  # total 110 < 140
    ]
    res_ins = run_cap_test(offers_ins)
    cap_ins = [a for a in res_ins.alerts if a.type == "capacity_constraint"]
    assert len(cap_ins) == 1
    assert cap_ins[0].id == "capacity_constraint.COMP-1.insufficient"
    assert cap_ins[0].severity == "medium"

    # 2. Any offer has null capacity -> unknown (low)
    offers_unk = [
        SupplierOfferInput(10, "SUP-A", 1, 50),
        SupplierOfferInput(11, "SUP-B", 1, None),
    ]
    res_unk = run_cap_test(offers_unk)
    cap_unk = [a for a in res_unk.alerts if a.type == "capacity_constraint"]
    assert len(cap_unk) == 1
    assert cap_unk[0].id == "capacity_constraint.COMP-1.unknown"
    assert cap_unk[0].severity == "low"

    # 3. Sufficient capacity: 150 >= 140 -> no alert
    offers_suf = [
        SupplierOfferInput(10, "SUP-A", 1, 80),
        SupplierOfferInput(11, "SUP-B", 1, 70),  # total 150 >= 140
    ]
    res_suf = run_cap_test(offers_suf)
    assert len([a for a in res_suf.alerts if a.type == "capacity_constraint"]) == 0

    # 4. Low risk component -> no capacity alert even if insufficient
    res_low = make_eval_result(1, "COMP-1", "low", mean_demand=20.0)
    res_low_cap = run_cap_test(offers_ins, comp_res=res_low)
    assert len([a for a in res_low_cap.alerts if a.type == "capacity_constraint"]) == 0


# =====================================================================
# 8. Compound Risk Detection
# =====================================================================

def test_compound_risk_rules():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig(compound_min_types=2, compound_escalate_at_types=3)
    inv_cfg = InventoryRiskConfig()

    comps = [ComponentAlertInfo(1, "COMP-1", "Component 1", "critical", True)]

    # Case A: 2 distinct types (inventory_shortage: critical, capacity_constraint: medium)
    # Highest is critical -> compound severity critical
    res_crit = make_eval_result(1, "COMP-1", "critical", mean_demand=20.0)
    offers_ins = [SupplierOfferInput(10, "SUP-A", 1, 50)]  # < 140 -> medium
    res_a = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results={1: res_crit},
        supplier_results={},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=offers_ins,
        deliveries=[],
    )
    comp_a = [a for a in res_a.alerts if a.type == "compound_risk"]
    assert len(comp_a) == 1
    assert comp_a[0].severity == "critical"
    assert len(comp_a[0].related_alert_ids) == 2
    assert "inventory_shortage.COMP-1" in comp_a[0].related_alert_ids
    assert "capacity_constraint.COMP-1.insufficient" in comp_a[0].related_alert_ids

    # Case B: 3 distinct types at medium severity -> escalates to high!
    res_med = make_eval_result(1, "COMP-1", "medium", mean_demand=20.0)
    po_overdue = PurchaseOrderInput(
        po_id=1,
        po_number="PO-MED",
        supplier_id=10,
        supplier_code="SUP-A",
        status="open",
        promised_date=date(2026, 10, 10),
        latest_estimate_date=None,
        remaining_qty=100,
        component_ids=[1],
        component_skus=["COMP-1"],
    )
    res_b = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results={1: res_med},
        supplier_results={},
        purchase_orders=[po_overdue],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=offers_ins,
        deliveries=[],
    )
    comp_b = [a for a in res_b.alerts if a.type == "compound_risk"]
    assert len(comp_b) == 1
    # Base severity medium escalated to high!
    assert comp_b[0].severity == "high"
    assert len(comp_b[0].related_alert_ids) == 3

    # Case C: Low severity alert ignored for compound
    # 1 medium inventory_shortage and 1 low capacity_constraint -> only 1 type >= medium -> no compound alert
    offers_unk = [SupplierOfferInput(10, "SUP-A", 1, None)] # low capacity_constraint
    res_c = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results={1: res_med},
        supplier_results={},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=offers_unk,
        deliveries=[],
    )
    assert len([a for a in res_c.alerts if a.type == "compound_risk"]) == 0


# =====================================================================
# 9. Impact and Exposure Calculations
# =====================================================================

def test_impact_order_filtering_and_decimal_revenue():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig()
    inv_cfg = InventoryRiskConfig()

    comps = [ComponentAlertInfo(1, "COMP-1", "Component 1", "critical", True)]
    res_crit = make_eval_result(1, "COMP-1", "critical", shortage_date=date(2026, 10, 22))

    products = [
        ProductInput(10, "LAPTOP-X", "Laptop X", Decimal("1200.50")),
        ProductInput(20, "LAPTOP-Y", "Laptop Y", Decimal("500.00")),
    ]

    bom = [
        BomLineInput(product_id=10, component_id=1, quantity_per_unit=2),
        BomLineInput(product_id=20, component_id=2, quantity_per_unit=1),
    ]

    orders = [
        # 1. Valid: open, due 2026-10-24, priority critical, qty 10 -> rev = 12005.00
        CustomerOrderInput(1, "ORD-1", "Acme", 10, 10, date(2026, 10, 24), "critical", "open"),
        # 2. Valid: in_production, due 2026-10-22 (exact shortage date), priority normal, qty 5 -> rev = 6002.50
        CustomerOrderInput(2, "ORD-2", "Beta", 10, 5, date(2026, 10, 22), "normal", "in_production"),
        # 3. Before shortage date: due 2026-10-20 -> EXCLUDED
        CustomerOrderInput(3, "ORD-3", "Gamma", 10, 8, date(2026, 10, 20), "high", "open"),
        # 4. Status shipped -> EXCLUDED
        CustomerOrderInput(4, "ORD-4", "Delta", 10, 10, date(2026, 10, 25), "high", "shipped"),
        # 5. Status cancelled -> EXCLUDED
        CustomerOrderInput(5, "ORD-5", "Epsilon", 10, 10, date(2026, 10, 25), "high", "cancelled"),
        # 6. Unrelated product -> EXCLUDED
        CustomerOrderInput(6, "ORD-6", "Zeta", 20, 10, date(2026, 10, 25), "high", "open"),
        # 7. Beyond horizon (due 2027-02-01) -> EXCLUDED
        CustomerOrderInput(7, "ORD-7", "Eta", 10, 10, date(2027, 2, 1), "high", "open"),
    ]

    res = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results={1: res_crit},
        supplier_results={},
        purchase_orders=[],
        customer_orders=orders,
        bom_lines=bom,
        products=products,
        supplier_offers=[],
        deliveries=[],
    )
    alert = [a for a in res.alerts if a.type == "inventory_shortage"][0]
    assert alert.impact is not None
    assert alert.impact.orders_count == 2
    assert alert.impact.count_by_priority == {"critical": 1, "high": 0, "normal": 1, "low": 0}
    # Total units required: (10 * 2) + (5 * 2) = 30
    assert alert.impact.total_component_units_required == 30
    # Total revenue: 12005.00 + 6002.50 = 18007.50
    assert alert.impact.exposed_revenue == Decimal("18007.50")
    # Mandatory assumptions text
    assert any("Upper bound of exposure" in a for a in alert.assumptions)


# =====================================================================
# 10. Ordering, Determinism, and Stable IDs
# =====================================================================

def test_alert_ordering_and_determinism():
    as_of = date(2026, 10, 17)
    cfg = AlertConfig()
    inv_cfg = InventoryRiskConfig()

    comps = [
        ComponentAlertInfo(1, "SKU-CRIT-LATE", "Name 1", "critical", True),
        ComponentAlertInfo(2, "SKU-CRIT-SOON", "Name 2", "critical", True),
        ComponentAlertInfo(3, "SKU-HIGH", "Name 3", "high", True),
        ComponentAlertInfo(4, "SKU-UNK", "Name 4", "normal", True),
    ]

    res_map = {
        1: make_eval_result(1, "SKU-CRIT-LATE", "critical", days_until_shortage=10),
        2: make_eval_result(2, "SKU-CRIT-SOON", "critical", days_until_shortage=2),
        3: make_eval_result(3, "SKU-HIGH", "high", days_until_shortage=1),
        4: make_eval_result(4, "SKU-UNK", "unknown"),
    }

    result_a = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results=res_map,
        supplier_results={},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )
    result_b = detect_alerts(
        as_of=as_of,
        config=cfg,
        inventory_config=inv_cfg,
        components=comps,
        component_inputs={},
        component_results=res_map,
        supplier_results={},
        purchase_orders=[],
        customer_orders=[],
        bom_lines=[],
        products=[],
        supplier_offers=[],
        deliveries=[],
    )

    # Identical output
    assert [a.id for a in result_a.alerts] == [a.id for a in result_b.alerts]
    assert result_a.counts_by_severity == result_b.counts_by_severity
    assert result_a.counts_by_type == result_b.counts_by_type

    # Ordering: Critical first (soonest first), then High, then Low
    alert_ids = [a.id for a in result_a.alerts]
    assert alert_ids.index("inventory_shortage.SKU-CRIT-SOON") < alert_ids.index("inventory_shortage.SKU-CRIT-LATE")
    assert alert_ids.index("inventory_shortage.SKU-CRIT-LATE") < alert_ids.index("inventory_shortage.SKU-HIGH")
    assert alert_ids.index("inventory_shortage.SKU-HIGH") < alert_ids.index("data_quality.SKU-UNK")
