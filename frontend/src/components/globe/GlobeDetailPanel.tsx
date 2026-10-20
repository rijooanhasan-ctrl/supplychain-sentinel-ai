import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSupplierRiskDetail, getInventoryRisk } from '../../api/endpoints';
import type {
  GlobeConcentration,
  GlobeSupplier,
  GlobeWarehouse,
  InventoryRiskItem,
  SupplierRiskDetailResponse,
} from '../../api/types';
import { RISK_PALETTE } from '../../theme/riskPalette';

export type SelectedEntity =
  | { type: 'supplier'; item: GlobeSupplier }
  | { type: 'warehouse'; item: GlobeWarehouse }
  | { type: 'country'; item: GlobeConcentration };

interface GlobeDetailPanelProps {
  entity: SelectedEntity | null;
  onClose: () => void;
  onSetLocation: (type: 'supplier' | 'warehouse', code: string, name: string) => void;
}

export const GlobeDetailPanel: React.FC<GlobeDetailPanelProps> = ({
  entity,
  onClose,
  onSetLocation,
}) => {
  const [supplierDetail, setSupplierDetail] = useState<SupplierRiskDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [impactedComps, setImpactedComps] = useState<InventoryRiskItem[]>([]);

  // Fetch supplier risk detail and inventory impact when a supplier is selected
  useEffect(() => {
    if (!entity || entity.type !== 'supplier') {
      return;
    }

    const abortCtrl = new AbortController();
    const supp = entity.item;

    async function loadData() {
      setLoadingDetail(true);
      setDetailError(null);
      try {
        // 1. Fetch supplier risk detail
        const [detRes, invRes] = await Promise.allSettled([
          getSupplierRiskDetail(supp.id, abortCtrl.signal),
          getInventoryRisk({ limit: 100 }, abortCtrl.signal),
        ]);

        if (detRes.status === 'fulfilled') {
          setSupplierDetail(detRes.value);
        } else if (!abortCtrl.signal.aborted) {
          setDetailError('Failed to load in-depth supplier evaluation.');
        }

        if (invRes.status === 'fulfilled') {
          const suppSkus = new Set(supp.components.map((c) => c.sku));
          const matched = invRes.value.items.filter(
            (item) => suppSkus.has(item.sku) && (item.risk_level === 'critical' || item.risk_level === 'high' || item.days_until_shortage !== null)
          );
          setImpactedComps(matched);
        }
      } catch {
        if (!abortCtrl.signal.aborted) {
          setDetailError('Error loading supplier detail metrics.');
        }
      } finally {
        if (!abortCtrl.signal.aborted) {
          setLoadingDetail(false);
        }
      }
    }

    loadData();
    return () => abortCtrl.abort();
  }, [entity]);

  if (!entity) return null;

  return (
    <aside
      aria-label="Entity Detail Inspection Panel"
      className="w-80 md:w-96 bg-[#0c152b]/95 border-l border-slate-700/60 p-4 text-slate-100 flex flex-col justify-between overflow-y-auto z-30 shadow-2xl backdrop-blur-md"
    >
      <div className="space-y-4">
        {/* Panel Header */}
        <div className="flex items-start justify-between border-b border-slate-700/60 pb-3">
          <div className="space-y-0.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400">
              {entity.type === 'supplier'
                ? 'Supplier Entity'
                : entity.type === 'warehouse'
                ? 'Warehouse Node'
                : 'Country Concentration'}
            </span>
            <h2 className="text-base font-bold text-white tracking-tight break-words">
              {entity.type === 'country' ? entity.item.country_name : entity.item.name}
            </h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-text-muted font-semibold">
                {entity.type === 'country' ? entity.item.country_code : entity.item.code}
              </span>
              {entity.type === 'supplier' && (
                <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {entity.item.country}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-white p-1 rounded hover:bg-slate-800/60 transition-colors"
            aria-label="Close detail panel"
          >
            &times;
          </button>
        </div>

        {/* ----------------- SUPPLIER CONTENT ----------------- */}
        {entity.type === 'supplier' && (
          <div className="space-y-4 text-xs">
            {/* Risk Badge and Score */}
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-text-muted block text-[11px]">Assessed Risk Band</span>
                <span
                  className="font-bold text-sm uppercase tracking-wide inline-block mt-0.5"
                  style={{ color: RISK_PALETTE[entity.item.risk_band]?.fillColor || '#94a3b8' }}
                >
                  {entity.item.risk_band} ({entity.item.risk_score} / 100)
                </span>
              </div>
              <div className="text-right">
                <span className="text-text-muted block text-[11px]">On-Time Rate</span>
                <span className="font-mono font-bold text-slate-100 text-sm">
                  {(entity.item.on_time_rate * 100).toFixed(1)}%
                </span>
                <span className="text-[10px] text-text-muted block">
                  {entity.item.n_deliveries} deliveries ({entity.item.confidence} conf)
                </span>
              </div>
            </div>

            {/* Geographic Location & Precision */}
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Geographic Location</span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {entity.item.location?.precision || 'unresolved'}
                </span>
              </div>
              <p className="text-text-muted text-[11px]">
                {entity.item.location?.source || 'No coordinate mapping available'}
              </p>
              {entity.item.location?.lat != null && (
                <div className="font-mono text-[11px] text-slate-300">
                  Lat: {entity.item.location.lat.toFixed(4)}, Lon: {entity.item.location.lon?.toFixed(4)}
                </div>
              )}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onSetLocation('supplier', entity.item.code, entity.item.name)}
                  className="text-cyan-400 hover:text-cyan-300 underline text-[11px] font-medium"
                >
                  Edit / Correct Coordinates &rarr;
                </button>
              </div>
            </div>

            {/* In-depth formula explanation */}
            {loadingDetail && (
              <div className="text-text-muted italic text-[11px]">Loading evaluation notes...</div>
            )}
            {detailError && (
              <div className="text-rose-400 text-[11px]">{detailError}</div>
            )}
            {supplierDetail && (
              <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-1">
                <span className="font-semibold text-slate-300 block text-[11px]">Assessment Logic</span>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  {supplierDetail.explanation}
                </p>
              </div>
            )}

            {/* Open PO Pipeline */}
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-1.5">
              <span className="font-semibold text-slate-300 block">Open Pipeline</span>
              <div className="flex justify-between text-slate-300">
                <span>Active Orders:</span>
                <span className="font-mono font-bold text-white">{entity.item.open_po_count}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Remaining Quantity:</span>
                <span className="font-mono text-white">{entity.item.remaining_qty.toLocaleString()} units</span>
              </div>
              {(entity.item.overdue_po_count > 0 || entity.item.slipped_po_count > 0) && (
                <div className="text-[11px] text-amber-300 font-semibold pt-1">
                  Alerts: {entity.item.overdue_po_count} overdue, {entity.item.slipped_po_count} slipped delivery
                </div>
              )}
            </div>

            {/* Potential Inventory Shortage Impact */}
            {impactedComps.length > 0 && (
              <div className="p-3 bg-rose-950/40 rounded-lg border border-rose-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-rose-300">Potential Inventory Impact</span>
                  <span className="text-[10px] text-rose-400 font-mono">
                    {impactedComps.length} component(s)
                  </span>
                </div>
                <ul className="space-y-1.5 divide-y divide-rose-900/40">
                  {impactedComps.map((comp) => (
                    <li key={comp.component_id} className="pt-1.5 first:pt-0 space-y-0.5">
                      <div className="flex items-center justify-between font-mono font-bold text-white">
                        <span>{comp.sku}</span>
                        <span className="text-xs uppercase text-rose-400">{comp.risk_level}</span>
                      </div>
                      <div className="text-[11px] text-slate-300">
                        Shortage: {comp.shortage_date || 'Projected soon'} ({comp.days_until_shortage != null ? `${comp.days_until_shortage} days` : '0 days'})
                      </div>
                      <div className="flex gap-2 pt-0.5 text-[11px]">
                        <Link
                          to={`/simulator?component_id=${comp.component_id}`}
                          className="text-cyan-400 hover:text-cyan-300 underline font-semibold"
                        >
                          Simulate &rarr;
                        </Link>
                        <Link
                          to="/recommendations"
                          className="text-slate-300 hover:text-white underline"
                        >
                          Action Options
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Supplied Components (Offers) */}
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-1.5">
              <span className="font-semibold text-slate-300 block">
                Supplied Components ({entity.item.components.length})
              </span>
              <div className="flex flex-wrap gap-1">
                {entity.item.components.map((c) => (
                  <span
                    key={c.sku}
                    className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]"
                    title={c.name}
                  >
                    {c.sku}
                  </span>
                ))}
              </div>
            </div>

            {/* Quick Links */}
            <div className="pt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
              <Link
                to="/suppliers"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              >
                Suppliers Table
              </Link>
              <Link
                to="/supplier-risk"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              >
                Supplier Risk Details
              </Link>
              <Link
                to="/purchase-orders"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              >
                Purchase Orders
              </Link>
            </div>
          </div>
        )}

        {/* ----------------- WAREHOUSE CONTENT ----------------- */}
        {entity.type === 'warehouse' && (
          <div className="space-y-4 text-xs">
            {/* Role & Coordinates */}
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Warehouse Role</span>
                <span className="font-mono uppercase font-bold text-cyan-300 px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800">
                  {entity.item.role}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-text-muted">Location Source</span>
                <span className="text-slate-300 font-mono text-[11px]">
                  {entity.item.location?.precision || 'unresolved'}
                </span>
              </div>
              <p className="text-text-muted text-[11px] leading-relaxed">
                {entity.item.location?.source || 'No location configured. Add coordinates to place on map.'}
              </p>
              {entity.item.location?.lat != null && (
                <div className="font-mono text-[11px] text-slate-300">
                  Lat: {entity.item.location.lat.toFixed(4)}, Lon: {entity.item.location.lon?.toFixed(4)}
                </div>
              )}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onSetLocation('warehouse', entity.item.code, entity.item.name)}
                  className="text-cyan-400 hover:text-cyan-300 underline text-[11px] font-medium"
                >
                  Edit / Set Location &rarr;
                </button>
              </div>
            </div>

            {/* Inventory Summary */}
            {entity.item.inventory_summary && (
              <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-2">
                <span className="font-semibold text-slate-300 block">Inventory Position</span>
                <div className="flex justify-between">
                  <span className="text-text-muted">Total Stock On-Hand:</span>
                  <span className="font-mono font-bold text-white">
                    {(entity.item.inventory_summary.total_on_hand ?? 0).toLocaleString()} units
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">SKUs Stocked:</span>
                  <span className="font-mono text-white">
                    {entity.item.inventory_summary.components_held ?? 0}
                  </span>
                </div>
                {(entity.item.inventory_summary.zero_usable_components_count ?? 0) > 0 && (
                  <div className="p-2 rounded bg-amber-950/60 border border-amber-800 text-amber-200 text-[11px]">
                    {entity.item.inventory_summary.zero_usable_components_count} stocked component(s) currently have 0 usable stock.
                  </div>
                )}
              </div>
            )}

            {/* Link to Inventory Page */}
            <div className="pt-2">
              <Link
                to="/inventory"
                className="inline-block px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold"
              >
                View Warehouse Inventory &rarr;
              </Link>
            </div>
          </div>
        )}

        {/* ----------------- COUNTRY CONCENTRATION CONTENT ----------------- */}
        {entity.type === 'country' && (
          <div className="space-y-4 text-xs">
            {/* Concentration Flag Notice */}
            <div
              className={`p-3 rounded-lg border space-y-1.5 ${
                entity.item.flagged
                  ? 'bg-amber-950/80 border-amber-600 text-amber-200'
                  : 'bg-slate-900/80 border-slate-700 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between font-bold">
                <span>Concentration Status</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${
                    entity.item.flagged
                      ? 'bg-amber-900 text-amber-100 border-amber-400'
                      : 'bg-slate-800 text-slate-300 border-slate-600'
                  }`}
                >
                  {entity.item.flagged ? 'Flagged Concentration' : 'Balanced'}
                </span>
              </div>
              {entity.item.reason && (
                <p className="text-[11px] leading-relaxed pt-1 text-amber-100/90 font-medium">
                  {entity.item.reason}
                </p>
              )}
            </div>

            {/* Mandatory Static Lineage Notice */}
            <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 text-[11px] text-text-muted italic leading-normal">
              Calculated from loaded supplier data; not a live disruption feed.
            </div>

            {/* Metrics */}
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-2">
              <div className="flex justify-between">
                <span className="text-text-muted">Supplier Count:</span>
                <span className="font-mono font-bold text-white">{entity.item.supplier_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Open Purchase Orders:</span>
                <span className="font-mono font-bold text-white">{entity.item.open_po_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Remaining Units:</span>
                <span className="font-mono text-white">
                  {entity.item.remaining_qty.toLocaleString()} units
                </span>
              </div>
            </div>

            {/* Risk Distribution in this country */}
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-1.5">
              <span className="font-semibold text-slate-300 block">Risk Distribution</span>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="p-1.5 rounded bg-slate-800/80 flex justify-between">
                  <span className="text-rose-400">Critical:</span>
                  <span className="font-mono font-bold">{entity.item.risk_distribution.critical || 0}</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/80 flex justify-between">
                  <span className="text-orange-400">High:</span>
                  <span className="font-mono font-bold">{entity.item.risk_distribution.high || 0}</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/80 flex justify-between">
                  <span className="text-amber-400">Medium:</span>
                  <span className="font-mono font-bold">{entity.item.risk_distribution.medium || 0}</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/80 flex justify-between">
                  <span className="text-emerald-400">Low:</span>
                  <span className="font-mono font-bold">{entity.item.risk_distribution.low || 0}</span>
                </div>
              </div>
            </div>

            {/* Single country sourced components */}
            {entity.item.single_country_components.length > 0 && (
              <div className="p-3 bg-amber-950/40 rounded-lg border border-amber-800/60 space-y-1.5">
                <span className="font-bold text-amber-300 block">
                  Exclusively Sourced Components ({entity.item.single_country_components.length})
                </span>
                <p className="text-[11px] text-amber-200/80">
                  100% of vendor offers for these items originate from {entity.item.country_name}:
                </p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {entity.item.single_country_components.map((sku) => (
                    <span
                      key={sku}
                      className="px-2 py-0.5 rounded bg-amber-900/70 border border-amber-700 text-amber-200 font-mono text-[10px]"
                    >
                      {sku}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer close */}
      <div className="pt-4 border-t border-slate-700/60 mt-4">
        <button
          type="button"
          onClick={onClose}
          className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors"
        >
          Close Inspection
        </button>
      </div>
    </aside>
  );
};
