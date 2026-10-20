import React, { useMemo, useState } from 'react';
import type { GlobeSupplier, GlobeWarehouse } from '../../api/types';
import { RISK_PALETTE } from '../../theme/riskPalette';

interface GlobeListFallbackProps {
  suppliers: GlobeSupplier[];
  warehouses: GlobeWarehouse[];
  onSelectEntity: (
    entity:
      | { type: 'supplier'; item: GlobeSupplier }
      | { type: 'warehouse'; item: GlobeWarehouse }
  ) => void;
  webGlUnavailable?: boolean;
}

export const GlobeListFallback: React.FC<GlobeListFallbackProps> = ({
  suppliers,
  warehouses,
  onSelectEntity,
  webGlUnavailable = false,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'supplier' | 'warehouse'>('all');
  const [sortField, setSortField] = useState<'code' | 'name' | 'precision' | 'open_po'>('code');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Combine entities into standard row items
  const combinedItems = useMemo(() => {
    const list: Array<{
      type: 'supplier' | 'warehouse';
      code: string;
      name: string;
      detailText: string;
      riskBand?: string;
      precision: string;
      coords: string;
      openPoCount: number;
      remainingQty: number;
      raw: GlobeSupplier | GlobeWarehouse;
    }> = [];

    suppliers.forEach((s) => {
      list.push({
        type: 'supplier',
        code: s.code,
        name: s.name,
        detailText: `Country: ${s.country}`,
        riskBand: s.risk_band,
        precision: s.location?.precision || 'unresolved',
        coords: s.location?.lat != null ? `${s.location.lat.toFixed(2)}, ${s.location.lon?.toFixed(2)}` : '—',
        openPoCount: s.open_po_count,
        remainingQty: s.remaining_qty,
        raw: s,
      });
    });

    warehouses.forEach((w) => {
      list.push({
        type: 'warehouse',
        code: w.code,
        name: w.name,
        detailText: `Role: ${w.role}`,
        precision: w.location?.precision || 'unresolved',
        coords: w.location?.lat != null ? `${w.location.lat.toFixed(2)}, ${w.location.lon?.toFixed(2)}` : '—',
        openPoCount: 0,
        remainingQty: 0,
        raw: w,
      });
    });

    return list;
  }, [suppliers, warehouses]);

  // Filter & sort
  const filteredItems = useMemo(() => {
    let result = combinedItems;
    if (filterType !== 'all') {
      result = result.filter((i) => i.type === filterType);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (i) => i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'code') cmp = a.code.localeCompare(b.code);
      else if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'precision') cmp = a.precision.localeCompare(b.precision);
      else if (sortField === 'open_po') cmp = a.openPoCount - b.openPoCount;
      return sortAsc ? cmp : -cmp;
    });

    return result;
  }, [combinedItems, filterType, searchTerm, sortField, sortAsc]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div className="flex-1 bg-[#070b14] p-4 md:p-6 overflow-y-auto space-y-4 text-slate-100">
      {/* Alert if WebGL is unavailable */}
      {webGlUnavailable && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-amber-950/80 border border-amber-500/60 text-amber-200 text-xs md:text-sm flex items-start gap-3 shadow-lg"
        >
          <span className="text-xl shrink-0" aria-hidden="true">&#9888;</span>
          <div className="space-y-1">
            <strong className="font-bold text-amber-100 block">
              WebGL Hardware Acceleration is Unavailable
            </strong>
            <p className="leading-relaxed">
              3D globe rendering is disabled because your browser or environment cannot create a WebGL context. Full supply chain data, coordinates, and risk assessments are presented below in tabular format.
            </p>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/80 border border-slate-800 rounded-lg">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search code or name..."
            aria-label="Filter entities in locations list"
            className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100 placeholder:text-text-secondary focus:outline-hidden focus:border-cyan-400"
          />

          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded font-medium ${
                filterType === 'all'
                  ? 'bg-cyan-950 text-cyan-200 border border-cyan-600'
                  : 'bg-slate-800 text-text-muted hover:text-white'
              }`}
            >
              All ({combinedItems.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('supplier')}
              className={`px-2.5 py-1 rounded font-medium ${
                filterType === 'supplier'
                  ? 'bg-cyan-950 text-cyan-200 border border-cyan-600'
                  : 'bg-slate-800 text-text-muted hover:text-white'
              }`}
            >
              Suppliers ({suppliers.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('warehouse')}
              className={`px-2.5 py-1 rounded font-medium ${
                filterType === 'warehouse'
                  ? 'bg-cyan-950 text-cyan-200 border border-cyan-600'
                  : 'bg-slate-800 text-text-muted hover:text-white'
              }`}
            >
              Warehouses ({warehouses.length})
            </button>
          </div>
        </div>

        {/* Aria live announcement */}
        <div aria-live="polite" className="text-xs text-text-muted font-mono">
          Showing {filteredItems.length} of {combinedItems.length} locations
        </div>
      </div>

      {/* Table */}
      <div className="border border-slate-800 rounded-lg overflow-x-auto bg-slate-900/60 shadow-xl">
        <table className="min-w-full divide-y divide-slate-800 text-xs" data-testid="globe-fallback-table">
          <thead className="bg-slate-950/80 text-text-muted font-semibold uppercase text-[11px]">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Type</th>
              <th scope="col" className="px-4 py-3 text-left cursor-pointer hover:text-white" onClick={() => handleSort('code')}>
                Code {sortField === 'code' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th scope="col" className="px-4 py-3 text-left cursor-pointer hover:text-white" onClick={() => handleSort('name')}>
                Name {sortField === 'name' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th scope="col" className="px-4 py-3 text-left">Attributes</th>
              <th scope="col" className="px-4 py-3 text-left cursor-pointer hover:text-white" onClick={() => handleSort('precision')}>
                Precision {sortField === 'precision' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th scope="col" className="px-4 py-3 text-left">Coordinates (Lat, Lon)</th>
              <th scope="col" className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('open_po')}>
                Open POs {sortField === 'open_po' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th scope="col" className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredItems.map((item) => (
              <tr key={`${item.type}-${item.code}`} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono border ${
                    item.type === 'supplier'
                      ? 'bg-blue-950 text-blue-300 border-blue-800'
                      : 'bg-indigo-950 text-indigo-300 border-indigo-800'
                  }`}>
                    {item.type}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono font-bold text-white">{item.code}</td>
                <td className="px-4 py-2.5 text-slate-200 font-medium">{item.name}</td>
                <td className="px-4 py-2.5 text-text-muted">
                  {item.detailText}
                  {item.riskBand && (
                    <span
                      className="ml-2 font-bold uppercase text-[10px]"
                      style={{ color: RISK_PALETTE[item.riskBand as keyof typeof RISK_PALETTE]?.fillColor || '#94a3b8' }}
                    >
                      [{item.riskBand}]
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] font-mono px-1.5 py-0.2 rounded border ${
                    item.precision === 'exact'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : item.precision === 'manual'
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                      : item.precision === 'country_centroid'
                      ? 'bg-amber-950 text-amber-300 border-amber-800'
                      : 'bg-rose-950 text-rose-300 border-rose-800'
                  }`}>
                    {item.precision}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300">{item.coords}</td>
                <td className="px-4 py-2.5 text-right font-mono text-slate-200">
                  {item.openPoCount > 0 ? `${item.openPoCount} POs (${item.remainingQty} units)` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onSelectEntity(item.type === 'supplier' ? { type: 'supplier', item: item.raw as GlobeSupplier } : { type: 'warehouse', item: item.raw as GlobeWarehouse })}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-semibold"
                  >
                    Inspect &rarr;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
