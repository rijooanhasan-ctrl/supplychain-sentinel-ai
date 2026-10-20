import { useMeta } from '../hooks/useMeta';

export function DemoBanner() {
  const { meta, loading, error, reload, isDemo, asOf } = useMeta();

  if (loading) {
    return (
      <div
        className="bg-surface border-b border-border-subtle px-4 py-1.5 text-xs text-text-secondary flex items-center justify-between"
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
        className="bg-amber-950/40 border-b border-amber-800/60 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-3"
        data-testid="banner-error"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-amber-100">Metadata Warning:</span>
          <span>Could not retrieve dataset details ({error.message}).</span>
        </div>
        <button
          type="button"
          onClick={reload}
          className="px-2.5 py-1 bg-elevated border border-amber-700/60 rounded font-medium text-amber-200 hover:bg-hover focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer"
        >
          Retry
        </button>
      </aside>
    );
  }

  const isUploaded = meta?.active_dataset === 'uploaded';

  if (!isDemo && !isUploaded && !meta?.seeded) {
    return null;
  }

  return (
    <aside
      aria-label="Environment Simulation Banner"
      className="bg-amber-950/30 border-b border-amber-800/40 px-4 py-2 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3"
      data-testid="demo-banner"
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <span
          data-testid="demo-badge"
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-900/60 text-amber-200 border border-amber-700/60"
        >
          {meta?.label || (isUploaded ? 'USER-SUPPLIED DATA (file import)' : 'DEMO DATA')}
        </span>
        <span className="font-medium text-amber-100/90">
          {isUploaded
            ? 'Uploaded dataset • Decision-support only (No live SAP connection)'
            : meta?.data_source === 'file-import'
            ? 'User-supplied CSV import • Decision-support only (No live SAP connection)'
            : 'Synthetic laptop supply chain simulation • Decision-support only (No live SAP connection)'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-amber-200 font-mono text-[11px]">
        <span>Snapshot As-Of:</span>
        <span className="font-semibold px-1.5 py-0.5 bg-amber-900/40 rounded border border-amber-700/60" data-testid="as-of-badge">
          {asOf}
        </span>
      </div>
    </aside>
  );
}
