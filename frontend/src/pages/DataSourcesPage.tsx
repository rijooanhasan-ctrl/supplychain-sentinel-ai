import { useCallback } from 'react';
import { getHealth, getMeta } from '../api/endpoints';
import { ApiError, NetworkError } from '../api/http';
import { useApi } from '../api/useApi';

const ENTITY_LABELS: Record<string, string> = {
  warehouses: 'Warehouses',
  products: 'Products',
  components: 'Components',
  bom_lines: 'Bill of Materials (BOM) Lines',
  suppliers: 'Suppliers',
  supplier_components: 'Supplier Component Offers',
  inventory_levels: 'Inventory Levels',
  purchase_orders: 'Purchase Orders',
  purchase_order_lines: 'Purchase Order Lines',
  customer_orders: 'Customer Orders',
  demand_records: 'Daily Demand Records',
  delivery_records: 'Historical Delivery Records',
};

function formatEntityName(key: string): string {
  return (
    ENTITY_LABELS[key] ||
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function formatUtcTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm} UTC`;
  } catch {
    return isoString;
  }
}

function renderErrorMessage(err: Error): { type: string; message: string } {
  if (err instanceof NetworkError) {
    return {
      type: 'Network Error',
      message: err.message,
    };
  }
  if (err instanceof ApiError) {
    return {
      type: `HTTP ${err.status} Error`,
      message: err.message,
    };
  }
  return {
    type: 'Request Error',
    message: err.message || 'An unexpected error occurred.',
  };
}

export function DataSourcesPage() {
  const fetchHealthFn = useCallback((signal: AbortSignal) => getHealth(signal), []);
  const fetchMetaFn = useCallback((signal: AbortSignal) => getMeta(signal), []);

  const healthApi = useApi(fetchHealthFn, [fetchHealthFn]);
  const metaApi = useApi(fetchMetaFn, [fetchMetaFn]);

  const isDemo =
    metaApi.data?.data_source === 'demo' ||
    healthApi.data?.data_source === 'demo' ||
    Boolean(metaApi.data?.label && metaApi.data.label.toLowerCase().includes('demo'));

  return (
    <div className="space-y-6" data-testid="data-sources-page">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Data Sources &amp; Integration Status
            </h1>
            {isDemo && (
              <span
                data-testid="demo-badge"
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300"
              >
                DEMO DATA
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">
            System health, active connector metadata, and verified dataset counts.
          </p>
        </div>
      </div>

      {/* Section 1: Backend Health */}
      <section
        aria-labelledby="health-heading"
        className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <h2 id="health-heading" className="text-base font-semibold text-slate-900">
            1. Backend Health
          </h2>
          {healthApi.data && (
            <span className="inline-flex items-center text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" aria-hidden="true" />
              Status: {healthApi.data.status.toUpperCase()}
            </span>
          )}
        </div>

        {healthApi.loading && (
          <div
            className="py-6 text-center text-slate-500 text-sm"
            aria-live="polite"
            aria-busy="true"
            data-testid="health-loading"
          >
            Checking backend health...
          </div>
        )}

        {healthApi.error && (
          <div
            role="alert"
            className="p-4 rounded-md bg-red-50 border border-red-200 text-red-800 space-y-2"
            data-testid="health-error"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">
                {renderErrorMessage(healthApi.error).type}
              </span>
              <button
                type="button"
                onClick={healthApi.reload}
                className="px-3 py-1 bg-white border border-red-300 rounded text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 cursor-pointer"
              >
                Retry Health
              </button>
            </div>
            <p className="text-xs text-red-700">{healthApi.error.message}</p>
          </div>
        )}

        {healthApi.data && !healthApi.loading && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm" data-testid="health-data">
            <div className="p-3 bg-slate-50 rounded border border-slate-100">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Application</dt>
              <dd className="mt-1 font-medium text-slate-900">{healthApi.data.app}</dd>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-100">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Version</dt>
              <dd className="mt-1 font-medium text-slate-900" data-testid="health-version">{healthApi.data.version}</dd>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-100">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Environment</dt>
              <dd className="mt-1 font-medium text-slate-900">{healthApi.data.environment}</dd>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-100">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Data Source</dt>
              <dd className="mt-1 font-medium text-slate-900">{healthApi.data.data_source}</dd>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-100 sm:col-span-2">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Server Timestamp</dt>
              <dd className="mt-1 font-medium text-slate-900">
                {formatUtcTimestamp(healthApi.data.timestamp)}
                <span className="text-xs text-slate-500 ml-2 font-mono">({healthApi.data.timestamp})</span>
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* Sections 2, 3, 4: Dataset, Integration, and Record Counts */}
      {metaApi.loading && (
        <section className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500 shadow-xs" aria-live="polite" aria-busy="true" data-testid="meta-loading">
          <p className="text-sm">Loading dataset metadata and integration status...</p>
        </section>
      )}

      {metaApi.error && (
        <section
          role="alert"
          className="p-5 rounded-lg bg-red-50 border border-red-200 text-red-800 space-y-3 shadow-xs"
          data-testid="meta-error"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">
              Dataset Metadata Error: {renderErrorMessage(metaApi.error).type}
            </h2>
            <button
              type="button"
              onClick={metaApi.reload}
              className="px-3 py-1.5 bg-white border border-red-300 rounded text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 cursor-pointer"
            >
              Retry Dataset Load
            </button>
          </div>
          <p className="text-xs text-red-700">{metaApi.error.message}</p>
        </section>
      )}

      {metaApi.data && !metaApi.loading && (
        <>
          {/* Unseeded State */}
          {!metaApi.data.seeded ? (
            <section
              aria-labelledby="unseeded-heading"
              className="bg-amber-50 border border-amber-200 rounded-lg p-6 shadow-xs space-y-4"
              data-testid="unseeded-state"
            >
              <div className="flex items-center justify-between">
                <h2 id="unseeded-heading" className="text-base font-semibold text-amber-900">
                  Database Unseeded
                </h2>
                <button
                  type="button"
                  onClick={metaApi.reload}
                  className="px-3 py-1 bg-white border border-amber-300 rounded text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 cursor-pointer"
                >
                  Refresh Status
                </button>
              </div>
              <p className="text-sm text-amber-800">
                {metaApi.data.message || 'Database is not seeded. Synthetic data must be populated.'}
              </p>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-amber-900">Run the following command from the backend directory:</p>
                <pre className="bg-slate-900 text-amber-200 p-3 rounded font-mono text-xs overflow-x-auto">
                  <code>python -m app.cli seed</code>
                </pre>
              </div>
            </section>
          ) : (
            <>
              {/* Section 2: Dataset Metadata */}
              <section
                aria-labelledby="dataset-heading"
                className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs"
              >
                <h2 id="dataset-heading" className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3 mb-4">
                  2. Dataset Metadata
                </h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm" data-testid="dataset-meta">
                  <div className="p-3 bg-slate-50 rounded border border-slate-100">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Dataset Label</dt>
                    <dd className="mt-1 font-medium text-slate-900">{metaApi.data.label || '—'}</dd>
                  </div>
                  <div className="p-3 bg-slate-50 rounded border border-slate-100">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Source</dt>
                    <dd className="mt-1 font-medium text-slate-900">{metaApi.data.data_source}</dd>
                  </div>
                  <div className="p-3 bg-slate-50 rounded border border-slate-100">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Seed Value</dt>
                    <dd className="mt-1 font-medium text-slate-900">{metaApi.data.seed !== null ? metaApi.data.seed : '—'}</dd>
                  </div>
                  <div className="p-3 bg-slate-50 rounded border border-slate-100">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">As-Of Date</dt>
                    <dd className="mt-1 font-medium text-slate-900">{metaApi.data.as_of || '—'}</dd>
                  </div>
                  <div className="p-3 bg-slate-50 rounded border border-slate-100">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Generator Version</dt>
                    <dd className="mt-1 font-medium text-slate-900">{metaApi.data.generator_version || '—'}</dd>
                  </div>
                  <div className="p-3 bg-slate-50 rounded border border-slate-100">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Generated At</dt>
                    <dd className="mt-1 font-medium text-slate-900">
                      {formatUtcTimestamp(metaApi.data.generated_at)}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Section 3: Integration Status */}
              <section
                aria-labelledby="integration-heading"
                className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs"
              >
                <h2 id="integration-heading" className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3 mb-4">
                  3. Integration Status
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm divide-y divide-slate-200 border border-slate-200 rounded">
                    <caption className="sr-only">Integration status and connector details</caption>
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wider w-1/3">
                          Integration Target
                        </th>
                        <th scope="col" className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">
                          Status &amp; Configuration
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      <tr>
                        <th scope="row" className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                          Data source
                        </th>
                        <td className="px-4 py-3 text-slate-700">
                          {metaApi.data.data_source === 'demo' ? (
                            <span className="inline-flex items-center text-amber-800 bg-amber-50 px-2 py-0.5 rounded text-xs font-medium border border-amber-200">
                              Demo connector — synthetic data, not a live SAP integration
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-xs font-medium">
                              {metaApi.data.data_source} (unverified integration)
                            </span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                          SAP connection
                        </th>
                        <td className="px-4 py-3 text-slate-700">
                          {metaApi.data.data_source === 'demo' ? (
                            <span className="text-slate-600 text-xs">
                              SAP connection: not configured
                            </span>
                          ) : (
                            <span className="text-amber-700 text-xs font-medium">
                              SAP connection: unverified integration
                            </span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Section 4: Record Counts */}
              <section
                aria-labelledby="counts-heading"
                className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs"
              >
                <h2 id="counts-heading" className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3 mb-4">
                  4. Record Counts
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm divide-y divide-slate-200 border border-slate-200 rounded" data-testid="record-counts-table">
                    <caption className="text-xs text-slate-500 py-2 px-1 text-left">
                      Total entities currently loaded into the decision-support database.
                    </caption>
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">
                          Entity Name
                        </th>
                        <th scope="col" className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-right">
                          Record Count
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {Object.entries(metaApi.data.counts).map(([key, count]) => (
                        <tr key={key} className="hover:bg-slate-50 transition-colors">
                          <th scope="row" className="px-4 py-2.5 font-medium text-slate-900">
                            {formatEntityName(key)}
                          </th>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                            {count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default DataSourcesPage;
