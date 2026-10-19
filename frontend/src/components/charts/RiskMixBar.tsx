import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RISK_PALETTE, type RiskLevelKey } from '../../theme/riskPalette';
import { StatusLegend } from '../ui/StatusLegend';

export interface RiskMixBarProps {
  counts: Record<string, number>;
  totalEvaluated: number;
  className?: string;
}

export const RiskMixBar: React.FC<RiskMixBarProps> = ({
  counts,
  totalEvaluated,
  className = '',
}) => {
  const navigate = useNavigate();

  const orderedKeys: RiskLevelKey[] = ['critical', 'high', 'medium', 'low', 'none', 'unknown'];
  const total = totalEvaluated > 0 ? totalEvaluated : Object.values(counts).reduce((a, b) => a + b, 0);

  // Filter keys with counts or keep defined
  const segments = orderedKeys
    .map((k) => ({
      key: k,
      palette: RISK_PALETTE[k],
      count: counts[k] ?? 0,
      pct: total > 0 ? ((counts[k] ?? 0) / total) * 100 : 0,
    }))
    .filter((s) => s.count > 0);

  let cumulativeOffset = 0;
  const positionedSegments = segments.map((seg) => {
    const x = cumulativeOffset;
    cumulativeOffset += seg.pct;
    return { ...seg, x, width: seg.pct };
  });

  const handleNavigate = (level: string) => {
    navigate(`/inventory-risk?risk_level=${level}`);
  };

  return (
    <div className={`space-y-4 ${className}`} data-testid="risk-mix-bar-container">
      {/* Visual Stacked Bar */}
      <div className="space-y-2">
        <div className="relative w-full h-11 bg-slate-100 rounded-md overflow-hidden border border-slate-300">
          <svg
            className="w-full h-full"
            viewBox="0 0 100 44"
            preserveAspectRatio="none"
            role="img"
            aria-label="Component risk distribution mix chart"
          >
            {positionedSegments.map((seg) => (
              <g
                key={seg.key}
                role="button"
                tabIndex={0}
                aria-label={`${seg.palette.label}: ${seg.count} components (${seg.pct.toFixed(1)}%). Click to view components.`}
                onClick={() => handleNavigate(seg.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNavigate(seg.key);
                  }
                }}
                className="cursor-pointer transition-opacity hover:opacity-85 focus:outline-none focus:opacity-80"
              >
                {/* Solid background fill */}
                <rect
                  x={seg.x}
                  y="0"
                  width={seg.width}
                  height="44"
                  fill={seg.palette.fillColor}
                />
                {/* SVG pattern overlay for greyscale accessibility */}
                <rect
                  x={seg.x}
                  y="0"
                  width={seg.width}
                  height="44"
                  fill={`url(#${seg.palette.patternId})`}
                />
                {/* Segment separator */}
                <line
                  x1={seg.x + seg.width}
                  y1="0"
                  x2={seg.x + seg.width}
                  y2="44"
                  stroke="#ffffff"
                  strokeWidth="0.8"
                />
              </g>
            ))}
          </svg>
        </div>

        {/* Text summaries per segment below the bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs">
          {orderedKeys.map((k) => {
            const count = counts[k] ?? 0;
            const item = RISK_PALETTE[k];
            const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0';
            return (
              <button
                key={k}
                type="button"
                onClick={() => handleNavigate(k)}
                className="p-2 bg-slate-50 border border-slate-200 rounded text-left hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors"
                aria-label={`Filter by ${item.label} risk: ${count} components`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: item.strokeColor }}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between font-mono">
                  <span className="text-base font-bold text-slate-900">{count}</span>
                  <span className="text-[11px] text-slate-500">({pct}%)</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend with direct filter links */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3 flex-wrap gap-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Filter by Risk Level:
        </span>
        <StatusLegend
          levels={orderedKeys}
          onSelect={(lvl) => handleNavigate(lvl)}
        />
      </div>
    </div>
  );
};

export const RiskMixTable: React.FC<{ counts: Record<string, number>; totalEvaluated: number }> = ({
  counts,
  totalEvaluated,
}) => {
  const navigate = useNavigate();
  const orderedKeys: RiskLevelKey[] = ['critical', 'high', 'medium', 'low', 'none', 'unknown'];
  const total = totalEvaluated > 0 ? totalEvaluated : Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <table className="min-w-full divide-y divide-slate-200 text-xs">
      <thead className="bg-slate-50 text-slate-700 font-semibold">
        <tr>
          <th scope="col" className="px-4 py-2.5 text-left">Risk Level</th>
          <th scope="col" className="px-4 py-2.5 text-right font-mono">Component Count</th>
          <th scope="col" className="px-4 py-2.5 text-right font-mono">Percentage</th>
          <th scope="col" className="px-4 py-2.5 text-left">Pattern / Shape Indicator</th>
          <th scope="col" className="px-4 py-2.5 text-center">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {orderedKeys.map((k) => {
          const item = RISK_PALETTE[k];
          const count = counts[k] ?? 0;
          const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
          return (
            <tr key={k} className="hover:bg-slate-50/80">
              <td className="px-4 py-2.5 font-semibold text-slate-900 flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-xs inline-block"
                  style={{ backgroundColor: item.strokeColor }}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">{count}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-600">{pct}%</td>
              <td className="px-4 py-2.5 text-slate-600">{item.shapeDescription}</td>
              <td className="px-4 py-2.5 text-center">
                <button
                  type="button"
                  onClick={() => navigate(`/inventory-risk?risk_level=${k}`)}
                  className="text-blue-600 hover:text-blue-800 font-semibold underline focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                >
                  View components &rarr;
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
