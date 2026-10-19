import React from 'react';
import { Link } from 'react-router-dom';
import type { InventoryRiskItem } from '../../api/types';
import { RISK_PALETTE, type RiskLevelKey } from '../../theme/riskPalette';
import { formatDate } from '../../lib/format';
import { daysBetween } from '../../lib/dates';

export interface RunwayChartProps {
  items: InventoryRiskItem[];
  asOf: string;
  className?: string;
}

const CRITICALITY_PRIORITY: Record<string, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export const RunwayChart: React.FC<RunwayChartProps> = ({ items, asOf, className = '' }) => {
  // 1. Filter critical, high, medium risk items with a projected shortage
  const eligible = items
    .filter((it) => ['critical', 'high', 'medium'].includes(it.risk_level) && it.days_until_shortage != null)
    .sort((a, b) => {
      const daysA = a.days_until_shortage ?? 999;
      const daysB = b.days_until_shortage ?? 999;
      if (daysA !== daysB) return daysA - daysB;
      const prioA = CRITICALITY_PRIORITY[a.criticality] ?? 0;
      const prioB = CRITICALITY_PRIORITY[b.criticality] ?? 0;
      return prioB - prioA;
    })
    .slice(0, 8);

  // 2. Dynamic Text Summary derived strictly from API data
  const runoutWithin14 = eligible.filter((it) => (it.days_until_shortage ?? 999) <= 14);
  const earliest = eligible[0];

  let summaryText = 'All evaluated components maintain adequate inventory runway.';
  if (eligible.length > 0 && earliest) {
    summaryText = `${eligible.length} component${eligible.length === 1 ? '' : 's'} face projected stockouts (${runoutWithin14.length} within 14 days); the earliest shortage is ${earliest.sku} in ${earliest.days_until_shortage} days.`;
  }

  const MAX_DAYS = 30;
  const CHART_WIDTH = 560; // 0 to 560 pixels
  const pxPerDay = CHART_WIDTH / MAX_DAYS; // ~18.67 px/day

  return (
    <div className={`space-y-4 ${className}`} data-testid="runway-chart-container">
      {/* Dynamic Summary Banner */}
      <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-md text-xs font-medium text-amber-950 flex items-center gap-2">
        <span aria-hidden="true" className="text-amber-700 text-sm">⏱</span>
        <span data-testid="runway-summary-text">{summaryText}</span>
      </div>

      {/* Axis Scale Header */}
      <div className="relative pl-36 sm:pl-48 pr-4 select-none">
        <div className="flex justify-between text-[11px] font-mono text-slate-500 border-b border-slate-300 pb-1">
          <span className="font-bold text-slate-900">Today (Day 0)</span>
          <span>Day 7</span>
          <span>Day 14</span>
          <span>Day 21</span>
          <span>Day 28</span>
          <span>30+ days &rarr;</span>
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {eligible.map((item) => {
          const shortageDays = Number.isFinite(item.days_until_shortage)
            ? Math.max(0, item.days_until_shortage!)
            : 0;
          const palette = RISK_PALETTE[(item.risk_level as RiskLevelKey) || 'unknown'];

          // Calculate delivery arrival in days from asOf
          let deliveryDays: number | null = null;
          if (item.next_replenishment?.date && asOf) {
            const d = daysBetween(asOf, item.next_replenishment.date);
            if (Number.isFinite(d)) {
              deliveryDays = Math.max(0, d);
            }
          }

          const clampedShortageDays = Math.min(shortageDays, MAX_DAYS);
          const stockBarWidth = clampedShortageDays * pxPerDay;

          // Gap segment: from shortage day to replenishment day
          const hasGap = deliveryDays != null && deliveryDays > shortageDays;
          const clampedDeliveryDays = deliveryDays != null ? Math.min(deliveryDays, MAX_DAYS) : MAX_DAYS;
          const gapWidth = hasGap ? Math.max(4, (clampedDeliveryDays - clampedShortageDays) * pxPerDay) : 0;
          const noDelivery = item.next_replenishment == null;
          const unscheduledGapWidth = noDelivery ? Math.max(10, (MAX_DAYS - clampedShortageDays) * pxPerDay) : 0;

          return (
            <div
              key={item.sku}
              className="group p-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-lg transition-colors flex flex-col sm:flex-row sm:items-center gap-2"
              data-testid={`runway-row-${item.sku}`}
            >
              {/* Component Label & Simulator Link */}
              <div className="w-full sm:w-44 shrink-0 space-y-0.5">
                <Link
                  to={`/simulator?component_id=${item.component_id}`}
                  className="font-mono font-bold text-xs text-blue-700 hover:text-blue-900 hover:underline flex items-center gap-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                  title={`Simulate what-if scenarios for ${item.sku}`}
                >
                  <span>{item.sku}</span>
                  <span aria-hidden="true" className="text-[10px] text-slate-400">&rarr;</span>
                </Link>
                <p className="text-[11px] text-slate-600 truncate" title={item.name}>
                  {item.name}
                </p>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span
                    className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: palette.bgColor, color: palette.textColor, borderColor: palette.strokeColor }}
                  >
                    {item.risk_level}
                  </span>
                </div>
              </div>

              {/* Graphical Runway SVG */}
              <div className="flex-1 overflow-x-auto min-w-[280px]">
                <svg
                  viewBox={`0 0 ${CHART_WIDTH} 32`}
                  className="w-full h-8"
                  role="img"
                  aria-label={`${item.sku}: stock lasts ${shortageDays} days${hasGap ? `, gap of ${deliveryDays! - shortageDays} days until delivery` : ''}`}
                >
                  {/* Background grid lines */}
                  {[0, 7, 14, 21, 28].map((d) => (
                    <line
                      key={d}
                      x1={d * pxPerDay}
                      y1="0"
                      x2={d * pxPerDay}
                      y2="32"
                      stroke="#cbd5e1"
                      strokeDasharray="2,2"
                      strokeWidth="1"
                    />
                  ))}

                  {/* 1. Usable Stock Bar */}
                  <rect
                    x="0"
                    y="6"
                    width={Math.max(2, stockBarWidth)}
                    height="20"
                    fill={palette.fillColor}
                    rx="3"
                  />
                  {/* SVG Pattern overlay */}
                  <rect
                    x="0"
                    y="6"
                    width={Math.max(2, stockBarWidth)}
                    height="20"
                    fill={`url(#${palette.patternId})`}
                    rx="3"
                  />

                  {/* Stock Bar Label */}
                  {stockBarWidth > 45 && (
                    <text
                      x="8"
                      y="19"
                      fill="#ffffff"
                      fontSize="9"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {shortageDays}d stock
                    </text>
                  )}

                  {/* 2. Gap Segment to Scheduled Delivery */}
                  {hasGap && (
                    <g>
                      <rect
                        x={stockBarWidth}
                        y="8"
                        width={gapWidth}
                        height="16"
                        fill="#fee2e2"
                        stroke="#dc2626"
                        strokeWidth="1"
                        strokeDasharray="3,2"
                      />
                      <rect
                        x={stockBarWidth}
                        y="8"
                        width={gapWidth}
                        height="16"
                        fill="url(#pattern-runway-gap)"
                      />
                      {gapWidth > 60 && (
                        <text
                          x={stockBarWidth + 6}
                          y="19"
                          fill="#991b1b"
                          fontSize="9"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          gap {deliveryDays! - shortageDays}d ({item.unmet_before_next_inbound ?? 0}u)
                        </text>
                      )}
                    </g>
                  )}

                  {/* 3. No Delivery Scheduled Segment */}
                  {noDelivery && (
                    <g>
                      <rect
                        x={stockBarWidth}
                        y="8"
                        width={unscheduledGapWidth}
                        height="16"
                        fill="#fef2f2"
                        stroke="#b91c1c"
                        strokeWidth="1"
                        strokeDasharray="4,2"
                      />
                      <rect
                        x={stockBarWidth}
                        y="8"
                        width={unscheduledGapWidth}
                        height="16"
                        fill="url(#pattern-unscheduled-gap)"
                      />
                      <text
                        x={stockBarWidth + 6}
                        y="19"
                        fill="#b91c1c"
                        fontSize="9"
                        fontStyle="italic"
                        fontWeight="bold"
                        fontFamily="sans-serif"
                      >
                        no delivery scheduled
                      </text>
                    </g>
                  )}

                  {/* 4. Delivery Marker Triangle */}
                  {deliveryDays != null && (
                    <g
                      transform={`translate(${clampedDeliveryDays * pxPerDay}, 16)`}
                      className="cursor-help"
                    >
                      {/* Triangle marker */}
                      <polygon
                        points="-6,-10 6,-10 0,2"
                        fill="#1d4ed8"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      {/* Date tick text */}
                      <text
                        x="0"
                        y="14"
                        fill="#1e3a8a"
                        fontSize="8.5"
                        fontWeight="bold"
                        fontFamily="monospace"
                        textAnchor="middle"
                      >
                        {formatDate(item.next_replenishment!.date).slice(5)} ({item.next_replenishment!.qty}u)
                      </text>
                    </g>
                  )}

                  {/* 5. 30+ Days Overflow Indicator */}
                  {(shortageDays > MAX_DAYS || (deliveryDays ?? 0) > MAX_DAYS) && (
                    <text
                      x={CHART_WIDTH - 2}
                      y="19"
                      fill="#64748b"
                      fontSize="9"
                      fontWeight="bold"
                      fontFamily="monospace"
                      textAnchor="end"
                    >
                      30+ days &rarr;
                    </text>
                  )}
                </svg>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const RunwayTable: React.FC<{ items: InventoryRiskItem[]; asOf: string }> = ({ items, asOf }) => {
  const eligible = items
    .filter((it) => ['critical', 'high', 'medium'].includes(it.risk_level) && it.days_until_shortage != null)
    .sort((a, b) => (a.days_until_shortage ?? 999) - (b.days_until_shortage ?? 999))
    .slice(0, 8);

  return (
    <table className="min-w-full divide-y divide-slate-200 text-xs">
      <thead className="bg-slate-50 text-slate-700 font-semibold">
        <tr>
          <th scope="col" className="px-3 py-2.5 text-left">Component</th>
          <th scope="col" className="px-3 py-2.5 text-center">Risk Level</th>
          <th scope="col" className="px-3 py-2.5 text-right font-mono">Stock Lasts (Days)</th>
          <th scope="col" className="px-3 py-2.5 text-left">Shortage Date</th>
          <th scope="col" className="px-3 py-2.5 text-left">Next Inbound Delivery</th>
          <th scope="col" className="px-3 py-2.5 text-right font-mono">Units Short Before Delivery</th>
          <th scope="col" className="px-3 py-2.5 text-center">Simulate</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {eligible.map((it) => {
          const shortageDays = it.days_until_shortage ?? 0;
          const repl = it.next_replenishment;
          const deliveryDays = repl?.date ? daysBetween(asOf, repl.date) : null;
          const gap = deliveryDays != null && deliveryDays > shortageDays ? deliveryDays - shortageDays : null;

          return (
            <tr key={it.sku} className="hover:bg-slate-50/80">
              <td className="px-3 py-2.5">
                <div className="font-mono font-bold text-slate-900">{it.sku}</div>
                <div className="text-slate-500 text-[11px] truncate max-w-[180px]">{it.name}</div>
              </td>
              <td className="px-3 py-2.5 text-center">
                <span className="font-semibold uppercase text-[11px]">{it.risk_level}</span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900">
                {shortageDays} days
              </td>
              <td className="px-3 py-2.5 text-slate-800 font-mono">
                {it.shortage_date ? formatDate(it.shortage_date) : 'None'}
              </td>
              <td className="px-3 py-2.5">
                {repl ? (
                  <div>
                    <span className="font-mono font-bold text-blue-900">{formatDate(repl.date)}</span>
                    <span className="text-slate-500 ml-1">({repl.qty} units, {repl.po_number || 'PO'})</span>
                    {gap != null && (
                      <span className="block text-[11px] text-red-700 font-medium">Gap: {gap} days</span>
                    )}
                  </div>
                ) : (
                  <span className="text-red-700 font-semibold italic">No delivery scheduled</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-mono font-bold text-red-700">
                {it.unmet_before_next_inbound != null ? it.unmet_before_next_inbound.toFixed(1) : '—'}
              </td>
              <td className="px-3 py-2.5 text-center">
                <Link
                  to={`/simulator?component_id=${it.component_id}`}
                  className="text-blue-600 hover:text-blue-800 font-semibold underline px-1 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                >
                  Simulate &rarr;
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
