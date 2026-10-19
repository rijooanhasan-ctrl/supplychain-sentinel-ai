import React from 'react';
import type { GlobeCoverage, GlobeResponse } from '../../api/types';

interface GlobeBottomStripProps {
  dataset: GlobeResponse['dataset'];
  as_of: string | null;
  coverage: GlobeCoverage;
  suppliers: GlobeResponse['suppliers'];
  warehouses: GlobeResponse['warehouses'];
}

export const GlobeBottomStrip: React.FC<GlobeBottomStripProps> = ({
  dataset,
  as_of,
  coverage,
  suppliers,
}) => {
  const isUploaded = dataset?.active_dataset === 'uploaded';
  const label = dataset?.label || (isUploaded ? 'UPLOADED DATA' : 'DEMO DATA');
  const genAt = dataset?.generated_at ? String(dataset.generated_at).replace('T', ' ').substring(0, 19) : '—';

  // Compute risk distribution
  const riskCounts = suppliers.reduce<Record<string, number>>((acc, s) => {
    const band = s.risk_band || 'unknown';
    acc[band] = (acc[band] || 0) + 1;
    return acc;
  }, {});

  return (
    <footer
      aria-label="Globe Data Source and Coverage Summary"
      className="bg-[#0b1329]/95 border-t border-slate-700/60 px-4 py-2.5 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-y-2 gap-x-4 shadow-xl z-20 shrink-0 backdrop-blur-md"
    >
      {/* Left: Lineage and Dataset Meta */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
            isUploaded
              ? 'bg-purple-950/80 text-purple-200 border-purple-500/50'
              : 'bg-amber-950/80 text-amber-200 border-amber-500/50'
          }`}
          data-testid="globe-dataset-badge"
        >
          {label}
        </span>
        <span className="text-slate-400 font-mono">
          Active: <strong className="text-slate-200 font-semibold">{isUploaded ? 'Uploaded' : 'Demo'}</strong>
        </span>
        {as_of && (
          <span className="text-slate-400 font-mono">
            As-of: <strong className="text-slate-200">{as_of}</strong>
          </span>
        )}
        <span className="text-slate-400 hidden sm:inline font-mono">
          Dataset generated at <strong className="text-slate-300">{genAt}</strong>
        </span>
      </div>

      {/* Center: Coverage metrics & Risk breakdown */}
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
        <div className="flex items-center gap-1.5" title="Suppliers with mapped geographic coordinates">
          <span className="text-slate-400 font-sans">Suppliers:</span>
          <span className="text-slate-200 font-bold">
            {coverage.suppliers_mapped}/{coverage.suppliers_total}
          </span>
          {coverage.approximate_count > 0 && (
            <span className="text-amber-400/90 text-[10px]">
              ({coverage.approximate_count} approx)
            </span>
          )}
          {coverage.suppliers_unresolved > 0 && (
            <span className="text-rose-400/90 text-[10px]">
              ({coverage.suppliers_unresolved} unmapped)
            </span>
          )}
        </div>

        <span className="text-slate-600 hidden md:inline">|</span>

        <div className="flex items-center gap-1.5" title="Warehouses with mapped coordinates">
          <span className="text-slate-400 font-sans">Warehouses:</span>
          <span className="text-slate-200 font-bold">
            {coverage.warehouses_mapped}/{coverage.warehouses_total}
          </span>
          {coverage.warehouses_unresolved > 0 && (
            <span className="text-rose-400/90 text-[10px]">
              ({coverage.warehouses_unresolved} unmapped)
            </span>
          )}
        </div>

        <span className="text-slate-600 hidden lg:inline">|</span>

        {/* Risk distribution pills */}
        <div className="hidden lg:flex items-center gap-1 text-[10px]">
          <span className="text-slate-400 font-sans mr-0.5">Risk:</span>
          <span className="px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800" title="Critical risk suppliers">
            {riskCounts.critical || 0} crit
          </span>
          <span className="px-1.5 py-0.2 rounded bg-orange-950 text-orange-300 border border-orange-800" title="High risk suppliers">
            {riskCounts.high || 0} high
          </span>
          <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800" title="Medium risk suppliers">
            {riskCounts.medium || 0} med
          </span>
          <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800" title="Low risk suppliers">
            {riskCounts.low || 0} low
          </span>
        </div>
      </div>

      {/* Right: Mandatory Disclaimer */}
      <div className="text-[11px] text-slate-400 italic font-sans flex items-center gap-1">
        <span>No live SAP connection. Routes are estimated, not shipment tracking.</span>
      </div>
    </footer>
  );
};
