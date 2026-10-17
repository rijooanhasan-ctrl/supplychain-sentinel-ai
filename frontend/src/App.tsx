import { useEffect, useState } from 'react';
import { fetchHealth, type HealthResponse } from './api/client';

export function App() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    fetchHealth()
      .then((res) => {
        if (isMounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (isMounted) {
          setError(err.message || 'Backend is unreachable');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-8 flex flex-col items-center justify-start">
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <header className="border-b border-slate-200 pb-4 mb-5 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            SupplyChain Sentinel AI
          </h1>
          {data?.data_source === 'demo' && (
            <span
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300"
              data-testid="demo-badge"
            >
              DEMO DATA
            </span>
          )}
        </header>

        {loading && (
          <div className="py-8 text-center text-slate-500" data-testid="loading-state">
            <p>Connecting to backend service...</p>
          </div>
        )}

        {error && (
          <div
            className="p-4 rounded-md bg-red-50 border border-red-200 text-red-700"
            role="alert"
            data-testid="error-state"
          >
            <h2 className="font-semibold mb-1">Backend Connection Error</h2>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-4" data-testid="success-state">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              System Health & Status
            </h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm border border-slate-100 rounded p-4 bg-slate-50">
              <dt className="text-slate-500 font-medium">Status</dt>
              <dd className="text-slate-900 font-semibold">{data.status}</dd>

              <dt className="text-slate-500 font-medium">Application</dt>
              <dd className="text-slate-900">{data.app}</dd>

              <dt className="text-slate-500 font-medium">Version</dt>
              <dd className="text-slate-900">{data.version}</dd>

              <dt className="text-slate-500 font-medium">Environment</dt>
              <dd className="text-slate-900">{data.environment}</dd>

              <dt className="text-slate-500 font-medium">Data Source</dt>
              <dd className="text-slate-900 font-semibold">{data.data_source}</dd>

              <dt className="text-slate-500 font-medium">Server Time (UTC)</dt>
              <dd className="text-slate-700 text-xs break-all">{data.timestamp}</dd>
            </dl>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
