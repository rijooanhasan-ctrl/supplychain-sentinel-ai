import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { getExecutiveSummary } from '../api/endpoints';
import type { ExecutiveSummaryResponse } from '../api/types';
import { useApi } from '../api/useApi';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Badge } from '../components/Badge';
import { WhyThis } from '../components/WhyThis';
import { formatInteger, formatNumber, formatUsd } from '../lib/format';

export function ExecutiveSummaryPage() {
  const [dqExpanded, setDqExpanded] = useState(false);

  const fetchSummary = useCallback(
    (signal?: AbortSignal) => getExecutiveSummary(signal),
    []
  );

  const { data, loading, error, reload } = useApi<ExecutiveSummaryResponse>(fetchSummary);

  if (loading) {
    return <LoadingView message="Loading executive briefing..." />;
  }

  if (error) {
    return <ErrorView error={error} onRetry={reload} />;
  }

  if (!data || !data.seeded) {
    return <UnseededView />;
  }

  if (data.top_risks.length === 0) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
        <PageHeader
          title="Executive Summary"
          description="Real-time strategic decision support briefing"
        />
        <EmptyView message="No components currently at risk" />
        <div className="p-4 bg-slate-100 rounded-lg text-xs text-slate-600 text-center border border-slate-200">
          Decision support only. No orders are created.
        </div>
      </div>
    );
  }

  const pd = data.priority_decision;
  const cc = data.cost_comparison;
  const dq = data.data_quality;

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
      {/* Page Header */}
      <PageHeader
        title="Executive Summary"
        description="Operational risk overview, cost of action vs inaction, and data quality lineage"
      />

      {/* 1. Headline Sentence + DEMO DATA label */}
      <section
        className="p-4 md:p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-2"
        data-testid="executive-headline-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase bg-amber-100 text-amber-900 border border-amber-300"
              data-testid="data-source-badge"
            >
              {data.label || 'DEMO DATA'}
            </span>
            {data.as_of && (
              <span className="text-xs text-slate-500 font-mono">
                As of: {data.as_of}
              </span>
            )}
          </div>
          <span className="text-xs font-semibold text-slate-500">
            Decision support only. No orders are created.
          </span>
        </div>
        <h2
          className="text-base md:text-lg font-bold text-slate-900 leading-snug"
          data-testid="executive-headline-text"
        >
          {data.headline}
        </h2>
      </section>

      {/* 2. Top Risks (Up to 3 cards) */}
      <section className="space-y-3" data-testid="top-risks-section">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Top Priority Risks (Up to 3)
          </h3>
          <Link
            to="/alerts"
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
          >
            <span>All Alerts</span>
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.top_risks.map((risk) => {
            const severityVariant =
              risk.severity === 'critical'
                ? 'danger'
                : risk.severity === 'high'
                  ? 'warning'
                  : 'neutral';

            return (
              <article
                key={risk.component_id}
                className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col justify-between space-y-3"
                data-testid={`risk-card-${risk.component_sku}`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-base text-slate-900 tracking-tight">
                      {risk.component_sku}
                    </span>
                    <Badge variant={severityVariant} testId={`severity-badge-${risk.component_sku}`}>
                      {risk.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 truncate" title={risk.component_name}>
                    {risk.component_name}
                  </p>

                  <div className="pt-2 border-t border-slate-100 text-xs space-y-1 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-sans">Shortage Date:</span>
                      <span className="font-semibold text-slate-800">
                        {risk.shortage_date || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-sans">Days Away:</span>
                      <span className="font-semibold text-slate-800">
                        {risk.days_until_impact !== null ? `${risk.days_until_impact} days` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-sans">Units Short:</span>
                      <span className="font-semibold text-red-700">
                        {formatNumber(risk.units_short_before_next_inbound, 1)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-sans">First Window:</span>
                      <span className="font-semibold text-slate-700">
                        {risk.first_shortage_window_days} days
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 pt-1 font-sans">
                    {risk.reason}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <WhyThis
                    items={risk.why}
                    dataTestId={`why-this-risk-${risk.component_sku}`}
                  />
                  <div className="flex items-center gap-3 text-xs font-semibold">
                    <Link
                      to="/alerts"
                      className="text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      Alerts
                    </Link>
                    <Link
                      to={`/simulator?component_id=${risk.component_id}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-0.5"
                    >
                      <span>Simulate</span>
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 3. Recommended Action Card */}
      {pd && (
        <section
          className="p-5 bg-white border border-blue-200 rounded-xl shadow-xs space-y-4"
          data-testid="recommended-action-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className="px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-blue-600 text-white shadow-xs"
                data-testid="recommended-badge"
              >
                Recommended
              </span>
              <h3 className="font-bold text-base text-slate-900">
                Priority Recovery Action: {pd.component_sku}
              </h3>
            </div>
            <WhyThis items={pd.why} dataTestId="why-this-decision" />
          </div>

          <p className="text-xs font-semibold text-blue-900 bg-blue-50/70 p-2.5 rounded border border-blue-100">
            {pd.scope_note}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                Action
              </span>
              <span className="font-semibold text-slate-900">{pd.recommended_option_kind}</span>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                Quantity
              </span>
              <span className="font-mono font-bold text-slate-900">
                {formatInteger(pd.quantity)} units
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                Expected Arrival
              </span>
              <span className="font-mono font-semibold text-slate-800">
                {pd.arrival_date || '—'}
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                Incremental Cost
              </span>
              <span
                className="font-mono font-bold text-slate-900"
                data-testid="decision-cost"
              >
                {!pd.cost_known || pd.incremental_cost === null
                  ? 'Unknown'
                  : formatUsd(pd.incremental_cost)}
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                Residual Short
              </span>
              <span className="font-mono font-bold text-emerald-700">
                {formatNumber(pd.residual_unmet_before_next_inbound, 1)} units
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-700 font-sans">{pd.recommended_option_description}</p>

          {pd.later_shortage_note && (
            <div
              className="text-xs text-amber-900 bg-amber-50 p-2.5 rounded border border-amber-200"
              data-testid="later-shortage-note"
            >
              <span className="font-bold">Later shortage note: </span>
              {pd.later_shortage_note}
            </div>
          )}
        </section>
      )}

      {/* 4. Cost of Acting vs Doing Nothing */}
      {cc && (
        <section
          className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4"
          data-testid="cost-comparison-section"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Cost of Acting vs. Doing Nothing
            </h3>
            <span className="text-xs text-slate-500 italic">
              Comparative decision tradeoff
            </span>
          </div>

          {/* Side-by-side Table */}
          <div className="overflow-x-auto">
            <table
              className="w-full text-left text-xs divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden"
              data-testid="cost-comparison-table"
            >
              <thead className="bg-slate-100/80 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">Metric / Dimension</th>
                  <th className="py-2.5 px-4 text-right bg-blue-50/50 text-blue-900">Act (Execute Recovery)</th>
                  <th className="py-2.5 px-4 text-right bg-slate-50 text-slate-900">Do Nothing (Accept Delay)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                <tr className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-sans font-medium text-slate-700">
                    Intervention Cost
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 bg-blue-50/20">
                    {!cc.act.cost_known || cc.act.cost === null
                      ? 'Unknown'
                      : formatUsd(cc.act.cost)}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-400 bg-slate-50/40 font-sans">
                    —
                  </td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-sans font-medium text-slate-700">
                    Units Short Before Next Inbound
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-emerald-700 bg-blue-50/20">
                    {formatNumber(cc.act.residual_units_short, 1)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-red-700 bg-slate-50/40">
                    {formatNumber(cc.do_nothing.units_short, 1)}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-sans font-medium text-slate-700">
                    Affected Customer Orders
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 bg-blue-50/20">
                    {formatInteger(cc.act.affected_orders_count)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 bg-slate-50/40">
                    {formatInteger(cc.do_nothing.affected_orders_count)}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-sans font-medium text-slate-700">
                    Selling Value of Affected Orders
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 bg-blue-50/20">
                    {cc.act.selling_value !== null ? formatUsd(cc.act.selling_value) : '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 bg-slate-50/40">
                    {cc.do_nothing.selling_value !== null ? formatUsd(cc.do_nothing.selling_value) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Generated Difference Sentence */}
          <div
            className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 space-y-2 leading-relaxed"
            data-testid="difference-sentence-box"
          >
            <p className="font-medium">{cc.difference_sentence}</p>
          </div>

          {/* Mandatory Upper Bound Wording */}
          <p
            className="text-[11px] text-slate-500 italic leading-normal"
            data-testid="upper-bound-disclaimer"
          >
            {cc.exposure_disclaimer}
          </p>
        </section>
      )}

      {/* 5. Data Quality Lineage Section */}
      {dq && (
        <section
          className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-3"
          data-testid="data-quality-section"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                Data Quality & Integrity Lineage
              </h3>
              <p className="text-xs text-slate-600" data-testid="data-quality-note">
                {dq.data_quality_note}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDqExpanded((open) => !open)}
              aria-expanded={dqExpanded}
              aria-controls="data-quality-expansion-panel"
              data-testid="toggle-data-quality-btn"
              className="text-xs font-semibold px-3 py-1 rounded border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {dqExpanded ? 'Hide Details ▲' : 'Expand Details ▼'}
            </button>
          </div>

          {dqExpanded && (
            <div
              id="data-quality-expansion-panel"
              className="pt-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs"
              data-testid="data-quality-expansion-panel"
            >
              <div className="space-y-2">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] block">
                  Evaluation Audit
                </span>
                <ul className="space-y-1 font-mono text-slate-700">
                  <li>
                    <span className="font-sans font-medium text-slate-500">Components Evaluated:</span>{' '}
                    <span className="font-bold">{dq.components_evaluated}</span>
                  </li>
                  <li>
                    <span className="font-sans font-medium text-slate-500">Unknown Risk / Short History:</span>{' '}
                    <span className="font-bold">{dq.components_unknown_risk}</span>
                  </li>
                  <li>
                    <span className="font-sans font-medium text-slate-500">Demand History Lookback:</span>{' '}
                    <span className="font-bold">
                      {dq.priority_component_demand_history_days !== null
                        ? `${dq.priority_component_demand_history_days} days`
                        : '—'}
                    </span>
                  </li>
                  <li>
                    <span className="font-sans font-medium text-slate-500">Live SAP Connection:</span>{' '}
                    <span className="font-bold">{dq.is_live ? 'Yes' : 'No (Synthetic Sample)'}</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] block">
                  Supplier Confidence Breakdown
                </span>
                <div className="flex gap-2">
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-xs">
                    High: {dq.supplier_confidence_counts.high || 0}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono text-xs">
                    Medium: {dq.supplier_confidence_counts.medium || 0}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200 font-mono text-xs">
                    Low: {dq.supplier_confidence_counts.low || 0}
                  </span>
                </div>

                {dq.top_risk_supplier_confidence.length > 0 && (
                  <div className="pt-2">
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                      Suppliers in Active Disruptions:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                      {dq.top_risk_supplier_confidence.map((s) => (
                        <li key={s.supplier_id}>
                          <span className="font-semibold">{s.supplier_code}</span> ({s.supplier_name}):{' '}
                          <span className="capitalize">{s.confidence}</span> confidence ({s.n_deliveries} deliveries)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 6. Assumptions and Permanent Note */}
      <section className="p-4 bg-slate-100 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-2">
        <span className="font-bold uppercase tracking-wider text-slate-700 block">
          Key Planning Assumptions & Limitations
        </span>
        <ul className="list-disc list-inside space-y-1 pl-1">
          {data.assumptions.map((asm, i) => (
            <li key={i}>{asm}</li>
          ))}
        </ul>
        <div className="pt-2 border-t border-slate-200 text-center font-semibold text-slate-700">
          Decision support only. No orders are created.
        </div>
      </section>
    </div>
  );
}
