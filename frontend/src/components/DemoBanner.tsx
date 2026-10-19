import { useMeta } from '../hooks/useMeta';

export function DemoBanner() {
  const { meta, loading, error, reload, isDemo, asOf } = useMeta();

  if (loading) {
    return (
      <div
        className="bg-slate-100 border-b border-slate-200 px-4 py-1.5 text-xs text-slate-500 flex items-center justify-between"
        aria-live="polite"
      >
        <span>Checking environment metadata...</span>
      </div>
    );
  }

  if (error) {
    return (
      <aside
        role="alert"
        aria-label="Metadata service connection warning"
        className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-center justify-between gap-3"
        data-testid="banner-error"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-amber-950">Metadata Warning:</span>
          <span>Could not retrieve dataset details ({error.message}).</span>
        </div>
        <button
          type="button"
          onClick={reload}
          className="px-2.5 py-1 bg-white border border-amber-300 rounded font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
        >
          Retry
        </button>
      </aside>
    );
  }

  if (!isDemo && !meta?.seeded) {
    return null;
  }

  return (
    <aside
      aria-label="Environment Simulation Banner"
      className="bg-amber-500/10 border-b border-amber-300/60 px-4 py-2 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3"
      data-testid="demo-banner"
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <span
          data-testid="demo-badge"
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-200 text-amber-900 border border-amber-400"
        >
          {meta?.label || 'DEMO DATA'}
        </span>
        <span className="font-medium">
          {meta?.data_source === 'file-import'
            ? 'User-supplied CSV import • Decision-support only (No live SAP connection)'
            : 'Synthetic laptop supply chain simulation • Decision-support only (No live SAP connection)'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-amber-900 font-mono text-[11px]">
        <span>Snapshot As-Of:</span>
        <span className="font-semibold px-1.5 py-0.5 bg-amber-100/80 rounded border border-amber-200" data-testid="as-of-badge">
          {asOf}
        </span>
      </div>
    </aside>
  );
}
