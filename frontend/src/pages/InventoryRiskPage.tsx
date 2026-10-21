import React, { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getInventoryRisk, getInventoryRiskDetail, listComponents } from '../api/endpoints';
import type {
  Component,
  ComponentCriticality,
  InventoryRiskDetailResponse,
  InventoryRiskItem,
  RiskLevel,
} from '../api/types';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { Pagination } from '../components/Pagination';
import { CriticalityBadge, RiskBadge } from '../components/Badge';
import { formatDate, formatInteger } from '../lib/format';
import { InfoTip } from '../components/ui/InfoTip';
import { GLOSSARY } from '../constants/glossary';
import { PAGE_SUBTITLES } from '../constants/pageSubtitles';

const RISK_LEVEL_OPTIONS: { label: string; value: RiskLevel | '' }[] = [
  { label: 'All Risk Levels', value: '' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
  { label: 'Not applicable', value: 'none' },
  { label: 'Unknown', value: 'unknown' },
];

const CRITICALITY_OPTIONS: { label: string; value: ComponentCriticality | '' }[] = [
  { label: 'All Criticalities', value: '' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Normal', value: 'normal' },
];

function ActionBadge({ type }: { type?: string }) {
  switch (type) {
    case 'expedite_po':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Expedite PO
        </span>
      );
    case 'regional_transfer':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 whitespace-nowrap">
          <span>🔄</span>
          Transfer Stock
        </span>
      );
    case 'alt_supplier':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 whitespace-nowrap">
          <span>🏭</span>
          Alt Supplier
        </span>
      );
    case 'issue_po':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 whitespace-nowrap">
          <span>📦</span>
          Place PO
        </span>
      );
    case 'maintain':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
          <span>✓</span>
          Adequate
        </span>
      );
    case 'review_forecast':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 whitespace-nowrap">
          <span>📊</span>
          Review Forecast
        </span>
      );
    case 'audit_inventory':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30 whitespace-nowrap">
          <span>🔍</span>
          Audit Plant
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/15 text-slate-300 border border-slate-500/30 whitespace-nowrap">
          <span>👁</span>
          Monitor
        </span>
      );
  }
}

/**
 * Interactive SVG Inventory Projection Chart
 * Shows 30-day / 60-day stock balance trajectory, incoming shipments, demand, zero threshold, and stockout date.
 */
function InventoryProjectionChart({
  detail,
}: {
  detail: InventoryRiskDetailResponse;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const steps = useMemo(() => {
    // Show up to 30 days for clarity
    return detail.daily_projection.slice(0, 30);
  }, [detail.daily_projection]);

  if (steps.length === 0) {
    return (
      <div className="p-4 text-center text-text-secondary italic bg-elevated/50 rounded border border-border-subtle">
        No projection simulation available.
      </div>
    );
  }

  const width = 680;
  const height = 180;
  const padLeft = 45;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(
    ...steps.map((s) => Math.max(s.ending_balance + s.receipts, s.forecast_demand)),
    50
  );

  const getX = (index: number) => padLeft + (index / (steps.length - 1)) * chartW;
  const getY = (val: number) => padTop + chartH - (Math.max(0, val) / maxVal) * chartH;

  // Build SVG path for ending balance line and area fill
  const points = steps.map((s, idx) => `${getX(idx)},${getY(s.ending_balance)}`).join(' ');
  const areaPath = `M ${getX(0)},${getY(0)} L ${points} L ${getX(steps.length - 1)},${getY(0)} Z`;
  const linePath = `M ${points}`;

  // Find shortage step
  const shortageStepIdx = steps.findIndex((s) => s.unmet > 0);

  // Inbound receipt points
  const receiptPoints = steps
    .map((s, idx) => ({ step: s, idx }))
    .filter((item) => item.step.receipts > 0);

  const activeStep = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < steps.length ? steps[hoverIndex] : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-secondary">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-400 rounded-full" />
            <span className="text-text-primary font-medium">Projected Balance</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-text-primary font-medium">Inbound Receipt</span>
          </span>
          {shortageStepIdx >= 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-red-500 rounded-full border-dashed" />
              <span className="text-red-400 font-medium">Predicted Shortage</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-border-subtle" />
            <span>Zero-Stock Baseline</span>
          </span>
        </div>
        <span className="text-[10px] text-text-muted">
          Showing 30-day forward trajectory • Hover for daily breakdown
        </span>
      </div>

      <div className="relative bg-[#050811] p-3 rounded-lg border border-border-subtle overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-44 select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={`grad-balance-${detail.component_id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
            <pattern id="grid-pattern" width="40" height="20" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Background grid */}
          <rect x={padLeft} y={padTop} width={chartW} height={chartH} fill="url(#grid-pattern)" />

          {/* Y Axis Reference lines */}
          <line x1={padLeft} y1={getY(maxVal)} x2={width - padRight} y2={getY(maxVal)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 2" />
          <text x={padLeft - 6} y={getY(maxVal) + 4} textAnchor="end" className="text-[9px] fill-text-muted font-mono">
            {formatInteger(Math.round(maxVal))}
          </text>

          <line x1={padLeft} y1={getY(maxVal / 2)} x2={width - padRight} y2={getY(maxVal / 2)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 2" />
          <text x={padLeft - 6} y={getY(maxVal / 2) + 4} textAnchor="end" className="text-[9px] fill-text-muted font-mono">
            {formatInteger(Math.round(maxVal / 2))}
          </text>

          {/* Zero reference baseline */}
          <line x1={padLeft} y1={getY(0)} x2={width - padRight} y2={getY(0)} stroke="#ef4444" strokeWidth="1.2" strokeOpacity="0.8" />
          <text x={padLeft - 6} y={getY(0) + 3} textAnchor="end" className="text-[9px] fill-red-400 font-mono font-bold">
            0
          </text>

          {/* Area fill */}
          <path d={areaPath} fill={`url(#grad-balance-${detail.component_id})`} />

          {/* Balance trajectory line */}
          <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Predicted stockout marker */}
          {shortageStepIdx >= 0 && (
            <g>
              <line
                x1={getX(shortageStepIdx)}
                y1={padTop}
                x2={getX(shortageStepIdx)}
                y2={padTop + chartH}
                stroke="#f43f5e"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
              <rect
                x={getX(shortageStepIdx) - 34}
                y={padTop - 18}
                width="68"
                height="15"
                rx="3"
                fill="#f43f5e"
              />
              <text
                x={getX(shortageStepIdx)}
                y={padTop - 7}
                textAnchor="middle"
                className="text-[9px] font-bold fill-white"
              >
                STOCKOUT
              </text>
            </g>
          )}

          {/* Inbound receipt markers */}
          {receiptPoints.map(({ step, idx }) => (
            <g key={idx}>
              <circle
                cx={getX(idx)}
                cy={getY(step.ending_balance)}
                r="4.5"
                fill="#10b981"
                stroke="#050811"
                strokeWidth="1.5"
                className="cursor-pointer"
              />
              <text
                x={getX(idx)}
                y={getY(step.ending_balance) - 8}
                textAnchor="middle"
                className="text-[9px] font-mono font-bold fill-emerald-400"
              >
                +{step.receipts.toFixed(0)}
              </text>
            </g>
          ))}

          {/* X Axis Ticks (Every 5 days) */}
          {steps.map((_, idx) => {
            if (idx % 5 === 0 || idx === steps.length - 1) {
              return (
                <g key={idx}>
                  <line x1={getX(idx)} y1={getY(0)} x2={getX(idx)} y2={getY(0) + 4} stroke="rgba(255,255,255,0.2)" />
                  <text x={getX(idx)} y={getY(0) + 16} textAnchor="middle" className="text-[9px] fill-text-muted font-mono">
                    +{idx}d
                  </text>
                </g>
              );
            }
            return null;
          })}

          {/* Hover Crosshair Line */}
          {hoverIndex !== null && hoverIndex >= 0 && hoverIndex < steps.length && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={padTop}
                x2={getX(hoverIndex)}
                y2={getY(0)}
                stroke="#38bdf8"
                strokeWidth="1.2"
                strokeDasharray="3 2"
              />
              <circle
                cx={getX(hoverIndex)}
                cy={getY(steps[hoverIndex].ending_balance)}
                r="5"
                fill="#38bdf8"
                stroke="#050811"
                strokeWidth="2"
              />
            </g>
          )}

          {/* Invisible hover trigger columns across steps */}
          {steps.map((_, idx) => {
            const stepW = chartW / (steps.length - 1);
            return (
              <rect
                key={idx}
                x={getX(idx) - stepW / 2}
                y={padTop}
                width={stepW}
                height={chartH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(idx)}
              />
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {activeStep && (
          <div
            className="absolute top-2 right-2 bg-surface/95 border border-cyan-500/30 p-2.5 rounded shadow-lg backdrop-blur text-[11px] font-mono space-y-1 pointer-events-none"
            data-testid="projection-chart-tooltip"
          >
            <div className="flex justify-between gap-4 text-text-secondary font-sans border-b border-border-subtle pb-1">
              <span>Day +{activeStep.day_index} ({formatDate(activeStep.date)})</span>
              {activeStep.unmet > 0 ? (
                <span className="text-red-400 font-bold">SHORTAGE</span>
              ) : (
                <span className="text-emerald-400 font-medium">Covered</span>
              )}
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Ending Balance:</span>
              <span className="text-cyan-300 font-bold">{formatInteger(Math.round(activeStep.ending_balance))} units</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Daily Consumption:</span>
              <span className="text-text-primary">{activeStep.forecast_demand.toFixed(1)}/d</span>
            </div>
            {activeStep.receipts > 0 && (
              <div className="flex justify-between gap-4 text-emerald-400 font-semibold">
                <span>Inbound Delivery:</span>
                <span>+{formatInteger(Math.round(activeStep.receipts))} units</span>
              </div>
            )}
            {activeStep.unmet > 0 && (
              <div className="flex justify-between gap-4 text-red-400 font-bold">
                <span>Unmet Demand:</span>
                <span>{activeStep.unmet.toFixed(1)} units</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentRiskDetailPanel({ componentId }: { componentId: number }) {
  const fetchDetail = useCallback(
    (signal: AbortSignal) => getInventoryRiskDetail(componentId, signal),
    [componentId]
  );
  const { data: detail, loading, error, reload } = useApi(fetchDetail, [fetchDetail]);

  if (loading) {
    return (
      <div className="p-4 bg-elevated border-t border-border-subtle">
        <LoadingView message="Loading component stock projection and evidence..." testId={`detail-loading-${componentId}`} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 bg-elevated border-t border-border-subtle">
        <ErrorView
          error={error || new Error('Failed to load detail')}
          onRetry={reload}
          title="Could not load inventory risk details"
        />
      </div>
    );
  }

  // Display first 14 days of projection
  const first14Days = detail.daily_projection.slice(0, 14);

  return (
    <div
      id={`risk-detail-${componentId}`}
      data-testid={`risk-detail-panel-${componentId}`}
      className="p-5 bg-[#0a0f1d] border-t border-border-subtle space-y-6 text-xs text-text-primary"
    >
      {/* 1. Actionable Recommendation Hero Card */}
      {detail.recommended_action && (
        <section
          aria-labelledby={`recommendation-heading-${componentId}`}
          className="bg-gradient-to-r from-surface to-elevated p-4 rounded-lg border border-cyan-500/30 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"
          data-testid={`recommendation-card-${componentId}`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                Actionable Replenishment Guidance
              </span>
              <ActionBadge type={detail.recommended_action_type} />
            </div>
            <p className="text-sm font-semibold text-text-primary">
              {detail.recommended_action}
            </p>
          </div>
          {detail.primary_supplier_code && (
            <Link
              to={`/globe?supplier=${detail.primary_supplier_code}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-700/60 rounded text-xs font-semibold shrink-0 transition-colors cursor-pointer"
            >
              <span>View Supplier on 3D Globe</span>
              <span>→</span>
            </Link>
          )}
        </section>
      )}

      {/* 2. Interactive Projection Chart */}
      <section aria-labelledby={`chart-heading-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-3">
        <h3 id={`chart-heading-${componentId}`} className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          Forward Inventory Projection Simulation
        </h3>
        <InventoryProjectionChart detail={detail} />
      </section>

      {/* 3. Location & Supply Network Context */}
      <section aria-labelledby={`location-heading-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 id={`location-heading-${componentId}`} className="font-bold text-text-primary uppercase tracking-wider text-xs">
            Location & Supply Network Context
          </h3>
          <span className="text-[10px] text-text-muted font-semibold uppercase">Physical Facilities</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 bg-elevated rounded border border-border-subtle">
            <div className="text-[10px] text-text-secondary uppercase font-semibold">Manufacturing Plant Warehouse</div>
            <div className="text-sm font-bold text-text-primary mt-1">
              {detail.plant_warehouse_name || 'Main Plant Warehouse'}
            </div>
            <div className="text-[11px] text-emerald-400 font-medium mt-0.5">Primary Assembly Hub</div>
          </div>
          <div className="p-3 bg-elevated rounded border border-border-subtle">
            <div className="text-[10px] text-text-secondary uppercase font-semibold">Primary Supplier & Origin</div>
            <div className="text-sm font-bold text-text-primary mt-1">
              {detail.primary_supplier_name || 'No direct contract assigned'}
            </div>
            <div className="text-[11px] text-text-secondary mt-0.5">
              {detail.primary_supplier_country ? `Country: ${detail.primary_supplier_country}` : 'Country unverified'}
              {detail.primary_supplier_code ? ` • Code: ${detail.primary_supplier_code}` : ''}
            </div>
          </div>
          <div className="p-3 bg-elevated rounded border border-border-subtle">
            <div className="text-[10px] text-text-secondary uppercase font-semibold">Data Confidence & Basis</div>
            <div className="text-sm font-bold text-text-primary mt-1 capitalize flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  detail.data_confidence === 'high'
                    ? 'bg-emerald-400'
                    : detail.data_confidence === 'medium'
                    ? 'bg-amber-400'
                    : 'bg-red-400'
                }`}
              />
              {detail.data_confidence || 'Standard'} Confidence
            </div>
            <div className="text-[11px] text-text-secondary mt-0.5">
              {detail.forecast_status === 'adequate'
                ? '28-day weekday heuristic baseline'
                : `Forecast status: ${detail.forecast_status}`}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Assessment Explanation Banner */}
      <section aria-labelledby={`explanation-heading-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs">
        <h3 id={`explanation-heading-${componentId}`} className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
          Assessment Explanation
        </h3>
        <p className="text-sm font-medium text-text-primary leading-relaxed" data-testid={`explanation-text-${componentId}`}>
          {detail.explanation}
        </p>
      </section>

      {/* 5. Identified Flags */}
      {detail.flags.length > 0 && (
        <section aria-labelledby={`flags-heading-${componentId}`} className="bg-amber-500/10 p-4 rounded-lg border border-amber-500/30">
          <h3 id={`flags-heading-${componentId}`} className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2">
            Identified Operational Flags ({detail.flags.length})
          </h3>
          <ul className="space-y-1.5 list-disc list-inside text-amber-200 font-medium">
            {detail.flags.map((flag) => (
              <li key={flag.code} data-testid={`flag-${flag.code}`}>
                <span className="font-mono font-bold text-[11px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded border border-amber-500/30 mr-1.5">
                  {flag.code}
                </span>
                {flag.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. Evidence Grid: Stock breakdown, regional inventory, and weekday demand */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Usable Stock Breakdown */}
        <section aria-labelledby={`stock-breakdown-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-2">
          <h3 id={`stock-breakdown-${componentId}`} className="font-bold text-text-primary uppercase tracking-wider">
            Plant Usable Stock
          </h3>
          {detail.usable_stock_breakdown ? (
            <div className="space-y-1.5">
              <div className="flex justify-between py-1 border-b border-border-subtle">
                <span className="text-text-secondary">On-hand Stock:</span>
                <span className="font-mono font-semibold text-text-primary">
                  {formatInteger(detail.usable_stock_breakdown.on_hand)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border-subtle">
                <span className="text-text-secondary">Reserved Allocations:</span>
                <span className="font-mono font-semibold text-text-primary">
                  {formatInteger(detail.usable_stock_breakdown.reserved)}
                </span>
              </div>
              <div className="flex justify-between py-1 font-bold text-text-primary">
                <span>Net Usable Stock:</span>
                <span className="font-mono text-cyan-400" data-testid={`usable-stock-val-${componentId}`}>
                  {formatInteger(detail.usable_stock_breakdown.usable)}
                </span>
              </div>
              {detail.usable_stock_breakdown.reserved_exceeds_on_hand && (
                <p className="text-[11px] text-red-400 font-bold mt-1">
                  Alert: Reserved stock exceeds on-hand balance. Usable stock clamped to 0.
                </p>
              )}
            </div>
          ) : (
            <p className="text-text-secondary italic">No inventory row recorded at plant.</p>
          )}
        </section>

        {/* Regional Inventory */}
        <section aria-labelledby={`reg-stock-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 id={`reg-stock-${componentId}`} className="font-bold text-text-primary uppercase tracking-wider">
              Regional Stock
            </h3>
            <span className="text-[10px] text-text-muted font-semibold uppercase">Informational</span>
          </div>
          {detail.regional_usable_stock.length > 0 ? (
            <div className="space-y-1.5">
              {detail.regional_usable_stock.map((reg) => (
                <div key={reg.warehouse_id} className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-secondary truncate max-w-[140px]" title={reg.warehouse_name}>
                    {reg.warehouse_code}:
                  </span>
                  <span className="font-mono font-semibold text-text-primary">
                    {formatInteger(reg.usable)} usable ({formatInteger(reg.on_hand)} on hand)
                  </span>
                </div>
              ))}
              <div className="flex justify-between py-1 font-bold text-text-primary">
                <span>Total Regional Usable:</span>
                <span className="font-mono text-text-primary" data-testid={`reg-total-${componentId}`}>
                  {formatInteger(detail.regional_total_usable)}
                </span>
              </div>
              <p className="text-[10px] text-text-secondary italic mt-1">
                Potentially transferable; no transfer assumed in plant projection.
              </p>
            </div>
          ) : (
            <p className="text-text-secondary italic">No inventory held across regional distribution hubs.</p>
          )}
        </section>

        {/* Weekday Forecast Baseline */}
        <section aria-labelledby={`weekday-forecast-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-2">
          <h3 id={`weekday-forecast-${componentId}`} className="font-bold text-text-primary uppercase tracking-wider">
            Weekday Demand Baseline
          </h3>
          {detail.forecast_by_weekday ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {detail.forecast_by_weekday.map((wf) => (
                <div key={wf.weekday} className="flex justify-between py-0.5 border-b border-border-subtle">
                  <span className="text-text-secondary">{wf.weekday_name.slice(0, 3)}:</span>
                  <span className="font-mono font-semibold text-text-primary">{wf.mean_demand.toFixed(1)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-secondary italic">Insufficient history to calculate weekday profile.</p>
          )}
        </section>
      </div>

      {/* 7. Inbound Deliveries Schedule */}
      <section aria-labelledby={`inbound-heading-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-3">
        <h3 id={`inbound-heading-${componentId}`} className="font-bold text-text-primary uppercase tracking-wider">
          Scheduled Inbound Replenishment Orders
        </h3>
        {detail.counted_inbound.length === 0 && detail.unconfirmed_inbound.length === 0 ? (
          <p className="text-text-secondary italic">No active replenishment purchase orders scheduled for this component.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-subtle text-xs">
              <thead className="bg-elevated text-text-secondary font-semibold">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">PO Number</th>
                  <th scope="col" className="px-3 py-2 text-left">Status</th>
                  <th scope="col" className="px-3 py-2 text-left">Warehouse</th>
                  <th scope="col" className="px-3 py-2 text-right">Remaining Qty</th>
                  <th scope="col" className="px-3 py-2 text-left">Expected Arrival</th>
                  <th scope="col" className="px-3 py-2 text-left">Date Basis</th>
                  <th scope="col" className="px-3 py-2 text-left">Planning Consideration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {detail.counted_inbound.map((inb) => (
                  <tr key={inb.po_id}>
                    <td className="px-3 py-2 font-mono font-bold text-text-primary">{inb.po_number}</td>
                    <td className="px-3 py-2 text-text-primary">{inb.status}</td>
                    <td className="px-3 py-2 font-mono text-text-secondary">{inb.warehouse_code}</td>
                    <td className="px-3 py-2 font-mono text-right font-semibold text-text-primary">
                      {formatInteger(inb.remaining_qty)}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-primary">{formatDate(inb.expected_date)}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-elevated text-text-primary border border-border-subtle">
                        {inb.date_basis}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-emerald-400 font-medium">Counted in supply projection</td>
                  </tr>
                ))}
                {detail.unconfirmed_inbound.map((inb) => (
                  <tr key={inb.po_id} className="bg-red-500/10">
                    <td className="px-3 py-2 font-mono font-bold text-text-primary">{inb.po_number}</td>
                    <td className="px-3 py-2 text-text-primary">{inb.status}</td>
                    <td className="px-3 py-2 font-mono text-text-secondary">{inb.warehouse_code}</td>
                    <td className="px-3 py-2 font-mono text-right font-semibold text-text-primary">
                      {formatInteger(inb.remaining_qty)}
                    </td>
                    <td className="px-3 py-2 font-mono text-red-400 font-semibold">{formatDate(inb.expected_date)}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                        overdue
                      </span>
                    </td>
                    <td className="px-3 py-2 text-red-300 font-medium">
                      Excluded (overdue inbound policy: exclude)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 8. 14-Day Trajectory Projection Table */}
      <section aria-labelledby={`projection-heading-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 id={`projection-heading-${componentId}`} className="font-bold text-text-primary uppercase tracking-wider">
            14-Day Daily Stock Trajectory Simulation
          </h3>
          <span className="text-[11px] text-text-secondary">
            Receipts available at start of day; demand consumed during day.
          </span>
        </div>

        {first14Days.length === 0 ? (
          <p className="text-text-secondary italic">No projection available for this component.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-subtle text-xs" data-testid={`projection-table-${componentId}`}>
              <thead className="bg-elevated text-text-secondary font-semibold">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Day</th>
                  <th scope="col" className="px-3 py-2 text-left">Date</th>
                  <th scope="col" className="px-3 py-2 text-right">Forecast Demand</th>
                  <th scope="col" className="px-3 py-2 text-right">Inbound Receipts</th>
                  <th scope="col" className="px-3 py-2 text-right">Ending Balance</th>
                  <th scope="col" className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {first14Days.map((step) => {
                  const isShortage = step.unmet > 0;
                  return (
                    <tr
                      key={step.day_index}
                      className={isShortage ? 'bg-red-500/15 font-medium' : 'hover:bg-elevated/80'}
                      data-testid={`projection-day-${step.day_index}`}
                    >
                      <th scope="row" className="px-3 py-2 font-mono font-semibold text-text-primary text-left">
                        +{step.day_index}
                      </th>
                      <td className="px-3 py-2 font-mono text-text-primary">{formatDate(step.date)}</td>
                      <td className="px-3 py-2 font-mono text-right text-text-primary">{step.forecast_demand.toFixed(1)}</td>
                      <td className="px-3 py-2 font-mono text-right text-text-primary">
                        {step.receipts > 0 ? (
                          <span className="text-emerald-400 font-bold">+{step.receipts.toFixed(1)}</span>
                        ) : (
                          '0.0'
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-right font-bold text-text-primary">
                        {step.ending_balance.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isShortage ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded font-bold text-red-300 bg-red-500/20 border border-red-500/40"
                            data-testid={`shortage-badge-day-${step.day_index}`}
                          >
                            Shortage: {step.unmet.toFixed(1)} unmet units
                          </span>
                        ) : (
                          <span className="text-text-secondary font-medium">Covered</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 9. Shortage Episodes & Unmet Demand Semantics */}
      <section aria-labelledby={`episodes-heading-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h3 id={`episodes-heading-${componentId}`} className="font-bold text-text-primary uppercase tracking-wider">
            Shortage Episodes &amp; Unmet Demand Semantics
          </h3>
          <span className="text-[11px] text-text-secondary font-medium">
            Lost sales / deferred demand convention: Unmet demand is not backlogged.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-elevated rounded-lg border border-border-subtle">
          <div>
            <div className="text-[11px] text-text-secondary uppercase font-semibold">
              Immediate Unmet (Before Next Inbound)
            </div>
            <div className="text-lg font-bold font-mono text-red-400 mt-0.5" data-testid={`unmet-pre-inbound-${componentId}`}>
              {detail.unmet_before_next_inbound != null ? `${detail.unmet_before_next_inbound.toFixed(1)} units` : 'None (0.0)'}
            </div>
            <p className="text-[10px] text-text-secondary mt-0.5">
              Accumulated unserved demand until first replenishment arrives.
            </p>
          </div>
          <div>
            <div className="text-[11px] text-text-secondary uppercase font-semibold">
              Total Projected Unmet (Horizon)
            </div>
            <div className="text-lg font-bold font-mono text-text-primary mt-0.5">
              {detail.unmet_demand_units > 0 ? `${detail.unmet_demand_units.toFixed(1)} units` : '0.0 units'}
            </div>
            <p className="text-[10px] text-text-secondary mt-0.5">
              Sum of all unfulfilled consumption across the 60-day horizon.
            </p>
          </div>
        </div>
      </section>

      {/* 10. Planning Assumptions & Model Notice */}
      <section aria-labelledby={`assumptions-heading-${componentId}`} className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs space-y-2 text-text-secondary">
        <h3 id={`assumptions-heading-${componentId}`} className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          Planning Assumptions &amp; Heuristic Baseline
        </h3>
        <ul className="list-disc list-inside space-y-1 text-[11px]">
          {detail.assumptions.map((assump, idx) => (
            <li key={idx}>{assump}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function InventoryRiskPage() {
  const { meta, reload: reloadMeta } = useMeta();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters state
  const selectedRiskLevel = (searchParams.get('risk_level') || '') as RiskLevel | '';
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedCriticality, setSelectedCriticality] = useState<ComponentCriticality | ''>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('severity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Pagination & expansion
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Distinct component categories
  const fetchComponents = useCallback(
    (signal: AbortSignal) => listComponents({ limit: 200 }, signal),
    []
  );
  const { data: compData } = useApi(fetchComponents, [fetchComponents]);

  const categories = useMemo(() => {
    if (!compData?.items) return [];
    const set = new Set<string>();
    compData.items.forEach((c: Component) => {
      if (c.category) set.add(c.category);
    });
    return Array.from(set).sort();
  }, [compData]);

  // Fetch evaluated inventory risk list
  const fetchRisk = useCallback(
    (signal: AbortSignal) =>
      getInventoryRisk(
        {
          risk_level: selectedRiskLevel || undefined,
          category: selectedCategory || undefined,
          criticality: selectedCriticality || undefined,
          search: searchQuery || undefined,
          sort_by: sortBy || undefined,
          sort_dir: sortDir,
          limit,
          offset,
        },
        signal
      ),
    [selectedRiskLevel, selectedCategory, selectedCriticality, searchQuery, sortBy, sortDir, limit, offset]
  );

  const { data, loading, error, reload } = useApi(fetchRisk, [fetchRisk]);

  const handleRiskChange = (val: string) => {
    setOffset(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) {
        next.set('risk_level', val);
      } else {
        next.delete('risk_level');
      }
      return next;
    });
  };

  const handleCategoryChange = (val: string) => {
    setSelectedCategory(val);
    setOffset(0);
  };

  const handleCriticalityChange = (val: string) => {
    setSelectedCriticality(val as ComponentCriticality | '');
    setOffset(0);
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setOffset(0);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setOffset(0);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setOffset(0);
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (meta?.seeded === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Inventory Risk & Shortage Projections"
          description={PAGE_SUBTITLES.inventory_risk}
        />
        <UnseededView message={meta.message} onRefresh={reloadMeta} />
      </div>
    );
  }

  const hasFilters =
    selectedRiskLevel !== '' ||
    selectedCategory !== '' ||
    selectedCriticality !== '' ||
    searchQuery.trim() !== '' ||
    sortBy !== 'severity';

  // Summary Metrics calculations
  const highRiskCount =
    data?.summary.high_risk_count ??
    (data?.items.filter((i) => i.risk_level === 'critical' || i.risk_level === 'high').length ?? 0);

  const criticalImpactCount =
    data?.summary.critical_impact_count ??
    (data?.items.filter(
      (i) => i.criticality === 'critical' && ['critical', 'high', 'medium'].includes(i.risk_level)
    ).length ?? 0);

  const runoutBeforeInboundCount =
    data?.summary.runout_before_replenishment_count ??
    (data?.items.filter(
      (i) => i.shortage_date && (!i.next_replenishment || i.next_replenishment.date > i.shortage_date)
    ).length ?? 0);

  const dataAttentionCount =
    data?.summary.data_attention_count ??
    (data?.items.filter(
      (i) =>
        i.risk_level === 'unknown' ||
        i.data_confidence === 'low' ||
        i.data_confidence === 'insufficient'
    ).length ?? 0);

  return (
    <div className="space-y-6" data-testid="inventory-risk-page">
      <PageHeader
        title="Inventory Risk & Shortage Projections"
        description={PAGE_SUBTITLES.inventory_risk}
      />

      {/* Model Heuristic Baseline Note Banner */}
      <section
        aria-label="Model Baseline Notice"
        className="bg-blue-500/10 border border-blue-500/25 rounded-lg p-3 text-xs text-blue-200 flex items-start gap-2.5 shadow-xs"
        data-testid="heuristic-banner"
      >
        <span className="font-bold text-blue-300 uppercase tracking-wide text-[10px] bg-blue-500/20 px-1.5 py-0.5 rounded border border-blue-400/30 shrink-0">
          Baseline Model
        </span>
        <p className="font-medium leading-relaxed">
          Demand estimate: weekday-average heuristic baseline (not a trained ML model). Based on the last{' '}
          {data?.config.lookback_days ?? 28} days of demand history.
        </p>
      </section>

      {/* Summary KPI Indicators (Phase 4) */}
      <section
        aria-label="Inventory Risk Summary Indicators"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <div
          data-testid="kpi-high-risk"
          onClick={() => handleRiskChange(selectedRiskLevel === 'critical' ? '' : 'critical')}
          className={`p-3.5 bg-surface border rounded-lg transition-all cursor-pointer hover:border-red-500/50 ${
            selectedRiskLevel === 'critical' ? 'border-red-500 shadow-md ring-1 ring-red-500' : 'border-border-subtle'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              High Risk Components
            </span>
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          </div>
          <div className="text-2xl font-black font-mono text-red-400 mt-1">
            {highRiskCount}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">
            Projected stockout within &le; 14 days
          </p>
        </div>

        <div
          data-testid="kpi-critical-priority"
          onClick={() => handleCriticalityChange(selectedCriticality === 'critical' ? '' : 'critical')}
          className={`p-3.5 bg-surface border rounded-lg transition-all cursor-pointer hover:border-purple-500/50 ${
            selectedCriticality === 'critical' ? 'border-purple-500 shadow-md ring-1 ring-purple-500' : 'border-border-subtle'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Critical Impact Attention
            </span>
            <span className="w-2 h-2 rounded-full bg-purple-400" />
          </div>
          <div className="text-2xl font-black font-mono text-purple-300 mt-1">
            {criticalImpactCount}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">
            Mission-critical BOM components facing shortages
          </p>
        </div>

        <div
          data-testid="kpi-runout-before-inbound"
          className="p-3.5 bg-surface border border-border-subtle rounded-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Runout Before Next Inbound
            </span>
            <span className="w-2 h-2 rounded-full bg-amber-400" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-400 mt-1">
            {runoutBeforeInboundCount}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">
            Shipment arrives after stockout or unscheduled
          </p>
        </div>

        <div
          data-testid="kpi-data-attention"
          onClick={() => handleRiskChange(selectedRiskLevel === 'unknown' ? '' : 'unknown')}
          className={`p-3.5 bg-surface border rounded-lg transition-all cursor-pointer hover:border-blue-500/50 ${
            selectedRiskLevel === 'unknown' ? 'border-blue-500 shadow-md ring-1 ring-blue-500' : 'border-border-subtle'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Data Attention Needed
            </span>
            <span className="w-2 h-2 rounded-full bg-blue-400" />
          </div>
          <div className="text-2xl font-black font-mono text-blue-300 mt-1">
            {dataAttentionCount}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">
            Insufficient demand history or promise-only dates
          </p>
        </div>
      </section>

      {/* Filter & Search Bar */}
      <section
        aria-label="Inventory Risk Filters"
        className="bg-surface p-4 rounded-lg border border-border-subtle shadow-xs flex flex-wrap items-center gap-3 text-xs font-medium text-text-primary"
      >
        {/* Search input */}
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search component SKU or name..."
              data-testid="search-input"
              className="w-full pl-8 pr-7 py-1.5 bg-elevated border border-border-subtle rounded text-text-primary placeholder:text-text-muted text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
            />
            <span className="absolute left-2.5 top-2 text-text-muted pointer-events-none">🔍</span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-2 top-1.5 text-text-muted hover:text-text-primary text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-risk" className="text-text-secondary font-semibold">
            Risk Level:
          </label>
          <select
            id="filter-risk"
            value={selectedRiskLevel}
            onChange={(e) => handleRiskChange(e.target.value)}
            className="border border-border-subtle rounded px-2.5 py-1.5 bg-elevated text-text-primary focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            {RISK_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-category" className="text-text-secondary font-semibold">
            Category:
          </label>
          <select
            id="filter-category"
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="border border-border-subtle rounded px-2.5 py-1.5 bg-elevated text-text-primary focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-criticality" className="text-text-secondary font-semibold">
            Criticality:
          </label>
          <select
            id="filter-criticality"
            value={selectedCriticality}
            onChange={(e) => handleCriticalityChange(e.target.value)}
            className="border border-border-subtle rounded px-2.5 py-1.5 bg-elevated text-text-primary focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            {CRITICALITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('');
              setSelectedCriticality('');
              setSearchQuery('');
              setSortBy('severity');
              setSortDir('asc');
              setOffset(0);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('risk_level');
                return next;
              });
            }}
            className="text-xs text-cyan-400 hover:text-cyan-300 underline font-semibold ml-auto cursor-pointer"
          >
            Reset Filters
          </button>
        )}
      </section>

      {/* Table Area */}
      <section aria-labelledby="risk-table-heading" className="space-y-4">
        <h2 id="risk-table-heading" className="sr-only">Inventory Intelligence Projections</h2>

        {loading && <LoadingView message="Calculating inventory risk and shortage projections..." />}

        {error && (
          <ErrorView
            error={error}
            onRetry={reload}
            title="Failed to evaluate inventory risk"
          />
        )}

        {data && !loading && (
          <>
            {data.items.length === 0 ? (
              <EmptyView
                title="No components match criteria"
                message="No catalog items matched the selected risk level, search, or category filters."
              />
            ) : (
              <div className="bg-surface border border-border-subtle rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border-subtle text-sm" data-testid="risk-table">
                    <caption className="sr-only">Component inventory risk and predicted shortages</caption>
                    <thead className="bg-[#0b1329] text-text-secondary text-[11px] uppercase font-semibold">
                      <tr>
                        <th
                          scope="col"
                          onClick={() => handleSort('sku')}
                          className="px-4 py-3 text-left cursor-pointer hover:text-text-primary select-none"
                        >
                          <div className="flex items-center gap-1">
                            <span>Component</span>
                            {sortBy === 'sku' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </div>
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">Criticality</th>
                        <th
                          scope="col"
                          onClick={() => handleSort('plant_usable_stock')}
                          className="px-4 py-3 text-right cursor-pointer hover:text-text-primary select-none"
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>Plant Usable</span>
                            {sortBy === 'plant_usable_stock' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                            <InfoTip term={GLOSSARY.usable_stock.term} description={GLOSSARY.usable_stock.definition} />
                          </div>
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">Daily Demand</th>
                        <th
                          scope="col"
                          onClick={() => handleSort('coverage_days')}
                          className="px-4 py-3 text-right cursor-pointer hover:text-text-primary select-none"
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>Coverage Days</span>
                            {sortBy === 'coverage_days' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                            <InfoTip term={GLOSSARY.runway.term} description={GLOSSARY.runway.definition} />
                          </div>
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">Next Replenishment</th>
                        <th
                          scope="col"
                          onClick={() => handleSort('shortage_date')}
                          className="px-4 py-3 text-left cursor-pointer hover:text-text-primary select-none"
                        >
                          <div className="flex items-center gap-1">
                            <span>Predicted Shortage</span>
                            {sortBy === 'shortage_date' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                            <InfoTip term={GLOSSARY.shortage_date.term} description={GLOSSARY.shortage_date.definition} />
                          </div>
                        </th>
                        <th
                          scope="col"
                          onClick={() => handleSort('severity')}
                          className="px-4 py-3 text-left cursor-pointer hover:text-text-primary select-none"
                        >
                          <div className="flex items-center gap-1">
                            <span>Risk Level</span>
                            {sortBy === 'severity' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </div>
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">Recommended Action</th>
                        <th scope="col" className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle bg-surface">
                      {data.items.map((item: InventoryRiskItem) => {
                        const isExpanded = expandedIds.has(item.component_id);

                        return (
                          <React.Fragment key={item.component_id}>
                            <tr
                              className={`hover:bg-elevated/70 transition-colors ${
                                isExpanded ? 'bg-elevated/90' : ''
                              }`}
                              data-testid={`risk-row-${item.sku}`}
                            >
                              <th scope="row" className="px-4 py-3 text-left font-normal">
                                <span className="font-mono font-bold text-text-primary block text-sm">
                                  {item.sku}
                                </span>
                                <span className="text-xs text-text-secondary block">
                                  {item.name}
                                </span>
                                <span className="text-[10px] text-text-muted uppercase">
                                  {item.category}
                                </span>
                              </th>
                              <td className="px-4 py-3">
                                <CriticalityBadge criticality={item.criticality} />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="font-mono font-semibold text-text-primary block">
                                  {item.plant_usable_stock !== null ? formatInteger(item.plant_usable_stock) : '—'}
                                </span>
                                {item.plant_on_hand !== null && (
                                  <span className="text-[10px] text-text-muted block font-mono">
                                    {formatInteger(item.plant_on_hand)} on-hand − {formatInteger(item.plant_reserved || 0)} res
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 font-mono text-right text-text-primary">
                                {item.mean_daily_demand !== null ? `${item.mean_daily_demand.toFixed(1)}/d` : '—'}
                              </td>
                              <td className="px-4 py-3 font-mono text-right">
                                {item.coverage_days !== null ? (
                                  <span
                                    className={`font-semibold ${
                                      item.coverage_days <= 7
                                        ? 'text-red-400'
                                        : item.coverage_days <= 14
                                        ? 'text-amber-400'
                                        : 'text-emerald-400'
                                    }`}
                                  >
                                    {item.coverage_days.toFixed(1)}d
                                  </span>
                                ) : (
                                  <span className="text-text-muted">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs" data-testid={`replenishment-${item.sku}`}>
                                {item.next_replenishment ? (
                                  <div>
                                    <span className="font-mono font-semibold text-text-primary block">
                                      {formatDate(item.next_replenishment.date)}
                                    </span>
                                    <span className="text-text-secondary text-[11px] block">
                                      {formatInteger(item.next_replenishment.qty)} units ({item.next_replenishment.date_basis})
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-text-muted italic">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs" data-testid={`shortage-${item.sku}`}>
                                {item.shortage_date ? (
                                  <div>
                                    <span className="font-mono font-bold text-red-400 block">
                                      {formatDate(item.shortage_date)}
                                    </span>
                                    <span className="text-red-300 font-medium text-[11px] block">
                                      in {item.days_until_shortage} {item.days_until_shortage === 1 ? 'day' : 'days'}
                                    </span>
                                    {item.supply_gap_days !== null && item.supply_gap_days !== undefined && item.supply_gap_days > 0 && (
                                      <span className="text-amber-400 text-[10px] block font-mono">
                                        Gap: {item.supply_gap_days}d
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-text-secondary font-medium">None within horizon</span>
                                )}
                              </td>
                              <td className="px-4 py-3" data-testid={`risk-cell-${item.sku}`}>
                                <div className="flex items-center gap-1.5">
                                  <RiskBadge level={item.risk_level} />
                                  <span className="text-xs text-text-secondary font-medium capitalize sr-only">
                                    {item.risk_level}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs max-w-xs">
                                <div className="space-y-1">
                                  <ActionBadge type={item.recommended_action_type} />
                                  <p className="line-clamp-2 text-text-secondary text-[11px]" title={item.recommended_action || item.risk_reason}>
                                    {item.recommended_action || item.risk_reason}
                                  </p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(item.component_id)}
                                  aria-expanded={isExpanded}
                                  aria-controls={`risk-detail-${item.component_id}`}
                                  className="px-3 py-1 bg-elevated hover:bg-surface text-cyan-300 hover:text-cyan-200 border border-border-subtle rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
                                  data-testid={`toggle-expand-${item.sku}`}
                                >
                                  {isExpanded ? 'Hide Details' : 'View Details'}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={10} className="p-0 border-b border-border-subtle">
                                  <ComponentRiskDetailPanel componentId={item.component_id} />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <Pagination
                  total={data.total}
                  limit={limit}
                  offset={offset}
                  onLimitChange={handleLimitChange}
                  onOffsetChange={(newOffset: number) => setOffset(newOffset)}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
