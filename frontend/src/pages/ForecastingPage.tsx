import { useCallback, useState } from 'react';
import { getForecastEvaluation, getComponentForecastDetail } from '../api/endpoints';
import type {
  ForecastEvaluationResponse,
  ComponentForecastEvaluation,
  ComponentForecastDetailResponse,
} from '../api/types';
import { useApi } from '../api/useApi';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { formatDate, formatNumber } from '../lib/format';
import { PAGE_SUBTITLES } from '../constants/pageSubtitles';

export function ForecastingPage() {
  const fetcher = useCallback((signal: AbortSignal) => getForecastEvaluation(signal), []);
  const { data, loading, error, reload } = useApi<ForecastEvaluationResponse>(fetcher, [fetcher]);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (loading) {
    return <LoadingView message="Loading demand forecasting evaluation..." />;
  }

  if (error) {
    return (
      <ErrorView
        title="Failed to Load Forecasting Evaluation"
        error={error}
        onRetry={reload}
      />
    );
  }

  if (!data || data.seeded === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Demand Forecasting"
          description={PAGE_SUBTITLES.forecasting}
        />
        <UnseededView />
      </div>
    );
  }

  const { protocol, models, aggregate, decision, per_component, data_caveat } = data;

  // Find the model with lowest pooled WAPE
  const validAggregates = Object.values(aggregate).filter((a) => a.pooled_wape !== null);
  const lowestWape =
    validAggregates.length > 0
      ? Math.min(...validAggregates.map((a) => a.pooled_wape as number))
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demand Forecasting"
        description={PAGE_SUBTITLES.forecasting}
      />

      {/* Permanent Synthetic Data Caveat Banner */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        <div className="flex items-start gap-3">
          <span className="font-semibold uppercase tracking-wider text-amber-400">
            Synthetic Data Notice:
          </span>
          <p>{data_caveat}</p>
        </div>
      </div>

      {/* Production Model In Use Callout */}
      <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="font-medium text-slate-200">
            Active Production Model in Inventory Risk:
          </span>
          <code className="rounded bg-slate-900 px-2 py-0.5 font-mono text-emerald-400">
            weekday_average
          </code>
        </div>
        <span className="text-xs text-text-muted">
          Evaluated via rolling-origin backtest before consideration for production
        </span>
      </div>

      {/* Protocol Summary Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs text-text-muted">Min Training History</div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-100">
            {protocol.min_train_days} days
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs text-text-muted">Forecast Horizon</div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-100">
            {protocol.horizon_days} days
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs text-text-muted">Roll Step Interval</div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-100">
            {protocol.step_days} days
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs text-text-muted">Backtest Folds</div>
          <div className="mt-1 font-mono text-lg font-semibold text-sky-400">
            {protocol.folds} folds
          </div>
        </div>
        <div className="col-span-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 sm:col-span-4 lg:col-span-1">
          <div className="text-xs text-text-muted">Evaluated Points / Model</div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-100">
            {aggregate['weekday_average']?.n_points ?? 0}
          </div>
        </div>
      </div>

      {/* Champion vs Challenger Decision Banner */}
      <div
        className={`rounded-xl border p-5 ${
          decision.recommended
            ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
            : 'border-blue-500/30 bg-blue-950/20 text-slate-200'
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Evaluation Decision Rule
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  decision.recommended
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                {decision.recommended ? 'Challenger Recommended' : 'Baseline Retained'}
              </span>
            </div>
            <h3 className="mt-1 text-base font-semibold text-slate-100">
              {decision.recommended
                ? `Promote Challenger: ${decision.challenger}`
                : `Retain Production Baseline: ${decision.champion}`}
            </h3>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="rounded border border-slate-800 bg-slate-900/80 p-2">
              <span className="text-text-muted">WAPE Impv: </span>
              <span
                className={
                  (decision.pooled_wape_improvement_pct ?? 0) >= 5.0
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }
              >
                {decision.pooled_wape_improvement_pct !== null
                  ? `${decision.pooled_wape_improvement_pct > 0 ? '+' : ''}${decision.pooled_wape_improvement_pct.toFixed(2)}%`
                  : 'N/A'}
              </span>
              <span className="text-text-secondary"> (req &ge; 5%)</span>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/80 p-2">
              <span className="text-text-muted">Win Rate: </span>
              <span
                className={
                  (decision.win_rate ?? 0) >= 0.6 ? 'text-emerald-400' : 'text-amber-400'
                }
              >
                {decision.win_rate !== null ? `${(decision.win_rate * 100).toFixed(1)}%` : 'N/A'}
              </span>
              <span className="text-text-secondary"> (req &ge; 60%)</span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm text-slate-300 leading-relaxed">{decision.reason}</p>
        <p className="mt-2 text-xs text-text-muted">{decision.rule_text}</p>
      </div>

      {/* Aggregate Models Table */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-slate-100">Model Performance Summary</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Production Role</th>
                <th className="px-4 py-3 text-right">Pooled WAPE</th>
                <th className="px-4 py-3 text-right">Macro WAPE</th>
                <th className="px-4 py-3 text-right">MAE</th>
                <th className="px-4 py-3 text-right">RMSE</th>
                <th className="px-4 py-3 text-right">Bias</th>
                <th className="px-4 py-3 text-right">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {models.map((model) => {
                const agg = aggregate[model.name];
                const isLowest =
                  agg?.pooled_wape !== null && agg?.pooled_wape === lowestWape;
                return (
                  <tr key={model.name} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-200">
                      <code>{model.name}</code>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">{model.type}</td>
                    <td className="px-4 py-3">
                      {model.used_by_inventory_risk ? (
                        <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
                          Active in Inventory Risk
                        </span>
                      ) : (
                        <span className="text-xs text-text-secondary">Evaluation Only</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      {agg?.pooled_wape !== null && agg?.pooled_wape !== undefined ? (
                        <span className="inline-flex items-center gap-2">
                          {isLowest && (
                            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-xs text-sky-300 font-sans">
                              Lowest WAPE
                            </span>
                          )}
                          <span className={isLowest ? 'text-sky-300' : 'text-slate-200'}>
                            {(agg.pooled_wape * 100).toFixed(2)}%
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {agg?.macro_wape !== null && agg?.macro_wape !== undefined
                        ? `${(agg.macro_wape * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {agg ? formatNumber(agg.mae, 2) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {agg ? formatNumber(agg.rmse, 2) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {agg ? `${agg.bias > 0 ? '+' : ''}${formatNumber(agg.bias, 2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-text-muted">
                      {agg?.n_points ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-Component Backtest Evaluation Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-100">
            Per-Component Backtest Results
          </h3>
          <span className="text-xs text-text-muted">
            Click a component to view the 14-day projection and last-fold backtest
          </span>
        </div>

        {per_component.length === 0 ? (
          <EmptyView
            title="No Components Evaluated"
            message="No component demand history records were found."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="w-8 px-3 py-3" />
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Component Name</th>
                  <th className="px-4 py-3 text-center">Best Model</th>
                  <th className="px-4 py-3 text-right">Seasonal Naive WAPE</th>
                  <th className="px-4 py-3 text-right">Weekday Avg WAPE</th>
                  <th className="px-4 py-3 text-right">Ridge Trend WAPE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {per_component.map((comp) => {
                  const isExpanded = expandedId === comp.component_id;
                  const snWape = comp.models['seasonal_naive']?.wape;
                  const wkaWape = comp.models['weekday_average']?.wape;
                  const rgWape = comp.models['ridge_weekday_trend']?.wape;

                  return (
                    <ComponentTableRow
                      key={comp.component_id}
                      comp={comp}
                      isExpanded={isExpanded}
                      snWape={snWape}
                      wkaWape={wkaWape}
                      rgWape={rgWape}
                      onToggle={() =>
                        setExpandedId(isExpanded ? null : comp.component_id)
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentTableRow({
  comp,
  isExpanded,
  snWape,
  wkaWape,
  rgWape,
  onToggle,
}: {
  comp: ComponentForecastEvaluation;
  isExpanded: boolean;
  snWape: number | null | undefined;
  wkaWape: number | null | undefined;
  rgWape: number | null | undefined;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition-colors ${
          isExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
        }`}
      >
        <td className="px-3 py-3 text-center text-text-muted">
          <span className="inline-block transition-transform duration-200">
            {isExpanded ? '▼' : '▶'}
          </span>
        </td>
        <td className="px-4 py-3 font-mono font-medium text-slate-200">
          {comp.sku}
        </td>
        <td className="px-4 py-3 text-slate-300">{comp.name}</td>
        <td className="px-4 py-3 text-center">
          {comp.zero_demand ? (
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-text-muted">
              Zero Demand
            </span>
          ) : comp.best_model ? (
            <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
              {comp.best_model}
            </span>
          ) : (
            '—'
          )}
        </td>
        <td className="px-4 py-3 text-right font-mono text-slate-300">
          {snWape !== null && snWape !== undefined
            ? `${(snWape * 100).toFixed(2)}%`
            : comp.zero_demand
              ? '— (Zero Demand)'
              : '—'}
        </td>
        <td className="px-4 py-3 text-right font-mono text-slate-300">
          {wkaWape !== null && wkaWape !== undefined
            ? `${(wkaWape * 100).toFixed(2)}%`
            : comp.zero_demand
              ? '— (Zero Demand)'
              : '—'}
        </td>
        <td className="px-4 py-3 text-right font-mono text-slate-300">
          {rgWape !== null && rgWape !== undefined
            ? `${(rgWape * 100).toFixed(2)}%`
            : comp.zero_demand
              ? '— (Zero Demand)'
              : '—'}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7} className="border-b border-slate-800 bg-slate-900/90 p-4">
            <ComponentDetailExpanded componentId={comp.component_id} sku={comp.sku} />
          </td>
        </tr>
      )}
    </>
  );
}

function ComponentDetailExpanded({
  componentId,
  sku,
}: {
  componentId: number;
  sku: string;
}) {
  const fetcher = useCallback(
    (signal: AbortSignal) => getComponentForecastDetail(componentId, 14, signal),
    [componentId]
  );
  const { data, loading, error, reload } = useApi<ComponentForecastDetailResponse>(
    fetcher,
    [fetcher]
  );

  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-text-muted">
        Loading 14-day forecasts and last-fold backtest for {sku}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
        <span>Failed to load details: {error.message}</span>
        <button
          onClick={reload}
          className="ml-3 underline hover:text-red-200"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Table 1: Future 14-day forecast */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Future 14-Day Demand Forecast (Next 14 Days from As-Of)
        </h4>
        <div className="overflow-x-auto rounded border border-slate-800 bg-slate-950/50">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-900/60 text-text-muted">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Weekday</th>
                <th className="px-3 py-2 text-right">Seasonal Naive</th>
                <th className="px-3 py-2 text-right">Weekday Average (Prod)</th>
                <th className="px-3 py-2 text-right">Ridge Regression</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data.forecast_days.map((d) => (
                <tr key={d.date} className="hover:bg-slate-800/30">
                  <td className="px-3 py-1.5 font-mono text-slate-300">
                    {formatDate(d.date)}
                  </td>
                  <td className="px-3 py-1.5 text-text-muted">{d.weekday}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-300">
                    {d.forecasts.seasonal_naive?.toFixed(1) ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-medium text-emerald-400">
                    {d.forecasts.weekday_average?.toFixed(1) ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-indigo-300">
                    {d.forecasts.ridge_weekday_trend?.toFixed(1) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Table 2: Backtest Last Fold Comparison */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Backtest Fold 5 Evaluation: Actual vs Model Forecasts
        </h4>
        <div className="overflow-x-auto rounded border border-slate-800 bg-slate-950/50">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-900/60 text-text-muted">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-200">
                  Actual Demand
                </th>
                <th className="px-3 py-2 text-right">Seasonal Naive</th>
                <th className="px-3 py-2 text-right">Weekday Average</th>
                <th className="px-3 py-2 text-right">Ridge Regression</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data.backtest_last_fold.map((bf) => (
                <tr key={bf.date} className="hover:bg-slate-800/30">
                  <td className="px-3 py-1.5 font-mono text-slate-300">
                    {formatDate(bf.date)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-100">
                    {bf.actual.toFixed(1)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-300">
                    {bf.forecasts.seasonal_naive?.toFixed(1) ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-400">
                    {bf.forecasts.weekday_average?.toFixed(1) ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-indigo-300">
                    {bf.forecasts.ridge_weekday_trend?.toFixed(1) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
