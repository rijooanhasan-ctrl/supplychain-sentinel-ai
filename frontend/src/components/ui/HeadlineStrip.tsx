import React from 'react';
import { Link } from 'react-router-dom';
import { useGuidedDemo } from '../../hooks/useGuidedDemo';
import { formatDate } from '../../lib/format';

export interface HeadlineStripProps {
  headline?: string | null;
  datasetLabel?: string | null;
  asOf?: string | null;
  loading?: boolean;
  mostSevereSku?: string | null;
  soonestSku?: string | null;
}

export const HeadlineStrip: React.FC<HeadlineStripProps> = ({
  headline,
  datasetLabel = 'DEMO DATA',
  asOf = '2026-10-17',
  loading = false,
  mostSevereSku,
  soonestSku,
}) => {
  const { startDemo } = useGuidedDemo();

  const isCalm = !headline || headline.toLowerCase().includes('no components currently at risk') || headline.toLowerCase().includes('0 components face shortage');
  const differ = Boolean(mostSevereSku && soonestSku && mostSevereSku !== soonestSku);

  return (
    <section
      aria-label="Executive decision summary strip"
      className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs transition-all space-y-3"
      data-testid="headline-strip"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Metadata tag + Headline text */}
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
              {datasetLabel}
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Snapshot As-Of: <strong className="font-mono text-slate-700">{formatDate(asOf)}</strong>
            </span>
            {differ && (
              <span
                data-testid="most-severe-vs-soonest-badge"
                className="text-[11px] font-semibold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-300"
                title={`Headline highlights most severe risk (${mostSevereSku}), while KPI tile shows soonest shortage (${soonestSku})`}
              >
                Most severe: <strong className="font-mono">{mostSevereSku}</strong> vs Soonest: <strong className="font-mono">{soonestSku}</strong>
              </span>
            )}
          </div>

          {loading ? (
            <div className="h-6 w-3/4 bg-slate-100 animate-pulse rounded" />
          ) : isCalm ? (
            <p className="text-sm sm:text-base font-semibold text-emerald-800 flex items-center gap-2">
              <span aria-hidden="true" className="text-emerald-600">✓</span>
              <span>No components currently at risk across the planning horizon.</span>
            </p>
          ) : (
            <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-snug tracking-tight">
              {headline}
            </h1>
          )}
        </div>

        {/* Right: Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <Link
            to="/executive-summary"
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors"
          >
            See the recommended action &rarr;
          </Link>
          <button
            type="button"
            onClick={startDemo}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded text-xs font-semibold shadow-2xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors flex items-center gap-1.5"
          >
            <span aria-hidden="true">💡</span>
            <span>Start guided demo</span>
          </button>
        </div>
      </div>
    </section>
  );
};
