import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getExecutiveSummary } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { formatInteger, formatMoney } from '../lib/format';

export function ReportPage() {
  const { meta } = useMeta();
  const fetcher = useCallback((signal: AbortSignal) => getExecutiveSummary(signal), []);
  const { data, loading, error, reload } = useApi(fetcher, [fetcher]);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500" data-testid="report-loading">
        <p className="text-sm">Generating executive printable report...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4" data-testid="report-error">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-800">
          <p className="font-semibold text-sm">Failed to generate report</p>
          <p className="text-xs mt-1">{error ? error.message : 'No report data'}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const pd = data.priority_decision;
  const cc = data.cost_comparison;
  const dq = data.data_quality;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-6 text-slate-900 bg-white print:p-0 print:max-w-none print:bg-white print:text-black">
      {/* Action Bar (Hidden when printing) */}
      <div className="print:hidden flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <Link
          to="/executive-summary"
          className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          &larr; Back to Executive Summary
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="print-report-button"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print / Save as PDF
        </button>
      </div>

      {/* Report Header */}
      <header className="border-b-2 border-slate-900 pb-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950">
            SupplyChain Sentinel AI — Executive Decision Support Report
          </h1>
          <span
            className="px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 print:border print:border-black"
            data-testid="report-dataset-label"
          >
            {data.label || 'DEMO DATA'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 print:text-black font-mono gap-2">
          <span>Snapshot As-Of Date: {data.as_of || '—'}</span>
          <span className="font-semibold text-slate-700 print:text-black">
            Decision support only. No orders are created.
          </span>
        </div>
      </header>

      {/* Currency Notice */}
      <div className="text-xs text-slate-500 print:text-black italic border-l-2 border-slate-300 pl-3">
        Currency: Display currency is {meta?.display_currency || 'USD'} (stored baseline in USD; converted at configured exchange rate).
      </div>

      {/* 1. Executive Headline */}
      <section className="space-y-1.5 print:break-inside-avoid">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 print:text-black">
          Executive Headline
        </h2>
        <p className="text-base font-semibold text-slate-900 print:text-black leading-snug" data-testid="report-headline">
          {data.headline}
        </p>
      </section>

      {/* 2. Top Supply Chain Risks */}
      <section className="space-y-3 print:break-inside-avoid">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 print:text-black">
          Top Supply Chain Risks
        </h2>
        {data.top_risks.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No components currently at risk.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-slate-200 divide-y divide-slate-200">
              <thead className="bg-slate-50 text-slate-700 print:bg-slate-100 print:text-black">
                <tr>
                  <th scope="col" className="p-2 font-semibold">Component</th>
                  <th scope="col" className="p-2 font-semibold">Shortage Reason</th>
                  <th scope="col" className="p-2 font-semibold">Shortage Date</th>
                  <th scope="col" className="p-2 font-semibold text-right">Runway</th>
                  <th scope="col" className="p-2 font-semibold text-right">Units Short</th>
                  <th scope="col" className="p-2 font-semibold text-right">Revenue at Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.top_risks.map((risk) => (
                  <tr key={risk.component_id} className="hover:bg-slate-50">
                    <td className="p-2 font-medium">
                      <span className="font-mono">{risk.component_sku}</span>
                      <div className="text-[11px] text-slate-500 print:text-black">{risk.component_name}</div>
                    </td>
                    <td className="p-2">{risk.reason}</td>
                    <td className="p-2 font-mono">{risk.shortage_date || '—'}</td>
                    <td className="p-2 text-right">{risk.days_until_impact !== null ? `${risk.days_until_impact} d` : '—'}</td>
                    <td className="p-2 text-right font-mono font-medium">{formatInteger(risk.units_short_before_next_inbound)}</td>
                    <td className="p-2 text-right font-mono font-semibold">
                      {risk.exposed_selling_value !== null ? formatMoney(risk.exposed_selling_value, meta) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. Recommended Action */}
      <section className="space-y-2 border border-slate-200 rounded p-4 bg-slate-50/50 print:bg-white print:border-slate-300 print:break-inside-avoid">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 print:text-black">
          Recommended Priority Mitigation
        </h2>
        {pd ? (
          <div className="space-y-1.5 text-xs text-slate-800 print:text-black">
            <div className="font-medium text-sm text-slate-950">
              {pd.component_sku} — {pd.component_name}
            </div>
            <div>
              <span className="font-semibold">Action: </span>
              {pd.recommended_option_description}
            </div>
            <div>
              <span className="font-semibold">Estimated Recovery Cost: </span>
              <span className="font-mono font-bold">
                {pd.incremental_cost !== null ? formatMoney(pd.incremental_cost, meta) : 'Unknown / not configured'}
              </span>
            </div>
            <div className="text-[11px] text-slate-600 print:text-black italic">
              Scope: {pd.scope_note}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">No priority recommendation required.</p>
        )}
      </section>

      {/* 4. Act vs Do Nothing Comparison Table */}
      {cc && (
        <section className="space-y-3 print:break-inside-avoid">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 print:text-black">
            Action vs Inaction Impact Comparison
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-slate-200 divide-y divide-slate-200" data-testid="report-comparison-table">
              <thead className="bg-slate-50 text-slate-700 print:bg-slate-100 print:text-black">
                <tr>
                  <th scope="col" className="p-2 font-semibold">Scenario</th>
                  <th scope="col" className="p-2 font-semibold text-right">Recovery Cost</th>
                  <th scope="col" className="p-2 font-semibold text-right">Residual Shortage Units</th>
                  <th scope="col" className="p-2 font-semibold text-right">Exposed Customer Orders</th>
                  <th scope="col" className="p-2 font-semibold text-right">Upper-Bound Revenue Exposure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <th scope="row" className="p-2 font-semibold text-emerald-900 print:text-black">
                    Act (Mitigation Plan)
                  </th>
                  <td className="p-2 text-right font-mono font-bold">
                    {cc.act.cost !== null ? formatMoney(cc.act.cost, meta) : '—'}
                  </td>
                  <td className="p-2 text-right font-mono">{formatInteger(cc.act.residual_units_short)}</td>
                  <td className="p-2 text-right font-mono">{formatInteger(cc.act.affected_orders_count)}</td>
                  <td className="p-2 text-right font-mono font-semibold">
                    {cc.act.selling_value !== null ? formatMoney(cc.act.selling_value, meta) : '—'}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="p-2 font-semibold text-red-900 print:text-black">
                    Do Nothing (Inaction)
                  </th>
                  <td className="p-2 text-right font-mono text-slate-500">—</td>
                  <td className="p-2 text-right font-mono">{formatInteger(cc.do_nothing.units_short)}</td>
                  <td className="p-2 text-right font-mono">{formatInteger(cc.do_nothing.affected_orders_count)}</td>
                  <td className="p-2 text-right font-mono font-semibold text-red-700 print:text-black">
                    {cc.do_nothing.selling_value !== null ? formatMoney(cc.do_nothing.selling_value, meta) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="space-y-1 text-[11px] text-slate-600 print:text-black">
            <p className="font-medium">{cc.difference_sentence}</p>
            <p className="italic text-slate-500 print:text-black">
              {cc.exposure_disclaimer}
            </p>
          </div>
        </section>
      )}

      {/* 5. Data Quality Lineage Note */}
      {dq && (
        <section className="space-y-1.5 print:break-inside-avoid border-t border-slate-200 pt-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 print:text-black">
            Data Quality &amp; Assessment Lineage
          </h2>
          <p className="text-xs text-slate-700 print:text-black">
            {dq.data_quality_note}
          </p>
          <div className="text-[11px] text-slate-500 print:text-black font-mono">
            Components evaluated: {dq.components_evaluated} (Unknown risk: {dq.components_unknown_risk}) &bull; Active Source: {dq.dataset_source}
          </div>
        </section>
      )}

      {/* 6. Model Assumptions */}
      {data.assumptions && data.assumptions.length > 0 && (
        <section className="space-y-1.5 print:break-inside-avoid border-t border-slate-200 pt-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 print:text-black">
            Operational Assumptions
          </h2>
          <ul className="list-disc list-inside text-xs text-slate-600 print:text-black space-y-0.5">
            {data.assumptions.map((assump, idx) => (
              <li key={idx}>{assump}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-300 pt-4 text-center text-[10px] text-slate-400 print:text-black">
        Generated by SupplyChain Sentinel AI &bull; Autonomous Decision Support Platform &bull; Never places live orders
      </footer>
    </div>
  );
}

export default ReportPage;
