import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getInventoryRisk, listPurchaseOrders } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, UnseededView, EmptyView } from '../components/StateViews';
import { CriticalityBadge, PoStatusBadge, RiskBadge } from '../components/Badge';
import { formatInteger, formatDate } from '../lib/format';
import { expectedDate, isOverdue, isDelayedVsPromise, slippedInfo } from '../lib/dates';

export function OverviewPage() {
  const { meta, loading: metaLoading, error: metaError, reload: reloadMeta, asOf } = useMeta();

  // Fetch purchase orders with limit=200 for overdue analysis & upcoming delivery schedule
  const fetchPos = useCallback(
    (signal: AbortSignal) => listPurchaseOrders({ limit: 200 }, signal),
    []
  );
  const {
    data: poData,
    loading: poLoading,
    error: poError,
    reload: reloadPos,
  } = useApi(fetchPos, [fetchPos]);

  // Parallel fetch for exact open status totals
  const fetchOpenTotals = useCallback(async (signal: AbortSignal) => {
    const [openRes, inTransitRes, partialRes] = await Promise.all([
      listPurchaseOrders({ status: 'open', limit: 1 }, signal),
      listPurchaseOrders({ status: 'in_transit', limit: 1 }, signal),
      listPurchaseOrders({ status: 'partially_received', limit: 1 }, signal),
    ]);
    return {
      open: openRes.total,
      inTransit: inTransitRes.total,
      partial: partialRes.total,
      totalOpen: openRes.total + inTransitRes.total + partialRes.total,
    };
  }, []);

  const {
    data: openTotals,
    loading: openTotalsLoading,
    error: openTotalsError,
    reload: reloadOpenTotals,
  } = useApi(fetchOpenTotals, [fetchOpenTotals]);

  // Fetch inventory risk summary & items for independent section
  const fetchRisk = useCallback(
    (signal: AbortSignal) => getInventoryRisk({ limit: 100 }, signal),
    []
  );
  const {
    data: riskData,
    loading: riskLoading,
    error: riskError,
    reload: reloadRisk,
  } = useApi(fetchRisk, [fetchRisk]);

  // Derived metrics from fetched POs
  const { overdueCount, delayedCount, upcomingDeliveries, isTruncated } = useMemo(() => {
    if (!poData?.items) {
      return { overdueCount: 0, delayedCount: 0, upcomingDeliveries: [], isTruncated: false };
    }

    const items = poData.items;
    const isTruncated = poData.total > 200;

    // Filter active POs (open, in_transit, partially_received)
    const activePos = items.filter(
      (po) =>
        po.status === 'open' ||
        po.status === 'in_transit' ||
        po.status === 'partially_received'
    );

    // Overdue count: effective expected date strictly before asOf
    const overduePos = activePos.filter((po) => isOverdue(po, asOf));

    // Delayed count: active orders with latest_estimate_date > promised_date
    const delayedPos = activePos.filter((po) => isDelayedVsPromise(po));

    // Upcoming deliveries: effective expected date on or after asOf, sorted ascending
    const upcoming = activePos
      .filter((po) => !isOverdue(po, asOf))
      .map((po) => {
        const { date, basis } = expectedDate(po);
        return { po, date, basis };
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);

    return {
      overdueCount: overduePos.length,
      delayedCount: delayedPos.length,
      upcomingDeliveries: upcoming,
      isTruncated,
    };
  }, [poData, asOf]);

  const criticalOrHighComponents = useMemo(() => {
    if (!riskData?.items) return [];
    return riskData.items.filter(
      (it) => it.risk_level === 'critical' || it.risk_level === 'high'
    );
  }, [riskData]);

  if (meta?.seeded === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Supply Chain Overview"
          description="High-level operational snapshot derived from active database records."
        />
        <UnseededView message={meta.message} onRefresh={reloadMeta} />
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="overview-page">
      <PageHeader
        title="Supply Chain Overview"
        description="Core operational metrics derived strictly from verified database records. All dates are evaluated against the dataset snapshot date."
      />

      {/* Section 1: Tracked Master Data Entities */}
      <section aria-labelledby="entities-heading">
        <h2 id="entities-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Tracked Master Entities
        </h2>

        {metaLoading && <LoadingView message="Loading master entity counts..." />}
        {metaError && (
          <ErrorView
            error={metaError}
            onRetry={reloadMeta}
            title="Failed to load master entity counts"
          />
        )}

        {meta?.counts && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="entity-counts-grid">
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Products</dt>
              <dd className="mt-2 text-2xl font-bold text-slate-900" data-testid="count-products">
                {formatInteger(meta.counts.products)}
              </dd>
              <span className="text-xs text-slate-400 mt-1 block">Finished laptop models</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Components</dt>
              <dd className="mt-2 text-2xl font-bold text-slate-900" data-testid="count-components">
                {formatInteger(meta.counts.components)}
              </dd>
              <span className="text-xs text-slate-400 mt-1 block">Catalog BOM items</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Suppliers</dt>
              <dd className="mt-2 text-2xl font-bold text-slate-900" data-testid="count-suppliers">
                {formatInteger(meta.counts.suppliers)}
              </dd>
              <span className="text-xs text-slate-400 mt-1 block">Active vendor partners</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Warehouses</dt>
              <dd className="mt-2 text-2xl font-bold text-slate-900" data-testid="count-warehouses">
                {formatInteger(meta.counts.warehouses)}
              </dd>
              <span className="text-xs text-slate-400 mt-1 block">Plants &amp; regional hubs</span>
            </div>
          </div>
        )}
      </section>

      {/* Section 2: Procurement Execution Status */}
      <section aria-labelledby="procurement-heading">
        <h2 id="procurement-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Procurement Execution Status
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card: Open Purchase Orders */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs">
            <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Open Purchase Orders
            </dt>
            {openTotalsLoading && <LoadingView message="Loading open order counts..." />}
            {openTotalsError && (
              <ErrorView
                error={openTotalsError}
                onRetry={reloadOpenTotals}
                title="Could not load open orders count"
              />
            )}
            {openTotals && !openTotalsLoading && (
              <div className="mt-2">
                <dd className="text-3xl font-bold text-slate-900" data-testid="count-open-pos">
                  {formatInteger(openTotals.totalOpen)}
                </dd>
                <p className="text-xs text-slate-500 mt-2">
                  Orders currently active ({openTotals.open} open, {openTotals.inTransit} in transit,{' '}
                  {openTotals.partial} partially received).
                </p>
              </div>
            )}
          </div>

          {/* Card: Overdue Purchase Orders */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Overdue Purchase Orders
              </dt>
              {overdueCount > 0 && (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-900 border border-red-300">
                  Attention Required
                </span>
              )}
            </div>
            {poLoading && <LoadingView message="Evaluating schedule status..." />}
            {poError && (
              <ErrorView
                error={poError}
                onRetry={reloadPos}
                title="Could not evaluate overdue orders"
              />
            )}
            {poData && !poLoading && (
              <div className="mt-2">
                <dd className="text-3xl font-bold text-red-700" data-testid="count-overdue-pos">
                  {formatInteger(overdueCount)}
                </dd>
                <p className="text-xs text-slate-600 mt-2">
                  <span className="font-semibold">Definition:</span> Active orders (open, in transit, partially
                  received) whose effective expected date (latest estimate if available, otherwise promised date)
                  is strictly earlier than snapshot date ({asOf}).
                </p>
                <div className="mt-4 pt-3 border-t border-slate-100" data-testid="delayed-pos-block">
                  <p className="text-xs font-semibold text-slate-800" data-testid="count-delayed-pos">
                    Delayed vs promise: {formatInteger(delayedCount)} POs
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="font-semibold">Definition:</span> Active orders (open, in transit, partially
                    received) whose latest estimated delivery date is strictly later than promised date.
                  </p>
                </div>
                {isTruncated && (
                  <p
                    className="text-xs text-amber-800 bg-amber-50 p-2 rounded mt-2 border border-amber-200"
                    data-testid="overdue-truncated-warning"
                  >
                    Note: Evaluated across first 200 purchase orders (total in system: {poData.total}).
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Section 3: Next 5 Upcoming Inbound Deliveries */}
      <section aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Next 5 Upcoming Inbound Deliveries
        </h2>

        {poLoading && <LoadingView message="Loading upcoming deliveries..." />}
        {poError && (
          <ErrorView
            error={poError}
            onRetry={reloadPos}
            title="Could not load upcoming delivery schedule"
          />
        )}

        {poData && !poLoading && (
          <>
            {upcomingDeliveries.length === 0 ? (
              <EmptyView
                title="No upcoming deliveries scheduled"
                message="All open purchase orders are either fulfilled, cancelled, or currently past their expected date."
              />
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white shadow-xs">
                <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="upcoming-table">
                  <caption className="sr-only">Next 5 upcoming delivery orders</caption>
                  <thead className="bg-slate-50 text-slate-700 text-xs uppercase font-semibold">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left">PO Number</th>
                      <th scope="col" className="px-4 py-3 text-left">Supplier</th>
                      <th scope="col" className="px-4 py-3 text-left">Status</th>
                      <th scope="col" className="px-4 py-3 text-left">Expected Date</th>
                      <th scope="col" className="px-4 py-3 text-left">Date Basis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {upcomingDeliveries.map(({ po, date, basis }) => {
                      const slipped = slippedInfo(po);
                      return (
                        <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                          <th scope="row" className="px-4 py-3 font-mono font-semibold text-slate-900">
                            {po.po_number}
                          </th>
                          <td className="px-4 py-3 text-slate-800">
                            {po.supplier_name}{' '}
                            <span className="text-xs text-slate-500 font-mono">({po.supplier_code})</span>
                          </td>
                          <td className="px-4 py-3">
                            <PoStatusBadge status={po.status} />
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-900">
                            <div>{formatDate(date)}</div>
                            {slipped && (
                              <div
                                className="text-[11px] font-sans text-amber-900 font-medium mt-0.5"
                                data-testid={`slipped-upcoming-${po.po_number}`}
                              >
                                {slipped.label}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                                basis === 'estimated'
                                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                                  : 'bg-slate-100 text-slate-800 border-slate-200'
                              }`}
                              data-testid={`basis-${po.po_number}`}
                            >
                              {basis}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Section 4: Inventory Risk & Shortage Projections */}
      <section aria-labelledby="inventory-risk-heading" className="space-y-4" data-testid="overview-risk-section">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 id="inventory-risk-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Inventory Stockout Risk &amp; Shortage Projections
          </h2>
          <Link
            to="/inventory-risk"
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
            data-testid="link-to-inventory-risk"
          >
            Open Full Inventory Risk Analysis &rarr;
          </Link>
        </div>

        {riskLoading && (
          <LoadingView
            message="Evaluating inventory risks and projected shortages..."
            testId="overview-risk-loading"
          />
        )}

        {riskError && (
          <ErrorView
            error={riskError}
            onRetry={reloadRisk}
            title="Could not load inventory risk summary"
          />
        )}

        {riskData?.summary && !riskLoading && (
          <div className="space-y-4">
            {/* Risk Counts Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="risk-summary-grid">
              <div className="bg-white p-3.5 rounded-lg border border-red-200 bg-red-50/20 shadow-xs">
                <dt className="text-[11px] font-bold text-red-900 uppercase tracking-wider">Critical Risk</dt>
                <dd className="mt-1 text-2xl font-bold text-red-700" data-testid="count-risk-critical">
                  {formatInteger(riskData.summary?.counts_by_risk_level?.critical ?? 0)}
                </dd>
                <span className="text-[10px] text-slate-500 block mt-0.5">Shortage &le; 7 days</span>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-amber-200 bg-amber-50/20 shadow-xs">
                <dt className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">High Risk</dt>
                <dd className="mt-1 text-2xl font-bold text-amber-800" data-testid="count-risk-high">
                  {formatInteger(riskData.summary?.counts_by_risk_level?.high ?? 0)}
                </dd>
                <span className="text-[10px] text-slate-500 block mt-0.5">Shortage &le; 14 days</span>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-blue-200 bg-blue-50/20 shadow-xs">
                <dt className="text-[11px] font-bold text-blue-900 uppercase tracking-wider">Medium Risk</dt>
                <dd className="mt-1 text-2xl font-bold text-blue-700" data-testid="count-risk-medium">
                  {formatInteger(riskData.summary?.counts_by_risk_level?.medium ?? 0)}
                </dd>
                <span className="text-[10px] text-slate-500 block mt-0.5">Shortage &le; 30 days</span>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/20 shadow-xs">
                <dt className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">Low Risk</dt>
                <dd className="mt-1 text-2xl font-bold text-emerald-700" data-testid="count-risk-low">
                  {formatInteger(riskData.summary?.counts_by_risk_level?.low ?? 0)}
                </dd>
                <span className="text-[10px] text-slate-500 block mt-0.5">Covered &gt; 30 days</span>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs">
                <dt className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Not Applicable</dt>
                <dd className="mt-1 text-2xl font-bold text-slate-700" data-testid="count-risk-none">
                  {formatInteger(riskData.summary?.counts_by_risk_level?.none ?? 0)}
                </dd>
                <span className="text-[10px] text-slate-500 block mt-0.5">Zero demand items</span>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs">
                <dt className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Unknown</dt>
                <dd className="mt-1 text-2xl font-bold text-slate-700" data-testid="count-risk-unknown">
                  {formatInteger(riskData.summary?.counts_by_risk_level?.unknown ?? 0)}
                </dd>
                <span className="text-[10px] text-slate-500 block mt-0.5">Missing history/stock</span>
              </div>
            </div>

            {/* Critical & High Risk Priority List */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                High Priority Components Requiring Attention ({criticalOrHighComponents.length})
              </h3>
              {criticalOrHighComponents.length === 0 ? (
                <p className="text-xs text-slate-500 italic">
                  No components currently classified with Critical or High stockout risk.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs" data-testid="overview-critical-table">
                    <thead className="bg-slate-50 text-slate-600 font-semibold">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left">SKU</th>
                        <th scope="col" className="px-3 py-2 text-left">Component Name</th>
                        <th scope="col" className="px-3 py-2 text-left">Criticality</th>
                        <th scope="col" className="px-3 py-2 text-right">Plant Usable</th>
                        <th scope="col" className="px-3 py-2 text-left">Predicted Shortage</th>
                        <th scope="col" className="px-3 py-2 text-left">Risk Level</th>
                        <th scope="col" className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {criticalOrHighComponents.map((comp) => (
                        <tr key={comp.component_id} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2 font-mono font-bold text-slate-900">{comp.sku}</td>
                          <td className="px-3 py-2 text-slate-700">{comp.name}</td>
                          <td className="px-3 py-2">
                            <CriticalityBadge criticality={comp.criticality} />
                          </td>
                          <td className="px-3 py-2 font-mono text-right text-slate-900 font-semibold">
                            {comp.plant_usable_stock !== null ? formatInteger(comp.plant_usable_stock) : '—'}
                          </td>
                          <td className="px-3 py-2 text-red-700 font-medium">
                            {comp.shortage_date ? (
                              <span>
                                {formatDate(comp.shortage_date)} (in {comp.days_until_shortage} days)
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <RiskBadge level={comp.risk_level} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              to="/inventory-risk"
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
                              data-testid={`inspect-link-${comp.sku}`}
                            >
                              Inspect Details &rarr;
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default OverviewPage;
