"""Tests for pure domain inventory intelligence logic."""

from datetime import date, timedelta
import pytest

from app.domain.inventory import (
    ComponentEvaluationInput,
    DemandHistoryRecordInput,
    InboundLineInput,
    InventoryRiskConfig,
    PlantInventoryInput,
    RegionalInventoryInput,
    evaluate_component,
)


def _make_demand(start_date: date, days: int, weekday_val: float, weekend_val: float) -> list[DemandHistoryRecordInput]:
    records = []
    for i in range(days):
        d = start_date + timedelta(days=i)
        qty = weekend_val if d.weekday() in (5, 6) else weekday_val
        records.append(DemandHistoryRecordInput(date=d, quantity=qty))
    return records


class TestInventoryRiskConfig:
    def test_default_config_valid(self):
        cfg = InventoryRiskConfig()
        assert cfg.lookback_days == 28
        assert cfg.min_history_days == 14
        assert cfg.min_coverage_ratio == 0.8
        assert cfg.horizon_days == 60
        assert cfg.critical_days == 7
        assert cfg.high_days == 14
        assert cfg.medium_days == 30
        assert cfg.overdue_inbound_policy == "exclude"

    def test_invalid_horizon_rejected(self):
        with pytest.raises(ValueError, match="horizon_days must be between 7 and 180"):
            InventoryRiskConfig(horizon_days=5)

        with pytest.raises(ValueError, match="horizon_days must be between 7 and 180"):
            InventoryRiskConfig(horizon_days=200)

    def test_invalid_threshold_ordering_rejected(self):
        with pytest.raises(ValueError, match="Invalid threshold ordering"):
            InventoryRiskConfig(critical_days=14, high_days=14)

        with pytest.raises(ValueError, match="Invalid threshold ordering"):
            InventoryRiskConfig(critical_days=0)

        with pytest.raises(ValueError, match="Invalid threshold ordering"):
            InventoryRiskConfig(medium_days=70, horizon_days=60)

    def test_invalid_overdue_policy_rejected(self):
        with pytest.raises(ValueError, match="Unsupported overdue_inbound_policy"):
            InventoryRiskConfig(overdue_inbound_policy="include")

    def test_invalid_lookback_or_history_rejected(self):
        with pytest.raises(ValueError, match="lookback_days must be at least 7"):
            InventoryRiskConfig(lookback_days=5)

        with pytest.raises(ValueError, match="min_history_days must be > 0 and <= lookback_days"):
            InventoryRiskConfig(lookback_days=28, min_history_days=35)

        with pytest.raises(ValueError, match="min_coverage_ratio must be in"):
            InventoryRiskConfig(min_coverage_ratio=0.0)


class TestPlantInventoryDomain:
    as_of = date(2026, 10, 17)

    def test_usable_stock_normal(self):
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="high",
            plant_inventory=PlantInventoryInput(on_hand=500, reserved=100),
            demand_records=_make_demand(self.as_of - timedelta(days=28), 28, 10.0, 10.0),
        )
        res = evaluate_component(inputs)
        assert res.plant_usable_stock == 400
        assert res.plant_on_hand == 500
        assert res.plant_reserved == 100
        assert res.usable_stock_breakdown is not None
        assert res.usable_stock_breakdown.usable == 400
        assert not res.usable_stock_breakdown.reserved_exceeds_on_hand
        assert not any(f.code == "reserved_exceeds_on_hand" for f in res.flags)

    def test_reserved_exceeds_on_hand_clamped_to_zero_and_flagged(self):
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="high",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=100),
            demand_records=_make_demand(self.as_of - timedelta(days=28), 28, 10.0, 10.0),
        )
        res = evaluate_component(inputs)
        assert res.plant_usable_stock == 0
        assert res.usable_stock_breakdown is not None
        assert res.usable_stock_breakdown.usable == 0
        assert res.usable_stock_breakdown.reserved_exceeds_on_hand
        assert any(f.code == "reserved_exceeds_on_hand" for f in res.flags)

    def test_missing_plant_inventory_unknown_not_zero(self):
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="high",
            plant_inventory=None,
            demand_records=_make_demand(self.as_of - timedelta(days=28), 28, 10.0, 10.0),
        )
        res = evaluate_component(inputs)
        assert res.plant_usable_stock is None
        assert res.plant_on_hand is None
        assert res.plant_reserved is None
        assert res.usable_stock_breakdown is None
        assert res.forecast_status == "no_plant_inventory"
        assert res.risk_level == "unknown"
        assert any(f.code == "no_plant_inventory" for f in res.flags)

    def test_regional_stock_informational_not_counted_in_plant(self):
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="high",
            plant_inventory=PlantInventoryInput(on_hand=100, reserved=0),
            regional_inventories=[
                RegionalInventoryInput(1, "REG-1", "East Hub", 200, 50),
                RegionalInventoryInput(2, "REG-2", "West Hub", 80, 0),
            ],
            demand_records=_make_demand(self.as_of - timedelta(days=28), 28, 10.0, 10.0),
        )
        res = evaluate_component(inputs)
        assert res.plant_usable_stock == 100  # Only plant stock
        assert res.regional_total_usable == 150 + 80  # 230
        assert len(res.regional_usable_stock) == 2
        assert any(f.code == "regional_stock_available" for f in res.flags)


class TestDemandForecastingDomain:
    as_of = date(2026, 10, 17)  # Saturday

    def test_weekday_aware_forecast_distinct_levels(self):
        # 28 days history: weekdays=100, weekends=20
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 100.0, 20.0)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=1000, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.forecast_status == "adequate"
        assert res.weekday_forecast is not None
        # Mon-Fri (0-4) should be exactly 100.0
        for w in range(5):
            assert res.weekday_forecast[w] == pytest.approx(100.0)
        # Sat-Sun (5,6) should be exactly 20.0
        for w in (5, 6):
            assert res.weekday_forecast[w] == pytest.approx(20.0)
        # 20 weekdays * 100 + 8 weekend days * 20 = 2000 + 160 = 2160 / 28 = 77.142857
        assert res.mean_daily_demand == pytest.approx(2160.0 / 28.0)
        assert res.coverage_days == pytest.approx(1000.0 / (2160.0 / 28.0))

    def test_insufficient_history_when_days_below_min(self):
        # Only 10 days present (< 14)
        demand = _make_demand(self.as_of - timedelta(days=10), 10, 50.0, 50.0)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=1000, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.forecast_status == "insufficient_history"
        assert res.risk_level == "unknown"
        assert res.mean_daily_demand is None
        assert res.weekday_forecast is None
        assert res.coverage_days is None
        assert any(f.code == "insufficient_history" for f in res.flags)

    def test_insufficient_history_when_coverage_ratio_below_min(self):
        # 16 days present in 28-day window = 16/28 = 0.5714 < 0.8
        demand = []
        for i in range(16):
            d = self.as_of - timedelta(days=28 - i)
            demand.append(DemandHistoryRecordInput(date=d, quantity=10.0))
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=1000, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.forecast_status == "insufficient_history"
        assert any(f.code == "insufficient_history" for f in res.flags)

    def test_gaps_treated_as_missing_not_zero(self):
        # 24 days present out of 28 (ratio = 24/28 = 0.857 >= 0.8), each with 100 units
        # Mean should be 100, not 2400/28
        demand = []
        for i in range(24):
            d = self.as_of - timedelta(days=28 - i)
            demand.append(DemandHistoryRecordInput(date=d, quantity=100.0))
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=1000, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.forecast_status == "adequate"
        assert res.mean_daily_demand == pytest.approx(100.0)

    def test_zero_demand_component(self):
        # 28 days of 0.0 demand
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 0.0, 0.0)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-SPARE-01",
            name="Spare Component",
            category="Misc",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.forecast_status == "no_demand"
        assert res.risk_level == "none"
        assert res.shortage_date is None
        assert res.days_until_shortage is None
        assert res.coverage_days is None
        assert res.unmet_demand_units == 0.0
        assert res.shortage_days == 0
        assert any(f.code == "zero_demand" for f in res.flags)

    def test_weekday_fallback_when_a_day_has_no_samples(self):
        # 24 records, but no Sundays present
        demand = []
        cur = self.as_of - timedelta(days=28)
        while cur < self.as_of:
            if cur.weekday() != 6:  # Skip Sunday
                demand.append(DemandHistoryRecordInput(date=cur, quantity=50.0))
            cur += timedelta(days=1)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=500, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.forecast_status == "adequate"
        assert res.weekday_forecast is not None
        assert res.weekday_forecast[6] == pytest.approx(50.0)  # Sunday fell back to overall mean
        assert any(f.code == "weekday_fallback" and "Sunday" in f.message for f in res.flags)


class TestDailyProjectionAndTiming:
    as_of = date(2026, 10, 17)

    def test_stock_exactly_equal_to_demand_is_not_shortage(self):
        # Constant demand 50/day. Stock = 100.
        # Day 0: start 100, demand 50 -> ending 50, unmet 0.
        # Day 1: start 50, demand 50 -> ending 0, unmet 0 (NOT shortage!).
        # Day 2: start 0, demand 50 -> ending 0, unmet 50 (Shortage on Day 2).
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=100, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.shortage_date == self.as_of + timedelta(days=2)
        assert res.days_until_shortage == 2
        p0 = res.daily_projection[0]
        p1 = res.daily_projection[1]
        p2 = res.daily_projection[2]
        assert p0.ending_balance == 50.0 and p0.unmet == 0.0
        assert p1.ending_balance == 0.0 and p1.unmet == 0.0
        assert p2.ending_balance == 0.0 and p2.unmet == 50.0

    def test_receipt_at_start_of_day_prevents_shortage(self):
        # Demand 50/day. Stock = 50.
        # Without inbound: Day 0 exhausts 50, Day 1 would have shortage.
        # With receipt of 100 on Day 1:
        # Day 0: balance start 50 - 50 = 0.
        # Day 1: receipts 100 at start of day -> balance start 100 - 50 = 50. No shortage on Day 1!
        # Day 2: balance start 50 - 50 = 0.
        # Day 3: shortage!
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=101,
                po_number="PO-101",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=100,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert res.runout_date_without_inbound == self.as_of + timedelta(days=1)
        assert res.shortage_date == self.as_of + timedelta(days=3)
        assert res.days_until_shortage == 3

    def test_receipt_one_day_too_late_causes_one_shortage_day(self):
        # Demand 50/day. Stock = 50.
        # Receipt of 100 on Day 2.
        # Day 0: ending 0, unmet 0.
        # Day 1: balance 0, unmet 50 (shortage day 1).
        # Day 2: receipt 100 at start -> balance 100 - 50 = 50, unmet 0.
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=102,
                po_number="PO-102",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=100,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=2),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert res.shortage_date == self.as_of + timedelta(days=1)
        p1 = res.daily_projection[1]
        p2 = res.daily_projection[2]
        assert p1.unmet == 50.0
        assert p2.unmet == 0.0
        assert p2.receipts == 100.0

    def test_two_receipts_on_same_day(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-A",
                po_status="open",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=40,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=None,
            ),
            InboundLineInput(
                po_id=2,
                po_number="PO-B",
                po_status="open",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=60,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=None,
            ),
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=0, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        p1 = res.daily_projection[1]
        assert p1.receipts == 100.0  # 40 + 60
        assert p1.ending_balance == 50.0  # 100 - 50
        assert p1.unmet == 0.0

    def test_partial_receipt_remaining_qty(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-PART",
                po_status="partially_received",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=500,
                qty_received=200,  # 300 remaining
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=0, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert len(res.counted_inbound) == 1
        assert res.counted_inbound[0].remaining_qty == 300
        assert res.daily_projection[1].receipts == 300.0

    def test_received_and_cancelled_pos_ignored(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-REC",
                po_status="received",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=500,
                qty_received=500,
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=None,
            ),
            InboundLineInput(
                po_id=2,
                po_number="PO-CANC",
                po_status="cancelled",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=500,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=None,
            ),
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=100, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert len(res.counted_inbound) == 0
        assert any(f.code == "no_open_inbound" for f in res.flags)

    def test_promised_vs_estimate_precedence(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-EST",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=200,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=self.as_of + timedelta(days=5),
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=0, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert res.next_replenishment is not None
        assert res.next_replenishment.date == self.as_of + timedelta(days=5)
        assert res.next_replenishment.date_basis == "estimated"
        assert res.daily_projection[1].receipts == 0.0
        assert res.daily_projection[5].receipts == 200.0

    def test_overdue_inbound_excluded_and_flagged(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-OVERDUE",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=200,
                qty_received=0,
                promised_date=self.as_of - timedelta(days=3),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert len(res.counted_inbound) == 0
        assert len(res.unconfirmed_inbound) == 1
        assert any(f.code == "overdue_inbound_excluded" for f in res.flags)
        assert res.next_replenishment is None

    def test_inbound_beyond_horizon_not_counted(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-FAR",
                po_status="open",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=200,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=70),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert len(res.counted_inbound) == 0
        assert len(res.out_of_horizon_inbound) == 1
        assert any(f.code == "inbound_outside_horizon" for f in res.flags)

    def test_non_plant_inbound_not_counted(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-REG",
                po_status="in_transit",
                warehouse_id=2,
                warehouse_code="WH-REG-EAST",
                warehouse_name="East Hub",
                warehouse_role="regional",
                qty_ordered=300,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=2),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert len(res.counted_inbound) == 0
        assert res.non_plant_inbound_count == 1
        assert res.non_plant_inbound_qty == 300

    def test_runout_date_without_inbound(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        # Stock 100 will run out on day 2 without inbound (day 0 uses 50, day 1 uses 50 -> 0 remaining)
        # Inbound on day 1 of 500 units prevents shortage
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-REPLEN",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=3000,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=1),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=100, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert res.runout_date_without_inbound == self.as_of + timedelta(days=2)
        assert res.shortage_date is None  # inbound of 500 covers the rest of the 60-day horizon

    def test_horizon_boundary_receipt_inclusion_and_exclusion(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-LAST-DAY",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=100,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=59),  # day 59 is last day of 60-day horizon
                latest_estimate_date=None,
            ),
            InboundLineInput(
                po_id=2,
                po_number="PO-DAY-AFTER",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=200,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=60),  # day 60 is out of horizon
                latest_estimate_date=None,
            ),
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=50, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert len(res.counted_inbound) == 1
        assert res.counted_inbound[0].po_number == "PO-LAST-DAY"
        assert len(res.out_of_horizon_inbound) == 1
        assert res.out_of_horizon_inbound[0].po_number == "PO-DAY-AFTER"
        assert res.daily_projection[59].receipts == 100.0

    def test_no_open_inbound_flag(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=100, reserved=0),
            demand_records=demand,
            inbound_lines=[],
        )
        res = evaluate_component(inputs)
        assert any(f.code == "no_open_inbound" for f in res.flags)

    def test_shortage_days_count(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        # Stock 150 covers day 0, 1, 2 (150 units). Days 3..59 (57 days) are shortages.
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=150, reserved=0),
            demand_records=demand,
            inbound_lines=[],
        )
        res = evaluate_component(inputs)
        assert res.shortage_days == 57

    def test_shortage_episodes_none(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=10000, reserved=0),
            demand_records=demand,
            inbound_lines=[],
        )
        res = evaluate_component(inputs)
        assert res.shortage_episodes == []
        assert res.unmet_before_next_inbound is None
        assert res.first_episode_start_date is None

    def test_shortage_episodes_single_through_horizon_end(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        # 100 stock covers days 0 and 1. Days 2..59 have shortage.
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=100, reserved=0),
            demand_records=demand,
            inbound_lines=[],
        )
        res = evaluate_component(inputs)
        assert len(res.shortage_episodes) == 1
        ep = res.shortage_episodes[0]
        assert ep.start_date == self.as_of + timedelta(days=2)
        assert ep.end_date == self.as_of + timedelta(days=59)
        assert ep.days == 58
        assert ep.ends_because == "horizon_end"
        assert res.unmet_before_next_inbound == ep.unmet_units

    def test_shortage_episodes_two_episodes_like_cpu_x7(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        # 100 stock covers days 0 and 1. Days 2 and 3 are shortages.
        # Day 4 has receipt of 100 units covering days 4 and 5.
        # Day 6 onwards are shortages.
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-MID",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=100,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=4),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=100, reserved=0),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert len(res.shortage_episodes) == 2

        ep1 = res.shortage_episodes[0]
        assert ep1.start_date == self.as_of + timedelta(days=2)
        assert ep1.end_date == self.as_of + timedelta(days=3)
        assert ep1.days == 2
        assert ep1.unmet_units == 100.0  # 50 + 50
        assert ep1.ends_because == "inbound_receipt"

        ep2 = res.shortage_episodes[1]
        assert ep2.start_date == self.as_of + timedelta(days=6)
        assert ep2.end_date == self.as_of + timedelta(days=59)
        assert ep2.days == 54
        assert ep2.ends_because == "horizon_end"

        assert res.unmet_before_next_inbound == 100.0
        assert res.first_episode_start_date == ep1.start_date
        assert res.first_episode_end_date == ep1.end_date


class TestRiskThresholdsAndExplanation:
    as_of = date(2026, 10, 17)

    @pytest.mark.parametrize(
        "stock,days_to_shortage,expected_risk",
        [
            (50, 1, "critical"),
            (350, 7, "critical"),   # Boundary 7 -> critical
            (400, 8, "high"),       # Boundary 8 -> high
            (700, 14, "high"),      # Boundary 14 -> high
            (750, 15, "medium"),    # Boundary 15 -> medium
            (1500, 30, "medium"),   # Boundary 30 -> medium
            (1550, 31, "low"),      # Boundary 31 -> low
            (10000, None, "low"),   # No shortage in 60 days -> low
        ],
    )
    def test_risk_level_boundaries(self, stock: int, days_to_shortage: int | None, expected_risk: str):
        # 50 demand per day
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 50.0, 50.0)
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="COMP-1",
            name="Component 1",
            category="Chips",
            criticality="normal",
            plant_inventory=PlantInventoryInput(on_hand=stock, reserved=0),
            demand_records=demand,
        )
        res = evaluate_component(inputs)
        assert res.risk_level == expected_risk
        if days_to_shortage is not None:
            assert res.days_until_shortage == days_to_shortage
        else:
            assert res.days_until_shortage is None

    def test_explanation_contains_computed_numbers(self):
        demand = _make_demand(self.as_of - timedelta(days=28), 28, 125.0, 39.0)
        inbound = [
            InboundLineInput(
                po_id=1,
                po_number="PO-CPU-701",
                po_status="in_transit",
                warehouse_id=1,
                warehouse_code="WH-PLANT",
                warehouse_name="Plant",
                warehouse_role="plant",
                qty_ordered=800,
                qty_received=0,
                promised_date=self.as_of + timedelta(days=7),
                latest_estimate_date=None,
            )
        ]
        inputs = ComponentEvaluationInput(
            as_of=self.as_of,
            component_id=1,
            sku="CPU-X7",
            name="NovaCore X7 Processor",
            category="Processor",
            criticality="critical",
            plant_inventory=PlantInventoryInput(on_hand=520, reserved=100),
            demand_records=demand,
            inbound_lines=inbound,
        )
        res = evaluate_component(inputs)
        assert "Usable plant stock 420" in res.explanation
        assert "520" in res.explanation
        assert "100" in res.explanation
        assert "800 units" in res.explanation
        assert "PO-CPU-701" not in res.explanation  # explanation mentions units and date
        assert "promised date" in res.explanation
        assert "Stock runs out on" in res.explanation
        assert "Estimated unmet demand before next inbound" in res.explanation
        assert "After this inbound is consumed, a further shortage begins on" in res.explanation
        assert res.risk_level == "critical"
        assert len(res.shortage_episodes) == 2
        assert res.unmet_before_next_inbound is not None
        assert res.unmet_before_next_inbound > 0
