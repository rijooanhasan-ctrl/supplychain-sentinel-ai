import { Fragment, useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getRecommendations } from '../api/endpoints';
import type {
  ComponentRecoveryRecommendation,
  RecoveryOption,
} from '../api/types';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Badge } from '../components/Badge';
import { WhyThis } from '../components/WhyThis';
import { CurrencyNotice } from '../components/CurrencyNotice';
import { formatInteger, formatNumber, formatMoney } from '../lib/format';
import { PAGE_SUBTITLES } from '../constants/pageSubtitles';

function OptionKindBadge({ kind }: { kind: string }) {
  switch (kind) {
    case 'expedite_existing':
      return <Badge variant="warning">Expedite PO</Badge>;
    case 'alternative_supplier':
      return <Badge variant="info">Alt Supplier</Badge>;
    case 'transfer':
      return <Badge variant="success">Transfer</Badge>;
    case 'accept_delay':
      return <Badge variant="neutral">Accept Delay</Badge>;
    default:
      return <Badge variant="default">{kind}</Badge>;
  }
}

function OptionDetailExpansion({
  option,
  optionIndex,
}: {
  option: RecoveryOption;
  optionIndex: number;
}) {
  const { meta } = useMeta();
  return (
    <div
      id={`option-expansion-${option.id}-${optionIndex}`}
      className="p-4 bg-slate-50 border-t border-slate-200 text-xs space-y-3"
      data-testid={`option-expansion-${option.id}`}
    >
      {/* Constraints Applied */}
      {option.constraints_applied.length > 0 && (
        <div>
          <span className="font-semibold text-slate-800 uppercase tracking-wider text-[11px] block mb-1">
            Constraints Applied:
          </span>
          <ul className="list-disc list-inside space-y-0.5 text-slate-700 pl-1">
            {option.constraints_applied.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Assumptions */}
      {option.assumptions.length > 0 && (
        <div>
          <span className="font-semibold text-slate-800 uppercase tracking-wider text-[11px] block mb-1">
            Assumptions:
          </span>
          <ul className="list-disc list-inside space-y-0.5 text-slate-600 pl-1">
            {option.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Flags */}
      {option.flags.length > 0 && (
        <div>
          <span className="font-semibold text-slate-800 uppercase tracking-wider text-[11px] block mb-1">
            Operational Flags:
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {option.flags.map((f, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[11px] font-mono"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Infeasible Reason if infeasible */}
      {!option.feasible && option.infeasible_reason && (
        <div className="p-2.5 bg-red-50 border border-red-200 rounded text-red-900">
          <span className="font-bold">Infeasibility Reason: </span>
          {option.infeasible_reason}
        </div>
      )}

      {/* Accept Delay Impact: Customer Orders Exposed */}
      {option.kind === 'accept_delay' && option.impact && (
        <div className="pt-2 border-t border-slate-200 space-y-2" data-testid="accept-delay-impact-panel">
          <div className="font-semibold text-slate-900 flex items-center justify-between">
            <span>Customer Orders Potentially Exposed ({option.impact.orders_count} orders)</span>
            <span className="font-mono text-slate-800 font-bold">
              Selling Value: {formatMoney(option.impact.exposed_revenue, meta)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 italic">
            Upper bound of exposure: production lead time and stock allocation to orders are unknown,
            so these orders are potentially exposed, not predicted to be late. Exposed revenue is the
            selling value of those orders, not an estimate of loss.
          </p>

          {option.impact.exposed_orders.length > 0 && (
            <div className="overflow-x-auto max-h-56 overflow-y-auto border border-slate-200 rounded mt-2">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs bg-white">
                <thead className="bg-slate-100 font-semibold text-slate-700 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Order #</th>
                    <th className="py-2 px-3">Customer</th>
                    <th className="py-2 px-3">Product</th>
                    <th className="py-2 px-3">Priority</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    <th className="py-2 px-3">Due Date</th>
                    <th className="py-2 px-3 text-right">Units Req.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {option.impact.exposed_orders.map((order) => (
                    <tr key={order.order_number} className="hover:bg-slate-50">
                      <td className="py-1.5 px-3 font-semibold text-blue-700">{order.order_number}</td>
                      <td className="py-1.5 px-3 font-sans text-slate-800">{order.customer_name}</td>
                      <td className="py-1.5 px-3 font-sans text-slate-800">
                        {order.product_sku} ({order.product_name})
                      </td>
                      <td className="py-1.5 px-3 font-sans">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            order.priority === 'critical'
                              ? 'bg-red-100 text-red-800'
                              : order.priority === 'high'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {order.priority}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right">{order.quantity}</td>
                      <td className="py-1.5 px-3 text-slate-700">{order.due_date}</td>
                      <td className="py-1.5 px-3 text-right font-bold text-slate-900">
                        {order.component_units_required}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComponentCard({
  rec,
}: {
  rec: ComponentRecoveryRecommendation;
}) {
  const { meta } = useMeta();
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedOptionId((prev) => (prev === id ? null : id));
  };

  return (
    <article
      className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden"
      data-testid={`recommendation-card-${rec.sku}`}
    >
      {/* Component Header */}
      <div className="p-4 md:p-5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">{rec.sku}</h2>
            <span className="text-sm font-medium text-slate-600">{rec.name}</span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${
                rec.risk_level === 'critical'
                  ? 'bg-red-50 text-red-800 border-red-300'
                  : 'bg-amber-50 text-amber-800 border-amber-300'
              }`}
            >
              {rec.risk_level} Risk
            </span>
            <Link
              to={`/simulator?component_id=${rec.component_id}`}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-0.5 ml-2"
              data-testid={`simulator-link-${rec.component_id}`}
            >
              <span>Simulate</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            First Shortage Date:{' '}
            <span className="font-semibold text-slate-800">{rec.baseline_shortage_date}</span> · Shortage
            Runway Need:{' '}
            <span className="font-semibold text-slate-900">
              {formatNumber(rec.baseline_unmet_before_next_inbound, 1)} units
            </span>{' '}
            (Target: <span className="font-bold text-blue-700">{rec.need_units} units</span>)
          </p>
        </div>

        {/* Reason summary banner */}
        <div className="max-w-xl text-xs bg-blue-50/80 border border-blue-200 p-2.5 rounded-md text-blue-950 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-blue-900">Recommendation Decision:</span>
            <WhyThis
              items={[
                { label: 'Reason', text: rec.reason },
                { label: 'Alternatives', text: rec.alternatives_note },
              ]}
              dataTestId={`why-this-rec-${rec.sku}`}
            />
          </div>
          <p>{rec.reason}</p>
        </div>
      </div>

      {/* Options Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs divide-y divide-slate-200">
          <thead className="bg-slate-100/80 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
            <tr>
              <th className="py-2.5 px-3 w-10 text-center">Info</th>
              <th className="py-2.5 px-3">Option</th>
              <th className="py-2.5 px-3">Description / Source</th>
              <th className="py-2.5 px-3 text-right">Quantity</th>
              <th className="py-2.5 px-3">Arrival Date</th>
              <th className="py-2.5 px-3 text-right">Cost</th>
              <th className="py-2.5 px-3 text-right">Residual Short</th>
              <th className="py-2.5 px-3">Feasible</th>
              <th className="py-2.5 px-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rec.options.map((opt, idx) => {
              const isRecommended = opt.id === rec.recommended_option_id;
              const isExpanded = expandedOptionId === opt.id;
              const sourceLabel =
                opt.source_name && opt.source_code
                  ? `${opt.source_code} (${opt.source_name})`
                  : opt.source_code || '—';

              return (
                <Fragment key={opt.id}>
                  <tr
                    className={`transition-colors hover:bg-slate-50/80 ${
                      isRecommended
                        ? 'bg-blue-50/50 font-medium'
                        : isExpanded
                          ? 'bg-slate-50'
                          : ''
                    }`}
                    data-testid={`option-row-${opt.id}`}
                  >
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`option-expansion-${opt.id}-${idx}`}
                        onClick={() => toggleExpand(opt.id)}
                        className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors"
                        title={isExpanded ? 'Collapse details' : 'Expand constraints & assumptions'}
                        data-testid={`expand-btn-${opt.id}`}
                      >
                        <span className="font-mono text-xs font-bold leading-none">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      </button>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <OptionKindBadge kind={opt.kind} />
                      </div>
                    </td>
                    <td className="py-3 px-3 max-w-sm">
                      <div className="font-sans text-slate-900">{opt.description}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">Source: {sourceLabel}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {opt.quantity > 0 ? formatInteger(opt.quantity) : '0'}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                      {opt.arrival_date ? opt.arrival_date : '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                      {!opt.cost_known || opt.incremental_cost === null ? (
                        <span className="text-amber-800 font-semibold" data-testid={`cost-unknown-${opt.id}`}>
                          Unknown
                        </span>
                      ) : (
                        <span className="font-semibold text-slate-900">
                          {formatMoney(opt.incremental_cost, meta)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                      {opt.residual_unmet_before_next_inbound === 0 ? (
                        <span className="text-emerald-700 font-bold">0.0</span>
                      ) : (
                        <span className="text-red-700 font-semibold">
                          {formatNumber(opt.residual_unmet_before_next_inbound, 1)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs whitespace-nowrap">
                      {opt.feasible ? (
                        <span className="text-emerald-700 font-semibold">Yes</span>
                      ) : (
                        <span className="text-red-600 font-semibold" title={opt.infeasible_reason || 'Infeasible'}>
                          No ({opt.infeasible_reason || 'Infeasible'})
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      {isRecommended ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-blue-600 text-white shadow-xs"
                          data-testid={`recommended-badge-${opt.id}`}
                        >
                          ★ Recommended
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <OptionDetailExpansion option={opt} optionIndex={idx} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Combined Plan Section (if single option did not reach 0 residual) */}
      {rec.combined_plan && (
        <div
          className="p-4 bg-amber-50/60 border-t border-amber-200 space-y-3"
          data-testid={`combined-plan-${rec.sku}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-bold text-xs">
                Combined Plan
              </span>
              <span className="text-xs font-semibold text-amber-950">
                {rec.combined_plan.description}
              </span>
            </div>
            <div className="text-xs font-mono text-amber-900">
              Total Quantity:{' '}
              <span className="font-bold">{formatInteger(rec.combined_plan.total_quantity)}</span> · Known Cost:{' '}
              <span className="font-bold">
                {rec.combined_plan.total_known_cost !== null
                  ? formatMoney(rec.combined_plan.total_known_cost, meta)
                  : 'Contains Unknown Costs'}
              </span> · Final Residual:{' '}
              <span className="font-bold">
                {formatNumber(rec.combined_plan.residual_unmet_before_next_inbound, 1)} units
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-amber-200 text-left text-xs bg-white rounded border border-amber-200">
              <thead className="bg-amber-100 font-semibold text-amber-900">
                <tr>
                  <th className="py-1.5 px-3">Step</th>
                  <th className="py-1.5 px-3">Action Type</th>
                  <th className="py-1.5 px-3">Source</th>
                  <th className="py-1.5 px-3 text-right">Quantity</th>
                  <th className="py-1.5 px-3">Arrival Date</th>
                  <th className="py-1.5 px-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 font-mono text-[11px]">
                {rec.combined_plan.steps.map((st, i) => (
                  <tr key={i}>
                    <td className="py-1.5 px-3 font-semibold text-slate-800">#{i + 1}</td>
                    <td className="py-1.5 px-3 font-sans">
                      <OptionKindBadge kind={st.kind} />
                    </td>
                    <td className="py-1.5 px-3 font-sans text-slate-800">
                      {st.source_code} ({st.source_name})
                    </td>
                    <td className="py-1.5 px-3 text-right font-bold text-slate-900">
                      {formatInteger(st.quantity)}
                    </td>
                    <td className="py-1.5 px-3 text-slate-700">{st.arrival_date || '—'}</td>
                    <td className="py-1.5 px-3 text-right">
                      {st.cost_known && st.incremental_cost !== null
                        ? formatMoney(st.incremental_cost, meta)
                        : 'Unknown'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Card Footer: Scope Clarification, Later Shortage Note and Alternatives Note */}
      <div className="p-3 bg-slate-50/90 border-t border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-3">
        <div className="italic text-slate-500">
          <span className="font-semibold text-slate-700">Alternatives Note: </span>
          {rec.alternatives_note}
          <span className="block text-[11px] text-slate-500 mt-0.5">
            * &quot;Recommended&quot; designates the option that fixes the first shortage window; later shortages are not covered.
          </span>
        </div>
        {rec.later_shortage_note && (
          <div
            className="text-amber-800 bg-amber-50 px-2.5 py-1 rounded border border-amber-200 text-xs"
            data-testid={`later-shortage-${rec.sku}`}
          >
            <span className="font-bold">Notice: </span>
            {rec.later_shortage_note}
          </div>
        )}
      </div>
    </article>
  );
}

export function RecommendationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const componentIdParam = searchParams.get('component_id');
  const componentIdFilter = componentIdParam ? parseInt(componentIdParam, 10) : undefined;

  const { meta } = useMeta();

  const fetchRecommendations = useCallback(
    (signal: AbortSignal) => {
      return getRecommendations(
        {
          component_id: componentIdFilter,
        },
        signal
      );
    },
    [componentIdFilter]
  );

  const { data, loading, error, reload } = useApi(fetchRecommendations, [fetchRecommendations]);

  const clearFilter = () => {
    setSearchParams({});
  };

  if (meta && !meta.seeded) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Recovery Recommendations"
          description={PAGE_SUBTITLES.recommendations}
        />
        <UnseededView />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery Recommendations"
        description={PAGE_SUBTITLES.recommendations}
      />

      <CurrencyNotice />

      {/* Permanent Warning Banner */}
      <div
        className="p-4 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg shadow-xs text-amber-950 text-xs md:text-sm font-medium flex items-start gap-3"
        data-testid="permanent-recommendations-note"
      >
        <span className="text-amber-600 text-base leading-none select-none font-bold">ℹ</span>
        <div className="flex-1">
          <span className="font-bold block text-amber-900 mb-0.5">
            Decision support only. No orders are created.
          </span>
          <p className="text-amber-800 text-xs">
            Transfer time and cost are assumptions you can configure. "Recommended" designates the option
            that resolves the first shortage window; later shortages are not covered. All evaluated options
            remain strictly non-binding recommendations.
          </p>
        </div>
      </div>

      {/* Component Filter Banner (if component_id is active) */}
      {componentIdFilter !== undefined && (
        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-xs flex items-center justify-between text-xs">
          <span className="text-slate-700">
            Filtered by Component ID: <span className="font-bold text-slate-900">{componentIdFilter}</span>
          </span>
          <button
            type="button"
            onClick={clearFilter}
            className="text-blue-600 hover:text-blue-800 font-semibold hover:underline"
            data-testid="clear-component-filter-btn"
          >
            Show All Components
          </button>
        </div>
      )}

      {/* Body States */}
      {loading && <LoadingView message="Evaluating recovery recommendations..." />}

      {error && <ErrorView error={error} onRetry={reload} />}

      {!loading && !error && data && data.items.length === 0 && (
        <EmptyView message="No components currently need recovery" />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <div className="space-y-6" data-testid="recommendations-list">
          {data.items.map((rec) => (
            <ComponentCard key={rec.component_id} rec={rec} />
          ))}
        </div>
      )}
    </div>
  );
}

export default RecommendationsPage;
