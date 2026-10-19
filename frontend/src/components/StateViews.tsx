import type { ReactNode } from 'react';
import { ApiError, NetworkError } from '../api/http';

export function LoadingView({
  message = 'Loading data...',
  testId = 'loading-state',
}: {
  message?: string;
  testId?: string;
}) {
  return (
    <div
      className="p-8 text-center text-slate-500 space-y-3"
      aria-live="polite"
      aria-busy="true"
      data-testid={testId}
    >
      <div className="inline-block w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" aria-hidden="true" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

export function ErrorView({
  error,
  onRetry,
  title = 'Failed to load data',
  testId = 'error-state',
}: {
  error: Error | null;
  onRetry?: () => void;
  title?: string;
  testId?: string;
}) {
  let errorType = 'Request Error';
  let message = error?.message || 'An unexpected error occurred.';

  if (error instanceof NetworkError) {
    errorType = 'Network Error';
  } else if (error instanceof ApiError) {
    errorType = `HTTP ${error.status} Error`;
  }

  return (
    <div
      role="alert"
      className="p-5 rounded-lg bg-red-50 border border-red-200 text-red-900 space-y-3"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <span className="text-xs text-red-700 font-medium">{errorType}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 bg-white border border-red-300 rounded text-xs font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 cursor-pointer transition-colors"
          >
            Retry
          </button>
        )}
      </div>
      <p className="text-xs text-red-800 break-words">{message}</p>
    </div>
  );
}

export function EmptyView({
  title = 'No records found',
  message = 'Try adjusting your filters or search terms.',
  icon,
  testId = 'empty-state',
}: {
  title?: string;
  message?: string;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="p-10 text-center text-slate-500 bg-white border border-slate-200 rounded-lg space-y-2"
      data-testid={testId}
    >
      {icon && <div className="mb-2 flex justify-center">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm mx-auto">{message}</p>
    </div>
  );
}

export function UnseededView({
  message = 'Database contains no data. Seed data or import CSV files first.',
  onRefresh,
  testId = 'unseeded-state',
}: {
  message?: string | null;
  onRefresh?: () => void;
  testId?: string;
}) {
  return (
    <div
      aria-labelledby="unseeded-title"
      className="bg-amber-50 border border-amber-200 rounded-lg p-6 space-y-4 text-amber-900 shadow-xs"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="unseeded-title" className="text-base font-semibold text-amber-950">
          Database Unseeded
        </h3>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1 bg-white border border-amber-300 rounded text-xs font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            Refresh Status
          </button>
        )}
      </div>
      <p className="text-sm text-amber-800">
        {message || 'Database contains no data. Please run seed command.'}
      </p>
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-amber-950">
          Run the following seed command from the backend folder:
        </p>
        <pre className="bg-slate-900 text-amber-200 p-3 rounded font-mono text-xs overflow-x-auto">
          <code>python -m app.cli seed</code>
        </pre>
      </div>
    </div>
  );
}
