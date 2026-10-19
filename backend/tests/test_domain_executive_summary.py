"""tests/test_domain_executive_summary.py

Unit tests for pure domain logic in app.domain.executive_summary.
Uses hand-built inputs only: no database, no network, completely deterministic.
"""

from datetime import date
from decimal import Decimal
from typing import Optional
import pytest

from app.domain.alerts import (
    AlertImpact,
    DisruptionAlert,
    MANDATORY_EXPOSURE_ASSUMPTION,
)
from app.domain.executive_summary import (
    DEFAULT_EXECUTIVE_SUMMARY_ASSUMPTIONS,
    ExecutiveSummaryInputs,
    build_executive_summary,
)
from app.domain.inventory import (
    ComponentRiskResult,
    ShortageEpisode,
)
from app.domain.recovery import (
    ComponentRecoveryRecommendation,
    RecoveryOption,
)
from app.domain.simulation import (
    AppliedRecoveryAction,
    InboundSummary,
    LaterShortageSummary,
    ScenarioResult,
    SimulationParams,
    SimulationResult,
)
from app.domain.supplier_risk import (
    InformationalCurrentState,
    SupplierRiskResult,
)


def _make_dummy_inventory_result(
    component_id: int,
    sku: str,
    name: str,
    risk_level: str = "critical",
    shortage_date: date = date(2026, 10, 21),
    days_until_shortage: int = 4,
    unmet_before_next_inbound: float = 200.0,
    has_later: bool = False,
) -> ComponentRiskResult:
    episodes = [
        ShortageEpisode(
            start_date=shortage_date,
            end_date=date(2026, 10, 23),
            days=3,
            unmet_units=unmet_before_next_inbound,
            ends_because="inbound_receipt",
        )
    ]
    if has_later:
        episodes.append(
            ShortageEpisode(
                start_date=date(2026, 11, 2),
                end_date=date(2026, 11, 15),
                days=14,
                unmet_units=500.0,
                ends_because="horizon_end",
            )
        )

    return ComponentRiskResult(
        component_id=component_id,
        sku=sku,
        name=name,
        category="processor",
        criticality="critical",
        plant_usable_stock=100,
        plant_on_hand=100,
        plant_reserved=0,
        usable_stock_breakdown=None,
        forecast_status="adequate",
        mean_daily_demand=50.0,
        weekday_forecast={i: 50.0 for i in range(7)},
        coverage_days=2.0,
        next_replenishment=None,
        shortage_date=shortage_date,
        days_until_shortage=days_until_shortage,
        unmet_demand_units=unmet_before_next_inbound,
        shortage_days=3,
        runout_date_without_inbound=shortage_date,
        shortage_episodes=episodes,
        unmet_before_next_inbound=unmet_before_next_inbound,
        first_episode_start_date=shortage_date,
        first_episode_end_date=date(2026, 10, 23),
        risk_level=risk_level,
        risk_reason=f"Projected shortage in {days_until_shortage} days",
        explanation="Inventory shortage projected",
        flags=[],
        assumptions=[],
        counted_inbound=[],
        unconfirmed_inbound=[],
        out_of_horizon_inbound=[],
        non_plant_inbound_count=0,
        non_plant_inbound_qty=0,
        regional_usable_stock=[],
        regional_total_usable=0,
        daily_projection=[],
    )


def _make_dummy_alert(
    component_id: int,
    sku: str,
    severity: str = "critical",
    days_until_impact: int = 4,
    orders_count: int = 10,
    exposed_revenue: Decimal = Decimal("150000.00"),
    supplier_id: int = 1,
) -> DisruptionAlert:
    return DisruptionAlert(
        id=f"alert-{sku}",
        type="inventory_shortage",
        severity=severity,
        title=f"Shortage for {sku}",
        summary=f"Projected shortage for {sku} starting {days_until_impact} days away",
        component_id=component_id,
        component_sku=sku,
        component_name=f"Name {sku}",
        supplier_id=supplier_id,
        supplier_code=f"SUP-{supplier_id}",
        po_number=None,
        days_until_impact=days_until_impact,
        detected_on=date(2026, 10, 17),
        evidence=[],
        assumptions=[],
        impact=AlertImpact(
            orders_count=orders_count,
            count_by_priority={"high": orders_count},
            total_component_units_required=orders_count * 10,
            exposed_revenue=exposed_revenue,
            exposed_orders=[],
        ),
        impact_null_reason=None,
    )


def _make_dummy_recommendation(
    component_id: int,
    sku: str,
    cost: Optional[Decimal] = Decimal("50000.00"),
    cost_known: bool = True,
) -> ComponentRecoveryRecommendation:
    opt = RecoveryOption(
        id="alt_supplier.SUP-ALT",
        kind="alternative_supplier",
        description=f"Procure from alternative supplier for {sku}",
        source_code="SUP-ALT",
        source_name="Alternative Supplier Inc",
        quantity=200,
        arrival_date=date(2026, 10, 20),
        arrival_within_time=True,
        incremental_cost=cost,
        cost_known=cost_known,
        unit_premium_vs_shortage_supplier=None,
        residual_unmet_before_next_inbound=0.0,
        new_shortage_date=None,
        remaining_total_unmet=0.0,
        constraints_applied=[],
        assumptions=[],
        flags=[],
        feasible=True,
        infeasible_reason=None,
    )
    runner_up = RecoveryOption(
        id="expedite.PO-100",
        kind="expedite_existing",
        description=f"Expedite PO-100 for {sku}",
        source_code="SUP-OLD",
        source_name="Old Supplier",
        quantity=200,
        arrival_date=date(2026, 10, 22),
        arrival_within_time=True,
        incremental_cost=Decimal("60000.00"),
        cost_known=True,
        unit_premium_vs_shortage_supplier=None,
        residual_unmet_before_next_inbound=0.0,
        new_shortage_date=None,
        remaining_total_unmet=0.0,
        constraints_applied=[],
        assumptions=[],
        flags=[],
        feasible=True,
        infeasible_reason=None,
    )
    return ComponentRecoveryRecommendation(
        component_id=component_id,
        sku=sku,
        name=f"Name {sku}",
        risk_level="critical",
        baseline_shortage_date=date(2026, 10, 21),
        baseline_unmet_before_next_inbound=200.0,
        need_units=200,
        baseline_summary="Baseline shortage",
        options=[opt, runner_up],
        combined_plan=None,
        recommended_option_id=opt.id,
        recommended_option_kind=opt.kind,
        reason=f"Recommended {opt.id} because it resolves the shortage.",
        alternatives_note=f"Preferred over runner-up {runner_up.id}.",
        later_shortage_note="Later shortage begins 2026-11-02 not covered by this recommendation.",
    )


def _make_dummy_simulation(
    component_id: int,
    sku: str,
    act_cost: Optional[Decimal] = Decimal("50000.00"),
    act_cost_known: bool = True,
) -> SimulationResult:
    scenario_base = ScenarioResult(
        risk_level="critical",
        shortage_date=date(2026, 10, 21),
        days_until_shortage=4,
        first_shortage_episode=None,
        unmet_before_next_inbound=200.0,
        later_episodes_note=None,
        next_inbound=None,
        mean_daily_demand=50.0,
        plant_usable_stock=100,
        daily_projection_30d=[],
        exposed_orders_count=15,
        exposed_revenue=Decimal("250000.00"),
        exposed_orders_summary="15 orders exposed",
        applied_actions=[],
    )
    scenario_rec = ScenarioResult(
        risk_level="none",
        shortage_date=None,
        days_until_shortage=None,
        first_shortage_episode=None,
        unmet_before_next_inbound=0.0,
        later_episodes_note=None,
        next_inbound=None,
        mean_daily_demand=50.0,
        plant_usable_stock=100,
        daily_projection_30d=[],
        exposed_orders_count=5,
        exposed_revenue=Decimal("80000.00"),
        exposed_orders_summary="5 orders exposed",
        applied_actions=[
            AppliedRecoveryAction(
                id="alt_supplier.SUP-ALT",
                kind="alternative_supplier",
                description="Procure from alternative supplier",
                source_code="SUP-ALT",
                quantity=200,
                arrival_date=date(2026, 10, 20),
                incremental_cost=act_cost,
                cost_known=act_cost_known,
            )
        ],
        shortage_resolved_for_first_window=True,
        later_shortage=LaterShortageSummary(
            date=date(2026, 11, 2),
            days=14,
            units=500.0,
            note="Later shortage not covered",
        ),
    )
    return SimulationResult(
        as_of=date(2026, 10, 17),
        component_id=component_id,
        sku=sku,
        name=f"Name {sku}",
        params=SimulationParams(),
        baseline=scenario_base,
        disrupted=scenario_base,
        recovered=scenario_rec,
        what_changed=[],
        assumptions=[],
    )


def _make_dummy_supplier_result(supplier_id: int, code: str, confidence: str = "high") -> SupplierRiskResult:
    return SupplierRiskResult(
        supplier_id=supplier_id,
        supplier_code=code,
        supplier_name=f"Name {code}",
        country="US",
        as_of=date(2026, 10, 17),
        n_deliveries=40 if confidence == "high" else 8,
        excluded_future_deliveries=0,
        has_excluded_future_deliveries=False,
        on_time_count=35,
        on_time_rate=0.875,
        on_time_ci_lower=0.75,
        on_time_ci_upper=0.95,
        late_delivery_probability=0.125,
        expected_delay_days_if_late=3.0,
        avg_delay_days_all=0.5,
        avg_delay_days_when_late=3.0,
        p50_delay_days_when_late=2.0,
        p90_delay_days_when_late=5.0,
        max_delay_days=6.0,
        total_ordered_qty=5000,
        total_received_qty=5000,
        total_rejected_qty=20,
        rejection_rate=0.004,
        fill_rate=1.0,
        risk_score=15.0,
        risk_band="low",
        confidence=confidence,
        metrics_breakdown=[],
        nominal_weights={},
        effective_weights={},
        metrics_used=[],
        metrics_dropped=[],
        main_drivers=[],
        monthly_breakdown=[],
        informational_po=InformationalCurrentState(0, 0, 0, 0),
        explanation=f"Descriptive risk for {code}",
        assumptions=[],
    )


def test_headline_generated_from_inputs():
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[_make_dummy_alert(1, "CPU-X7", "critical", 4)],
        recommendations=[_make_dummy_recommendation(1, "CPU-X7")],
        priority_simulation=_make_dummy_simulation(1, "CPU-X7"),
        inventory_results={1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7")},
        supplier_results={1: _make_dummy_supplier_result(1, "SUP-1")},
    )
    summary = build_executive_summary(inputs)
    assert "1 components face shortage risk" in summary.headline
    assert "the most urgent is CPU-X7" in summary.headline
    assert "short from 2026-10-21 (4 days)" in summary.headline


def test_top_risks_ordering_and_cap_at_3():
    # 5 components facing risks
    alerts = [
        _make_dummy_alert(1, "COMP-1", "critical", 2),
        _make_dummy_alert(2, "COMP-2", "critical", 5),
        _make_dummy_alert(3, "COMP-3", "high", 3),
        _make_dummy_alert(4, "COMP-4", "medium", 10),
        _make_dummy_alert(5, "COMP-5", "low", 15),
    ]
    inv_results = {
        i: _make_dummy_inventory_result(i, f"COMP-{i}", f"Name COMP-{i}")
        for i in range(1, 6)
    }
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=alerts,
        recommendations=[],
        priority_simulation=None,
        inventory_results=inv_results,
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    assert len(summary.top_risks) == 3
    assert [r.component_sku for r in summary.top_risks] == ["COMP-1", "COMP-2", "COMP-3"]


def test_no_risks_empty_list_and_headline():
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[],
        recommendations=[],
        priority_simulation=None,
        inventory_results={},
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    assert summary.top_risks == []
    assert summary.priority_decision is None
    assert summary.cost_comparison is None
    assert "none at risk" in summary.headline.lower()


def test_priority_decision_chosen_from_most_urgent():
    alerts = [
        _make_dummy_alert(1, "CPU-X7", "critical", 4),
        _make_dummy_alert(2, "GPU-RTX", "high", 8),
    ]
    recs = [
        _make_dummy_recommendation(2, "GPU-RTX"),
        _make_dummy_recommendation(1, "CPU-X7"),
    ]
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=alerts,
        recommendations=recs,
        priority_simulation=_make_dummy_simulation(1, "CPU-X7"),
        inventory_results={
            1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7"),
            2: _make_dummy_inventory_result(2, "GPU-RTX", "GPU-RTX", "high", date(2026, 10, 25), 8),
        },
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    assert summary.priority_decision is not None
    assert summary.priority_decision.component_sku == "CPU-X7"
    assert summary.priority_decision.recommended_option_id == "alt_supplier.SUP-ALT"


def test_cost_comparison_uses_supplied_values():
    sim = _make_dummy_simulation(1, "CPU-X7", act_cost=Decimal("75000.00"), act_cost_known=True)
    rec = _make_dummy_recommendation(1, "CPU-X7", cost=Decimal("75000.00"), cost_known=True)
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[_make_dummy_alert(1, "CPU-X7")],
        recommendations=[rec],
        priority_simulation=sim,
        inventory_results={1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7")},
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    assert summary.cost_comparison is not None
    cc = summary.cost_comparison
    assert cc.act.cost == Decimal("75000.00")
    assert cc.act.residual_units_short == 0.0
    assert cc.act.affected_orders_count == 5
    assert cc.act.selling_value == Decimal("80000.00")
    assert cc.do_nothing.units_short == 200.0
    assert cc.do_nothing.affected_orders_count == 15
    assert cc.do_nothing.selling_value == Decimal("250000.00")


def test_cost_comparison_unknown_cost_null_and_text_says_unknown():
    sim = _make_dummy_simulation(1, "CPU-X7", act_cost=None, act_cost_known=False)
    rec = _make_dummy_recommendation(1, "CPU-X7", cost=None, cost_known=False)
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[_make_dummy_alert(1, "CPU-X7")],
        recommendations=[rec],
        priority_simulation=sim,
        inventory_results={1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7")},
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    assert summary.cost_comparison is not None
    assert summary.cost_comparison.act.cost is None
    assert summary.cost_comparison.act.cost_known is False
    assert "Unknown" in summary.cost_comparison.difference_sentence


def test_difference_sentence_no_savings_or_loss_estimate_and_has_upper_bound():
    sim = _make_dummy_simulation(1, "CPU-X7")
    rec = _make_dummy_recommendation(1, "CPU-X7")
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[_make_dummy_alert(1, "CPU-X7")],
        recommendations=[rec],
        priority_simulation=sim,
        inventory_results={1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7")},
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    diff = summary.cost_comparison.difference_sentence
    # Strictly forbids "savings" and "loss estimate"
    assert "savings" not in diff.lower()
    assert "loss estimate" not in diff.lower()
    # Must contain upper bound statement
    assert "upper bound" in diff.lower()
    assert "not an estimate of loss" in diff.lower()


def test_exposure_not_summed_across_components():
    alerts = [
        _make_dummy_alert(1, "CPU-X7", orders_count=10, exposed_revenue=Decimal("100000.00")),
        _make_dummy_alert(2, "RAM-16", orders_count=5, exposed_revenue=Decimal("50000.00")),
    ]
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=alerts,
        recommendations=[],
        priority_simulation=None,
        inventory_results={
            1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7"),
            2: _make_dummy_inventory_result(2, "RAM-16", "RAM-16", "high", date(2026, 10, 24), 7),
        },
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    assert len(summary.exposure_totals) == 2
    assert summary.exposure_totals[0].component_sku == "CPU-X7"
    assert summary.exposure_totals[0].orders_count == 10
    assert summary.exposure_totals[1].component_sku == "RAM-16"
    assert summary.exposure_totals[1].orders_count == 5
    assert "not summed" in summary.exposure_note.lower()


def test_data_quality_counts_and_note():
    inv_results = {
        1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7"),
    }
    sup_results = {
        1: _make_dummy_supplier_result(1, "SUP-HELIX", confidence="high"),
    }
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[_make_dummy_alert(1, "CPU-X7", supplier_id=1)],
        recommendations=[],
        priority_simulation=None,
        inventory_results=inv_results,
        supplier_results=sup_results,
        priority_component_demand_history_days=28,
        flags=["inbound_promise_only"],
    )
    summary = build_executive_summary(inputs)
    dq = summary.data_quality
    assert dq.components_evaluated == 1
    assert dq.components_unknown_risk == 0
    assert dq.priority_component_demand_history_days == 28
    assert "inbound_promise_only" in dq.flags
    assert "Based on 1 components" in dq.data_quality_note
    assert "supplier confidence for SUP-HELIX is high" in dq.data_quality_note
    assert "%" not in dq.data_quality_note


def test_low_confidence_supplier_reflected():
    sup_results = {
        1: _make_dummy_supplier_result(1, "SUP-NEW", confidence="low"),
    }
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[_make_dummy_alert(1, "CPU-X7", supplier_id=1)],
        recommendations=[],
        priority_simulation=None,
        inventory_results={1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7")},
        supplier_results=sup_results,
    )
    summary = build_executive_summary(inputs)
    assert summary.data_quality.supplier_confidence_counts["low"] == 1
    assert "supplier confidence for SUP-NEW is low" in summary.data_quality.data_quality_note


def test_assumptions_present():
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[],
        recommendations=[],
        priority_simulation=None,
        inventory_results={},
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    text = " ".join(summary.assumptions).lower()
    assert "first shortage window" in text
    assert "not carried forward" in text
    assert "transfer" in text
    assert "weekday-average" in text
    assert "historical" in text
    assert "upper bound" in text


def test_determinism():
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=[_make_dummy_alert(1, "CPU-X7")],
        recommendations=[_make_dummy_recommendation(1, "CPU-X7")],
        priority_simulation=_make_dummy_simulation(1, "CPU-X7"),
        inventory_results={1: _make_dummy_inventory_result(1, "CPU-X7", "CPU-X7")},
        supplier_results={1: _make_dummy_supplier_result(1, "SUP-1")},
    )
    s1 = build_executive_summary(inputs)
    s2 = build_executive_summary(inputs)
    assert s1 == s2


def test_headline_excludes_low_and_none_risk_shortages():
    """Verify that headline counts only critical, high, or medium components facing shortage risk, excluding low and none."""
    # 1 critical, 1 high, 1 medium, 2 low with shortage, 1 none
    inv_results = {
        1: _make_dummy_inventory_result(1, "COMP-CRIT", "Critical", risk_level="critical", shortage_date=date(2026, 10, 20)),
        2: _make_dummy_inventory_result(2, "COMP-HIGH", "High", risk_level="high", shortage_date=date(2026, 10, 25)),
        3: _make_dummy_inventory_result(3, "COMP-MED", "Medium", risk_level="medium", shortage_date=date(2026, 11, 2)),
        4: _make_dummy_inventory_result(4, "COMP-LOW1", "Low 1", risk_level="low", shortage_date=date(2026, 11, 20)),
        5: _make_dummy_inventory_result(5, "COMP-LOW2", "Low 2", risk_level="low", shortage_date=date(2026, 11, 25)),
        6: _make_dummy_inventory_result(6, "COMP-NONE", "None", risk_level="none", shortage_date=None),
    }
    alerts = [
        _make_dummy_alert(1, "COMP-CRIT", "critical", 3),
        _make_dummy_alert(2, "COMP-HIGH", "high", 8),
        _make_dummy_alert(3, "COMP-MED", "medium", 16),
    ]
    inputs = ExecutiveSummaryInputs(
        as_of=date(2026, 10, 17),
        dataset_label="DEMO DATA",
        dataset_source="demo",
        is_live=False,
        alerts=alerts,
        recommendations=[_make_dummy_recommendation(1, "COMP-CRIT")],
        priority_simulation=_make_dummy_simulation(1, "COMP-CRIT"),
        inventory_results=inv_results,
        supplier_results={},
    )
    summary = build_executive_summary(inputs)
    # Exactly 3 components should be counted (critical, high, medium), excluding the 2 low-risk components
    assert "3 components face shortage risk;" in summary.headline
    assert "the most urgent is COMP-CRIT" in summary.headline


def test_headline_days_until_impact_matches_shortage_date_minus_as_of():
    """Step 0b fix: When a component has shortage_date (e.g. 2026-10-25) and as_of is 2026-10-18,
    days until impact must be exactly 7 days, even if an alert on that component has days_until_impact=0
    (such as an overdue purchase order alert).
    """
    as_of = date(2026, 10, 18)
    shortage_date = date(2026, 10, 25)
    sku = "CMP-CAM-103"

    # Alert has days_until_impact=0 (e.g. overdue PO alert)
    alert = _make_dummy_alert(103, sku, "critical", days_until_impact=0)
    inv_result = _make_dummy_inventory_result(
        103,
        sku,
        "Camera Module 103",
        risk_level="critical",
        shortage_date=shortage_date,
        days_until_shortage=7,
    )

    inputs = ExecutiveSummaryInputs(
        as_of=as_of,
        dataset_label="USER-SUPPLIED DATA",
        dataset_source="file-import",
        is_live=False,
        alerts=[alert],
        recommendations=[_make_dummy_recommendation(103, sku)],
        priority_simulation=_make_dummy_simulation(103, sku),
        inventory_results={103: inv_result},
        supplier_results={},
    )

    summary = build_executive_summary(inputs)
    # Verifies fix: 2026-10-25 minus 2026-10-18 = 7 days, NOT 0 days
    assert summary.top_risks[0].days_until_impact == 7
    assert "the most urgent is CMP-CAM-103, short from 2026-10-25 (7 days)." in summary.headline


