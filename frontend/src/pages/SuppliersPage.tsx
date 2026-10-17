import { useCallback, useState } from 'react';
import { getSupplier, listSuppliers } from '../api/endpoints';
import type { Supplier, SupplierOffer } from '../api/types';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Pagination } from '../components/Pagination';
import { formatInteger, formatPercentFromFraction, formatUsd } from '../lib/format';

function SupplierOffersPanel({ supplierId }: { supplierId: number }) {
  const fetchDetail = useCallback(
    (signal: AbortSignal) => getSupplier(supplierId, signal),
    [supplierId]
  );
  const { data, loading, error, reload } = useApi(fetchDetail, [fetchDetail]);

  if (loading) {
    return <LoadingView message="Loading supplier component offers..." testId={`offers-loading-${supplierId}`} />;
  }

  if (error) {
    return (
      <ErrorView
        error={error}
        onRetry={reload}
        title="Could not load offers"
        testId={`offers-error-${supplierId}`}
      />
    );
  }

  if (!data || data.offers.length === 0) {
    return (
      <div className="p-4 bg-white rounded border border-slate-200 text-xs text-slate-500">
        No active component supply agreements on file for this vendor.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`offers-table-${supplierId}`}>
      <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
        Active Component Supply Agreements &amp; Procurement Terms
      </h4>
      <div className="overflow-x-auto border border-slate-200 rounded bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-slate-700 uppercase font-semibold">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Component SKU</th>
              <th scope="col" className="px-3 py-2 text-right">Unit Cost (USD)</th>
              <th scope="col" className="px-3 py-2 text-right">Lead Time</th>
              <th scope="col" className="px-3 py-2 text-right">Min Order Qty</th>
              <th scope="col" className="px-3 py-2 text-right">Max Weekly Capacity</th>
              <th scope="col" className="px-3 py-2 text-center">Preferred</th>
              <th scope="col" className="px-3 py-2 text-left">Expedite Terms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {data.offers.map((offer: SupplierOffer) => {
              // Expedite terms display logic
              let expediteDisplay = 'Not available';
              if (offer.expedite_available) {
                const lead =
                  offer.expedite_lead_time_days !== null
                    ? `${offer.expedite_lead_time_days} days`
                    : 'Unknown lead time';
                const premium =
                  offer.expedite_cost_premium_pct !== null
                    ? `+${formatPercentFromFraction(offer.expedite_cost_premium_pct)}`
                    : 'Unknown premium';
                expediteDisplay = `Yes (${lead}, ${premium})`;
              }

              return (
                <tr key={offer.id} className="hover:bg-slate-50/80">
                  <th scope="row" className="px-3 py-2 font-mono font-semibold text-slate-900 text-left">
                    <span>{offer.component_sku}</span>
                    <span className="text-slate-500 font-sans block text-[11px]">{offer.component_name}</span>
                  </th>
                  <td className="px-3 py-2 text-right font-mono text-slate-900 font-semibold">
                    {formatUsd(offer.unit_cost)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {offer.lead_time_days} days
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {formatInteger(offer.min_order_qty)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700" data-testid={`capacity-${offer.id}`}>
                    {offer.max_weekly_capacity !== null
                      ? formatInteger(offer.max_weekly_capacity)
                      : 'Unknown'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {offer.is_preferred ? (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                        Yes
                      </span>
                    ) : (
                      <span className="text-slate-400">No</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700" data-testid={`expedite-${offer.id}`}>
                    {expediteDisplay}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SuppliersPage() {
  const { meta, reload: reloadMeta } = useMeta();

  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<number>>(new Set());

  const fetchSuppliers = useCallback(
    (signal: AbortSignal) => listSuppliers({ limit, offset }, signal),
    [limit, offset]
  );
  const { data, loading, error, reload } = useApi(fetchSuppliers, [fetchSuppliers]);

  const toggleExpand = (id: number) => {
    setExpandedSupplierIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setOffset(0);
  };

  if (meta?.seeded === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Supplier Directory"
          description="Global suppliers, manufacturing facilities, and active procurement contracts."
        />
        <UnseededView message={meta.message} onRefresh={reloadMeta} />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="suppliers-page">
      <PageHeader
        title="Supplier Directory"
        description="Catalog of supplier partners and contractual supply parameters. Click 'View Agreements' to inspect component unit costs, lead times, and capacity."
      />

      <section aria-labelledby="suppliers-table-heading" className="space-y-4">
        <h2 id="suppliers-table-heading" className="sr-only">Supplier List Table</h2>

        {loading && <LoadingView message="Loading suppliers directory..." />}

        {error && (
          <ErrorView
            error={error}
            onRetry={reload}
            title="Failed to load supplier directory"
          />
        )}

        {data && !loading && (
          <>
            {data.items.length === 0 ? (
              <EmptyView
                title="No suppliers found"
                message="The supplier database currently has no records."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="suppliers-table">
                    <caption className="sr-only">Supplier Directory</caption>
                    <thead className="bg-slate-50 text-slate-700 text-xs uppercase font-semibold">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left">Code</th>
                        <th scope="col" className="px-4 py-3 text-left">Supplier Name</th>
                        <th scope="col" className="px-4 py-3 text-left">Country</th>
                        <th scope="col" className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {data.items.map((supplier: Supplier) => {
                        const isExpanded = expandedSupplierIds.has(supplier.id);

                        return (
                          <tr key={supplier.id} className="hover:bg-slate-50/80 transition-colors">
                            <th scope="row" className="px-4 py-3 font-mono font-bold text-slate-900 text-left">
                              {supplier.code}
                            </th>
                            <td className="px-4 py-3 text-slate-900 font-medium">
                              {supplier.name}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {supplier.country}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => toggleExpand(supplier.id)}
                                aria-expanded={isExpanded}
                                aria-controls={`supplier-details-${supplier.id}`}
                                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                data-testid={`toggle-supplier-${supplier.id}`}
                              >
                                {isExpanded ? 'Hide Agreements' : 'View Agreements'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Expanded details container */}
                {Array.from(expandedSupplierIds).map((supId) => (
                  <div
                    key={`panel-${supId}`}
                    id={`supplier-details-${supId}`}
                    className="p-4 bg-slate-50 border-t border-slate-200"
                  >
                    <SupplierOffersPanel supplierId={supId} />
                  </div>
                ))}

                <Pagination
                  limit={limit}
                  offset={offset}
                  total={data.total}
                  onOffsetChange={setOffset}
                  onLimitChange={handleLimitChange}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default SuppliersPage;
