interface PaginationProps {
  limit: number;
  offset: number;
  total: number;
  onOffsetChange: (newOffset: number) => void;
  onLimitChange: (newLimit: number) => void;
  limits?: number[];
  disabled?: boolean;
}

export function Pagination({
  limit,
  offset,
  total,
  onOffsetChange,
  onLimitChange,
  limits = [25, 50, 100],
  disabled = false,
}: PaginationProps) {
  if (total === 0) {
    return null;
  }

  const start = Math.min(offset + 1, total);
  const end = Math.min(offset + limit, total);
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <nav
      aria-label="Pagination Navigation"
      className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-2 border-t border-slate-200 text-xs text-slate-700"
    >
      <div className="flex items-center gap-3">
        <label htmlFor="pagination-limit" className="font-medium text-slate-600">
          Rows per page:
        </label>
        <select
          id="pagination-limit"
          value={limit}
          disabled={disabled}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="border border-slate-300 rounded px-2 py-1 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
        >
          {limits.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div
        className="font-medium text-slate-600"
        aria-live="polite"
        data-testid="pagination-range"
      >
        Showing <span className="font-semibold text-slate-900">{start}</span>–
        <span className="font-semibold text-slate-900">{end}</span> of{' '}
        <span className="font-semibold text-slate-900">{total}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          disabled={!hasPrevious || disabled}
          aria-label="Previous page"
          className="px-3 py-1.5 border border-slate-300 rounded font-medium bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onOffsetChange(offset + limit)}
          disabled={!hasNext || disabled}
          aria-label="Next page"
          className="px-3 py-1.5 border border-slate-300 rounded font-medium bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
