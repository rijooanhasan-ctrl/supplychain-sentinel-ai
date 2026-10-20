import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSimulation, listComponents } from '../api/endpoints';
import type { Component, SimulationResponse } from '../api/types';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { LoadingView, ErrorView, EmptyView, UnseededView } from '../components/StateViews';
import { CurrencyNotice } from '../components/CurrencyNotice';
import { Badge } from '../components/Badge';
import { formatInteger, formatNumber, formatMoney } from '../lib/format';
import { PAGE_SUBTITLES } from '../constants/pageSubtitles';

function RiskBadge({ level }: { level: string }) {
  const norm = level.toLowerCase();
  switch (norm) {
    case 'critical':
      return <Badge variant="danger">Critical Risk</Badge>;
    case 'high':
      return <Badge variant="warning">High Risk</Badge>;
    case 'medium':
      return <Badge variant="info">Medium Risk</Badge>;
    case 'low':
      return <Badge variant="success">Low Risk</Badge>;
    case 'none':
      return <Badge variant="neutral">No Risk</Badge>;
    default:
      return <Badge variant="neutral">Unknown Risk</Badge>;
  }
}

export function SimulatorPage() {
  const { meta } = useMeta();
  const [searchParams, setSearchParams] = useSearchParams();

  // Components dropdown state
  const [components, setComponents] = useState<Component[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(true);

  // Form inputs state
  const initialComponentId = searchParams.get('component_id')
    ? parseInt(searchParams.get('component_id')!, 10)
    : 1;

  const [selectedComponentId, setSelectedComponentId] = useState<number>(initialComponentId);
  const [supplierDelayDays, setSupplierDelayDays] = useState<number>(0);
  const [demandMultiplier, setDemandMultiplier] = useState<number>(1.0);
  const [onHandDelta, setOnHandDelta] = useState<number>(0);
  const [altSupplierAvailable, setAltSupplierAvailable] = useState<boolean>(true);

  // Validation messages state
  const [validationError, setValidationError] = useState<string | null>(null);

  // Simulation execution state
  const [simData, setSimData] = useState<SimulationResponse | null>(null);
  const [simLoading, setSimLoading] = useState<boolean>(false);
  const [simError, setSimError] = useState<Error | null>(null);

  const componentSelectId = useId();
  const delayInputId = useId();
  const demandInputId = useId();
  const stockInputId = useId();
  const altSupplierCheckboxId = useId();

  // Load components list on mount
  useEffect(() => {
    let active = true;
    listComponents({ limit: 100 })
      .then((res) => {
        if (active) {
          setComponents(res.items);
          setLoadingComponents(false);
          // If no component was selected or selected one not in items, fallback to first
          if (res.items.length > 0 && !res.items.some((c) => c.id === selectedComponentId)) {
            setSelectedComponentId(res.items[0].id);
          }
        }
      })
      .catch(() => {
        if (active) setLoadingComponents(false);
      });
    return () => {
      active = false;
    };
  }, [selectedComponentId]);

  // Synchronize component_id with URL query parameter
  useEffect(() => {
    const qId = searchParams.get('component_id');
    if (qId) {
      const parsed = parseInt(qId, 10);
      if (!isNaN(parsed) && parsed !== selectedComponentId) {
        setSelectedComponentId(parsed);
      }
    }
  }, [searchParams, selectedComponentId]);

  // Run simulation trigger
  const runSim = useCallback(
    async (
      compId: number,
      delay: number,
      mult: number,
      delta: number,
      altAvail: boolean
    ) => {
      // Validate inputs
      if (delay < 0 || delay > 60) {
        setValidationError('Supplier delay must be between 0 and 60 days.');
        return;
      }
      if (mult < 0.5 || mult > 3.0) {
        setValidationError('Demand multiplier must be between 0.5x and 3.0x.');
        return;
      }
      if (delta < -10000 || delta > 10000) {
        setValidationError('Stock adjustment must be between -10,000 and +10,000 units.');
        return;
      }

      setValidationError(null);
      setSimLoading(true);
      setSimError(null);

      try {
        const res = await getSimulation({
          component_id: compId,
          supplier_delay_days: delay,
          demand_multiplier: mult,
          on_hand_delta: delta,
          alt_supplier_available: altAvail,
        });
        setSimData(res);
      } catch (err: unknown) {
        setSimError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setSimLoading(false);
      }
    },
    []
  );

  // Auto-run baseline on initial component selection
  useEffect(() => {
    if (selectedComponentId) {
      runSim(
        selectedComponentId,
        supplierDelayDays,
        demandMultiplier,
        onHandDelta,
        altSupplierAvailable
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComponentId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSearchParams({ component_id: String(selectedComponentId) });
    runSim(
      selectedComponentId,
      supplierDelayDays,
      demandMultiplier,
      onHandDelta,
      altSupplierAvailable
    );
  };

  const handleReset = () => {
    setSupplierDelayDays(0);
    setDemandMultiplier(1.0);
    setOnHandDelta(0);
    setAltSupplierAvailable(true);
    setValidationError(null);
    runSim(selectedComponentId, 0, 1.0, 0, true);
  };

  const applyExampleDelay = () => {
    setSupplierDelayDays(7);
    setDemandMultiplier(1.0);
    setOnHandDelta(0);
    setAltSupplierAvailable(true);
    setValidationError(null);
  };

  const applyExampleDemand = () => {
    setSupplierDelayDays(0);
    setDemandMultiplier(1.3);
    setOnHandDelta(0);
    setAltSupplierAvailable(true);
    setValidationError(null);
  };

  // SVG Chart Computations
  const chartMetrics = useMemo(() => {
    if (!simData?.baseline || !simData?.disrupted || !simData?.recovered) return null;

    const bPts = simData.baseline.daily_projection_30d;
    const dPts = simData.disrupted.daily_projection_30d;
    const rPts = simData.recovered.daily_projection_30d;
    const count = Math.min(bPts.length, dPts.length, rPts.length);

    if (count === 0) return null;

    let maxBal = 0;
    for (let i = 0; i < count; i++) {
      maxBal = Math.max(maxBal, bPts[i].ending_balance, dPts[i].ending_balance, rPts[i].ending_balance);
    }
    maxBal = Math.max(10, Math.ceil(maxBal * 1.1));

    const width = 640;
    const height = 220;
    const padLeft = 55;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;

    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const toCoords = (points: typeof bPts) =>
      points
        .slice(0, count)
        .map((p, i) => {
          const x = padLeft + (i / (count - 1)) * plotW;
          const y = padTop + plotH - (p.ending_balance / maxBal) * plotH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotW,
      plotH,
      maxBal,
      count,
      dates: bPts.map((p) => p.date),
      bPoly: toCoords(bPts),
      dPoly: toCoords(dPts),
      rPoly: toCoords(rPts),
    };
  }, [simData]);

  if (meta && !meta.seeded) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="What-If Disruption Simulator"
          description={PAGE_SUBTITLES.simulator}
        />
        <UnseededView />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="simulator-page">
      <PageHeader
        title="What-If Disruption Simulator"
        description={PAGE_SUBTITLES.simulator}
      />

      <CurrencyNotice meta={meta} />

      {/* Permanent Warning Banner */}
      <div
        className="p-4 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg shadow-xs text-amber-950 text-xs md:text-sm font-medium flex items-start gap-3"
        data-testid="permanent-simulator-note"
      >
        <span className="text-amber-600 text-base leading-none select-none font-bold">ℹ</span>
        <div className="flex-1">
          <span className="font-bold block text-amber-900 mb-0.5">
            What-if simulation. Nothing is saved and no orders are created.
          </span>
          <p className="text-amber-800 text-xs">
            Simulations evaluate hypothetical scenarios strictly for decision support. Real system inventory,
            customer commitments, and purchase orders are not modified.
          </p>
        </div>
      </div>

      {/* Control Panel Card */}
      <section className="bg-surface p-5 rounded-lg border border-border-subtle shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary">
            Simulation Parameters &amp; Presets
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary font-medium">Presets:</span>
            <button
              type="button"
              onClick={applyExampleDelay}
              className="text-xs px-2.5 py-1 rounded bg-elevated hover:bg-surface text-text-primary font-medium transition-colors border border-border-subtle"
              data-testid="preset-delay-btn"
            >
              Example: supplier +7 days late
            </button>
            <button
              type="button"
              onClick={applyExampleDemand}
              className="text-xs px-2.5 py-1 rounded bg-elevated hover:bg-surface text-text-primary font-medium transition-colors border border-border-subtle"
              data-testid="preset-demand-btn"
            >
              Example: demand +30%
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Component Select */}
            <div>
              <label htmlFor={componentSelectId} className="block text-xs font-semibold text-text-primary mb-1">
                Component
              </label>
              <select
                id={componentSelectId}
                value={selectedComponentId}
                onChange={(e) => setSelectedComponentId(parseInt(e.target.value, 10))}
                disabled={loadingComponents}
                className="w-full text-xs font-mono py-2 px-2.5 border border-border-subtle rounded-md bg-surface text-text-primary focus:ring-2 focus:ring-accent-primary focus:border-blue-500"
                data-testid="component-select"
              >
                {components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.sku} - {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Supplier Delay */}
            <div>
              <label htmlFor={delayInputId} className="block text-xs font-semibold text-text-primary mb-1">
                Supplier Delay (days)
              </label>
              <input
                id={delayInputId}
                type="number"
                min={0}
                max={60}
                value={supplierDelayDays}
                onChange={(e) => setSupplierDelayDays(parseInt(e.target.value, 10) || 0)}
                className="w-full text-xs font-mono py-2 px-2.5 border border-border-subtle rounded-md bg-surface text-text-primary focus:ring-2 focus:ring-accent-primary"
                data-testid="delay-input"
              />
              <span className="text-[10px] text-text-secondary">Range: 0 to 60 days</span>
            </div>

            {/* Demand Multiplier */}
            <div>
              <label htmlFor={demandInputId} className="block text-xs font-semibold text-text-primary mb-1">
                Demand Level (multiplier)
              </label>
              <input
                id={demandInputId}
                type="number"
                step={0.1}
                min={0.5}
                max={3.0}
                value={demandMultiplier}
                onChange={(e) => setDemandMultiplier(parseFloat(e.target.value) || 1.0)}
                className="w-full text-xs font-mono py-2 px-2.5 border border-border-subtle rounded-md bg-surface text-text-primary focus:ring-2 focus:ring-accent-primary"
                data-testid="demand-input"
              />
              <span className="text-[10px] text-text-secondary">Range: 0.5x to 3.0x</span>
            </div>

            {/* Stock Change (on-hand delta) */}
            <div>
              <label htmlFor={stockInputId} className="block text-xs font-semibold text-text-primary mb-1">
                Stock Change (units)
              </label>
              <input
                id={stockInputId}
                type="number"
                step={10}
                min={-10000}
                max={10000}
                value={onHandDelta}
                onChange={(e) => setOnHandDelta(parseInt(e.target.value, 10) || 0)}
                className="w-full text-xs font-mono py-2 px-2.5 border border-border-subtle rounded-md bg-surface text-text-primary focus:ring-2 focus:ring-accent-primary"
                data-testid="stock-input"
              />
              <span className="text-[10px] text-text-secondary">Adjustment: -10k to +10k</span>
            </div>

            {/* Alt Supplier Checkbox */}
            <div className="flex flex-col justify-center">
              <label
                htmlFor={altSupplierCheckboxId}
                className="flex items-center gap-2 text-xs font-semibold text-text-primary cursor-pointer pt-3 sm:pt-4"
              >
                <input
                  id={altSupplierCheckboxId}
                  type="checkbox"
                  checked={altSupplierAvailable}
                  onChange={(e) => setAltSupplierAvailable(e.target.checked)}
                  className="rounded border-border-subtle text-blue-600 focus:ring-accent-primary w-4 h-4"
                  data-testid="alt-supplier-checkbox"
                />
                <span>Alternative Supplier Available</span>
              </label>
              <span className="text-[10px] text-text-secondary ml-6">Include in recovery search</span>
            </div>
          </div>

          {/* Validation Error Message */}
          {validationError && (
            <div
              className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md"
              data-testid="validation-error"
            >
              {validationError}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="px-3.5 py-1.5 text-xs font-semibold text-text-primary bg-elevated hover:bg-surface border border-border-subtle rounded-md transition-colors"
              data-testid="reset-btn"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={simLoading}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-xs disabled:opacity-50"
              data-testid="run-sim-btn"
            >
              {simLoading ? 'Simulating...' : 'Run Simulation'}
            </button>
          </div>
        </form>
      </section>

      {/* Error state */}
      {simError && (
        <ErrorView
          error={simError}
          onRetry={() =>
            runSim(
              selectedComponentId,
              supplierDelayDays,
              demandMultiplier,
              onHandDelta,
              altSupplierAvailable
            )
          }
        />
      )}

      {/* Loading state */}
      {simLoading && <LoadingView message="Computing comparative scenarios..." />}

      {/* Results View */}
      {!simLoading && !simError && simData && simData.baseline && simData.disrupted && simData.recovered && (
        <div className="space-y-6" data-testid="simulation-results">
          {/* Header Info */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-4 rounded-lg border border-border-subtle shadow-xs">
            <div>
              <span className="text-xs uppercase font-bold tracking-wider text-text-secondary block">
                Simulated Target Component
              </span>
              <h2 className="text-lg font-bold text-text-primary">
                {simData.component?.name}{' '}
                <span className="text-sm font-mono text-text-secondary">({simData.component?.sku})</span>
              </h2>
            </div>
            <div className="text-xs text-right font-mono text-text-secondary">
              As-Of Baseline:{' '}
              <span className="font-bold text-text-primary">{simData.as_of}</span>
            </div>
          </div>

          {/* 3-Column Comparison Table */}
          <div className="bg-surface rounded-lg border border-border-subtle shadow-xs overflow-hidden">
            <div className="p-3.5 border-b border-border-subtle bg-elevated/70">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Scenario Comparison: Baseline vs Disrupted vs With Recovery
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table
                className="w-full text-left text-xs divide-y divide-border-subtle"
                data-testid="comparison-table"
              >
                <thead className="bg-elevated/90 text-text-primary font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4 w-48">Metric</th>
                    <th className="py-2.5 px-4">1. Baseline (Unchanged)</th>
                    <th className="py-2.5 px-4 bg-red-50/50">2. Disrupted (With Shock)</th>
                    <th className="py-2.5 px-4 bg-emerald-50/50">3. With Recovery (Intervention)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle font-mono">
                  {/* Risk Level */}
                  <tr>
                    <td className="py-2.5 px-4 font-sans font-semibold text-text-primary">Risk Level</td>
                    <td className="py-2.5 px-4">
                      <RiskBadge level={simData.baseline.risk_level} />
                    </td>
                    <td className="py-2.5 px-4 bg-red-50/30">
                      <RiskBadge level={simData.disrupted.risk_level} />
                    </td>
                    <td className="py-2.5 px-4 bg-emerald-50/30">
                      <RiskBadge level={simData.recovered.risk_level} />
                    </td>
                  </tr>

                  {/* Shortage Date */}
                  <tr>
                    <td className="py-2.5 px-4 font-sans font-semibold text-text-primary">Shortage Date</td>
                    <td className="py-2.5 px-4">
                      {simData.baseline.shortage_date ? (
                        <span className="text-red-700 font-bold">{simData.baseline.shortage_date}</span>
                      ) : (
                        <span className="text-emerald-700 font-bold">No Shortage</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 bg-red-50/30">
                      {simData.disrupted.shortage_date ? (
                        <span className="text-red-700 font-bold">{simData.disrupted.shortage_date}</span>
                      ) : (
                        <span className="text-emerald-700 font-bold">No Shortage</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 bg-emerald-50/30">
                      {simData.recovered.shortage_date ? (
                        <span className="text-text-primary font-bold">{simData.recovered.shortage_date}</span>
                      ) : (
                        <span className="text-emerald-700 font-bold">No Shortage</span>
                      )}
                    </td>
                  </tr>

                  {/* First Shortage Window */}
                  <tr>
                    <td className="py-2.5 px-4 font-sans font-semibold text-text-primary">Shortage Window</td>
                    <td className="py-2.5 px-4">
                      {simData.baseline.first_shortage_episode ? (
                        <span>
                          {simData.baseline.first_shortage_episode.days} days (
                          {simData.baseline.first_shortage_episode.start_date} ..{' '}
                          {simData.baseline.first_shortage_episode.end_date})
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4 bg-red-50/30">
                      {simData.disrupted.first_shortage_episode ? (
                        <span className="text-red-800 font-bold">
                          {simData.disrupted.first_shortage_episode.days} days (
                          {simData.disrupted.first_shortage_episode.start_date} ..{' '}
                          {simData.disrupted.first_shortage_episode.end_date})
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4 bg-emerald-50/30">
                      {simData.recovered.first_shortage_episode ? (
                        <span className="text-text-primary">
                          {simData.recovered.first_shortage_episode.days} days (
                          {simData.recovered.first_shortage_episode.start_date} ..{' '}
                          {simData.recovered.first_shortage_episode.end_date})
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">Eliminated</span>
                      )}
                    </td>
                  </tr>

                  {/* Units Short Before Next Inbound */}
                  <tr>
                    <td className="py-2.5 px-4 font-sans font-semibold text-text-primary">
                      Units Short (Pre-Inbound)
                    </td>
                    <td className="py-2.5 px-4 font-bold text-text-primary">
                      {formatNumber(simData.baseline.unmet_before_next_inbound, 1)} units
                    </td>
                    <td className="py-2.5 px-4 bg-red-50/30 font-bold text-red-700">
                      {formatNumber(simData.disrupted.unmet_before_next_inbound, 1)} units
                    </td>
                    <td className="py-2.5 px-4 bg-emerald-50/30 font-bold text-emerald-800">
                      {simData.recovered.shortage_resolved_for_first_window
                        ? '0.0 units (Resolved)'
                        : `${formatNumber(simData.recovered.unmet_before_next_inbound, 1)} units`}
                    </td>
                  </tr>

                  {/* Later Shortage (Not Covered) Row */}
                  <tr>
                    <td className="py-2.5 px-4 font-sans font-semibold text-text-primary">
                      Later shortage (not covered)
                    </td>
                    <td className="py-2.5 px-4 text-xs font-sans text-text-secondary">
                      {simData.baseline.later_shortage ? (
                        <span>
                          From {simData.baseline.later_shortage.date} ({simData.baseline.later_shortage.days} days,{' '}
                          {formatNumber(simData.baseline.later_shortage.units, 1)} units)
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4 bg-red-50/30 text-xs font-sans text-red-800">
                      {simData.disrupted.later_shortage ? (
                        <span>
                          From {simData.disrupted.later_shortage.date} ({simData.disrupted.later_shortage.days} days,{' '}
                          {formatNumber(simData.disrupted.later_shortage.units, 1)} units)
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4 bg-emerald-50/30 text-xs font-sans text-text-primary">
                      {simData.recovered.later_shortage ? (
                        <div>
                          <span className="font-medium text-amber-900">
                            From {simData.recovered.later_shortage.date} ({simData.recovered.later_shortage.days} days,{' '}
                            {formatNumber(simData.recovered.later_shortage.units, 1)} units)
                          </span>
                          <span className="block text-[10px] text-text-secondary italic">
                            Later shortage not covered by this recovery
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>

                  {/* Exposed Orders & Revenue */}
                  <tr>
                    <td className="py-2.5 px-4 font-sans font-semibold text-text-primary">
                      Customer Exposure
                    </td>
                    <td className="py-2.5 px-4 text-xs font-sans">
                      <div>
                        <span className="font-bold text-text-primary">
                          {formatInteger(simData.baseline.exposed_orders_count)} orders
                        </span>{' '}
                        · Selling Value:{' '}
                        <span className="font-bold text-text-primary">
                          {simData.baseline.exposed_revenue !== null
                            ? formatMoney(simData.baseline.exposed_revenue, meta)
                            : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 bg-red-50/30 text-xs font-sans">
                      <div>
                        <span className="font-bold text-red-900">
                          {formatInteger(simData.disrupted.exposed_orders_count)} orders
                        </span>{' '}
                        · Selling Value:{' '}
                        <span className="font-bold text-red-900">
                          {simData.disrupted.exposed_revenue !== null
                            ? formatMoney(simData.disrupted.exposed_revenue, meta)
                            : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 bg-emerald-50/30 text-xs font-sans">
                      <div>
                        <span className="font-bold text-emerald-950">
                          {formatInteger(simData.recovered.exposed_orders_count)} orders
                        </span>{' '}
                        · Selling Value:{' '}
                        <span className="font-bold text-emerald-950">
                          {simData.recovered.exposed_revenue !== null
                            ? formatMoney(simData.recovered.exposed_revenue, meta)
                            : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>

                  {/* Recovery Action Row */}
                  <tr>
                    <td className="py-2.5 px-4 font-sans font-semibold text-text-primary">
                      Intervention Applied
                    </td>
                    <td className="py-2.5 px-4 text-text-muted font-sans italic">—</td>
                    <td className="py-2.5 px-4 bg-red-50/30 text-text-muted font-sans italic">—</td>
                    <td className="py-2.5 px-4 bg-emerald-50/30 font-sans">
                      {simData.recovered.applied_actions.length > 0 ? (
                        <div className="space-y-1">
                          {simData.recovered.applied_actions.map((act) => (
                            <div key={act.id} className="text-xs">
                              <span className="font-bold text-text-primary block">{act.description}</span>
                              <span className="text-[11px] text-text-secondary font-mono">
                                Qty: {formatInteger(act.quantity)} · Arrival:{' '}
                                {act.arrival_date || '—'} · Cost:{' '}
                                {act.cost_known && act.incremental_cost !== null
                                  ? formatMoney(act.incremental_cost, meta)
                                  : 'Unknown'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-text-secondary italic text-xs">
                          {simData.recovered.recovery_note || 'No action needed'}
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mandatory Upper-Bound Disclosure */}
            <div className="p-3 bg-elevated border-t border-border-subtle text-[11px] text-text-secondary italic">
              * Upper bound: production lead time and stock allocation are unknown, so these orders are
              potentially exposed, not predicted to be late. The value shown is the selling price of those
              orders, not an estimate of loss.
            </div>
          </div>

          {/* What Changed Summary Card */}
          <div
            className="bg-blue-50/60 p-4 rounded-lg border border-blue-200 space-y-2"
            data-testid="what-changed-card"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-900">
              What Changed in This Simulation
            </h3>
            <ul className="list-disc list-inside space-y-1 text-xs text-blue-950 font-medium">
              {simData.what_changed.map((sentence, idx) => (
                <li key={idx}>{sentence}</li>
              ))}
            </ul>
          </div>

          {/* SVG Line Chart: 30-Day Ending Stock Balance */}
          {chartMetrics && (
            <div className="bg-surface p-5 rounded-lg border border-border-subtle shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">
                    30-Day Ending Inventory Balance Trajectory
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Comparative daily stock balance across baseline, disrupted, and recovered scenarios.
                  </p>
                </div>

                {/* Accessible Text Legend with line style patterns */}
                <div
                  className="flex flex-wrap items-center gap-4 text-xs font-semibold"
                  data-testid="chart-legend"
                >
                  <span className="flex items-center gap-1.5 text-blue-700">
                    <span className="inline-block w-6 border-t-2 border-blue-600" />
                    —— Solid: Baseline
                  </span>
                  <span className="flex items-center gap-1.5 text-red-700">
                    <span className="inline-block w-6 border-t-2 border-dashed border-red-600" />
                    - - - Dashed: Disrupted
                  </span>
                  <span className="flex items-center gap-1.5 text-emerald-700">
                    <span className="inline-block w-6 border-t-2 border-dotted border-emerald-600" />
                    ···· Dotted: With Recovery
                  </span>
                </div>
              </div>

              {/* Hand-built SVG Visualization */}
              <div className="overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartMetrics.width} ${chartMetrics.height}`}
                  className="w-full max-w-2xl h-auto mx-auto select-none"
                  aria-label="30-day inventory trajectory line chart"
                  role="img"
                >
                  {/* Grid Lines */}
                  <line
                    x1={chartMetrics.padLeft}
                    y1={chartMetrics.padTop}
                    x2={chartMetrics.width - chartMetrics.padRight}
                    y2={chartMetrics.padTop}
                    stroke="var(--border-subtle)"
                    strokeWidth="1"
                  />
                  <line
                    x1={chartMetrics.padLeft}
                    y1={chartMetrics.padTop + chartMetrics.plotH / 2}
                    x2={chartMetrics.width - chartMetrics.padRight}
                    y2={chartMetrics.padTop + chartMetrics.plotH / 2}
                    stroke="var(--border-subtle)"
                    strokeWidth="1"
                  />
                  <line
                    x1={chartMetrics.padLeft}
                    y1={chartMetrics.padTop + chartMetrics.plotH}
                    x2={chartMetrics.width - chartMetrics.padRight}
                    y2={chartMetrics.padTop + chartMetrics.plotH}
                    stroke="var(--border-subtle)"
                    strokeWidth="1.5"
                  />

                  {/* Y-Axis Labels */}
                  <text
                    x={chartMetrics.padLeft - 8}
                    y={chartMetrics.padTop + 4}
                    textAnchor="end"
                    className="text-[10px] font-mono fill-slate-500"
                  >
                    {formatInteger(chartMetrics.maxBal)}
                  </text>
                  <text
                    x={chartMetrics.padLeft - 8}
                    y={chartMetrics.padTop + chartMetrics.plotH / 2 + 4}
                    textAnchor="end"
                    className="text-[10px] font-mono fill-slate-500"
                  >
                    {formatInteger(Math.round(chartMetrics.maxBal / 2))}
                  </text>
                  <text
                    x={chartMetrics.padLeft - 8}
                    y={chartMetrics.padTop + chartMetrics.plotH + 4}
                    textAnchor="end"
                    className="text-[10px] font-mono fill-slate-500"
                  >
                    0
                  </text>

                  {/* Baseline Polyline (Solid Blue) */}
                  <polyline
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2.5"
                    points={chartMetrics.bPoly}
                  />

                  {/* Disrupted Polyline (Dashed Red) */}
                  <polyline
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth="2.5"
                    strokeDasharray="6 3"
                    points={chartMetrics.dPoly}
                  />

                  {/* Recovered Polyline (Dotted Green) */}
                  <polyline
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth="2.5"
                    strokeDasharray="3 3"
                    points={chartMetrics.rPoly}
                  />

                  {/* X-Axis Labels (Day 0, 7, 14, 21, 28) */}
                  {[0, 7, 14, 21, 28].map((dayIdx) => {
                    const x =
                      chartMetrics.padLeft +
                      (dayIdx / (chartMetrics.count - 1)) * chartMetrics.plotW;
                    const dateStr = chartMetrics.dates[dayIdx] || `+${dayIdx}d`;
                    return (
                      <g key={dayIdx} transform={`translate(${x}, ${chartMetrics.padTop + chartMetrics.plotH + 15})`}>
                        <line y1="-3" y2="3" stroke="#94a3b8" />
                        <text
                          y="12"
                          textAnchor="middle"
                          className="text-[9px] font-mono fill-slate-600"
                        >
                          {dateStr}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Accessible Alternative: Daily Projection Data Table */}
              <div className="pt-2">
                <span className="text-xs font-semibold text-text-primary block mb-1">
                  Daily Ending Stock Balance (Accessible Alternative)
                </span>
                <div className="overflow-x-auto max-h-60 overflow-y-auto border border-border-subtle rounded-md">
                  <table
                    className="w-full text-left text-xs divide-y divide-border-subtle font-mono"
                    data-testid="projection-table"
                  >
                    <thead className="bg-elevated text-text-primary font-semibold sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3 text-right">Baseline Stock</th>
                        <th className="py-2 px-3 text-right bg-red-50/50">Disrupted Stock</th>
                        <th className="py-2 px-3 text-right bg-emerald-50/50">Recovered Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {simData.baseline.daily_projection_30d.map((row, idx) => {
                        const dRow = simData.disrupted?.daily_projection_30d[idx];
                        const rRow = simData.recovered?.daily_projection_30d[idx];
                        return (
                          <tr key={row.date} className="hover:bg-elevated/50">
                            <td className="py-1 px-3 text-text-primary">{row.date}</td>
                            <td className="py-1 px-3 text-right text-text-primary">
                              {formatNumber(row.ending_balance, 0)}
                            </td>
                            <td className="py-1 px-3 text-right text-red-800 bg-red-50/30 font-semibold">
                              {dRow ? formatNumber(dRow.ending_balance, 0) : '—'}
                            </td>
                            <td className="py-1 px-3 text-right text-emerald-800 bg-emerald-50/30 font-semibold">
                              {rRow ? formatNumber(rRow.ending_balance, 0) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Assumptions Box */}
          <div className="p-4 bg-elevated rounded-lg border border-border-subtle text-xs text-text-secondary space-y-1">
            <span className="font-bold text-text-primary block">Simulation Model Assumptions:</span>
            <ul className="list-disc list-inside space-y-0.5 text-text-secondary">
              {simData.assumptions.map((asm, i) => (
                <li key={i}>{asm}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Empty State before first simulation */}
      {!simLoading && !simError && !simData && (
        <EmptyView message="Select a component and click Run Simulation to view comparative what-if scenarios." />
      )}
    </div>
  );
}

export default SimulatorPage;
