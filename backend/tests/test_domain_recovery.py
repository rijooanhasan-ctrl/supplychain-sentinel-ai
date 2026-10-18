"""tests/test_domain_recovery.py

Pure domain unit tests for recovery recommendations.
Uses hand-built frozen dataclasses with zero DB or framework dependencies.
"""

import datetime
from decimal import Decimal
import math
import pytest

from app.domain.inventory import (
    ComponentEvaluationInput,
    ComponentRiskResult,
    DemandHistoryRecordInput,
    InboundLineInput,
    InventoryRiskConfig,
    PlantInventoryInput,
    RegionalInventoryInput,
    RegionalStockItem,
    add_inbound,
    expedite_inbound,
)
from app.domain.recovery import (
    CombinedPlan,
    CombinedPlanStep,
    ComponentRecoveryRecommendation,
    RecoveryConfig,
    RecoveryOption,
    SupplierOfferInput,
    evaluate_component_recovery,
)


def make_test_input(
    as_of: datetime.date = datetime.date(2026, 10, 17),
    plant_stock: int = 100,
    daily_demand: float = 50.0,
    inbound_lines: list = None,
    regional_inventories: list = None,
) -> ComponentEvaluationInput:
    """Builds a deterministic ComponentEvaluationInput."""
    demand_records = [
        DemandHistoryRecordInput(date=as_of - datetime.timedelta(days=i), quantity=daily_demand)
        for i in range(1, 29)
    ]
    return ComponentEvaluationInput(
        as_of=as_of,
        component_id=1,
        sku="COMP-01",
        name="Test Component",
        category="Processors",
        criticality="critical",
        plant_inventory=PlantInventoryInput(
            on_hand=plant_stock,
            reserved=0,
        ),
        regional_inventories=regional_inventories or [],
        demand_records=demand_records,
        inbound_lines=inbound_lines or [],
    )


# =============================================================================
# 1. Config Validation
# =============================================================================

def test_recovery_config_validation():
    # Valid default
    cfg = RecoveryConfig()
    assert cfg.transfer_days == 2
    assert cfg.transfer_cost_per_unit is None

    # Valid with cost
    cfg2 = RecoveryConfig(transfer_days=3, transfer_cost_per_unit=Decimal("5.50"))
    assert cfg2.transfer_days == 3
    assert cfg2.transfer_cost_per_unit == Decimal("5.50")

    # Invalid negative transfer_days
    with pytest.raises(ValueError, match="transfer_days must be non-negative"):
        RecoveryConfig(transfer_days=-1)

    # Invalid negative transfer_cost
    with pytest.raises(ValueError, match="transfer_cost_per_unit cannot be negative"):
        RecoveryConfig(transfer_cost_per_unit=Decimal("-0.01"))


# =============================================================================
# 2. Inbound Helpers Immutability
# =============================================================================

def test_helpers_immutability():
    as_of = datetime.date(2026, 10, 17)
    base_inbound = InboundLineInput(
        po_id=10,
        po_number="PO-EXISTING",
        po_status="open",
        warehouse_id=1,
        warehouse_code="WH-PLANT-01",
        warehouse_name="Plant Alpha",
        warehouse_role="plant",
        qty_ordered=500,
        qty_received=0,
        promised_date=as_of + datetime.timedelta(days=10),
        latest_estimate_date=None,
        supplier_code="SUP-A",
    )
    orig_input = make_test_input(inbound_lines=[base_inbound])

    # Test add_inbound
    new_in = add_inbound(
        orig_input,
        qty=200,
        arrival_date=as_of + datetime.timedelta(days=3),
        label="PO-ADDED",
        supplier_code="SUP-B",
    )
    assert len(orig_input.inbound_lines) == 1
    assert len(new_in.inbound_lines) == 2
    assert new_in.inbound_lines[1].po_number == "PO-ADDED"
    assert new_in.inbound_lines[1].qty_ordered == 200

    # Test expedite_inbound
    exp_in = expedite_inbound(
        orig_input,
        po_number="PO-EXISTING",
        new_arrival_date=as_of + datetime.timedelta(days=5),
    )
    assert orig_input.inbound_lines[0].promised_date == as_of + datetime.timedelta(days=10)
    assert exp_in.inbound_lines[0].promised_date == as_of + datetime.timedelta(days=5)
    assert exp_in.inbound_lines[0].latest_estimate_date == as_of + datetime.timedelta(days=5)


# =============================================================================
# 3. Evaluation: No Shortage produces None
# =============================================================================

def test_no_shortage_produces_none():
    from app.domain.inventory import evaluate_component

    as_of = datetime.date(2026, 10, 17)
    inv_cfg = InventoryRiskConfig()
    rec_cfg = RecoveryConfig()

    # Plenty of stock: 10,000 units, 50/day -> no shortage
    comp_in = make_test_input(as_of=as_of, plant_stock=10000, daily_demand=50.0)
    base_res = evaluate_component(comp_in, inv_cfg)
    assert base_res.risk_level == "low"

    rec = evaluate_component_recovery(
        component_input=comp_in,
        baseline_result=base_res,
        supplier_offers=[],
        regional_stocks=[],
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        inventory_config=inv_cfg,
        recovery_config=rec_cfg,
    )
    assert rec is None


# =============================================================================
# 4. Evaluation: Candidate Options & Ranking
# =============================================================================

def test_recovery_options_evaluation_and_rules():
    from app.domain.inventory import evaluate_component

    as_of = datetime.date(2026, 10, 17)
    inv_cfg = InventoryRiskConfig()
    rec_cfg = RecoveryConfig(transfer_days=2, transfer_cost_per_unit=None)

    # 100 on-hand, 50/day. Days 0,1 consume 100 -> shortage on Day 2 (as_of + 2d = 2026-10-19)
    # PO-EXISTING of 500 units promised on Day 5 (2026-10-22)
    # Shortage period is Days 2, 3, 4 (3 days, 150 units unmet before next inbound)
    base_line = InboundLineInput(
        po_id=1,
        po_number="PO-EXISTING",
        po_status="open",
        warehouse_id=1,
        warehouse_code="WH-PLANT-01",
        warehouse_name="Plant Alpha",
        warehouse_role="plant",
        qty_ordered=500,
        qty_received=0,
        promised_date=as_of + datetime.timedelta(days=5),
        latest_estimate_date=None,
        supplier_code="SUP-SHORT",
    )
    regional_in = [
        RegionalInventoryInput(
            warehouse_id=2,
            warehouse_code="WH-REG-EAST",
            warehouse_name="East Hub",
            on_hand=80,
            reserved=0,
        ),
        RegionalInventoryInput(
            warehouse_id=3,
            warehouse_code="WH-REG-EMPTY",
            warehouse_name="Empty Hub",
            on_hand=0,
            reserved=0,
        ),
    ]
    offers = [
        # Shortage supplier offer (expedite available, lead time 1 day -> arrives Day 1 = 2026-10-18)
        SupplierOfferInput(
            supplier_id=1,
            supplier_code="SUP-SHORT",
            supplier_name="Shortage Supplier",
            component_id=1,
            unit_cost=Decimal("100.00"),
            lead_time_days=7,
            min_order_qty=50,
            max_weekly_capacity=1000,
            is_preferred=True,
            expedite_available=True,
            expedite_lead_time_days=1,
            expedite_cost_premium_pct=Decimal("0.20"),
        ),
        # Alternative supplier (lead time 2 days -> arrives Day 2 = 2026-10-19, MOQ 100, capacity 300)
        SupplierOfferInput(
            supplier_id=2,
            supplier_code="SUP-ALT",
            supplier_name="Alternative Supplier",
            component_id=1,
            unit_cost=Decimal("120.00"),
            lead_time_days=2,
            min_order_qty=100,
            max_weekly_capacity=300,
            is_preferred=False,
            expedite_available=False,
            expedite_lead_time_days=None,
            expedite_cost_premium_pct=None,
        ),
    ]

    comp_in = make_test_input(
        as_of=as_of,
        plant_stock=100,
        daily_demand=50.0,
        inbound_lines=[base_line],
        regional_inventories=regional_in,
    )
    base_res = evaluate_component(comp_in, inv_cfg)
    assert base_res.unmet_before_next_inbound is not None
    assert base_res.unmet_before_next_inbound > 0

    rec = evaluate_component_recovery(
        component_input=comp_in,
        baseline_result=base_res,
        supplier_offers=offers,
        regional_stocks=base_res.regional_usable_stock,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        inventory_config=inv_cfg,
        recovery_config=rec_cfg,
    )
    assert rec is not None
    assert rec.need_units == math.ceil(base_res.unmet_before_next_inbound)

    opt_map = {o.id: o for o in rec.options}

    # 1. Expedite option check
    exp_opt = opt_map["expedite.PO-EXISTING"]
    assert exp_opt.feasible is True
    assert exp_opt.arrival_date == as_of + datetime.timedelta(days=1)
    assert exp_opt.quantity == 500
    # Cost = 500 * 100.00 * 0.20 = 10,000.00
    assert exp_opt.incremental_cost == Decimal("10000.00")
    # Arrives Day 1 before shortage Day 2 -> residual should be 0.0
    assert exp_opt.residual_unmet_before_next_inbound == 0.0

    # 2. Alternative supplier check
    alt_opt = opt_map["alt_supplier.SUP-ALT"]
    assert alt_opt.feasible is True
    assert alt_opt.arrival_date == as_of + datetime.timedelta(days=2)
    # need_units = 150, MOQ = 100 -> qty = max(150, 100) = 150 <= 300 capacity
    assert alt_opt.quantity == 150
    assert alt_opt.incremental_cost == Decimal("150") * Decimal("120.00") # 18,000.00
    # Arrives at start of Day 2 (the shortage day) -> residual = 0.0
    assert alt_opt.residual_unmet_before_next_inbound == 0.0
    # Unit premium vs shortage supplier = 120.00 - 100.00 = +20.00
    assert alt_opt.unit_premium_vs_shortage_supplier == Decimal("20.00")

    # 3. Transfer option check (WH-REG-EAST)
    east_opt = opt_map["transfer.WH-REG-EAST"]
    assert east_opt.feasible is True
    assert east_opt.quantity == 80 # Capped at usable stock 80 (< 150 needed)
    assert east_opt.cost_known is False # transfer_cost_per_unit is None
    assert east_opt.incremental_cost is None
    assert "transfer_cost_unknown" in east_opt.flags
    # Residual should be 150 - 80 = 70.0
    assert round(east_opt.residual_unmet_before_next_inbound, 1) == 70.0

    # 4. Transfer option check (WH-REG-EMPTY)
    empty_opt = opt_map["transfer.WH-REG-EMPTY"]
    assert empty_opt.feasible is False
    assert "zero usable" in empty_opt.infeasible_reason

    # 5. Accept delay check
    delay_opt = opt_map["accept_delay"]
    assert delay_opt.feasible is True
    assert delay_opt.incremental_cost == Decimal("0.00")
    assert delay_opt.residual_unmet_before_next_inbound == base_res.unmet_before_next_inbound

    # 6. Recommendation check
    # Expedite has residual 0.0 and cost 10,000.00
    # Alt supplier has residual 0.0 and cost 18,000.00
    # Expedite has lower cost -> Expedite should be recommended!
    assert rec.recommended_option_id == "expedite.PO-EXISTING"
    assert "PO-EXISTING" in rec.reason
    assert "alt_supplier.SUP-ALT" in rec.reason or "runner-up" in rec.reason.lower()
    assert "transfer options have unknown cost and were ranked after" in rec.reason
    assert "targets the first shortage window; later shortages are not covered" in rec.reason


# =============================================================================
# 5. Infeasible Expedite When Not Earlier
# =============================================================================

def test_expedite_infeasible_when_not_earlier():
    from app.domain.inventory import evaluate_component

    as_of = datetime.date(2026, 10, 17)
    inv_cfg = InventoryRiskConfig()
    rec_cfg = RecoveryConfig()

    # PO promised in 3 days, but expedite lead time is 5 days
    base_line = InboundLineInput(
        po_id=1,
        po_number="PO-SLOW-EXP",
        po_status="open",
        warehouse_id=1,
        warehouse_code="WH-PLANT-01",
        warehouse_name="Plant Alpha",
        warehouse_role="plant",
        qty_ordered=200,
        qty_received=0,
        promised_date=as_of + datetime.timedelta(days=3),
        latest_estimate_date=None,
        supplier_code="SUP-SLOW",
    )
    offers = [
        SupplierOfferInput(
            supplier_id=1,
            supplier_code="SUP-SLOW",
            supplier_name="Slow Expedite Supplier",
            component_id=1,
            unit_cost=Decimal("50.00"),
            lead_time_days=10,
            min_order_qty=50,
            max_weekly_capacity=500,
            is_preferred=True,
            expedite_available=True,
            expedite_lead_time_days=5, # 5 days >= 3 days -> NOT earlier
            expedite_cost_premium_pct=Decimal("0.10"),
        )
    ]
    comp_in = make_test_input(as_of=as_of, plant_stock=50, daily_demand=50.0, inbound_lines=[base_line])
    base_res = evaluate_component(comp_in, inv_cfg)

    rec = evaluate_component_recovery(
        component_input=comp_in,
        baseline_result=base_res,
        supplier_offers=offers,
        regional_stocks=[],
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        inventory_config=inv_cfg,
        recovery_config=rec_cfg,
    )
    assert rec is not None
    exp_opt = next(o for o in rec.options if o.kind == "expedite_existing")
    assert exp_opt.feasible is False
    assert "not earlier" in exp_opt.infeasible_reason.lower()
    # Infeasible option must never be recommended
    assert rec.recommended_option_id != exp_opt.id


# =============================================================================
# 6. Capacity Capped & Unknown Capacity
# =============================================================================

def test_supplier_capacity_constraints():
    from app.domain.inventory import evaluate_component

    as_of = datetime.date(2026, 10, 17)
    inv_cfg = InventoryRiskConfig()
    rec_cfg = RecoveryConfig()

    # Need units = 200
    offers = [
        # Supplier capped at 100
        SupplierOfferInput(
            supplier_id=2,
            supplier_code="SUP-CAPPED",
            supplier_name="Capped Supplier",
            component_id=1,
            unit_cost=Decimal("100.00"),
            lead_time_days=2,
            min_order_qty=50,
            max_weekly_capacity=100, # < 200 needed
            is_preferred=False,
            expedite_available=False,
            expedite_lead_time_days=None,
            expedite_cost_premium_pct=None,
        ),
        # Supplier with unknown capacity (None)
        SupplierOfferInput(
            supplier_id=3,
            supplier_code="SUP-UNK-CAP",
            supplier_name="Unknown Cap Supplier",
            component_id=1,
            unit_cost=Decimal("150.00"),
            lead_time_days=2,
            min_order_qty=50,
            max_weekly_capacity=None,
            is_preferred=False,
            expedite_available=False,
            expedite_lead_time_days=None,
            expedite_cost_premium_pct=None,
        ),
    ]

    # No inbound, stock 50, demand 50 -> shortage on Day 1, unmet over 30d
    comp_in = make_test_input(as_of=as_of, plant_stock=50, daily_demand=50.0)
    base_res = evaluate_component(comp_in, inv_cfg)

    rec = evaluate_component_recovery(
        component_input=comp_in,
        baseline_result=base_res,
        supplier_offers=offers,
        regional_stocks=[],
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        inventory_config=inv_cfg,
        recovery_config=rec_cfg,
    )
    assert rec is not None

    opt_capped = next(o for o in rec.options if o.source_code == "SUP-CAPPED")
    assert opt_capped.quantity == 100
    assert "capped_at_max_weekly_capacity" in opt_capped.flags

    opt_unk = next(o for o in rec.options if o.source_code == "SUP-UNK-CAP")
    assert opt_unk.quantity == rec.need_units
    assert "capacity_unknown_assumed_available" in opt_unk.flags


# =============================================================================
# 7. Combined Plan Formation
# =============================================================================

def test_combined_plan_when_no_single_option_reaches_zero():
    from app.domain.inventory import evaluate_component

    as_of = datetime.date(2026, 10, 17)
    inv_cfg = InventoryRiskConfig()
    # Configure transfer cost so transfer cost is known
    rec_cfg = RecoveryConfig(transfer_days=2, transfer_cost_per_unit=Decimal("2.00"))

    # Need 200 units
    # Regional warehouse has 100 units (leaves 100)
    # Alt supplier has max capacity 150 (can provide remaining 100)
    regional_in = [
        RegionalInventoryInput(
            warehouse_id=2,
            warehouse_code="WH-REG-1",
            warehouse_name="Hub 1",
            on_hand=100,
            reserved=0,
        ),
    ]
    offers = [
        SupplierOfferInput(
            supplier_id=2,
            supplier_code="SUP-ALT-CAP",
            supplier_name="Alt Cap Supplier",
            component_id=1,
            unit_cost=Decimal("50.00"),
            lead_time_days=3,
            min_order_qty=50,
            max_weekly_capacity=100, # Max 100 < 200 needed, so single option cannot reach 0
            is_preferred=False,
            expedite_available=False,
            expedite_lead_time_days=None,
            expedite_cost_premium_pct=None,
        )
    ]

    base_line = InboundLineInput(
        po_id=1,
        po_number="PO-FAR",
        po_status="open",
        warehouse_id=1,
        warehouse_code="WH-PLANT-01",
        warehouse_name="Plant Alpha",
        warehouse_role="plant",
        qty_ordered=500,
        qty_received=0,
        promised_date=as_of + datetime.timedelta(days=10),
        latest_estimate_date=None,
        supplier_code="SUP-FAR",
    )
    # Plant stock 0, demand 50/day. Day 0: 50, Day 1: 50, Day 2: 50, Day 3: 50 -> need before far inbound = 200+
    comp_in = make_test_input(
        as_of=as_of,
        plant_stock=0,
        daily_demand=50.0,
        inbound_lines=[base_line],
        regional_inventories=regional_in,
    )
    base_res = evaluate_component(comp_in, inv_cfg)

    rec = evaluate_component_recovery(
        component_input=comp_in,
        baseline_result=base_res,
        supplier_offers=offers,
        regional_stocks=base_res.regional_usable_stock,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        inventory_config=inv_cfg,
        recovery_config=rec_cfg,
    )
    assert rec is not None
    # No single option reached 0 residual
    assert not any(o.feasible and o.residual_unmet_before_next_inbound == 0.0 for o in rec.options)

    # Combined plan should have formed
    assert rec.combined_plan is not None
    plan = rec.combined_plan
    assert len(plan.steps) >= 2
    assert plan.steps[0].kind == "transfer"
    assert plan.steps[1].kind == "alternative_supplier"
    assert plan.residual_unmet_before_next_inbound < base_res.unmet_before_next_inbound


# =============================================================================
# 8. Determinism
# =============================================================================

def test_recovery_evaluation_determinism():
    from app.domain.inventory import evaluate_component

    as_of = datetime.date(2026, 10, 17)
    inv_cfg = InventoryRiskConfig()
    rec_cfg = RecoveryConfig()

    comp_in = make_test_input(as_of=as_of, plant_stock=50, daily_demand=50.0)
    base_res = evaluate_component(comp_in, inv_cfg)

    rec1 = evaluate_component_recovery(
        component_input=comp_in,
        baseline_result=base_res,
        supplier_offers=[],
        regional_stocks=[],
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        inventory_config=inv_cfg,
        recovery_config=rec_cfg,
    )
    rec2 = evaluate_component_recovery(
        component_input=comp_in,
        baseline_result=base_res,
        supplier_offers=[],
        regional_stocks=[],
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        inventory_config=inv_cfg,
        recovery_config=rec_cfg,
    )
    assert rec1 == rec2
