import React, { useState, useCallback, useId } from 'react';
import { useApi } from '../api/useApi';
import { getSupplierRisk, getSupplierRiskDetail } from '../api/endpoints';
import type {
  SupplierRiskBand,
  SupplierRiskItem,
  SupplierRiskDetailResponse,
} from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { formatInteger } from '../lib/format';

const BAND_OPTIONS: { value: SupplierRiskBand | ''; label: string }[] = [
  { value: '', label: 'All Bands' },
  { value: 'high', label: 'High Risk' },
  { value: 'medium', label: 'Medium Risk' },
  { value: 'low', label: 'Low Risk' },
  { value: 'unknown', label: 'Unknown' },
];

function SupplierRiskBandBadge({ band }: { band: SupplierRiskBand }) {
  const styles: Record<SupplierRiskBand, string> = {
    high: 'bg-red-100 text-red-900 border-red-300',
    medium: 'bg-amber-100 text-amber-900 border-amber-300',
    low: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    unknown: 'bg-slate-100 text-slate-800 border-slate-300',
  };

  const labels: Record<SupplierRiskBand, string> = {
    high: 'High Risk',
    medium: 'Medium Risk',
    low: 'Low Risk',
    unknown: 'Unknown',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${styles[band] || styles.unknown}`}
      data-testid={`supplier-band-${band}`}
    >
      {labels[band] || band}
    </span>
  );
}

function SupplierConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    high: 'bg-blue-100 text-blue-900 border-blue-300',
    medium: 'bg-slate-100 text-slate-800 border-slate-300',
    low: 'bg-amber-100 text-amber-900 border-amber-300',
    none: 'bg-zinc-100 text-zinc-700 border-zinc-300',
  };

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${styles[confidence] || styles.medium}`}
      data-testid={`supplier-confidence-${confidence}`}
    >
      {confidence.toUpperCase()} CONFIDENCE
    </span>
  );
}

interface DetailPanelProps {
  supplierId: number;
}

function SupplierRiskDetailPanel({ supplierId }: DetailPanelProps) {
  const fetchDetail = useCallback(
    (signal?: AbortSignal) => getSupplierRiskDetail(supplierId, signal),
    [supplierId]
  );
  const { data: detail, loading, error, reload } = useApi<SupplierRiskDetailResponse>(
    fetchDetail,
    [fetchDetail]
  );

  if (loading) {
    return (
      <div className="p-4 bg-slate-50 border-t border-slate-200">
        <LoadingView message="Loading detailed risk breakdown..." />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 bg-slate-50 border-t border-slate-200">
        <ErrorView
          error={error || new Error('Failed to load supplier risk detail')}
          onRetry={reload}
          title="Could not load supplier details"
        />
      </div>
    );
  }

  return (
    <div
      id={`supplier-detail-${supplierId}`}
      data-testid={`supplier-detail-panel-${supplierId}`}
      className="p-5 bg-slate-50 border-t border-slate-200 space-y-6 text-xs text-slate-800"
    >
      {/* 1. Factual Explanation */}
      <section aria-labelledby={`exp-heading-${supplierId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
        <h3 id={`exp-heading-${supplierId}`} className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
          Assessment Explanation
        </h3>
        <p className="text-sm font-medium text-slate-900 leading-relaxed" data-testid={`supplier-explanation-${supplierId}`}>
          {detail.explanation}
        </p>
      </section>

      {/* 2. Transparent Metric Contribution Points */}
      <section aria-labelledby={`metrics-heading-${supplierId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h3 id={`metrics-heading-${supplierId}`} className="font-bold text-slate-700 uppercase tracking-wider">
            Risk Score Formula &amp; Metric Penalty Breakdown
          </h3>
          <span className="text-[11px] text-slate-500">
            Total Score = Sum of Contribution Points (Effective Weight &times; Penalty &times; 100)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs" data-testid={`breakdown-table-${supplierId}`}>
            <thead className="bg-slate-50 text-slate-600 font-semibold">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Metric Name</th>
                <th scope="col" className="px-3 py-2 text-right">Historical Value</th>
                <th scope="col" className="px-3 py-2 text-right">Penalty [0..1]</th>
                <th scope="col" className="px-3 py-2 text-right">Nominal Weight</th>
                <th scope="col" className="px-3 py-2 text-right">Effective Weight</th>
                <th scope="col" className="px-3 py-2 text-right">Contribution Points</th>
                <th scope="col" className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.metrics_breakdown.map((m) => {
                let formattedValue = '—';
                if (m.raw_value != null) {
                  if (m.metric_name === 'on_time') formattedValue = `${(m.raw_value * 100).toFixed(1)}%`;
                  else if (m.metric_name === 'delay') formattedValue = `${m.raw_value.toFixed(1)} days`;
                  else if (m.metric_name === 'rejection') formattedValue = `${(m.raw_value * 100).toFixed(2)}%`;
                  else if (m.metric_name === 'fill') formattedValue = `${(m.raw_value * 100).toFixed(1)}%`;
                }

                return (
                  <tr key={m.metric_name} className={m.dropped ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50/80'}>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900 uppercase">{m.metric_name}</td>
                    <td className="px-3 py-2 font-mono text-right text-slate-800">{formattedValue}</td>
                    <td className="px-3 py-2 font-mono text-right text-slate-800">
                      {m.penalty != null ? m.penalty.toFixed(3) : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-right text-slate-600">{(m.nominal_weight * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 font-mono text-right font-medium text-slate-900">
                      {(m.effective_weight * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 font-mono text-right font-bold text-slate-900">
                      {m.dropped ? '0.0' : m.contribution_points.toFixed(1)} pts
                    </td>
                    <td className="px-3 py-2">
                      {m.dropped ? (
                        <span className="text-amber-800 font-medium">Dropped ({m.dropped_reason || 'Undefined'})</span>
                      ) : (
                        <span className="text-emerald-800 font-medium">Active in calculation</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Monthly Performance Breakdown */}
      <section aria-labelledby={`monthly-heading-${supplierId}`} className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-3">
        <h3 id={`monthly-heading-${supplierId}`} className="font-bold text-slate-700 uppercase tracking-wider">
          Historical Monthly Trend (Last 12 Months)
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs" data-testid={`monthly-table-${supplierId}`}>
            <thead className="bg-slate-50 text-slate-600 font-semibold">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Month</th>
                <th scope="col" className="px-3 py-2 text-right">Deliveries Count</th>
                <th scope="col" className="px-3 py-2 text-right">On-Time Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.monthly_breakdown.map((mo) => (
                <tr key={mo.month} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-mono font-semibold text-slate-900">{mo.month}</td>
                  <td className="px-3 py-2 font-mono text-right text-slate-800">{mo.n_deliveries}</td>
                  <td className="px-3 py-2 font-mono text-right font-bold text-slate-900">
                    {mo.on_time_rate != null ? `${(mo.on_time_rate * 100).toFixed(1)}%` : '— (No deliveries)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Assumptions */}
      {detail.assumptions.length > 0 && (
        <section aria-labelledby={`assumptions-heading-${supplierId}`} className="p-4 bg-slate-100/70 rounded-lg border border-slate-200">
          <h3 id={`assumptions-heading-${supplierId}`} className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2">
            Assessment Conventions &amp; Modeling Assumptions
          </h3>
          <ul className="space-y-1 list-disc list-inside text-[11px] text-slate-600">
            {detail.assumptions.map((a, idx) => (
              <li key={idx}>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function SupplierRiskPage() {
  const [selectedBand, setSelectedBand] = useState<SupplierRiskBand | ''>('');
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [offset, setOffset] = useState<number>(0);
  const limit = 50;

  const bandFilterId = useId();
  const countryFilterId = useId();

  const fetchSuppliers = useCallback(
    (signal?: AbortSignal) =>
      getSupplierRisk(
        {
          band: selectedBand,
          country: selectedCountry || undefined,
          limit,
          offset,
        },
        signal
      ),
    [selectedBand, selectedCountry, limit, offset]
  );

  const { data, loading, error, reload } = useApi(fetchSuppliers, [fetchSuppliers]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBandChange = (val: SupplierRiskBand | '') => {
    setSelectedBand(val);
    setOffset(0);
  };

  const handleCountryChange = (val: string) => {
    setSelectedCountry(val);
    setOffset(0);
  };

  if (data && !data.seeded) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Supplier Risk Scoring"
          description="Empirical reliability scoring based on historical delivery records and order fulfillment."
        />
        <UnseededView />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Risk Scoring"
        description="Empirical reliability scoring based on historical delivery records and order fulfillment."
      />

      {/* Transparent formula notice banner */}
      <div
        className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-950 font-medium leading-relaxed"
        data-testid="supplier-risk-banner"
      >
        <span className="font-bold uppercase tracking-wider block mb-0.5 text-blue-900">
          Descriptive Historical Scoring Framework
        </span>
        Score = transparent weighted formula (weights shown below). It summarizes historical delivery performance and does not predict individual deliveries.
      </div>

      {/* Summary KPI Strip */}
      {data?.summary && (
        <section aria-labelledby="summary-kpis-heading" className="space-y-2">
          <h2 id="summary-kpis-heading" className="sr-only">Supplier Risk Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-3.5 rounded-lg border border-red-200 bg-red-50/20 shadow-xs">
              <span className="text-[11px] font-bold text-red-900 uppercase tracking-wider block">High Risk (&ge; 50)</span>
              <span className="text-2xl font-bold text-red-700 mt-1 block" data-testid="count-high-band">
                {formatInteger(data.summary.counts_by_band.high || 0)}
              </span>
            </div>
            <div className="bg-white p-3.5 rounded-lg border border-amber-200 bg-amber-50/20 shadow-xs">
              <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">Medium Risk (25..49.9)</span>
              <span className="text-2xl font-bold text-amber-800 mt-1 block" data-testid="count-medium-band">
                {formatInteger(data.summary.counts_by_band.medium || 0)}
              </span>
            </div>
            <div className="bg-white p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/20 shadow-xs">
              <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider block">Low Risk (&lt; 25)</span>
              <span className="text-2xl font-bold text-emerald-700 mt-1 block" data-testid="count-low-band">
                {formatInteger(data.summary.counts_by_band.low || 0)}
              </span>
            </div>
            <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">Unknown (0 Deliveries)</span>
              <span className="text-2xl font-bold text-slate-700 mt-1 block" data-testid="count-unknown-band">
                {formatInteger(data.summary.counts_by_band.unknown || 0)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Filter Toolbar */}
      <section aria-labelledby="supplier-filters-heading" className="flex flex-wrap items-center gap-3 bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs text-xs">
        <h2 id="supplier-filters-heading" className="sr-only">Filter Suppliers</h2>

        <div className="flex items-center gap-2">
          <label htmlFor={bandFilterId} className="font-semibold text-slate-700">
            Risk Band:
          </label>
          <select
            id={bandFilterId}
            value={selectedBand}
            onChange={(e) => handleBandChange(e.target.value as SupplierRiskBand | '')}
            className="border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="filter-band"
          >
            {BAND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor={countryFilterId} className="font-semibold text-slate-700">
            Country:
          </label>
          <input
            id={countryFilterId}
            type="text"
            placeholder="e.g. DE, US, TW"
            value={selectedCountry}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900 w-28 uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="filter-country"
          />
        </div>

        {(selectedBand || selectedCountry) && (
          <button
            type="button"
            onClick={() => {
              setSelectedBand('');
              setSelectedCountry('');
              setOffset(0);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 underline font-semibold ml-auto"
          >
            Reset Filters
          </button>
        )}
      </section>

      {/* Main Table Area */}
      <section aria-labelledby="supplier-table-heading" className="space-y-4">
        <h2 id="supplier-table-heading" className="sr-only">Supplier Risk Scoring Results</h2>

        {loading && <LoadingView message="Calculating supplier risk metrics and Wilson intervals..." />}

        {error && (
          <ErrorView
            error={error}
            onRetry={reload}
            title="Failed to evaluate supplier risk"
          />
        )}

        {data && !loading && (
          <>
            {data.items.length === 0 ? (
              <EmptyView
                title="No suppliers match criteria"
                message="No suppliers matched the selected risk band or country filter."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="supplier-risk-table">
                    <caption className="sr-only">Suppliers scored by delivery performance</caption>
                    <thead className="bg-slate-50 text-slate-700 text-xs uppercase font-semibold">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left">Supplier</th>
                        <th scope="col" className="px-4 py-3 text-left">Country</th>
                        <th scope="col" className="px-4 py-3 text-right">Risk Score</th>
                        <th scope="col" className="px-4 py-3 text-left">Risk Band</th>
                        <th scope="col" className="px-4 py-3 text-left">Confidence</th>
                        <th scope="col" className="px-4 py-3 text-left">On-Time Rate (95% CI)</th>
                        <th scope="col" className="px-4 py-3 text-right">Avg Delay (Late)</th>
                        <th scope="col" className="px-4 py-3 text-right">Rejection Rate</th>
                        <th scope="col" className="px-4 py-3 text-left">Open Pipeline</th>
                        <th scope="col" className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {data.items.map((item: SupplierRiskItem) => {
                        const isExpanded = expandedIds.has(item.supplier_id);

                        return (
                          <React.Fragment key={item.supplier_id}>
                            <tr
                              className="hover:bg-slate-50/80 transition-colors"
                              data-testid={`supplier-row-${item.supplier_code}`}
                            >
                              <th scope="row" className="px-4 py-3 text-left font-normal">
                                <span className="font-mono font-bold text-slate-900 block">{item.supplier_code}</span>
                                <span className="text-xs text-slate-500 block">{item.supplier_name}</span>
                              </th>
                              <td className="px-4 py-3 font-mono text-slate-700 font-semibold">{item.country}</td>
                              <td className="px-4 py-3 font-mono text-right font-bold text-slate-900">
                                {item.risk_score != null ? item.risk_score.toFixed(1) : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <SupplierRiskBandBadge band={item.risk_band} />
                              </td>
                              <td className="px-4 py-3">
                                <SupplierConfidenceBadge confidence={item.confidence} />
                              </td>
                              <td className="px-4 py-3 text-xs">
                                {item.on_time_rate != null ? (
                                  <div>
                                    <span className="font-mono font-semibold text-slate-900">
                                      {(item.on_time_rate * 100).toFixed(1)}%
                                    </span>
                                    {item.on_time_ci_lower != null && item.on_time_ci_upper != null && (
                                      <span className="text-[11px] text-slate-500 block font-mono">
                                        [{(item.on_time_ci_lower * 100).toFixed(1)}%, {(item.on_time_ci_upper * 100).toFixed(1)}%]
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 italic">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 font-mono text-right text-slate-800">
                                {item.avg_delay_days_when_late != null
                                  ? `${item.avg_delay_days_when_late.toFixed(1)} d`
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 font-mono text-right text-slate-800">
                                {item.rejection_rate != null ? `${(item.rejection_rate * 100).toFixed(2)}%` : '—'}
                              </td>
                              <td className="px-4 py-3 text-xs">
                                {item.open_po_count > 0 ? (
                                  <div>
                                    <span className="font-semibold text-slate-900">
                                      {item.open_po_count} PO ({formatInteger(item.open_remaining_qty)} units)
                                    </span>
                                    {(item.open_pos_slipped_count > 0 || item.open_pos_overdue_count > 0) && (
                                      <span className="text-[11px] text-amber-800 block">
                                        {item.open_pos_slipped_count} slipped, {item.open_pos_overdue_count} overdue
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 italic">None</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(item.supplier_id)}
                                  aria-expanded={isExpanded}
                                  aria-controls={`supplier-detail-${item.supplier_id}`}
                                  className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                                  data-testid={`toggle-supplier-${item.supplier_code}`}
                                >
                                  {isExpanded ? 'Hide Details' : 'View Formula'}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={10} className="p-0">
                                  <SupplierRiskDetailPanel supplierId={item.supplier_id} />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  offset={offset}
                  limit={limit}
                  total={data.total}
                  onOffsetChange={setOffset}
                  onLimitChange={() => {}}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
