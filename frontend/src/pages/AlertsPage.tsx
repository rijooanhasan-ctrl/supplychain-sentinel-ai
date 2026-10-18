import { Fragment, useCallback, useState } from 'react';
import { getAlerts, getAlertDetail } from '../api/endpoints';
import {
  ALERT_TYPE_LABELS,
  type AlertListItem,
  type AlertSeverity,
  type AlertType,
} from '../api/types';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Pagination } from '../components/Pagination';
import { AlertSeverityBadge, Badge } from '../components/Badge';
import { formatInteger, formatNumber, formatUsd } from '../lib/format';

const SEVERITY_OPTIONS: { label: string; value: AlertSeverity | '' }[] = [
  { label: 'All Severities', value: '' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
  { label: 'Info', value: 'info' },
];

const TYPE_OPTIONS: { label: string; value: AlertType | '' }[] = [
  { label: 'All Alert Types', value: '' },
  { label: 'Inventory Shortage', value: 'inventory_shortage' },
  { label: 'Data Quality', value: 'data_quality' },
  { label: 'Supplier Delay Exposure', value: 'supplier_delay_exposure' },
  { label: 'PO Delivery Slipped', value: 'po_slipped' },
  { label: 'PO Overdue', value: 'po_overdue' },
  { label: 'Demand Surge', value: 'demand_surge' },
  { label: 'Quality Issue', value: 'quality_issue' },
  { label: 'Capacity Constraint', value: 'capacity_constraint' },
  { label: 'Compound Disruption', value: 'compound_risk' },
];

function AlertDetailPanel({
  alertId,
  onSelectAlert,
}: {
  alertId: string;
  onSelectAlert?: (id: string) => void;
}) {
  const fetchDetail = useCallback(
    (signal: AbortSignal) => getAlertDetail(alertId, signal),
    [alertId]
  );
  const { data: detail, loading, error, reload } = useApi(fetchDetail, [fetchDetail]);

  if (loading) {
    return (
      <div className="p-4 bg-slate-50 border-t border-slate-200" data-testid={`alert-detail-loading-${alertId}`}>
        <LoadingView message="Loading alert evidence, impact, and scenarios..." />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 bg-slate-50 border-t border-slate-200" data-testid={`alert-detail-error-${alertId}`}>
        <ErrorView
          error={error || new Error('Failed to load alert detail')}
          onRetry={reload}
          title="Could not load disruption alert details"
        />
      </div>
    );
  }

  return (
    <div
      id={`alert-detail-${alertId}`}
      data-testid={`alert-detail-panel-${alertId}`}
      className="p-5 bg-slate-50 border-t border-slate-200 space-y-6 text-xs text-slate-800"
    >
      {/* 1. Summary banner */}
      <section className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
          Disruption Summary
        </h4>
        <p className="text-sm font-medium text-slate-900 leading-relaxed" data-testid="alert-detail-summary">
          {detail.summary}
        </p>
        {detail.flags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-slate-500">Flags:</span>
            {detail.flags.map((flag) => (
              <Badge key={flag} variant="neutral">
                {flag}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* 2. Evidence Table */}
      {detail.evidence.length > 0 && (
        <section className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Computed Evidence
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" data-testid="alert-evidence-table">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2 px-3">Metric / Fact</th>
                  <th className="py-2 px-3">Value</th>
                  <th className="py-2 px-3">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {detail.evidence.map((ev, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-sans font-medium text-slate-700">{ev.label}</td>
                    <td className="py-2 px-3 text-slate-900">
                      {ev.value !== null && ev.value !== undefined ? String(ev.value) : '—'}
                    </td>
                    <td className="py-2 px-3 font-sans text-slate-500">{ev.unit || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 3. Delay Scenario Analysis (What-If) */}
      {detail.delay_scenarios && detail.delay_scenarios.length > 0 && (
        <section className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Supplier Delay Exposure Scenarios
            </h4>
            <span className="text-xs italic text-slate-500">
              What-if cases from historical delays, not predictions
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs" data-testid="delay-scenarios-table">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2 px-3">Scenario</th>
                  <th className="py-2 px-3">Shift</th>
                  <th className="py-2 px-3">Expected Date</th>
                  <th className="py-2 px-3">Shortage Date</th>
                  <th className="py-2 px-3">First Episode (Days)</th>
                  <th className="py-2 px-3">Unmet Before Inbound</th>
                  <th className="py-2 px-3">Incremental Unmet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {detail.delay_scenarios.map((sc) => (
                  <tr
                    key={sc.scenario_name}
                    className={sc.scenario_name === 'baseline' ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'}
                  >
                    <td className="py-2 px-3 font-sans capitalize text-slate-800">
                      {sc.scenario_name}
                    </td>
                    <td className="py-2 px-3 text-slate-700">+{sc.shift_days}d</td>
                    <td className="py-2 px-3 text-slate-700">{sc.expected_date || '—'}</td>
                    <td className="py-2 px-3 text-slate-700">{sc.shortage_date || 'None'}</td>
                    <td className="py-2 px-3 text-slate-700">
                      {sc.first_episode_days > 0 ? `${sc.first_episode_days} days` : '0 days'}
                    </td>
                    <td className="py-2 px-3 text-slate-700">
                      {sc.unmet_before_next_inbound !== null
                        ? `${formatNumber(sc.unmet_before_next_inbound, 1)} units`
                        : '—'}
                    </td>
                    <td className="py-2 px-3 text-slate-900 font-bold">
                      {sc.incremental_total_unmet > 0
                        ? `+${formatNumber(sc.incremental_total_unmet, 1)} units`
                        : '0.0 units'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. Customer Order Exposure / Impact */}
      {detail.impact && (
        <section className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Customer Order Exposure
              </h4>
              <p className="text-xs text-slate-600 mt-1">
                {detail.impact.orders_count} customer order(s) potentially exposed totaling{' '}
                <span className="font-bold text-slate-900 font-mono">
                  {formatUsd(detail.impact.exposed_revenue)}
                </span>{' '}
                in sales value ({formatInteger(detail.impact.total_component_units_required)} component units required).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Priority Breakdown:</span>
              <Badge variant="danger">Critical: {detail.impact.count_by_priority['critical'] || 0}</Badge>
              <Badge variant="warning">High: {detail.impact.count_by_priority['high'] || 0}</Badge>
              <Badge variant="neutral">Normal: {detail.impact.count_by_priority['normal'] || 0}</Badge>
              <Badge variant="neutral">Low: {detail.impact.count_by_priority['low'] || 0}</Badge>
            </div>
          </div>

          {detail.impact.exposed_orders.length > 0 && (
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs" data-testid="exposed-orders-table">
                <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-200 text-slate-500 font-semibold">
                  <tr>
                    <th className="py-2 px-3">Order Number</th>
                    <th className="py-2 px-3">Customer</th>
                    <th className="py-2 px-3">Product</th>
                    <th className="py-2 px-3">Quantity</th>
                    <th className="py-2 px-3">Due Date</th>
                    <th className="py-2 px-3">Priority</th>
                    <th className="py-2 px-3">Units Needed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {detail.impact.exposed_orders.map((ord) => (
                    <tr key={ord.order_number} className="hover:bg-slate-50">
                      <td className="py-1.5 px-3 font-semibold text-blue-700">{ord.order_number}</td>
                      <td className="py-1.5 px-3 font-sans text-slate-800">{ord.customer_name}</td>
                      <td className="py-1.5 px-3 font-sans text-slate-700">{ord.product_sku}</td>
                      <td className="py-1.5 px-3 text-slate-800">{ord.quantity}</td>
                      <td className="py-1.5 px-3 text-slate-700">{ord.due_date}</td>
                      <td className="py-1.5 px-3 font-sans">
                        <span
                          className={`capitalize font-semibold ${
                            ord.priority === 'critical'
                              ? 'text-red-700'
                              : ord.priority === 'high'
                              ? 'text-amber-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {ord.priority}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-slate-900 font-bold">{ord.component_units_required}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 5. Assumptions */}
      {detail.assumptions.length > 0 && (
        <section className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Assessment Assumptions & Limitations
          </h4>
          <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600" data-testid="alert-assumptions-list">
            {detail.assumptions.map((ass, i) => (
              <li key={i} className="leading-relaxed">
                {ass}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. Related Disruption Alerts */}
      {detail.related_alert_ids.length > 0 && (
        <section className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Related Disruption Alerts
          </h4>
          <div className="flex flex-wrap gap-2">
            {detail.related_alert_ids.map((relId) => (
              <button
                key={relId}
                type="button"
                onClick={() => onSelectAlert && onSelectAlert(relId)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                data-testid={`related-alert-link-${relId}`}
              >
                <span>{relId}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function AlertsPage() {
  const { meta } = useMeta();
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | ''>('');
  const [typeFilter, setTypeFilter] = useState<AlertType | ''>('');
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const fetchAlerts = useCallback(
    (signal: AbortSignal) => {
      return getAlerts(
        {
          severity: severityFilter || undefined,
          type: typeFilter || undefined,
          limit,
          offset,
        },
        signal
      );
    },
    [severityFilter, typeFilter, limit, offset]
  );

  const { data, loading, error, reload } = useApi(fetchAlerts, [fetchAlerts]);

  const handleSeverityChange = (newSev: AlertSeverity | '') => {
    setSeverityFilter(newSev);
    setOffset(0);
  };

  const handleTypeChange = (newType: AlertType | '') => {
    setTypeFilter(newType);
    setOffset(0);
  };

  const handleToggleExpand = (alertId: string) => {
    setExpandedAlertId((prev) => (prev === alertId ? null : alertId));
  };

  const handleSelectRelatedAlert = (relId: string) => {
    // If the related alert is in the current items, expand it and scroll into view
    setExpandedAlertId(relId);
    setTimeout(() => {
      const el = document.getElementById(`alert-row-${relId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  if (meta && !meta.seeded) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Disruption Detection & Alerts"
          description="Real-time multi-tier disruption monitoring, delay what-if exposure, and order exposure tracking."
        />
        <UnseededView />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disruption Detection & Alerts"
        description="Stateless predictive disruption detection across inventory runway, supplier reliability, purchase orders, and demand surges."
      />

      {/* Summary Counts Banner */}
      {data && (
        <section
          aria-label="Alerts summary counts"
          className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4"
          data-testid="alerts-summary-banner"
        >
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700">
            <span className="font-semibold text-slate-900 uppercase tracking-wider text-xs">
              System Disruption Status:
            </span>
            <span data-testid="summary-counts-text" className="text-slate-800">
              Critical {data.summary.counts_by_severity['critical'] || 0} · High{' '}
              {data.summary.counts_by_severity['high'] || 0} · Medium{' '}
              {data.summary.counts_by_severity['medium'] || 0} · Low{' '}
              {data.summary.counts_by_severity['low'] || 0} · Info{' '}
              {data.summary.counts_by_severity['info'] || 0}
            </span>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            Total Alerts: <span className="font-bold text-slate-900">{data.summary.total_alerts}</span>
          </div>
        </section>
      )}

      {/* Filter Toolbar */}
      <section
        aria-label="Alert filters"
        className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-wrap items-center gap-4"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <label htmlFor="severity-filter" className="text-xs font-semibold text-slate-700">
            Severity:
          </label>
          <select
            id="severity-filter"
            data-testid="severity-filter-select"
            value={severityFilter}
            onChange={(e) => handleSeverityChange(e.target.value as AlertSeverity | '')}
            className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <label htmlFor="type-filter" className="text-xs font-semibold text-slate-700">
            Alert Type:
          </label>
          <select
            id="type-filter"
            data-testid="type-filter-select"
            value={typeFilter}
            onChange={(e) => handleTypeChange(e.target.value as AlertType | '')}
            className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Main Content Area */}
      {loading && !data && (
        <LoadingView message="Detecting disruptions across supply chain nodes..." testId="alerts-page-loading" />
      )}

      {error && !data && (
        <ErrorView
          error={error}
          onRetry={reload}
          title="Could not evaluate supply chain alerts"
        />
      )}

      {data && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
          {data.items.length === 0 ? (
            <EmptyView message="No disruption alerts match the current filter criteria." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs" data-testid="alerts-table">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-3 px-4 w-12 text-center">Action</th>
                    <th className="py-3 px-4">Severity</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Title & Description</th>
                    <th className="py-3 px-4">Subject</th>
                    <th className="py-3 px-4">Impact Runway</th>
                    <th className="py-3 px-4 text-right">Exposed Orders</th>
                    <th className="py-3 px-4 text-right">Exposed Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((alert: AlertListItem) => {
                    const isExpanded = expandedAlertId === alert.id;
                    const subjectStr =
                      alert.component_sku ||
                      alert.supplier_code ||
                      alert.po_number ||
                      '—';

                    return (
                      <Fragment key={alert.id}>
                        <tr
                          id={`alert-row-${alert.id}`}
                          className={`hover:bg-slate-50 transition-colors ${
                            isExpanded ? 'bg-slate-50/80' : ''
                          }`}
                        >
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`alert-detail-${alert.id}`}
                              onClick={() => handleToggleExpand(alert.id)}
                              className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                              data-testid={`toggle-expand-${alert.id}`}
                              title={isExpanded ? 'Collapse alert details' : 'Expand alert details'}
                            >
                              <span className="font-mono text-sm leading-none font-bold">
                                {isExpanded ? '▼' : '▶'}
                              </span>
                            </button>
                          </td>
                          <td className="py-3 px-4">
                            <AlertSeverityBadge severity={alert.severity} />
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-700">
                            {ALERT_TYPE_LABELS[alert.type] || alert.type}
                          </td>
                          <td className="py-3 px-4 max-w-md">
                            <div className="font-semibold text-slate-900">{alert.title}</div>
                            <div className="text-slate-500 text-xs truncate mt-0.5" title={alert.summary}>
                              {alert.summary}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-800">
                            {subjectStr}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700">
                            {alert.days_until_impact !== null ? `${alert.days_until_impact}d` : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-800">
                            {alert.affected_orders_count !== null
                              ? formatInteger(alert.affected_orders_count)
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                            {alert.exposed_revenue !== null ? formatUsd(alert.exposed_revenue) : '—'}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr id={`alert-expanded-row-${alert.id}`}>
                            <td colSpan={8} className="p-0 border-t border-slate-200">
                              <AlertDetailPanel
                                alertId={alert.id}
                                onSelectAlert={handleSelectRelatedAlert}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data.total > limit && (
            <div className="p-4 border-t border-slate-200">
              <Pagination
                total={data.total}
                offset={offset}
                limit={limit}
                onOffsetChange={setOffset}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setOffset(0);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
