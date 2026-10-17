from datetime import date, timedelta
from decimal import Decimal
import pytest

from app.integrations.demo_adapter import DemoAdapter


def test_adapter_determinism():
    as_of = date(2026, 4, 1)
    adapter1 = DemoAdapter(seed=42, as_of=as_of)
    adapter2 = DemoAdapter(seed=42, as_of=as_of)

    ds1 = adapter1.fetch_dataset()
    ds2 = adapter2.fetch_dataset()

    # Identical serialization
    assert ds1.model_dump() == ds2.model_dump()

    # Different seed yields different dataset
    adapter3 = DemoAdapter(seed=999, as_of=as_of)
    ds3 = adapter3.fetch_dataset()
    assert ds1.model_dump() != ds3.model_dump()


@pytest.mark.parametrize("test_seed", [42, 1, 2, 3, 4, 5])
def test_adapter_seed_properties_and_mandatory_scenario(test_seed):
    as_of = date(2026, 3, 15)
    adapter = DemoAdapter(seed=test_seed, as_of=as_of)
    dataset = adapter.fetch_dataset()

    # Minimum counts
    assert len(dataset.warehouses) >= 3
    assert len(dataset.products) >= 4
    assert len(dataset.components) >= 12
    categories = {c.category for c in dataset.components}
    assert len(categories) >= 6
    assert len(dataset.suppliers) >= 8
    assert len(dataset.purchase_orders) >= 20
    assert len(dataset.delivery_records) >= 150
    assert len(dataset.customer_orders) >= 25

    # 180 days of demand per component
    for comp in dataset.components:
        comp_demands = [d for d in dataset.demand_records if d.component_sku == comp.sku]
        assert len(comp_demands) == 180

    # CPU-X7 Scenario
    # Plant inventory: on_hand 520, reserved 100 -> usable = 420
    plant_cpu_inv = next(
        inv for inv in dataset.inventory_levels
        if inv.component_sku == "CPU-X7" and inv.warehouse_code == "WH-PLANT"
    )
    assert plant_cpu_inv.on_hand == 520
    assert plant_cpu_inv.reserved == 100
    usable_stock = plant_cpu_inv.on_hand - plant_cpu_inv.reserved
    assert usable_stock == 420

    # Trailing 30 days average daily demand (ending day before as_of)
    cpu_demands = [
        d.quantity for d in dataset.demand_records
        if d.component_sku == "CPU-X7" and (as_of - timedelta(days=30)) <= d.date < as_of
    ]
    assert len(cpu_demands) == 30
    trailing_30_avg = sum(cpu_demands) / 30.0
    assert 90 <= trailing_30_avg <= 110

    # Usable stock / trailing 30 avg between 3.5 and 4.5
    coverage_ratio = usable_stock / trailing_30_avg
    assert 3.5 <= coverage_ratio <= 4.5

    # In-transit PO for CPU-X7 with promised_date = as_of + 7 days
    cpu_po = next(
        po for po in dataset.purchase_orders
        if any(line.component_sku == "CPU-X7" for line in po.lines)
        and po.status == "in_transit"
        and po.promised_date == as_of + timedelta(days=7)
    )
    assert cpu_po.supplier_code == "SUP-HELIX"
    assert cpu_po.latest_estimate_date is None
    cpu_line = next(line for line in cpu_po.lines if line.component_sku == "CPU-X7")
    assert cpu_line.qty_ordered == 800

    # Regional warehouse holds >= 100 usable units
    reg_cpu_inv = next(
        inv for inv in dataset.inventory_levels
        if inv.component_sku == "CPU-X7" and inv.warehouse_code == "WH-REG-EAST"
    )
    assert (reg_cpu_inv.on_hand - reg_cpu_inv.reserved) >= 100

    # Alternative supplier offer for CPU-X7
    cpu_offers = [sc for sc in dataset.supplier_components if sc.component_sku == "CPU-X7"]
    assert len(cpu_offers) >= 2
    preferred = next(o for o in cpu_offers if o.is_preferred)
    alternative = next(o for o in cpu_offers if not o.is_preferred)
    assert alternative.unit_cost > preferred.unit_cost
    assert alternative.lead_time_days < preferred.lead_time_days
    assert alternative.min_order_qty == 100
    assert alternative.max_weekly_capacity == 300
    assert preferred.expedite_available is True
    assert preferred.expedite_lead_time_days is not None
    assert preferred.expedite_cost_premium_pct is not None

    # Mandatory Edge Cases:
    # 1. Zero demand component across whole history
    zero_dem = next(c for c in dataset.components if c.sku == "COMP-SPARE-01")
    assert zero_dem.is_active is True
    zd_demands = [d for d in dataset.demand_records if d.component_sku == zero_dem.sku]
    assert all(d.quantity == 0 for d in zd_demands)

    # 2. Component with NO open purchase order
    no_open_po_comp = "KB-BACKLIT-EN"
    open_pos_for_comp = [
        po for po in dataset.purchase_orders
        if po.status in ("open", "in_transit", "partially_received")
        and any(line.component_sku == no_open_po_comp for line in po.lines)
    ]
    assert len(open_pos_for_comp) == 0

    # 3. Component with single supplier offer
    single_offer_comp = "MB-PRO-01"
    mb_offers = [sc for sc in dataset.supplier_components if sc.component_sku == single_offer_comp]
    assert len(mb_offers) == 1

    # 4. Supplier offer with NULL max_weekly_capacity
    null_cap_offers = [sc for sc in dataset.supplier_components if sc.max_weekly_capacity is None]
    assert len(null_cap_offers) >= 1

    # 5. Overdue open/in-transit PO
    overdue_pos = [
        po for po in dataset.purchase_orders
        if po.status in ("open", "in_transit") and po.promised_date < as_of
    ]
    assert len(overdue_pos) >= 1

    # 6. Partially received PO
    partial_pos = [po for po in dataset.purchase_orders if po.status == "partially_received"]
    assert len(partial_pos) >= 1
    assert any(line.qty_received > 0 and line.qty_received < line.qty_ordered for line in partial_pos[0].lines)

    # Unreliable supplier vs Reliable supplier on-time rate
    helix_deliveries = [d for d in dataset.delivery_records if d.supplier_code == "SUP-HELIX"]
    lumen_deliveries = [d for d in dataset.delivery_records if d.supplier_code == "SUP-LUMEN"]
    assert len(helix_deliveries) >= 20
    assert len(lumen_deliveries) >= 20

    helix_on_time = sum(1 for d in helix_deliveries if d.actual_date <= d.promised_date) / len(helix_deliveries)
    lumen_on_time = sum(1 for d in lumen_deliveries if d.actual_date <= d.promised_date) / len(lumen_deliveries)

    assert helix_on_time < lumen_on_time
    assert lumen_on_time > 0.90
