"""tests/test_domain_simulation.py

Unit tests for pure domain simulation logic in app/domain/simulation.py.
Covers:
- SimulationParams validation (ranges, types)
- Pure helpers (scale_demand, adjust_plant_on_hand, shift_all_inbound) immutability and behavior
- Negative on-hand rejection
- Defaults preserve disrupted == baseline
- Delay shifts or extends the shortage window
- Demand multiplier sensitivity (multiplier > 1 vs < 1)
- Recovered is never worse than disrupted
- alt_supplier_available=False removes alternative supplier offers from recovery
- No shortage case (recovered == disrupted with explanation)
- what_changed generated from computed values
- Determinism
"""

import datetime
from decimal import Decimal
import pytest

from app.domain.inventory import (
    ComponentEvaluationInput,
    DemandHistoryRecordInput,
    InboundLineInput,
    InventoryRiskConfig,
    PlantInventoryInput,
    RegionalInventoryInput,
    RegionalStockItem,
    adjust_plant_on_hand,
    scale_demand,
    shift_all_inbound,
)
from app.domain.alerts import CustomerOrderInput, ProductInput
from app.domain.recovery import RecoveryConfig, SupplierOfferInput
from app.domain.simulation import SimulationParams, simulate


@pytest.fixture
def base_as_of() -> datetime.date:
    return datetime.date(2026, 10, 17)


@pytest.fixture
def sample_component_inputs(base_as_of: datetime.date) -> ComponentEvaluationInput:
    """Create a sample component with 28 days of daily demand (100 units/day),
    usable stock of 400 units (shortage in 4 days: 2026-10-21),
    and an inbound PO of 800 units arriving 2026-10-24.
    """
    history = [
        DemandHistoryRecordInput(date=base_as_of - datetime.timedelta(days=d), quantity=100.0)
        for d in range(1, 29)
    ]
    inbound = [
        InboundLineInput(
            po_id=101,
            po_number="PO-101",
            po_status="open",
            warehouse_id=1,
            warehouse_code="WH-PLANT-01",
            warehouse_name="Plant Warehouse",
            warehouse_role="plant",
            qty_ordered=800,
            qty_received=0,
            promised_date=datetime.date(2026, 10, 24),
            latest_estimate_date=datetime.date(2026, 10, 24),
            supplier_code="SUP-PRIMARY",
        )
    ]
    return ComponentEvaluationInput(
        as_of=base_as_of,
        component_id=1,
        sku="COMP-01",
        name="Test Component",
        category="Processors",
        criticality="high",
        plant_inventory=PlantInventoryInput(on_hand=400, reserved=0),
        regional_inventories=[],
        demand_records=history,
        inbound_lines=inbound,
    )


@pytest.fixture
def sample_offers() -> list[SupplierOfferInput]:
    return [
        SupplierOfferInput(
            component_id=1,
            supplier_id=1,
            supplier_code="SUP-PRIMARY",
            supplier_name="Primary Supplier",
            unit_cost=Decimal("200.00"),
            lead_time_days=10,
            min_order_qty=100,
            max_weekly_capacity=1000,
            is_preferred=True,
            expedite_available=True,
            expedite_lead_time_days=5,
            expedite_cost_premium_pct=Decimal("0.20"),
        ),
        SupplierOfferInput(
            component_id=1,
            supplier_id=2,
            supplier_code="SUP-ALT",
            supplier_name="Alternative Supplier",
            unit_cost=Decimal("250.00"),
            lead_time_days=4,
            min_order_qty=50,
            max_weekly_capacity=500,
            is_preferred=False,
            expedite_available=False,
            expedite_lead_time_days=None,
            expedite_cost_premium_pct=None,
        ),
    ]


@pytest.fixture
def sample_regional_stocks() -> list[RegionalStockItem]:
    return [
        RegionalStockItem(
            warehouse_id=2,
            warehouse_code="WH-REG-EAST",
            warehouse_name="East Hub",
            on_hand=150,
            reserved=0,
            usable=150,
        )
    ]


# =============================================================================
# 1. Parameter Validation
# =============================================================================

def test_simulation_params_validation():
    # Valid defaults
    p = SimulationParams()
    assert p.is_default is True
    assert p.supplier_delay_days == 0
    assert p.demand_multiplier == 1.0
    assert p.on_hand_delta == 0
    assert p.alt_supplier_available is True

    # Valid boundaries
    p_min = SimulationParams(supplier_delay_days=0, demand_multiplier=0.5, on_hand_delta=-10000)
    assert p_min.is_default is False

    p_max = SimulationParams(supplier_delay_days=60, demand_multiplier=3.0, on_hand_delta=10000)
    assert p_max.supplier_delay_days == 60

    # Invalid delay
    with pytest.raises(ValueError, match="supplier_delay_days"):
        SimulationParams(supplier_delay_days=-1)
    with pytest.raises(ValueError, match="supplier_delay_days"):
        SimulationParams(supplier_delay_days=61)

    # Invalid multiplier
    with pytest.raises(ValueError, match="demand_multiplier"):
        SimulationParams(demand_multiplier=0.49)
    with pytest.raises(ValueError, match="demand_multiplier"):
        SimulationParams(demand_multiplier=3.1)

    # Invalid on_hand_delta
    with pytest.raises(ValueError, match="on_hand_delta"):
        SimulationParams(on_hand_delta=-10001)
    with pytest.raises(ValueError, match="on_hand_delta"):
        SimulationParams(on_hand_delta=10001)


# =============================================================================
# 2. Pure Helpers and Immutability
# =============================================================================

def test_scale_demand_immutability(sample_component_inputs: ComponentEvaluationInput):
    orig_qty = sample_component_inputs.demand_records[0].quantity
    scaled = scale_demand(sample_component_inputs, 1.5)

    assert sample_component_inputs.demand_records[0].quantity == orig_qty
    assert scaled.demand_records[0].quantity == orig_qty * 1.5
    assert len(scaled.demand_records) == len(sample_component_inputs.demand_records)

    with pytest.raises(ValueError, match="strictly positive"):
        scale_demand(sample_component_inputs, 0.0)


def test_adjust_plant_on_hand(sample_component_inputs: ComponentEvaluationInput):
    orig_on_hand = sample_component_inputs.plant_inventory.on_hand
    adjusted = adjust_plant_on_hand(sample_component_inputs, 50)

    assert sample_component_inputs.plant_inventory.on_hand == orig_on_hand
    assert adjusted.plant_inventory.on_hand == 450

    # Negative on-hand rejection
    with pytest.raises(ValueError, match="cannot be negative"):
        adjust_plant_on_hand(sample_component_inputs, -401)


def test_shift_all_inbound(sample_component_inputs: ComponentEvaluationInput):
    orig_date = sample_component_inputs.inbound_lines[0].promised_date
    shifted = shift_all_inbound(sample_component_inputs, 7)

    assert sample_component_inputs.inbound_lines[0].promised_date == orig_date
    assert shifted.inbound_lines[0].promised_date == orig_date + datetime.timedelta(days=7)

    # Negative delay rejection
    with pytest.raises(ValueError, match="non-negative"):
        shift_all_inbound(sample_component_inputs, -1)


# =============================================================================
# 3. Disrupted == Baseline on Defaults
# =============================================================================

def test_simulation_defaults_preserve_baseline(
    sample_component_inputs: ComponentEvaluationInput,
    sample_offers: list[SupplierOfferInput],
    sample_regional_stocks: list[RegionalStockItem],
):
    sim = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=SimulationParams(),
    )

    assert sim.disrupted.shortage_date == sim.baseline.shortage_date
    assert sim.disrupted.unmet_before_next_inbound == sim.baseline.unmet_before_next_inbound
    assert sim.disrupted.risk_level == sim.baseline.risk_level
    assert sim.disrupted.plant_usable_stock == sim.baseline.plant_usable_stock
    assert sim.what_changed == ["No changes applied; disrupted equals baseline."]


# =============================================================================
# 4. Disruption Effects (Delay, Demand, Stock)
# =============================================================================

def test_supplier_delay_extends_shortage_window(
    sample_component_inputs: ComponentEvaluationInput,
    sample_offers: list[SupplierOfferInput],
    sample_regional_stocks: list[RegionalStockItem],
):
    # Inbound is delayed by 7 days (from 2026-10-24 to 2026-10-31)
    sim = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=SimulationParams(supplier_delay_days=7),
    )

    # Baseline shortage starts 2026-10-21, replenishment on 2026-10-24 -> 3 days window (21, 22, 23)
    assert sim.baseline.first_shortage_episode.days == 3
    # Disrupted replenishment is 2026-10-31 -> shortage window extends to 10 days (21..30)
    assert sim.disrupted.first_shortage_episode.days == 10
    assert sim.disrupted.unmet_before_next_inbound > sim.baseline.unmet_before_next_inbound
    # Any delay is clearly reflected in what_changed
    assert any("delayed by 7 days" in s for s in sim.what_changed)


def test_demand_multiplier_monotonicity(
    sample_component_inputs: ComponentEvaluationInput,
    sample_offers: list[SupplierOfferInput],
    sample_regional_stocks: list[RegionalStockItem],
):
    # Higher demand (1.3x)
    sim_high = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=SimulationParams(demand_multiplier=1.3),
    )
    # Higher demand never makes unmet demand lower
    assert sim_high.disrupted.unmet_before_next_inbound >= sim_high.baseline.unmet_before_next_inbound
    assert sim_high.disrupted.shortage_date <= sim_high.baseline.shortage_date

    # Lower demand (0.8x)
    sim_low = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=SimulationParams(demand_multiplier=0.8),
    )
    # Lower demand never makes things worse
    assert sim_low.disrupted.unmet_before_next_inbound <= sim_low.baseline.unmet_before_next_inbound
    assert sim_low.disrupted.shortage_date >= sim_low.baseline.shortage_date


# =============================================================================
# 5. Recovery Behavior in Simulation
# =============================================================================

def test_recovered_never_worse_than_disrupted(
    sample_component_inputs: ComponentEvaluationInput,
    sample_offers: list[SupplierOfferInput],
    sample_regional_stocks: list[RegionalStockItem],
):
    sim = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=SimulationParams(supplier_delay_days=7),
    )

    # Recovered unmet demand must be <= disrupted unmet demand
    assert sim.recovered.unmet_before_next_inbound <= sim.disrupted.unmet_before_next_inbound
    assert len(sim.recovered.applied_actions) > 0


def test_alt_supplier_available_false_removes_alt_offers(
    sample_component_inputs: ComponentEvaluationInput,
    sample_offers: list[SupplierOfferInput],
    sample_regional_stocks: list[RegionalStockItem],
):
    # With alt_supplier_available=False, alternative supplier SUP-ALT cannot be recommended
    sim = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=SimulationParams(supplier_delay_days=7, alt_supplier_available=False),
    )

    for action in sim.recovered.applied_actions:
        assert action.kind != "alternative_supplier"
        assert action.source_code != "SUP-ALT"


def test_no_shortage_recovered_equals_disrupted(base_as_of: datetime.date):
    # Abundant inventory (10,000 units on hand)
    history = [
        DemandHistoryRecordInput(date=base_as_of - datetime.timedelta(days=d), quantity=10.0)
        for d in range(1, 29)
    ]
    comp = ComponentEvaluationInput(
        as_of=base_as_of,
        component_id=2,
        sku="COMP-SAFE",
        name="Safe Component",
        category="Resistors",
        criticality="low",
        plant_inventory=PlantInventoryInput(on_hand=10000, reserved=0),
        regional_inventories=[],
        demand_records=history,
        inbound_lines=[],
    )

    sim = simulate(
        component_inputs=comp,
        supplier_offers=[],
        regional_stocks=[],
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=SimulationParams(supplier_delay_days=10),
    )

    assert sim.disrupted.shortage_date is None
    assert sim.recovered.shortage_date is None
    assert sim.recovered.applied_actions == []
    assert "no shortage projected" in sim.recovered.recovery_note.lower()


def test_simulation_determinism(
    sample_component_inputs: ComponentEvaluationInput,
    sample_offers: list[SupplierOfferInput],
    sample_regional_stocks: list[RegionalStockItem],
):
    p = SimulationParams(supplier_delay_days=5, demand_multiplier=1.2, on_hand_delta=-50)
    sim1 = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=p,
    )
    sim2 = simulate(
        component_inputs=sample_component_inputs,
        supplier_offers=sample_offers,
        regional_stocks=sample_regional_stocks,
        customer_orders=[],
        bom_by_product={},
        products_by_id={},
        params=p,
    )

    assert sim1.disrupted.unmet_before_next_inbound == sim2.disrupted.unmet_before_next_inbound
    assert sim1.recovered.unmet_before_next_inbound == sim2.recovered.unmet_before_next_inbound
    assert sim1.what_changed == sim2.what_changed
