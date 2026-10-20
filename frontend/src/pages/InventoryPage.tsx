import { useCallback, useState } from 'react';
import { listComponents, listInventory, listWarehouses } from '../api/endpoints';
import type { Component, InventoryItem, Warehouse } from '../api/types';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Pagination } from '../components/Pagination';
import { formatInteger, formatUtcTimestamp } from '../lib/format';

export function InventoryPage() {
  const { meta, reload: reloadMeta } = useMeta();

  // Filters state
  const [selectedComponentId, setSelectedComponentId] = useState<number | undefined>(undefined);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | undefined>(undefined);

  // Pagination state
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);

  // Fetch filter dropdown options
  const fetchComponents = useCallback(
    (signal: AbortSignal) => listComponents({ limit: 200 }, signal),
    []
  );
  const { data: compData } = useApi(fetchComponents, [fetchComponents]);

  const fetchWarehouses = useCallback(
    (signal: AbortSignal) => listWarehouses({ limit: 100 }, signal),
    []
  );
  const { data: whData } = useApi(fetchWarehouses, [fetchWarehouses]);

  // Fetch inventory levels
  const fetchInventory = useCallback(
    (signal: AbortSignal) =>
      listInventory(
        {
          component_id: selectedComponentId,
          warehouse_id: selectedWarehouseId,
          limit,
          offset,
        },
        signal
      ),
    [selectedComponentId, selectedWarehouseId, limit, offset]
  );

  const {
    data: invData,
    loading: invLoading,
    error: invError,
    reload: reloadInv,
  } = useApi(fetchInventory, [fetchInventory]);

  const handleComponentChange = (val: string) => {
    setSelectedComponentId(val === '' ? undefined : Number(val));
    setOffset(0);
  };

  const handleWarehouseChange = (val: string) => {
    setSelectedWarehouseId(val === '' ? undefined : Number(val));
    setOffset(0);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setOffset(0);
  };

  if (meta?.seeded === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Inventory Levels"
          description="Stock levels, allocations, and usable balances across manufacturing and distribution facilities."
        />
        <UnseededView message={meta.message} onRefresh={reloadMeta} />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <PageHeader
        title="Inventory Levels"
        description="Current component on-hand and reserved stock levels. Usable stock is dynamically calculated as on-hand minus reserved allocations."
      />

      {/* Filter Bar */}
      <section
        aria-label="Inventory Filters"
        className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs flex flex-wrap items-center gap-4 text-xs font-medium text-text-primary"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="filter-component" className="text-text-secondary font-semibold">
            Filter by Component:
          </label>
          <select
            id="filter-component"
            value={selectedComponentId ?? ''}
            onChange={(e) => handleComponentChange(e.target.value)}
            className="border border-border-subtle rounded px-2.5 py-1.5 bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary max-w-xs"
          >
            <option value="">All Components</option>
            {compData?.items.map((c: Component) => (
              <option key={c.id} value={c.id}>
                {c.sku} — {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="filter-warehouse" className="text-text-secondary font-semibold">
            Filter by Warehouse:
          </label>
          <select
            id="filter-warehouse"
            value={selectedWarehouseId ?? ''}
            onChange={(e) => handleWarehouseChange(e.target.value)}
            className="border border-border-subtle rounded px-2.5 py-1.5 bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary max-w-xs"
          >
            <option value="">All Warehouses</option>
            {whData?.items.map((w: Warehouse) => (
              <option key={w.id} value={w.id}>
                {w.code} ({w.name})
              </option>
            ))}
          </select>
        </div>

        {(selectedComponentId !== undefined || selectedWarehouseId !== undefined) && (
          <button
            type="button"
            onClick={() => {
              setSelectedComponentId(undefined);
              setSelectedWarehouseId(undefined);
              setOffset(0);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 underline font-semibold ml-auto"
          >
            Reset Filters
          </button>
        )}
      </section>

      {/* Main Table Area */}
      <section aria-labelledby="inventory-table-heading" className="space-y-4">
        <h2 id="inventory-table-heading" className="sr-only">Inventory Stock Table</h2>

        {invLoading && <LoadingView message="Loading inventory records..." />}

        {invError && (
          <ErrorView
            error={invError}
            onRetry={reloadInv}
            title="Failed to load inventory stock levels"
          />
        )}

        {invData && !invLoading && (
          <>
            {invData.items.length === 0 ? (
              <EmptyView
                title="No inventory records found"
                message="No stock level records match the selected component and warehouse filters."
              />
            ) : (
              <div className="bg-surface border border-border-subtle rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border-subtle text-sm" data-testid="inventory-table">
                    <caption className="sr-only">Inventory stock levels per warehouse</caption>
                    <thead className="bg-elevated text-text-primary text-xs uppercase font-semibold">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left">Component</th>
                        <th scope="col" className="px-4 py-3 text-left">Warehouse</th>
                        <th scope="col" className="px-4 py-3 text-right">On Hand</th>
                        <th scope="col" className="px-4 py-3 text-right">Reserved</th>
                        <th scope="col" className="px-4 py-3 text-right">Usable (on hand − reserved)</th>
                        <th scope="col" className="px-4 py-3 text-left">Status Flag</th>
                        <th scope="col" className="px-4 py-3 text-left">As-Of (UTC)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle bg-surface">
                      {invData.items.map((row: InventoryItem) => {
                        const usable = row.on_hand - row.reserved;
                        const isDeficit = row.reserved > row.on_hand;
                        const isZeroUsable = usable === 0 && !isDeficit;

                        return (
                          <tr key={row.id} className="hover:bg-elevated/80 transition-colors">
                            <th scope="row" className="px-4 py-3 text-left font-medium text-text-primary">
                              <span className="font-mono font-semibold text-blue-700">{row.component_sku}</span>
                              <span className="text-xs text-text-secondary block">{row.component_name}</span>
                            </th>
                            <td className="px-4 py-3 text-text-primary">
                              <span className="font-semibold">{row.warehouse_code}</span>
                              <span className="text-xs text-text-secondary block">{row.warehouse_name}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-text-primary">
                              {formatInteger(row.on_hand)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-text-secondary">
                              {formatInteger(row.reserved)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-text-primary" data-testid={`usable-${row.id}`}>
                              {formatInteger(usable)}
                            </td>
                            <td className="px-4 py-3">
                              {isDeficit && (
                                <span
                                  data-testid={`flag-${row.id}`}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-900 border border-red-300"
                                >
                                  Reserved exceeds on hand
                                </span>
                              )}
                              {isZeroUsable && (
                                <span
                                  data-testid={`flag-${row.id}`}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300"
                                >
                                  No usable stock
                                </span>
                              )}
                              {!isDeficit && !isZeroUsable && (
                                <span className="text-xs text-emerald-700 font-medium">In Stock</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary font-mono">
                              {formatUtcTimestamp(row.as_of_ts)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  limit={limit}
                  offset={offset}
                  total={invData.total}
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

export default InventoryPage;
