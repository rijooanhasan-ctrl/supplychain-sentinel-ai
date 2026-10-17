"""Unit tests for domain demand forecasting models, rolling backtest, leakage, and decision rules."""

from datetime import date, timedelta
import math
import numpy as np
import pytest

from app.domain.forecasting import (
    ComponentDemandInput,
    DecisionResult,
    ForecastEvalConfig,
    compute_component_forecast_detail,
    compute_metrics,
    forecast_ridge_weekday_trend,
    forecast_seasonal_naive,
    forecast_weekday_average,
    run_forecast_evaluation,
)
from app.domain.inventory import (
    ComponentEvaluationInput,
    DemandHistoryRecordInput,
    InventoryRiskConfig,
    PlantInventoryInput,
    evaluate_component,
)


class TestForecastingModels:
    def test_weekday_average_near_zero_error_on_perfect_weekly_pattern(self):
        """A perfect repeating weekly pattern has 0 error under weekday_average."""
        base_date = date(2026, 1, 5)  # Monday
        pattern = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0]
        records = []
        for d_idx in range(56):  # 8 weeks
            d = base_date + timedelta(days=d_idx)
            records.append(DemandHistoryRecordInput(date=d, quantity=pattern[d.weekday()]))

        origin = base_date + timedelta(days=56)
        preds = forecast_weekday_average(records, origin=origin, horizon_days=7)
        assert preds is not None
        assert len(preds) == 7
        for k in range(7):
            assert math.isclose(preds[k], pattern[k], abs_tol=1e-6)

    def test_seasonal_naive_exact_on_periodic_series(self):
        """Seasonal naive exactly recovers a periodic series."""
        base_date = date(2026, 1, 5)  # Monday
        pattern = [15.0, 25.0, 35.0, 45.0, 55.0, 65.0, 75.0]
        records = []
        for d_idx in range(28):  # 4 weeks
            d = base_date + timedelta(days=d_idx)
            records.append(DemandHistoryRecordInput(date=d, quantity=pattern[d.weekday()]))

        origin = base_date + timedelta(days=28)
        preds, fallbacks = forecast_seasonal_naive(records, origin=origin, horizon_days=7)
        assert fallbacks == 0
        assert len(preds) == 7
        for k in range(7):
            assert math.isclose(preds[k], pattern[k], abs_tol=1e-6)

    def test_ridge_clips_negatives_and_is_deterministic(self):
        """Ridge regression clips negative predictions at 0 and produces deterministic outputs."""
        base_date = date(2026, 1, 1)
        # Steep downward trend
        records = []
        for d_idx in range(60):
            d = base_date + timedelta(days=d_idx)
            # Declining from 50 down to 0 and below
            qty = max(0.0, 50.0 - 1.5 * d_idx)
            records.append(DemandHistoryRecordInput(date=d, quantity=qty))

        origin = base_date + timedelta(days=60)
        preds_1 = forecast_ridge_weekday_trend(records, origin=origin, horizon_days=14)
        preds_2 = forecast_ridge_weekday_trend(records, origin=origin, horizon_days=14)

        assert preds_1 is not None
        assert preds_2 is not None
        # Deterministic
        assert preds_1 == preds_2
        # All clipped at >= 0.0
        assert all(p >= 0.0 for p in preds_1)
        # Latter half of horizon should be 0.0 due to steep downward trend
        assert preds_1[-1] == 0.0

    def test_backtest_weekday_average_equals_production_forecast(self):
        """The backtest model forecast_weekday_average equals the production evaluate_component forecast."""
        base_date = date(2026, 5, 1)
        records = []
        # 60 days of varying demand
        for d_idx in range(60):
            d = base_date + timedelta(days=d_idx)
            records.append(DemandHistoryRecordInput(date=d, quantity=float(100 + (d_idx % 7) * 10)))

        as_of = base_date + timedelta(days=60)
        # Production evaluate_component
        comp_input = ComponentEvaluationInput(
            as_of=as_of,
            component_id=1,
            sku="TEST-SKU",
            name="Test Component",
            category="PROCESSOR",
            criticality="CRITICAL",
            plant_inventory=PlantInventoryInput(on_hand=5000, reserved=0),
            demand_records=records,
        )
        inv_result = evaluate_component(comp_input, InventoryRiskConfig(lookback_days=28))
        prod_forecasts = [p.forecast_demand for p in inv_result.daily_projection[:14]]

        # Domain forecasting forecast_weekday_average
        backtest_forecasts = forecast_weekday_average(records, origin=as_of, horizon_days=14, lookback_days=28)
        assert backtest_forecasts is not None

        assert len(prod_forecasts) == len(backtest_forecasts) == 14
        for pf, bf in zip(prod_forecasts, backtest_forecasts):
            assert math.isclose(pf, bf, abs_tol=1e-6)


class TestBacktestProtocolAndMetrics:
    def test_fold_origins_and_count_for_180_day_series(self):
        """180-day series produces exactly 6 folds with min_train=84, horizon=14, step=14."""
        base_date = date(2026, 4, 20)
        records = [
            DemandHistoryRecordInput(date=base_date + timedelta(days=i), quantity=50.0)
            for i in range(180)
        ]
        comp = ComponentDemandInput(component_id=1, sku="C1", name="Comp 1", demand_records=records)
        as_of = base_date + timedelta(days=180)

        report = run_forecast_evaluation(
            [comp],
            as_of=as_of,
            config=ForecastEvalConfig(min_train_days=84, horizon_days=14, step_days=14),
        )

        assert report.protocol.folds == 6
        expected_origins = [
            date(2026, 7, 13),
            date(2026, 7, 27),
            date(2026, 8, 10),
            date(2026, 8, 24),
            date(2026, 9, 7),
            date(2026, 9, 21),
        ]
        assert report.protocol.origin_dates == expected_origins

    def test_leakage_safeguard(self):
        """Changing demand at or after origin has ZERO impact on forecasts generated at origin."""
        base_date = date(2026, 1, 1)
        records_clean = []
        records_contaminated = []

        origin = base_date + timedelta(days=90)
        for i in range(120):
            d = base_date + timedelta(days=i)
            qty_clean = float(20 + (i % 7) * 5)
            # Contaminated data modifies records on/after origin by 1000x
            qty_contam = qty_clean * 1000.0 if d >= origin else qty_clean

            records_clean.append(DemandHistoryRecordInput(date=d, quantity=qty_clean))
            records_contaminated.append(DemandHistoryRecordInput(date=d, quantity=qty_contam))

        # 1. seasonal_naive
        sn_1, _ = forecast_seasonal_naive(records_clean, origin=origin, horizon_days=14)
        sn_2, _ = forecast_seasonal_naive(records_contaminated, origin=origin, horizon_days=14)
        assert sn_1 == sn_2

        # 2. weekday_average
        wka_1 = forecast_weekday_average(records_clean, origin=origin, horizon_days=14)
        wka_2 = forecast_weekday_average(records_contaminated, origin=origin, horizon_days=14)
        assert wka_1 == wka_2

        # 3. ridge_weekday_trend
        rg_1 = forecast_ridge_weekday_trend(records_clean, origin=origin, horizon_days=14)
        rg_2 = forecast_ridge_weekday_trend(records_contaminated, origin=origin, horizon_days=14)
        assert rg_1 == rg_2

    def test_metrics_on_hand_computed_example(self):
        """MAE, RMSE, WAPE, and Bias on a known small hand-computed example."""
        actuals = [10.0, 20.0, 30.0]
        forecasts = [12.0, 18.0, 35.0]
        # err: +2.0, -2.0, +5.0 -> abs: 2, 2, 5 -> sum = 9, sum_act = 60
        # mae = 9 / 3 = 3.0
        # rmse = sqrt((4 + 4 + 25) / 3) = sqrt(11) = 3.32
        # wape = 9 / 60 = 0.1500
        # bias = (2 - 2 + 5) / 3 = 1.67
        metrics = compute_metrics(actuals, forecasts)
        assert metrics.n_points == 3
        assert metrics.mae == 3.0
        assert metrics.rmse == 3.32
        assert metrics.wape == 0.1500
        assert metrics.bias == 1.67

    def test_zero_demand_series_wape_null_without_exceptions(self):
        """Component with zero historical demand yields null WAPE and is skipped in evaluation."""
        base_date = date(2026, 1, 1)
        records = [
            DemandHistoryRecordInput(date=base_date + timedelta(days=i), quantity=0.0)
            for i in range(120)
        ]
        comp = ComponentDemandInput(component_id=14, sku="ZERO-1", name="Zero Demand Component", demand_records=records)
        as_of = base_date + timedelta(days=120)

        report = run_forecast_evaluation([comp], as_of=as_of)
        assert len(report.skipped) == 1
        assert report.skipped[0].sku == "ZERO-1"
        assert report.per_component[0].zero_demand is True
        for m_metrics in report.per_component[0].models.values():
            assert m_metrics.wape is None
            assert m_metrics.mae == 0.0

    def test_missing_actuals_skipped(self):
        """Missing actual dates in the evaluation horizon are skipped, not treated as 0."""
        base_date = date(2026, 1, 1)
        # Create records up to day 99, but in the horizon [90..103], skip 4 dates
        records = []
        origin = base_date + timedelta(days=90)
        skip_dates = {origin + timedelta(days=2), origin + timedelta(days=5), origin + timedelta(days=9)}

        for i in range(110):
            d = base_date + timedelta(days=i)
            if d not in skip_dates:
                records.append(DemandHistoryRecordInput(date=d, quantity=25.0))

        comp = ComponentDemandInput(component_id=1, sku="C1", name="Comp 1", demand_records=records)
        as_of = base_date + timedelta(days=110)

        # Single fold
        config = ForecastEvalConfig(min_train_days=90, horizon_days=14, step_days=100)
        report = run_forecast_evaluation([comp], as_of=as_of, config=config)

        # Horizon had 14 days, 3 were missing -> exactly 11 evaluated points
        assert report.per_component[0].models["seasonal_naive"].n_points == 11


class TestDecisionRuleTruthTable:
    def _create_report_with_metrics(self, wape_champ, wape_chall, challenger_wins, total_pairs):
        from app.domain.forecasting import DecisionResult

        wape_imprv = round(((wape_champ - wape_chall) / wape_champ) * 100, 2)
        win_rate = round(challenger_wins / total_pairs, 4)
        min_imprv = 5.0
        min_win = 0.60
        recommended = bool(wape_imprv >= min_imprv and win_rate >= min_win)
        return DecisionResult(
            rule_text="rule",
            champion="weekday_average",
            challenger="ridge_weekday_trend",
            recommended=recommended,
            pooled_wape_improvement_pct=wape_imprv,
            win_rate=win_rate,
            reason="test",
        )

    def test_passes_both_criteria_recommended(self):
        # 10% improvement >= 5%, 65% win rate >= 60%
        res = self._create_report_with_metrics(wape_champ=0.10, wape_chall=0.09, challenger_wins=65, total_pairs=100)
        assert res.recommended is True

    def test_passes_only_wape_improvement_retained(self):
        # 10% improvement >= 5%, but 55% win rate < 60%
        res = self._create_report_with_metrics(wape_champ=0.10, wape_chall=0.09, challenger_wins=55, total_pairs=100)
        assert res.recommended is False

    def test_passes_only_win_rate_retained(self):
        # 2% improvement < 5%, but 70% win rate >= 60%
        res = self._create_report_with_metrics(wape_champ=0.10, wape_chall=0.098, challenger_wins=70, total_pairs=100)
        assert res.recommended is False

    def test_passes_neither_retained(self):
        # -1% improvement < 5%, 40% win rate < 60%
        res = self._create_report_with_metrics(wape_champ=0.10, wape_chall=0.101, challenger_wins=40, total_pairs=100)
        assert res.recommended is False
