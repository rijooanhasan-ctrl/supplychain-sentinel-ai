import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getInventoryRisk, getInventoryRiskDetail, listComponents } from '../api/endpoints';
import type {
  Component,
  ComponentCriticality,
  InventoryRiskItem,
  RiskLevel,
} from '../api/types';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Pagination } from '../components/Pagination';
import { CriticalityBadge, RiskBadge } from '../components/Badge';
import { formatDate, formatInteger } from '../lib/format';
import { InfoTip } from '../components/ui/InfoTip';
import { GLOSSARY } from '../constants/glossary';
import { PAGE_SUBTITLES } from '../constants/pageSubtitles';

const RISK_LEVEL_OPTIONS: { label: string; value: RiskLevel | '' }[] = [
  { label: 'All Risk Levels', value: '' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
  { label: 'Not applicable', value: 'none' },
  { label: 'Unknown', value: 'unknown' },
];

const CRITICALITY_OPTIONS: { label: string; value: ComponentCriticality | '' }[] = [
  { label: 'All Criticalities', value: '' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Normal', value: 'normal' },
];

function ComponentRiskDetailPanel({ componentId }: { componentId: number }) {
  const fetchDetail = useCallback(
    (signal: AbortSignal) => getInventoryRiskDetail(componentId, signal),
    [componentId]
  );
  const { data: detail, loading, error, reload } = useApi(fetchDetail, [fetchDetail]);

  if (loading) {
    return (
      <div className="p-4 bg-slate-50 border-t border-slate-200">
        <LoadingView message="Loading component stock projection and evidence..." testId={`detail-loading-${componentId}`} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 bg-slate-50 border-t border-slate-200">
        <ErrorView
          error={error || new Error('Failed to load detail')}
          onRetry={reload}
          title="Could not load inventory risk details"
        />
      </div>
    );
  }

  // Display first 14 days of projection
  const first14Days = detail.daily_projection.slice(0, 14);

  return (
    <div
      id={`risk-detail-${componentId}`}
      data-testid={`risk-detail-panel-${componentId}`}
      className="p-5 bg-slate-50 border-t border-slate-200 space-y-6 text-xs text-slate-800"
    >
      {/* 1. Explanation Banner */}
      <section aria-labelledby={`explanation-heading-${componentId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
        <h3 id={`explanation-heading-${componentId}`} className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
          Assessment Explanation
        </h3>
        <p className="text-sm font-medium text-slate-900 leading-relaxed" data-testid={`explanation-text-${componentId}`}>
          {detail.explanation}
        </p>
      </section>

      {/* 2. Flags */}
      {detail.flags.length > 0 && (
        <section aria-labelledby={`flags-heading-${componentId}`} className="bg-amber-50/70 p-4 rounded-lg border border-amber-200">
          <h3 id={`flags-heading-${componentId}`} className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-2">
            Identified Operational Flags ({detail.flags.length})
          </h3>
          <ul className="space-y-1.5 list-disc list-inside text-amber-950 font-medium">
            {detail.flags.map((flag) => (
              <li key={flag.code} data-testid={`flag-${flag.code}`}>
                <span className="font-mono font-bold text-[11px] bg-amber-100 px-1 py-0.5 rounded border border-amber-300 mr-1.5">
                  {flag.code}
                </span>
                {flag.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Evidence Grid: Stock breakdown, regional inventory, and weekday demand */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Usable Stock Breakdown */}
        <section aria-labelledby={`stock-breakdown-${componentId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-2">
          <h3 id={`stock-breakdown-${componentId}`} className="font-bold text-slate-700 uppercase tracking-wider">
            Plant Usable Stock
          </h3>
          {detail.usable_stock_breakdown ? (
            <div className="space-y-1.5">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">On-hand Stock:</span>
                <span className="font-mono font-semibold text-slate-900">
                  {formatInteger(detail.usable_stock_breakdown.on_hand)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Reserved Allocations:</span>
                <span className="font-mono font-semibold text-slate-900">
                  {formatInteger(detail.usable_stock_breakdown.reserved)}
                </span>
              </div>
              <div className="flex justify-between py-1 font-bold text-slate-900">
                <span>Net Usable Stock:</span>
                <span className="font-mono text-blue-700" data-testid={`usable-stock-val-${componentId}`}>
                  {formatInteger(detail.usable_stock_breakdown.usable)}
                </span>
              </div>
              {detail.usable_stock_breakdown.reserved_exceeds_on_hand && (
                <p className="text-[11px] text-red-700 font-bold mt-1">
                  Alert: Reserved stock exceeds on-hand balance. Usable stock clamped to 0.
                </p>
              )}
            </div>
          ) : (
            <p className="text-slate-500 italic">No inventory row recorded at plant.</p>
          )}
        </section>

        {/* Regional Inventory */}
        <section aria-labelledby={`reg-stock-${componentId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 id={`reg-stock-${componentId}`} className="font-bold text-slate-700 uppercase tracking-wider">
              Regional Stock
            </h3>
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Informational</span>
          </div>
          {detail.regional_usable_stock.length > 0 ? (
            <div className="space-y-1.5">
              {detail.regional_usable_stock.map((reg) => (
                <div key={reg.warehouse_id} className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600 truncate max-w-[140px]" title={reg.warehouse_name}>
                    {reg.warehouse_code}:
                  </span>
                  <span className="font-mono font-semibold text-slate-900">
                    {formatInteger(reg.usable)} usable ({formatInteger(reg.on_hand)} on hand)
                  </span>
                </div>
              ))}
              <div className="flex justify-between py-1 font-bold text-slate-900">
                <span>Total Regional Usable:</span>
                <span className="font-mono text-slate-800" data-testid={`reg-total-${componentId}`}>
                  {formatInteger(detail.regional_total_usable)}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 italic mt-1">
                Potentially transferable; no transfer assumed in plant projection.
              </p>
            </div>
          ) : (
            <p className="text-slate-500 italic">No inventory held across regional distribution hubs.</p>
          )}
        </section>

        {/* Weekday Forecast Baseline */}
        <section aria-labelledby={`weekday-forecast-${componentId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-2">
          <h3 id={`weekday-forecast-${componentId}`} className="font-bold text-slate-700 uppercase tracking-wider">
            Weekday Demand Baseline
          </h3>
          {detail.forecast_by_weekday ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {detail.forecast_by_weekday.map((wf) => (
                <div key={wf.weekday} className="flex justify-between py-0.5 border-b border-slate-100">
                  <span className="text-slate-500">{wf.weekday_name.slice(0, 3)}:</span>
                  <span className="font-mono font-semibold text-slate-900">{wf.mean_demand.toFixed(1)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 italic">Insufficient history to calculate weekday profile.</p>
          )}
        </section>
      </div>

      {/* 4. Inbound Deliveries Schedule */}
      <section aria-labelledby={`inbound-heading-${componentId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-3">
        <h3 id={`inbound-heading-${componentId}`} className="font-bold text-slate-700 uppercase tracking-wider">
          Scheduled Inbound Replenishment Orders
        </h3>
        {detail.counted_inbound.length === 0 && detail.unconfirmed_inbound.length === 0 ? (
          <p className="text-slate-500 italic">No active replenishment purchase orders scheduled for this component.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">PO Number</th>
                  <th scope="col" className="px-3 py-2 text-left">Status</th>
                  <th scope="col" className="px-3 py-2 text-left">Warehouse</th>
                  <th scope="col" className="px-3 py-2 text-right">Remaining Qty</th>
                  <th scope="col" className="px-3 py-2 text-left">Expected Arrival</th>
                  <th scope="col" className="px-3 py-2 text-left">Date Basis</th>
                  <th scope="col" className="px-3 py-2 text-left">Planning Consideration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.counted_inbound.map((inb) => (
                  <tr key={inb.po_id}>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">{inb.po_number}</td>
                    <td className="px-3 py-2 text-slate-700">{inb.status}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{inb.warehouse_code}</td>
                    <td className="px-3 py-2 font-mono text-right font-semibold text-slate-900">
                      {formatInteger(inb.remaining_qty)}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-900">{formatDate(inb.expected_date)}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                        {inb.date_basis}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-emerald-800 font-medium">Counted in supply projection</td>
                  </tr>
                ))}
                {detail.unconfirmed_inbound.map((inb) => (
                  <tr key={inb.po_id} className="bg-amber-50/40">
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">{inb.po_number}</td>
                    <td className="px-3 py-2 text-slate-700">{inb.status}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{inb.warehouse_code}</td>
                    <td className="px-3 py-2 font-mono text-right font-semibold text-slate-900">
                      {formatInteger(inb.remaining_qty)}
                    </td>
                    <td className="px-3 py-2 font-mono text-red-700 font-semibold">{formatDate(inb.expected_date)}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-900 border border-red-200">
                        overdue
                      </span>
                    </td>
                    <td className="px-3 py-2 text-red-800 font-medium">
                      Excluded (overdue inbound policy: exclude)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5. 14-Day Trajectory Projection Table */}
      <section aria-labelledby={`projection-heading-${componentId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 id={`projection-heading-${componentId}`} className="font-bold text-slate-700 uppercase tracking-wider">
            14-Day Daily Stock Trajectory Simulation
          </h3>
          <span className="text-[11px] text-slate-500">
            Receipts available at start of day; demand consumed during day.
          </span>
        </div>

        {first14Days.length === 0 ? (
          <p className="text-slate-500 italic">No projection available for this component.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs" data-testid={`projection-table-${componentId}`}>
              <thead className="bg-slate-50 text-slate-600 font-semibold">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Day</th>
                  <th scope="col" className="px-3 py-2 text-left">Date</th>
                  <th scope="col" className="px-3 py-2 text-right">Forecast Demand</th>
                  <th scope="col" className="px-3 py-2 text-right">Inbound Receipts</th>
                  <th scope="col" className="px-3 py-2 text-right">Ending Balance</th>
                  <th scope="col" className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {first14Days.map((step) => {
                  const isShortage = step.unmet > 0;
                  return (
                    <tr
                      key={step.day_index}
                      className={isShortage ? 'bg-red-50/80 font-medium' : 'hover:bg-slate-50/80'}
                      data-testid={`projection-day-${step.day_index}`}
                    >
                      <th scope="row" className="px-3 py-2 font-mono font-semibold text-slate-700 text-left">
                        +{step.day_index}
                      </th>
                      <td className="px-3 py-2 font-mono text-slate-900">{formatDate(step.date)}</td>
                      <td className="px-3 py-2 font-mono text-right text-slate-800">{step.forecast_demand.toFixed(1)}</td>
                      <td className="px-3 py-2 font-mono text-right text-slate-800">
                        {step.receipts > 0 ? (
                          <span className="text-emerald-700 font-bold">+{step.receipts.toFixed(1)}</span>
                        ) : (
                          '0.0'
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-right font-bold text-slate-900">
                        {step.ending_balance.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isShortage ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded font-bold text-red-900 bg-red-100 border border-red-300"
                            data-testid={`shortage-badge-day-${step.day_index}`}
                          >
                            Shortage: {step.unmet.toFixed(1)} unmet units
                          </span>
                        ) : (
                          <span className="text-slate-500 font-medium">Covered</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 6. Shortage Episodes & Unmet Demand Semantics */}
      <section aria-labelledby={`episodes-heading-${componentId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h3 id={`episodes-heading-${componentId}`} className="font-bold text-slate-700 uppercase tracking-wider">
            Shortage Episodes &amp; Unmet Demand Semantics
          </h3>
          <span className="text-[11px] text-slate-500 font-medium">
            Lost sales / deferred demand convention: Unmet demand is not backlogged.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div>
            <div className="text-[11px] text-slate-500 uppercase font-semibold">
              Immediate Unmet (Before Next Inbound)
            </div>
            <div className="text-lg font-bold font-mono text-red-700 mt-0.5" data-testid={`unmet-pre-inbound-${componentId}`}>
              {detail.unmet_before_next_inbound != null ? `${detail.unmet_before_next_inbound.toFixed(1)} units` : 'None (0.0)'}
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Unmet demand strictly before first replenishment arrives.
            </p>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 uppercase font-semibold">
              Total horizon unmet, assuming no further supply
            </div>
            <div className="text-lg font-bold font-mono text-slate-900 mt-0.5" data-testid={`unmet-horizon-total-${componentId}`}>
              {detail.unmet_demand_units > 0 ? `${detail.unmet_demand_units.toFixed(1)} units` : 'None (0.0)'}
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Cumulative unmet units over full 60-day horizon assuming no additional supply.
            </p>
          </div>
        </div>

        {detail.shortage_episodes && detail.shortage_episodes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs" data-testid={`episodes-table-${componentId}`}>
              <thead className="bg-slate-50 text-slate-600 font-semibold">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Episode #</th>
                  <th scope="col" className="px-3 py-2 text-left">Date Range</th>
                  <th scope="col" className="px-3 py-2 text-right">Duration</th>
                  <th scope="col" className="px-3 py-2 text-right">Unmet Units</th>
                  <th scope="col" className="px-3 py-2 text-left">Episode Conclusion Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.shortage_episodes.map((ep) => (
                  <tr key={ep.episode_index} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">Episode {ep.episode_index}</td>
                    <td className="px-3 py-2 font-mono text-slate-800">
                      {formatDate(ep.start_date)} &ndash; {formatDate(ep.end_date)}
                    </td>
                    <td className="px-3 py-2 font-mono text-right text-slate-900">{ep.days} days</td>
                    <td className="px-3 py-2 font-mono text-right font-bold text-red-700">
                      {ep.unmet_units.toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      {ep.ends_because === 'inbound_receipt' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300">
                          Inbound replenishment arrival
                        </span>
                      )}
                      {ep.ends_because === 'horizon_end' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                          Runs to 60-day horizon end
                        </span>
                      )}
                      {ep.ends_because === 'other' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-300">
                          Demand drops to 0
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 italic">No shortage episodes projected across the 60-day planning horizon.</p>
        )}
      </section>

      {/* 7. Assumptions */}
      {detail.assumptions.length > 0 && (
        <section aria-labelledby={`assumptions-heading-${componentId}`} className="p-4 bg-slate-100/70 rounded-lg border border-slate-200">
          <h3 id={`assumptions-heading-${componentId}`} className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2">
            Model Assumptions &amp; Governing Rules
          </h3>
          <ul className="space-y-1 list-disc list-inside text-[11px] text-slate-600">
            {detail.assumptions.map((assump, idx) => (
              <li key={idx}>{assump}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const VALID_RISK_LEVELS: readonly string[] = ['critical', 'high', 'medium', 'low', 'none', 'unknown'];

export function InventoryRiskPage() {
  const { meta, reload: reloadMeta } = useMeta();
  const [searchParams, setSearchParams] = useSearchParams();

  // Pagination state
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);

  // Read risk_level directly from URL search params as source of truth
  const rawRisk = searchParams.get('risk_level');
  const selectedRiskLevel: RiskLevel | '' = rawRisk && VALID_RISK_LEVELS.includes(rawRisk)
    ? (rawRisk as RiskLevel)
    : '';

  // Other filters state
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedCriticality, setSelectedCriticality] = useState<ComponentCriticality | ''>('');

  // Expanded component rows
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Fetch component categories for dropdown
  const fetchComponents = useCallback(
    (signal: AbortSignal) => listComponents({ limit: 200 }, signal),
    []
  );
  const { data: compData } = useApi(fetchComponents, [fetchComponents]);

  const categories = Array.from(
    new Set((compData?.items ?? []).map((c: Component) => c.category))
  ).sort();

  // Fetch Inventory Risk List
  const fetchRisk = useCallback(
    (signal: AbortSignal) =>
      getInventoryRisk(
        {
          risk_level: selectedRiskLevel,
          category: selectedCategory || undefined,
          criticality: selectedCriticality || undefined,
          limit,
          offset,
        },
        signal
      ),
    [selectedRiskLevel, selectedCategory, selectedCriticality, limit, offset]
  );

  const { data, loading, error, reload } = useApi(fetchRisk, [fetchRisk]);

  const handleRiskChange = (val: string) => {
    setOffset(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) {
        next.set('risk_level', val);
      } else {
        next.delete('risk_level');
      }
      return next;
    });
  };

  const handleCategoryChange = (val: string) => {
    setSelectedCategory(val);
    setOffset(0);
  };

  const handleCriticalityChange = (val: string) => {
    setSelectedCriticality(val as ComponentCriticality | '');
    setOffset(0);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setOffset(0);
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (meta?.seeded === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Inventory Risk & Shortage Projections"
          description={PAGE_SUBTITLES.inventory_risk}
        />
        <UnseededView message={meta.message} onRefresh={reloadMeta} />
      </div>
    );
  }

  const hasFilters = selectedRiskLevel !== '' || selectedCategory !== '' || selectedCriticality !== '';

  return (
    <div className="space-y-6" data-testid="inventory-risk-page">
      <PageHeader
        title="Inventory Risk & Shortage Projections"
        description={PAGE_SUBTITLES.inventory_risk}
      />

      {/* Model Heuristic Baseline Note Banner */}
      <section
        aria-label="Model Baseline Notice"
        className="bg-blue-50/80 border border-blue-200 rounded-lg p-3.5 text-xs text-blue-900 flex items-start gap-2.5 shadow-xs"
        data-testid="heuristic-banner"
      >
        <span className="font-bold text-blue-800 uppercase tracking-wide text-[10px] bg-blue-100 px-1.5 py-0.5 rounded border border-blue-300 shrink-0">
          Baseline Model
        </span>
        <p className="font-medium leading-relaxed">
          Demand estimate: weekday-average heuristic baseline (not a trained ML model). Based on the last{' '}
          {data?.config.lookback_days ?? 28} days of demand history.
        </p>
      </section>

      {/* Filter Bar */}
      <section
        aria-label="Inventory Risk Filters"
        className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="filter-risk" className="text-slate-600 font-semibold">
            Risk Level:
          </label>
          <select
            id="filter-risk"
            value={selectedRiskLevel}
            onChange={(e) => handleRiskChange(e.target.value)}
            className="border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {RISK_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="filter-category" className="text-slate-600 font-semibold">
            Category:
          </label>
          <select
            id="filter-category"
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="filter-criticality" className="text-slate-600 font-semibold">
            Criticality:
          </label>
          <select
            id="filter-criticality"
            value={selectedCriticality}
            onChange={(e) => handleCriticalityChange(e.target.value)}
            className="border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CRITICALITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('');
              setSelectedCriticality('');
              setOffset(0);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('risk_level');
                return next;
              });
            }}
            className="text-xs text-blue-600 hover:text-blue-800 underline font-semibold ml-auto"
          >
            Reset Filters
          </button>
        )}
      </section>

      {/* Table Area */}
      <section aria-labelledby="risk-table-heading" className="space-y-4">
        <h2 id="risk-table-heading" className="sr-only">Inventory Intelligence Projections</h2>

        {loading && <LoadingView message="Calculating inventory risk and shortage projections..." />}

        {error && (
          <ErrorView
            error={error}
            onRetry={reload}
            title="Failed to evaluate inventory risk"
          />
        )}

        {data && !loading && (
          <>
            {data.items.length === 0 ? (
              <EmptyView
                title="No components match criteria"
                message="No catalog items matched the selected risk level or category filters."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="risk-table">
                    <caption className="sr-only">Component inventory risk and predicted shortages</caption>
                    <thead className="bg-slate-50 text-slate-700 text-xs uppercase font-semibold">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left">Component</th>
                        <th scope="col" className="px-4 py-3 text-left">Criticality</th>
                        <th scope="col" className="px-4 py-3 text-right">
                          <span>Plant Usable</span>
                          <InfoTip term={GLOSSARY.usable_stock.term} description={GLOSSARY.usable_stock.definition} />
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">Daily Demand</th>
                        <th scope="col" className="px-4 py-3 text-right">
                          <span>Coverage Days</span>
                          <InfoTip term={GLOSSARY.runway.term} description={GLOSSARY.runway.definition} />
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">Next Replenishment</th>
                        <th scope="col" className="px-4 py-3 text-left">
                          <span>Predicted Shortage</span>
                          <InfoTip term={GLOSSARY.shortage_date.term} description={GLOSSARY.shortage_date.definition} />
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">Risk Level</th>
                        <th scope="col" className="px-4 py-3 text-left">Governing Reason</th>
                        <th scope="col" className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {data.items.map((item: InventoryRiskItem) => {
                        const isExpanded = expandedIds.has(item.component_id);

                        return (
                          <tr
                            key={item.component_id}
                            className="hover:bg-slate-50/80 transition-colors"
                            data-testid={`risk-row-${item.sku}`}
                          >
                            <th scope="row" className="px-4 py-3 text-left font-normal">
                              <span className="font-mono font-bold text-slate-900 block">{item.sku}</span>
                              <span className="text-xs text-slate-500 block">{item.name}</span>
                            </th>
                            <td className="px-4 py-3">
                              <CriticalityBadge criticality={item.criticality} />
                            </td>
                            <td className="px-4 py-3 font-mono text-right font-semibold text-slate-900">
                              {item.plant_usable_stock !== null ? formatInteger(item.plant_usable_stock) : '—'}
                            </td>
                            <td className="px-4 py-3 font-mono text-right text-slate-800">
                              {item.mean_daily_demand !== null ? item.mean_daily_demand.toFixed(1) : '—'}
                            </td>
                            <td className="px-4 py-3 font-mono text-right text-slate-800">
                              {item.coverage_days !== null ? item.coverage_days.toFixed(1) : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs" data-testid={`replenishment-${item.sku}`}>
                              {item.next_replenishment ? (
                                <div>
                                  <span className="font-mono font-semibold text-slate-900 block">
                                    {formatDate(item.next_replenishment.date)}
                                  </span>
                                  <span className="text-slate-500 text-[11px] block">
                                    {formatInteger(item.next_replenishment.qty)} units ({item.next_replenishment.date_basis})
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs" data-testid={`shortage-${item.sku}`}>
                              {item.shortage_date ? (
                                <div>
                                  <span className="font-mono font-bold text-red-700 block">
                                    {formatDate(item.shortage_date)}
                                  </span>
                                  <span className="text-red-900 font-medium text-[11px] block">
                                    in {item.days_until_shortage} {item.days_until_shortage === 1 ? 'day' : 'days'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-500 font-medium">None within horizon</span>
                              )}
                            </td>
                            <td className="px-4 py-3" data-testid={`risk-cell-${item.sku}`}>
                              <div className="flex items-center gap-1.5">
                                <RiskBadge level={item.risk_level} />
                                <span className="text-xs text-slate-600 font-medium capitalize sr-only">
                                  {item.risk_level}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                              <p className="line-clamp-2" title={item.risk_reason}>
                                {item.risk_reason}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => toggleExpand(item.component_id)}
                                aria-expanded={isExpanded}
                                aria-controls={`risk-detail-${item.component_id}`}
                                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                data-testid={`toggle-expand-${item.sku}`}
                              >
                                {isExpanded ? 'Hide Details' : 'View Details'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Render expanded detail panels below the table */}
                {data.items
                  .filter((item) => expandedIds.has(item.component_id))
                  .map((item) => (
                    <ComponentRiskDetailPanel key={item.component_id} componentId={item.component_id} />
                  ))}

                {/* Pagination */}
                <Pagination
                  total={data.total}
                  limit={limit}
                  offset={offset}
                  onLimitChange={handleLimitChange}
                  onOffsetChange={(newOffset: number) => setOffset(newOffset)}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
