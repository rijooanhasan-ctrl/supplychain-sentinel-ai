import { useCallback, useState } from 'react';
import { getPurchaseOrder, listPurchaseOrders, listSuppliers } from '../api/endpoints';
import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus, Supplier } from '../api/types';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Pagination } from '../components/Pagination';
import { PoStatusBadge } from '../components/Badge';
import { CurrencyNotice } from '../components/CurrencyNotice';
import { formatDate, formatInteger, formatMoney } from '../lib/format';
import { timingLabel, slippedInfo } from '../lib/dates';

const PO_STATUS_OPTIONS: { label: string; value: PurchaseOrderStatus | '' }[] = [
  { label: 'All Statuses', value: '' },
  { label: 'Open', value: 'open' },
  { label: 'In Transit', value: 'in_transit' },
  { label: 'Partially Received', value: 'partially_received' },
  { label: 'Received', value: 'received' },
  { label: 'Cancelled', value: 'cancelled' },
];

function PurchaseOrderLinesPanel({ poId }: { poId: number }) {
  const { meta } = useMeta();
  const fetchDetail = useCallback(
    (signal: AbortSignal) => getPurchaseOrder(poId, signal),
    [poId]
  );
  const { data, loading, error, reload } = useApi(fetchDetail, [fetchDetail]);

  if (loading) {
    return <LoadingView message="Loading purchase order line items..." testId={`lines-loading-${poId}`} />;
  }

  if (error) {
    return (
      <ErrorView
        error={error}
        onRetry={reload}
        title="Could not load PO lines"
        testId={`lines-error-${poId}`}
      />
    );
  }

  if (!data || data.lines.length === 0) {
    return (
      <div className="p-4 bg-white rounded border border-slate-200 text-xs text-slate-500">
        No line items on file for this purchase order.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`lines-table-${poId}`}>
      <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
        Purchase Order Line Items &amp; Fulfillment Progress
      </h4>
      <div className="overflow-x-auto border border-slate-200 rounded bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-slate-700 uppercase font-semibold">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Component</th>
              <th scope="col" className="px-3 py-2 text-left">Destination Warehouse</th>
              <th scope="col" className="px-3 py-2 text-right">Qty Ordered</th>
              <th scope="col" className="px-3 py-2 text-right">Qty Received</th>
              <th scope="col" className="px-3 py-2 text-right">Remaining</th>
              <th scope="col" className="px-3 py-2 text-right">Unit Price ({meta?.display_currency || 'USD'})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {data.lines.map((line: PurchaseOrderLine) => {
              const remaining = line.qty_ordered - line.qty_received;

              return (
                <tr key={line.id} className="hover:bg-slate-50/80">
                  <th scope="row" className="px-3 py-2 font-mono font-semibold text-slate-900 text-left">
                    <span>{line.component_sku}</span>
                    <span className="text-slate-500 font-sans block text-[11px]">{line.component_name}</span>
                  </th>
                  <td className="px-3 py-2 text-slate-800">
                    <span className="font-semibold">{line.warehouse_code}</span>
                    <span className="text-slate-500 block text-[11px]">{line.warehouse_name}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-800">
                    {formatInteger(line.qty_ordered)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-800">
                    {formatInteger(line.qty_received)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-slate-900" data-testid={`remaining-${line.id}`}>
                    {formatInteger(remaining)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900 font-semibold">
                    {formatMoney(line.unit_price, meta)}
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

export function PurchaseOrdersPage() {
  const { meta, reload: reloadMeta, asOf } = useMeta();

  // Filters state
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | undefined>(undefined);

  // Pagination state
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);

  // Expand state
  const [expandedPoIds, setExpandedPoIds] = useState<Set<number>>(new Set());

  // Fetch suppliers for filter dropdown
  const fetchSuppliers = useCallback(
    (signal: AbortSignal) => listSuppliers({ limit: 200 }, signal),
    []
  );
  const { data: supData } = useApi(fetchSuppliers, [fetchSuppliers]);

  // Fetch POs
  const fetchPos = useCallback(
    (signal: AbortSignal) =>
      listPurchaseOrders(
        {
          status: selectedStatus || undefined,
          supplier_id: selectedSupplierId,
          limit,
          offset,
        },
        signal
      ),
    [selectedStatus, selectedSupplierId, limit, offset]
  );
  const { data, loading, error, reload } = useApi(fetchPos, [fetchPos]);

  const handleStatusChange = (statusVal: string) => {
    setSelectedStatus(statusVal);
    setOffset(0);
  };

  const handleSupplierChange = (supVal: string) => {
    setSelectedSupplierId(supVal === '' ? undefined : Number(supVal));
    setOffset(0);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setOffset(0);
  };

  const toggleExpand = (id: number) => {
    setExpandedPoIds((prev) => {
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
          title="Purchase Orders"
          description="Inbound replenishment orders, fulfillment schedules, and expected arrival tracking."
        />
        <UnseededView message={meta.message} onRefresh={reloadMeta} />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="purchase-orders-page">
      <PageHeader
        title="Purchase Orders"
        description="Inbound component purchase orders. Timing indicators evaluate days remaining or overdue relative to the reference snapshot date."
      />

      <CurrencyNotice />

      {/* Filter Bar */}
      <section
        aria-label="Purchase Order Filters"
        className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="filter-status" className="text-slate-600 font-semibold">
            Status:
          </label>
          <select
            id="filter-status"
            value={selectedStatus}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PO_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="filter-supplier" className="text-slate-600 font-semibold">
            Supplier:
          </label>
          <select
            id="filter-supplier"
            value={selectedSupplierId ?? ''}
            onChange={(e) => handleSupplierChange(e.target.value)}
            className="border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-xs"
          >
            <option value="">All Suppliers</option>
            {supData?.items.map((s: Supplier) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>

        {(selectedStatus !== '' || selectedSupplierId !== undefined) && (
          <button
            type="button"
            onClick={() => {
              setSelectedStatus('');
              setSelectedSupplierId(undefined);
              setOffset(0);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 underline font-semibold ml-auto"
          >
            Reset Filters
          </button>
        )}
      </section>

      {/* Table Area */}
      <section aria-labelledby="pos-table-heading" className="space-y-4">
        <h2 id="pos-table-heading" className="sr-only">Purchase Orders Table</h2>

        {loading && <LoadingView message="Loading purchase orders..." />}

        {error && (
          <ErrorView
            error={error}
            onRetry={reload}
            title="Failed to load purchase orders"
          />
        )}

        {data && !loading && (
          <>
            {data.items.length === 0 ? (
              <EmptyView
                title="No purchase orders found"
                message="No orders match the selected status or supplier filters."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="pos-table">
                    <caption className="sr-only">Inbound Purchase Orders</caption>
                    <thead className="bg-slate-50 text-slate-700 text-xs uppercase font-semibold">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left">PO Number</th>
                        <th scope="col" className="px-4 py-3 text-left">Supplier</th>
                        <th scope="col" className="px-4 py-3 text-left">Status</th>
                        <th scope="col" className="px-4 py-3 text-left">Order Date</th>
                        <th scope="col" className="px-4 py-3 text-left">Promised Date</th>
                        <th scope="col" className="px-4 py-3 text-left">Latest Estimate</th>
                        <th scope="col" className="px-4 py-3 text-left">Timing</th>
                        <th scope="col" className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {data.items.map((po: PurchaseOrder) => {
                        const isExpanded = expandedPoIds.has(po.id);
                        const timing = timingLabel(po, asOf);
                        const isTimingOverdue = timing.startsWith('Overdue');
                        const slipped = slippedInfo(po);

                        return (
                          <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                            <th scope="row" className="px-4 py-3 font-mono font-bold text-slate-900 text-left">
                              {po.po_number}
                            </th>
                            <td className="px-4 py-3 text-slate-800">
                              <span className="font-semibold">{po.supplier_name}</span>
                              <span className="text-xs text-slate-500 font-mono block">({po.supplier_code})</span>
                            </td>
                            <td className="px-4 py-3">
                              <PoStatusBadge status={po.status} />
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-700 text-xs">
                              {formatDate(po.order_date)}
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-700 text-xs">
                              {formatDate(po.promised_date)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {po.latest_estimate_date ? (
                                <span className="text-slate-900 font-medium">
                                  {formatDate(po.latest_estimate_date)}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">None provided</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs font-medium" data-testid={`timing-${po.po_number}`}>
                              <div>
                                {isTimingOverdue ? (
                                  <span className="text-red-700 font-bold">{timing}</span>
                                ) : timing === 'Due today' ? (
                                  <span className="text-amber-800 font-bold">{timing}</span>
                                ) : (
                                  <span className="text-slate-700">{timing}</span>
                                )}
                              </div>
                              {slipped && (
                                <div className="text-[11px] text-amber-900 font-medium mt-0.5" data-testid={`slipped-${po.po_number}`}>
                                  {slipped.label}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => toggleExpand(po.id)}
                                aria-expanded={isExpanded}
                                aria-controls={`po-lines-${po.id}`}
                                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                data-testid={`toggle-po-${po.id}`}
                              >
                                {isExpanded ? 'Hide Lines' : 'View Lines'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Expanded details container */}
                {Array.from(expandedPoIds).map((poId) => (
                  <div
                    key={`po-panel-${poId}`}
                    id={`po-lines-${poId}`}
                    className="p-4 bg-slate-50 border-t border-slate-200"
                  >
                    <PurchaseOrderLinesPanel poId={poId} />
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

export default PurchaseOrdersPage;
