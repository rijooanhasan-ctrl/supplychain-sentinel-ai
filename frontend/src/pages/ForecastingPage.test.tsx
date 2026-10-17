import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as endpoints from '../api/endpoints';
import type {
  ForecastEvaluationResponse,
  ComponentForecastDetailResponse,
} from '../api/types';
import { ForecastingPage } from './ForecastingPage';

vi.mock('../api/endpoints', () => ({
  getForecastEvaluation: vi.fn(),
  getComponentForecastDetail: vi.fn(),
}));

const mockEvaluationData: ForecastEvaluationResponse = {
  seeded: true,
  as_of: '2026-10-17',
  data_caveat: 'The synthetic dataset was generated with structural weekday patterns, trend, and noise.',
  protocol: {
    min_train_days: 84,
    horizon_days: 14,
    step_days: 14,
    folds: 6,
    origin_dates: ['2026-07-13', '2026-07-27', '2026-08-10', '2026-08-24', '2026-09-07', '2026-09-21'],
  },
  models: [
    {
      name: 'seasonal_naive',
      type: 'heuristic_baseline',
      description: 'Seasonal naive baseline',
      used_by_inventory_risk: false,
    },
    {
      name: 'weekday_average',
      type: 'production_champion',
      description: 'Weekday-specific mean demand over 28-day window',
      used_by_inventory_risk: true,
    },
    {
      name: 'ridge_weekday_trend',
      type: 'challenger',
      description: 'Ridge regression with weekday one-hot and standardized trend',
      used_by_inventory_risk: false,
    },
  ],
  aggregate: {
    seasonal_naive: {
      model_name: 'seasonal_naive',
      pooled_wape: 0.1357,
      macro_wape: 0.138,
      mae: 6.95,
      rmse: 22.95,
      bias: -1.64,
      n_points: 1092,
      n_components: 13,
    },
    weekday_average: {
      model_name: 'weekday_average',
      pooled_wape: 0.1199,
      macro_wape: 0.121,
      mae: 6.14,
      rmse: 22.72,
      bias: -1.76,
      n_points: 1092,
      n_components: 13,
    },
    ridge_weekday_trend: {
      model_name: 'ridge_weekday_trend',
      pooled_wape: 0.1171,
      macro_wape: 0.118,
      mae: 6.0,
      rmse: 22.64,
      bias: -1.66,
      n_points: 1092,
      n_components: 13,
    },
  },
  decision: {
    rule_text: 'Challenger recommended only if WAPE improvement >= 5% and win rate >= 60%',
    champion: 'weekday_average',
    challenger: 'ridge_weekday_trend',
    recommended: false,
    pooled_wape_improvement_pct: 2.29,
    win_rate: 0.5897,
    reason: 'Baseline model weekday_average retained: pooled WAPE improvement was 2.29% (required >= 5.0%); win rate was 59.0% (required >= 60.0%).',
  },
  per_component: [
    {
      component_id: 1,
      sku: 'CPU-X7',
      name: 'NovaCore X7 Processor',
      zero_demand: false,
      models: {
        seasonal_naive: { n_points: 84, mae: 5.5, rmse: 7.2, wape: 0.054, bias: -0.8 },
        weekday_average: { n_points: 84, mae: 4.8, rmse: 6.1, wape: 0.047, bias: -0.5 },
        ridge_weekday_trend: { n_points: 84, mae: 4.2, rmse: 5.4, wape: 0.041, bias: -0.3 },
      },
      best_model: 'ridge_weekday_trend',
    },
    {
      component_id: 14,
      sku: 'COMP-SPARE-01',
      name: 'Legacy Sensor',
      zero_demand: true,
      models: {
        seasonal_naive: { n_points: 0, mae: 0, rmse: 0, wape: null, bias: 0 },
        weekday_average: { n_points: 0, mae: 0, rmse: 0, wape: null, bias: 0 },
        ridge_weekday_trend: { n_points: 0, mae: 0, rmse: 0, wape: null, bias: 0 },
      },
      best_model: null,
    },
  ],
  skipped: [
    {
      component_id: 14,
      sku: 'COMP-SPARE-01',
      name: 'Legacy Sensor',
      reason: 'Zero historical demand',
    },
  ],
};

const mockDetailData: ComponentForecastDetailResponse = {
  seeded: true,
  component_id: 1,
  sku: 'CPU-X7',
  name: 'NovaCore X7 Processor',
  as_of: '2026-10-17',
  days: 14,
  forecast_days: [
    {
      date: '2026-10-17',
      weekday: 'Saturday',
      forecasts: { seasonal_naive: 95.0, weekday_average: 98.2, ridge_weekday_trend: 97.4 },
    },
  ],
  backtest_last_fold: [
    {
      date: '2026-09-21',
      actual: 104.0,
      forecasts: { seasonal_naive: 98.0, weekday_average: 101.5, ridge_weekday_trend: 103.2 },
    },
  ],
};

describe('ForecastingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders caveat banner, protocol, aggregate table with lowest WAPE, and baseline retained decision', async () => {
    vi.mocked(endpoints.getForecastEvaluation).mockResolvedValue(mockEvaluationData);

    render(<ForecastingPage />);

    expect(await screen.findByText(/Synthetic Data Notice:/i)).toBeInTheDocument();
    expect(screen.getByText(/Active Production Model in Inventory Risk:/i)).toBeInTheDocument();
    expect(screen.getAllByText('weekday_average').length).toBeGreaterThan(0);

    // Protocol
    expect(screen.getByText('84 days')).toBeInTheDocument();
    expect(screen.getByText('6 folds')).toBeInTheDocument();

    // Decision block
    expect(screen.getByText('Baseline Retained')).toBeInTheDocument();
    expect(screen.getByText(/Retain Production Baseline: weekday_average/i)).toBeInTheDocument();

    // Lowest WAPE badge
    expect(screen.getByText('Lowest WAPE')).toBeInTheDocument();

    // Per component table
    expect(screen.getByText('CPU-X7')).toBeInTheDocument();
    expect(screen.getByText('COMP-SPARE-01')).toBeInTheDocument();
    // Zero demand WAPE displayed with reason
    expect(screen.getAllByText('— (Zero Demand)').length).toBeGreaterThan(0);
  });

  it('renders recommended decision block when challenger passes criteria', async () => {
    const recommendedData: ForecastEvaluationResponse = {
      ...mockEvaluationData,
      decision: {
        ...mockEvaluationData.decision,
        recommended: true,
        pooled_wape_improvement_pct: 8.5,
        win_rate: 0.65,
        reason: 'Challenger model ridge_weekday_trend recommended: achieved 8.50% relative reduction and 65.0% win rate.',
      },
    };
    vi.mocked(endpoints.getForecastEvaluation).mockResolvedValue(recommendedData);

    render(<ForecastingPage />);

    expect(await screen.findByText('Challenger Recommended')).toBeInTheDocument();
    expect(screen.getByText(/Promote Challenger: ridge_weekday_trend/i)).toBeInTheDocument();
  });

  it('expands component row to show 14-day forecast and last-fold backtest tables', async () => {
    vi.mocked(endpoints.getForecastEvaluation).mockResolvedValue(mockEvaluationData);
    vi.mocked(endpoints.getComponentForecastDetail).mockResolvedValue(mockDetailData);

    render(<ForecastingPage />);

    const row = await screen.findByText('CPU-X7');
    fireEvent.click(row);

    expect(
      await screen.findByText(/Future 14-Day Demand Forecast/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Backtest Fold 5 Evaluation/i)).toBeInTheDocument();
    expect(screen.getByText('104.0')).toBeInTheDocument();
  });

  it('handles unseeded state properly', async () => {
    vi.mocked(endpoints.getForecastEvaluation).mockResolvedValue({
      ...mockEvaluationData,
      seeded: false,
    });

    render(<ForecastingPage />);

    expect(await screen.findByText(/Database Unseeded/i)).toBeInTheDocument();
  });

  it('handles error state with retry button', async () => {
    vi.mocked(endpoints.getForecastEvaluation)
      .mockRejectedValueOnce(new Error('Network evaluation error'))
      .mockResolvedValueOnce(mockEvaluationData);

    render(<ForecastingPage />);

    expect(await screen.findByText(/Network evaluation error/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    expect(await screen.findByText(/Synthetic Data Notice:/i)).toBeInTheDocument();
  });
});
