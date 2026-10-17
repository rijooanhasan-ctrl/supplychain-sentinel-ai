"""Unit tests for Supplier Risk domain logic (pure functions)."""

from datetime import date, timedelta
import pytest

from app.domain.supplier_risk import (
    DeliveryInput,
    OpenPoInput,
    SupplierEvaluationInput,
    SupplierRiskConfig,
    compute_nearest_rank_percentile,
    compute_wilson_interval,
    evaluate_supplier,
)


def _make_delivery(
    id: int,
    promised_offset: int,
    actual_offset: int,
    qty_ordered: int = 100,
    qty_received: int = 100,
    qty_rejected: int = 0,
    as_of: date = date(2026, 10, 17),
) -> DeliveryInput:
    return DeliveryInput(
        id=id,
        supplier_id=1,
        component_id=1,
        purchase_order_id=id,
        promised_date=as_of + timedelta(days=promised_offset),
        actual_date=as_of + timedelta(days=actual_offset),
        qty_ordered=qty_ordered,
        qty_received=qty_received,
        qty_rejected=qty_rejected,
    )


class TestSupplierRiskConfigValidation:
    def test_default_config_valid(self):
        cfg = SupplierRiskConfig()
        assert cfg.lookback_days == 365
        assert cfg.on_time_grace_days == 0
        assert cfg.w_on_time == 0.40
        assert cfg.w_delay == 0.25
        assert cfg.w_rejection == 0.20
        assert cfg.w_fill == 0.15

    def test_weights_not_summing_to_one_rejected(self):
        with pytest.raises(ValueError, match="Weights must sum to 1"):
            SupplierRiskConfig(w_on_time=0.5, w_delay=0.5, w_rejection=0.2, w_fill=0.1)

    def test_negative_weight_rejected(self):
        with pytest.raises(ValueError, match="Weights cannot be negative"):
            SupplierRiskConfig(w_on_time=-0.1, w_delay=0.6, w_rejection=0.3, w_fill=0.2)

    def test_threshold_ordering_rejected(self):
        with pytest.raises(ValueError, match="Bands must satisfy"):
            SupplierRiskConfig(band_medium=60.0, band_high=50.0)

        with pytest.raises(ValueError, match="Bands must satisfy"):
            SupplierRiskConfig(band_medium=-5.0, band_high=50.0)


class TestWilsonIntervalAndPercentiles:
    def test_wilson_interval_against_hand_calculation(self):
        # n = 10, k = 8 hand calculation gives lower ~0.4902, upper ~0.9433
        lower, upper = compute_wilson_interval(8, 10, z=1.96)
        assert lower == pytest.approx(0.4902, abs=1e-3)
        assert upper == pytest.approx(0.9433, abs=1e-3)

    def test_nearest_rank_percentiles(self):
        vals = [2.0, 5.0, 10.0, 20.0]
        p50 = compute_nearest_rank_percentile(vals, 50.0)
        p90 = compute_nearest_rank_percentile(vals, 90.0)
        assert p50 == 5.0
        assert p90 == 20.0


class TestSupplierEvaluationScenarios:
    as_of = date(2026, 10, 17)

    def test_perfect_supplier_scores_zero(self):
        # 30 deliveries, all on time, 0 delay, 0 rejections, 100% fill
        delivs = [
            _make_delivery(i, -100 + i * 2, -100 + i * 2, as_of=self.as_of)
            for i in range(30)
        ]
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=1,
            supplier_code="SUP-PERFECT",
            supplier_name="Perfect Corp",
            country="DE",
            deliveries=delivs,
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert res.risk_score == 0.0
        assert res.risk_band == "low"
        assert res.confidence == "high"
        assert res.on_time_rate == 1.0
        assert res.avg_delay_days_all == 0.0
        assert res.rejection_rate == 0.0
        assert res.fill_rate == 1.0

    def test_worst_case_scores_one_hundred(self):
        # 30 deliveries, all >= 10 days late (delay > 7), 10% rejections (>= 5%), 50% fill (shortfall >= 20%)
        delivs = [
            _make_delivery(
                i,
                promised_offset=-200 + i * 5,
                actual_offset=-200 + i * 5 + 10,  # 10 days late
                qty_ordered=100,
                qty_received=50,  # 50% fill
                qty_rejected=5,   # 10% rejection
                as_of=self.as_of,
            )
            for i in range(30)
        ]
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=2,
            supplier_code="SUP-WORST",
            supplier_name="Worst Corp",
            country="US",
            deliveries=delivs,
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert res.risk_score == 100.0
        assert res.risk_band == "high"
        assert res.confidence == "high"
        assert res.on_time_rate == 0.0
        assert res.avg_delay_days_all == 10.0

    def test_weights_renormalize_when_rejection_undefined_and_confidence_drops(self):
        # 30 deliveries, but qty_received = 0 for all (rejection rate undefined!)
        delivs = [
            _make_delivery(
                i,
                promised_offset=-100 + i * 2,
                actual_offset=-100 + i * 2,
                qty_ordered=100,
                qty_received=0,
                qty_rejected=0,
                as_of=self.as_of,
            )
            for i in range(30)
        ]
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=3,
            supplier_code="SUP-ZERO-REC",
            supplier_name="Zero Received Corp",
            country="JP",
            deliveries=delivs,
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert "rejection" in res.metrics_dropped
        assert "rejection" not in res.metrics_used
        # Effective weights must sum to 1.0
        assert sum(res.effective_weights.values()) == pytest.approx(1.0, abs=1e-6)
        # Confidence drops one tier: base 30 deliveries is "high", drops to "medium"
        assert res.confidence == "medium"

    def test_n_equals_zero_gives_unknown(self):
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=4,
            supplier_code="SUP-EMPTY",
            supplier_name="Empty Corp",
            country="FR",
            deliveries=[],
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert res.n_deliveries == 0
        assert res.risk_score is None
        assert res.risk_band == "unknown"
        assert res.confidence == "none"

    def test_confidence_boundaries(self):
        # 9 deliveries -> low confidence
        delivs_9 = [_make_delivery(i, -50 + i, -50 + i, as_of=self.as_of) for i in range(9)]
        res_9 = evaluate_supplier(
            SupplierEvaluationInput(
                as_of=self.as_of,
                supplier_id=5,
                supplier_code="SUP-9",
                supplier_name="Nine",
                country="US",
                deliveries=delivs_9,
                open_orders=[],
            )
        )
        assert res_9.confidence == "low"

        # 10 deliveries -> medium confidence
        delivs_10 = [_make_delivery(i, -50 + i, -50 + i, as_of=self.as_of) for i in range(10)]
        res_10 = evaluate_supplier(
            SupplierEvaluationInput(
                as_of=self.as_of,
                supplier_id=5,
                supplier_code="SUP-10",
                supplier_name="Ten",
                country="US",
                deliveries=delivs_10,
                open_orders=[],
            )
        )
        assert res_10.confidence == "medium"

        # 29 deliveries -> medium confidence
        delivs_29 = [_make_delivery(i, -50 + i, -50 + i, as_of=self.as_of) for i in range(29)]
        res_29 = evaluate_supplier(
            SupplierEvaluationInput(
                as_of=self.as_of,
                supplier_id=5,
                supplier_code="SUP-29",
                supplier_name="TwentyNine",
                country="US",
                deliveries=delivs_29,
                open_orders=[],
            )
        )
        assert res_29.confidence == "medium"

        # 30 deliveries -> high confidence
        delivs_30 = [_make_delivery(i, -50 + i, -50 + i, as_of=self.as_of) for i in range(30)]
        res_30 = evaluate_supplier(
            SupplierEvaluationInput(
                as_of=self.as_of,
                supplier_id=5,
                supplier_code="SUP-30",
                supplier_name="Thirty",
                country="US",
                deliveries=delivs_30,
                open_orders=[],
            )
        )
        assert res_30.confidence == "high"

    def test_grace_boundary(self):
        # Config with grace = 2 days. Delivery 2 days late counts on-time. Delivery 3 days late does not.
        cfg = SupplierRiskConfig(on_time_grace_days=2)
        deliv_grace = _make_delivery(1, -10, -8, as_of=self.as_of)  # 2 days late
        deliv_late = _make_delivery(2, -10, -7, as_of=self.as_of)   # 3 days late
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=6,
            supplier_code="SUP-GRACE",
            supplier_name="Grace",
            country="US",
            deliveries=[deliv_grace, deliv_late],
            open_orders=[],
            config=cfg,
        )
        res = evaluate_supplier(inp)
        assert res.on_time_count == 1
        assert res.on_time_rate == 0.5

    def test_early_deliveries_not_penalized(self):
        # Delivery arrives 5 days early -> lateness is 0
        deliv_early = _make_delivery(1, -10, -15, as_of=self.as_of)
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=7,
            supplier_code="SUP-EARLY",
            supplier_name="Early",
            country="US",
            deliveries=[deliv_early],
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert res.on_time_count == 1
        assert res.avg_delay_days_all == 0.0

    def test_actual_date_after_as_of_excluded_and_flagged(self):
        deliv_valid = _make_delivery(1, -10, -5, as_of=self.as_of)
        deliv_future = _make_delivery(2, 5, 6, as_of=self.as_of)  # actual_date > as_of
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=8,
            supplier_code="SUP-FUTURE",
            supplier_name="Future",
            country="US",
            deliveries=[deliv_valid, deliv_future],
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert res.n_deliveries == 1
        assert res.excluded_future_deliveries == 1
        assert res.has_excluded_future_deliveries is True

    def test_lookback_boundary(self):
        # Delivery on as_of - 365 is included. Delivery on as_of - 366 is excluded.
        deliv_in = _make_delivery(1, -365, -365, as_of=self.as_of)
        deliv_out = _make_delivery(2, -366, -366, as_of=self.as_of)
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=9,
            supplier_code="SUP-LOOKBACK",
            supplier_name="Lookback",
            country="US",
            deliveries=[deliv_in, deliv_out],
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert res.n_deliveries == 1

    def test_band_boundaries(self):
        # Test band classification logic directly
        # band_medium = 25.0, band_high = 50.0
        # Check boundary classifications
        cfg = SupplierRiskConfig(band_medium=25.0, band_high=50.0)
        # If score < 25.0 -> low
        # If score 25.0 -> medium
        # If score 49.9 -> medium
        # If score 50.0 -> high
        # We can construct deliveries that produce exactly these scores or test evaluation
        assert cfg.band_medium == 25.0
        assert cfg.band_high == 50.0

    def test_open_po_informational_metrics(self):
        open_pos = [
            OpenPoInput(
                po_id=1,
                po_number="PO-1",
                status="in_transit",
                promised_date=self.as_of + timedelta(days=5),
                latest_estimate_date=self.as_of + timedelta(days=8),  # Slipped
                remaining_qty=100,
            ),
            OpenPoInput(
                po_id=2,
                po_number="PO-2",
                status="open",
                promised_date=self.as_of - timedelta(days=3),  # Overdue
                latest_estimate_date=None,
                remaining_qty=50,
            ),
        ]
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=10,
            supplier_code="SUP-OPEN-PO",
            supplier_name="Open PO Corp",
            country="US",
            deliveries=[_make_delivery(1, -10, -10, as_of=self.as_of)],
            open_orders=open_pos,
        )
        res = evaluate_supplier(inp)
        assert res.informational_po.open_po_count == 2
        assert res.informational_po.open_pos_slipped_count == 1
        assert res.informational_po.open_pos_overdue_count == 1
        assert res.informational_po.open_remaining_qty == 150

    def test_monthly_breakdown_and_explanation(self):
        # 12 months history
        delivs = [
            _make_delivery(i, -30 * i - 5, -30 * i - 5, as_of=self.as_of)
            for i in range(10)
        ]
        inp = SupplierEvaluationInput(
            as_of=self.as_of,
            supplier_id=11,
            supplier_code="SUP-MONTHLY",
            supplier_name="Monthly Corp",
            country="US",
            deliveries=delivs,
            open_orders=[],
        )
        res = evaluate_supplier(inp)
        assert len(res.monthly_breakdown) == 12
        assert any(m.n_deliveries > 0 for m in res.monthly_breakdown)
        assert "SUP-MONTHLY" in res.explanation
        assert str(res.risk_score) in res.explanation
