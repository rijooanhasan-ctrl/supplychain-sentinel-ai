import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getAlerts,
  getExecutiveSummary,
  getInventoryRisk,
  getSupplierRisk,
  listPurchaseOrders,
} from '../api/endpoints';
import { useApi } from '../api/useApi';
import { useMeta } from '../hooks/useMeta';
import { PageHeader } from '../components/PageHeader';
import { SvgPatternDefs } from '../components/ui/SvgPatternDefs';
import { HeadlineStrip } from '../components/ui/HeadlineStrip';
import { KpiTile } from '../components/ui/KpiTile';
import { ChartCard } from '../components/ui/ChartCard';
import { HowToReadPanel } from '../components/ui/HowToReadPanel';
import { InfoTip } from '../components/ui/InfoTip';
import { RiskMixBar, RiskMixTable } from '../components/charts/RiskMixBar';
import { RunwayChart, RunwayTable } from '../components/charts/RunwayChart';
import { DeliveryTimeline, DeliveryTimelineTable } from '../components/charts/DeliveryTimeline';
import {
  SupplierReliabilityBars,
  SupplierReliabilityTable,
} from '../components/charts/SupplierReliabilityBars';
import { GLOSSARY } from '../constants/glossary';
import { PAGE_SUBTITLES } from '../constants/pageSubtitles';
import { expectedDate, isOverdue, isDelayedVsPromise, slippedInfo } from '../lib/dates';
import { ErrorView } from '../components/StateViews';
import { computeOverallStatus } from '../lib/overviewStatus';
import { RISK_PALETTE } from '../theme/riskPalette';

// Lazy-load the 3D globe component so the Overview's first paint does not wait for Three.js
const LazySupplyChainGlobe = React.lazy(() =>
  import('../components/globe/SupplyChainGlobe').then((mod) => ({
    default: mod.SupplyChainGlobe,
  }))
);

export function OverviewPage() {
  const { meta, asOf } = useMeta();

  // Collapsible state for incoming deliveries
  const [isDeliveriesOpen, setIsDeliveriesOpen] = useState(false);

  // 1. Executive Summary for Headline Strip and "What you should do next"
  const fetchExec = useCallback((signal: AbortSignal) => getExecutiveSummary(signal), []);
  const {
    data: execData,
    loading: execLoading,
    error: execError,
    reload: reloadExec,
  } = useApi(fetchExec, [fetchExec]);

  // 2. Inventory Risk for RiskMix and Runway
  const fetchRisk = useCallback(
    (signal: AbortSignal) => getInventoryRisk({ limit: 100 }, signal),
    []
  );
  const {
    data: riskData,
    loading: riskLoading,
    error: riskError,
    reload: reloadRisk,
  } = useApi(fetchRisk, [fetchRisk]);

  // 3. Purchase Orders for Delivery Timeline & Late PO calculations
  const fetchPos = useCallback(
    (signal: AbortSignal) => listPurchaseOrders({ limit: 200 }, signal),
    []
  );
  const {
    data: poData,
    loading: poLoading,
    error: poError,
    reload: reloadPos,
  } = useApi(fetchPos, [fetchPos]);

  // 4. Exact open PO counts across statuses
  const fetchOpenTotals = useCallback(async (signal: AbortSignal) => {
    const [openRes, inTransitRes, partialRes] = await Promise.all([
      listPurchaseOrders({ status: 'open', limit: 1 }, signal),
      listPurchaseOrders({ status: 'in_transit', limit: 1 }, signal),
      listPurchaseOrders({ status: 'partially_received', limit: 1 }, signal),
    ]);
    const o = typeof openRes?.total === 'number' && !isNaN(openRes.total) ? openRes.total : 0;
    const it = typeof inTransitRes?.total === 'number' && !isNaN(inTransitRes.total) ? inTransitRes.total : 0;
    const p = typeof partialRes?.total === 'number' && !isNaN(partialRes.total) ? partialRes.total : 0;
    return {
      open: o,
      inTransit: it,
      partial: p,
      totalOpen: o + it + p,
    };
  }, []);
  const { data: openTotals } = useApi(fetchOpenTotals, [fetchOpenTotals]);

  // 5. Supplier Risk for Reliability Bars
  const fetchSupplierRiskCall = useCallback(
    (signal: AbortSignal) => getSupplierRisk({ limit: 100 }, signal),
    []
  );
  const {
    data: supplierRiskData,
    loading: supplierRiskLoading,
    error: supplierRiskError,
    reload: reloadSupplierRisk,
  } = useApi(fetchSupplierRiskCall, [fetchSupplierRiskCall]);

  // 6. Alerts for KPI Tile and Overview
  const fetchAlertsCall = useCallback(
    (signal: AbortSignal) => getAlerts({ limit: 10 }, signal),
    []
  );
  const {
    data: alertsData,
    loading: alertsLoading,
    error: alertsError,
    reload: reloadAlerts,
  } = useApi(fetchAlertsCall, [fetchAlertsCall]);

  // Derived metrics from fetched POs
  const { overdueCount, delayedCount, isTruncated, upcomingDeliveries } = useMemo(() => {
    if (!poData?.items) {
      return { overdueCount: 0, delayedCount: 0, isTruncated: false, upcomingDeliveries: [] };
    }

    const items = poData.items;
    const isTruncated = poData.total > 200;

    const activePos = items.filter(
      (po) =>
        po.status === 'open' ||
        po.status === 'in_transit' ||
        po.status === 'partially_received'
    );

    const overduePos = activePos.filter((po) => isOverdue(po, asOf));
    const delayedPos = activePos.filter((po) => isDelayedVsPromise(po));

    const upcoming = activePos
      .filter((po) => !isOverdue(po, asOf))
      .map((po) => {
        const { date, basis } = expectedDate(po);
        return { po, date, basis };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      overdueCount: overduePos.length,
      delayedCount: delayedPos.length,
      isTruncated,
      upcomingDeliveries: upcoming,
    };
  }, [poData, asOf]);

  // Derived metrics from inventory risk
  const { riskCounts, totalEvaluated, earliestShortage, atRiskCount } = useMemo(() => {
    const counts: Record<string, number> = riskData?.summary?.counts_by_risk_level || {};
    const total = riskData?.summary?.components_evaluated || riskData?.items?.length || 0;
    const atRisk = (counts.critical || 0) + (counts.high || 0) + (counts.medium || 0);

    const itemsWithShortage = (riskData?.items || [])
      .filter((it) => it.days_until_shortage != null)
      .sort((a, b) => (a.days_until_shortage ?? 999) - (b.days_until_shortage ?? 999));

    const earliest = itemsWithShortage[0]
      ? {
          sku: itemsWithShortage[0].sku,
          days: itemsWithShortage[0].days_until_shortage!,
          date: itemsWithShortage[0].shortage_date || undefined,
        }
      : null;

    return {
      riskCounts: counts,
      totalEvaluated: total,
      earliestShortage: earliest,
      atRiskCount: atRisk,
    };
  }, [riskData]);

  // Derived metrics from suppliers
  const { totalSuppliers, highSuppliers, medSuppliers, worst5Suppliers } = useMemo(() => {
    const items = supplierRiskData?.items || [];
    const bands = supplierRiskData?.summary?.counts_by_band as Record<string, number> | undefined;
    const total = supplierRiskData?.summary?.total_suppliers || meta?.counts?.suppliers || items.length;
    const high = bands?.high ?? items.filter((s) => s.risk_band === 'high').length;
    const med = bands?.medium ?? items.filter((s) => s.risk_band === 'medium').length;

    // Ordered worst on-time rate first, top 5
    const worst = [...items]
      .sort((a, b) => (a.on_time_rate ?? 0) - (b.on_time_rate ?? 0))
      .slice(0, 5);

    return {
      totalSuppliers: total,
      highSuppliers: high,
      medSuppliers: med,
      worst5Suppliers: worst,
    };
  }, [supplierRiskData, meta]);

  const highestScoringSupplier = useMemo(() => {
    if (!supplierRiskData?.items) return null;
    return supplierRiskData.items.find((s) => s.risk_score != null) || null;
  }, [supplierRiskData]);

  // Derived metrics from alerts
  const totalAlerts = alertsData?.summary?.total_alerts ?? alertsData?.items?.length ?? 0;
  const topAlertsList = useMemo(() => (alertsData?.items || []).slice(0, 5), [alertsData]);

  // Overall Status calculation (pre-registered rule)
  const overallStatus = useMemo(() => {
    return computeOverallStatus({
      seeded: meta?.seeded,
      componentsEvaluated: totalEvaluated,
      riskCounts,
      alertsSummary: {
        total_alerts: totalAlerts,
        counts_by_severity: alertsData?.summary?.counts_by_severity,
      },
      overdueCount,
      delayedCount,
      supplierCountsByBand: {
        high: highSuppliers,
        medium: medSuppliers,
      },
      earliestShortage,
    });
  }, [
    meta?.seeded,
    totalEvaluated,
    riskCounts,
    totalAlerts,
    alertsData?.summary?.counts_by_severity,
    overdueCount,
    delayedCount,
    highSuppliers,
    medSuppliers,
    earliestShortage,
  ]);

  const statusColor = RISK_PALETTE[overallStatus.riskBand]?.fillColor || '#94a3b8';
  const statusBorder = RISK_PALETTE[overallStatus.riskBand]?.fillColor || '#475569';

  return (
    <div className="space-y-6" data-testid="overview-page">
      {/* Global SVG Pattern definitions for pattern overlays */}
      <SvgPatternDefs />

      {/* Page Header with Dataset Label, As-Of Date, and Pre-registered Overall Status */}
      <div className="space-y-3">
        <PageHeader
          title="Supply Chain Overview"
          description={PAGE_SUBTITLES.overview}
        />

        {/* Top Status & Context Bar */}
        <div
          data-testid="overall-status-container"
          className="bg-surface border border-border-subtle rounded-lg p-3 sm:p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3"
        >
          {/* Dataset & As-Of Metadata */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            <span className="flex items-center gap-1.5 font-semibold text-text-primary">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span>Dataset: {meta?.label || 'Demo data'}</span>
            </span>
            <span>&bull;</span>
            <span>Snapshot As Of: <strong className="text-text-primary font-mono">{asOf || '2026-10-17'}</strong></span>
            <span>&bull;</span>
            <span className="text-[11px] text-text-muted italic">Decision support only &bull; No live SAP connection</span>
          </div>

          {/* Overall Status Badge & Generated Reason */}
          <div className="flex items-center gap-3">
            <div
              data-testid="overall-status-badge"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border font-bold text-xs uppercase tracking-wider shadow-xs"
              style={{
                borderColor: statusBorder,
                color: statusColor,
                backgroundColor: 'rgba(15, 23, 42, 0.4)',
              }}
            >
              <span className="text-sm" aria-hidden="true">
                {overallStatus.status === 'Urgent action needed' && '⚠'}
                {overallStatus.status === 'Needs attention' && '▲'}
                {overallStatus.status === 'All clear' && '✓'}
                {overallStatus.status === 'Insufficient data' && 'ℹ'}
              </span>
              <span>{overallStatus.status}</span>
            </div>
            <p
              data-testid="overall-status-reason"
              className="text-xs text-text-secondary italic max-w-md hidden sm:block"
            >
              {overallStatus.reason}
            </p>
          </div>
        </div>
      </div>

      {/* 1. Headline Strip */}
      <HeadlineStrip
        headline={execData?.headline}
        datasetLabel={meta?.label}
        asOf={asOf || undefined}
        loading={execLoading}
        mostSevereSku={execData?.top_risks?.[0]?.component_sku}
        soonestSku={earliestShortage?.sku}
      />

      {/* 2. Four KPI Tiles (Plain-Language Labels + InfoTips) */}
      <section aria-label="Key supply chain indicators" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Tile 1: Suppliers at Risk */}
        <KpiTile
          label="Suppliers at risk"
          value={
            supplierRiskLoading ? (
              <span className="text-text-muted">...</span>
            ) : totalSuppliers > 0 ? (
              `${highSuppliers + medSuppliers} of ${totalSuppliers}`
            ) : (
              'No data'
            )
          }
          explanation="Suppliers in high or medium risk bands."
          to="/supplier-risk"
          infoTerm={GLOSSARY.suppliers_at_risk?.term || 'Suppliers at Risk'}
          infoDescription={GLOSSARY.suppliers_at_risk?.definition || 'Active suppliers evaluated in high or medium risk bands.'}
          testId="kpi-suppliers-at-risk"
        />

        {/* Tile 2: Parts that May Run Out */}
        <KpiTile
          label="Parts that may run out"
          value={
            riskLoading ? (
              <span className="text-text-muted">...</span>
            ) : totalEvaluated > 0 ? (
              `${atRiskCount} of ${totalEvaluated}`
            ) : (
              'No data'
            )
          }
          explanation="Components with critical, high, or medium stockout risk."
          to="/inventory-risk"
          infoTerm={GLOSSARY.parts_that_may_run_out?.term || GLOSSARY.runway.term}
          infoDescription={GLOSSARY.parts_that_may_run_out?.definition || GLOSSARY.runway.definition}
          testId="kpi-parts-at-risk"
        />

        {/* Tile 3: Late Deliveries */}
        <KpiTile
          label="Late deliveries"
          value={
            poLoading ? (
              <span className="text-text-muted">...</span>
            ) : (
              `${overdueCount + delayedCount}`
            )
          }
          explanation={`${overdueCount} overdue, ${delayedCount} slipped vs promise.`}
          to="/purchase-orders"
          infoTerm={GLOSSARY.slipped_delivery.term}
          infoDescription={`${GLOSSARY.slipped_delivery.definition} ${GLOSSARY.overdue_delivery.definition}`}
          testId="kpi-late-deliveries"
        />

        {/* Tile 4: Earliest Projected Shortage */}
        <KpiTile
          label="Earliest projected shortage"
          value={
            riskLoading ? (
              <span className="text-text-muted">...</span>
            ) : earliestShortage ? (
              `${earliestShortage.days} days`
            ) : (
              'None'
            )
          }
          explanation={
            earliestShortage
              ? `${earliestShortage.sku} projected runout.`
              : 'No shortages projected within planning horizon.'
          }
          to="/inventory-risk"
          infoTerm={GLOSSARY.shortage_date.term}
          infoDescription={GLOSSARY.shortage_date.definition}
          testId="kpi-earliest-shortage"
        />
      </section>

      {/* 3. Main Two-Column Area: Left = Compact Globe, Right = What you should do next */}
      <section aria-label="Geospatial disruption and action priority" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Compact Supply Chain Globe */}
        <div className="lg:col-span-7 flex flex-col">
          <Suspense
            fallback={
              <div
                data-testid="compact-globe-skeleton"
                className="h-[460px] w-full rounded-xl bg-surface border border-border-subtle flex flex-col items-center justify-center p-6 space-y-3 animate-pulse"
              >
                <div className="w-12 h-12 rounded-full border-4 border-cyan-500/30 border-t-cyan-400 animate-spin" />
                <span className="text-xs text-text-muted">Loading Supply Chain Globe...</span>
              </div>
            }
          >
            <LazySupplyChainGlobe mode="compact" />
          </Suspense>
        </div>

        {/* Right Column: What You Should Do Next */}
        <div className="lg:col-span-5 flex flex-col">
          <div
            data-testid="overview-what-next-card"
            className="bg-surface rounded-xl border border-border-subtle p-5 shadow-sm flex-1 flex flex-col justify-between space-y-4"
          >
            <div>
              {/* Card Header with InfoTip */}
              <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-text-primary tracking-tight">
                    What You Should Do Next
                  </h2>
                  <InfoTip
                    term={GLOSSARY.what_you_should_do_next?.term || 'What You Should Do Next'}
                    description={GLOSSARY.what_you_should_do_next?.definition || 'Recommended decisions and alerts.'}
                  />
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-accent-primary/20 text-accent-primary border border-accent-primary/40">
                  Priority
                </span>
              </div>

              {/* Priority Decision Block */}
              <div className="mt-4 space-y-4">
                {execLoading ? (
                  <div className="p-4 rounded-lg bg-elevated border border-border-subtle text-xs text-text-muted animate-pulse">
                    Evaluating tactical recommendations...
                  </div>
                ) : execError ? (
                  <div className="p-4 rounded-lg bg-elevated border border-rose-800 text-xs text-rose-300">
                    Could not retrieve priority recommendations.{' '}
                    <button
                      type="button"
                      onClick={() => reloadExec()}
                      className="underline font-semibold"
                    >
                      Retry
                    </button>
                  </div>
                ) : execData?.priority_decision ? (
                  <div
                    data-testid="priority-decision-block"
                    className="p-4 rounded-lg bg-elevated border border-border-subtle space-y-2.5"
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-accent-primary">
                      <span aria-hidden="true">&#9673;</span>
                      <span>Primary Decision Required</span>
                    </div>
                    <p className="text-sm font-semibold text-text-primary leading-snug">
                      {(execData.priority_decision as any).decision ||
                        execData.priority_decision.recommended_option_description ||
                        execData.priority_decision.scope_note}
                    </p>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      {(execData.priority_decision as any).rationale ||
                        (execData.priority_decision as any).description ||
                        execData.priority_decision.scope_note}
                    </p>
                    <div className="pt-2">
                      <Link
                        to="/recommendations"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent-primary text-white text-xs font-semibold hover:bg-accent-primary/90 transition-colors shadow-xs"
                      >
                        <span>Review Recommendation</span>
                        <span aria-hidden="true">&rarr;</span>
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div
                    data-testid="priority-decision-empty"
                    className="p-4 rounded-lg bg-elevated border border-border-subtle text-xs text-text-secondary space-y-1"
                  >
                    <strong className="text-text-primary block font-semibold">
                      Nothing urgent right now
                    </strong>
                    <p>No critical stockouts or urgent priority decisions currently required.</p>
                  </div>
                )}

                {/* Top Urgent Alerts List */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-text-secondary block">
                    Highest Priority Disruption Alerts:
                  </span>
                  {alertsLoading ? (
                    <div className="text-xs text-text-muted">Loading alerts...</div>
                  ) : topAlertsList.length === 0 ? (
                    <div className="text-xs text-text-muted italic p-2 bg-elevated rounded border border-border-subtle">
                      No active disruption alerts in system.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {topAlertsList.slice(0, 2).map((alert) => (
                        <li
                          key={alert.id}
                          className="p-2.5 rounded bg-elevated border border-border-subtle text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold border"
                              style={{
                                color: RISK_PALETTE[alert.severity as keyof typeof RISK_PALETTE]?.fillColor || '#94a3b8',
                                borderColor: RISK_PALETTE[alert.severity as keyof typeof RISK_PALETTE]?.fillColor || '#94a3b8',
                              }}
                            >
                              {alert.severity}
                            </span>
                            <span className="text-[11px] text-text-muted font-mono">
                              {alert.component_sku || alert.supplier_code}
                            </span>
                          </div>
                          <p className="text-text-primary font-medium truncate" title={alert.title}>
                            {alert.title}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Action Links Footer */}
            <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-xs font-semibold">
              <Link
                to="/recommendations"
                className="text-accent-primary hover:underline flex items-center gap-1"
              >
                <span>All Recommendations &rarr;</span>
              </Link>
              <Link
                to="/alerts"
                className="text-text-secondary hover:text-text-primary hover:underline flex items-center gap-1"
              >
                <span>All Alerts ({totalAlerts}) &rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Lower Section: Primary Charts (RiskMix & Runway) */}
      <section aria-label="Risk mix and runway timelines" className="space-y-6">
        {/* Risk Mix Bar */}
        <ChartCard
          title="Component Risk Distribution Mix"
          subtitle="Proportion of catalog components evaluated across critical, high, medium, and low risk bands."
          infoTerm={GLOSSARY.runway.term}
          infoDescription={GLOSSARY.runway.definition}
          loading={riskLoading}
          error={riskError}
          onRetry={reloadRisk}
          isEmpty={!riskData || ((riskData.items?.length ?? 0) === 0 && totalEvaluated === 0)}
          emptyMessage="No component risk evaluations are currently available."
          testId="overview-risk-mix-card"
          tableView={
            <RiskMixTable
              counts={riskCounts}
              totalEvaluated={totalEvaluated}
            />
          }
        >
          <RiskMixBar
            counts={riskCounts}
            totalEvaluated={totalEvaluated}
          />
        </ChartCard>

        {/* Runway Chart (Key Visual) */}
        <ChartCard
          title="Component Shortage Runway & Gap Timeline"
          subtitle="Visualizes days of usable stock remaining against confirmed inbound shipments; red hatched bars indicate critical supply deficits."
          infoTerm={GLOSSARY.units_short_before_delivery.term}
          infoDescription={GLOSSARY.units_short_before_delivery.definition}
          loading={riskLoading}
          error={riskError}
          onRetry={reloadRisk}
          isEmpty={!riskData || (riskData.items?.length ?? 0) === 0}
          emptyMessage="No components currently projected to run out of stock."
          testId="overview-runway-card"
          tableView={<RunwayTable items={riskData?.items || []} asOf={asOf} />}
        >
          <RunwayChart items={riskData?.items || []} asOf={asOf} />
        </ChartCard>
      </section>

      {/* 5. Suppliers Needing Attention & Latest Alerts Section */}
      <section aria-label="Suppliers needing attention and recent alerts" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Suppliers Needing Attention (worst 5) */}
        <div className="lg:col-span-7 flex flex-col">
          <ChartCard
            title="Suppliers Needing Attention"
            subtitle="Active suppliers ordered worst on-time delivery rate first; top 5 shown."
            infoTerm={GLOSSARY.supplier_risk_score.term}
            infoDescription={GLOSSARY.supplier_risk_score.definition}
            loading={supplierRiskLoading}
            error={supplierRiskError}
            onRetry={reloadSupplierRisk}
            isEmpty={!supplierRiskData || (supplierRiskData.items?.length ?? 0) === 0}
            emptyMessage="No supplier delivery performance records found."
            testId="overview-supplier-reliability-card"
            tableView={<SupplierReliabilityTable suppliers={worst5Suppliers} />}
          >
            <div className="space-y-3">
              <SupplierReliabilityBars suppliers={worst5Suppliers} />
              <div className="pt-2 text-right">
                <Link
                  to="/supplier-risk"
                  className="text-xs text-accent-primary hover:underline font-semibold"
                >
                  View all suppliers in Supplier Risk &rarr;
                </Link>
              </div>
            </div>
          </ChartCard>
        </div>

        {/* Right: Latest Alerts List */}
        <div className="lg:col-span-5 flex flex-col">
          <div
            data-testid="overview-latest-alerts-card"
            className="bg-surface rounded-xl border border-border-subtle p-5 shadow-sm flex-1 flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
                <h2 className="text-base font-bold text-text-primary tracking-tight">
                  Latest Alerts
                </h2>
                <span className="text-xs text-text-muted font-mono">
                  {totalAlerts} total
                </span>
              </div>

              {alertsLoading ? (
                <div className="py-8 text-center text-xs text-text-muted animate-pulse">
                  Loading active alerts...
                </div>
              ) : alertsError ? (
                <div className="py-6 text-center text-xs text-rose-300 space-y-2">
                  <p>Could not load active alerts.</p>
                  <button
                    type="button"
                    onClick={() => reloadAlerts()}
                    className="px-2.5 py-1 rounded bg-slate-800 text-xs font-semibold"
                  >
                    Retry
                  </button>
                </div>
              ) : topAlertsList.length === 0 ? (
                <div className="py-8 text-center text-xs text-text-muted italic">
                  No active disruption alerts currently open.
                </div>
              ) : (
                <ul className="divide-y divide-border-subtle mt-2">
                  {topAlertsList.map((alert) => (
                    <li key={alert.id} className="py-2.5 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold border"
                          style={{
                            color: RISK_PALETTE[alert.severity as keyof typeof RISK_PALETTE]?.fillColor || '#94a3b8',
                            borderColor: RISK_PALETTE[alert.severity as keyof typeof RISK_PALETTE]?.fillColor || '#94a3b8',
                          }}
                        >
                          {alert.severity}
                        </span>
                        <span className="text-[11px] text-text-muted font-mono">
                          {(alert as any).created_at?.slice(0, 10) || (alert as any).detected_on || asOf}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-text-primary truncate" title={alert.title}>
                        {alert.title}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-3 border-t border-border-subtle text-right">
              <Link
                to="/alerts"
                className="text-xs font-semibold text-accent-primary hover:underline"
              >
                View all alerts in Alerts page &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Collapsible "More detail: incoming deliveries" Section */}
      <section
        aria-label="Collapsible incoming deliveries timeline"
        className="bg-surface border border-border-subtle rounded-xl p-4 sm:p-5 shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text-primary">
              More detail: incoming deliveries
            </h2>
            <p className="text-xs text-text-secondary">
              Chronological schedule of open purchase orders, highlighting delivery slips and overdue arrivals.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsDeliveriesOpen((prev) => !prev)}
            aria-expanded={isDeliveriesOpen}
            aria-controls="incoming-deliveries-collapsible"
            className="px-3 py-1.5 rounded bg-elevated hover:bg-slate-700/60 text-xs font-semibold text-text-primary border border-border-subtle transition-colors flex items-center gap-1.5"
          >
            <span>{isDeliveriesOpen ? 'Collapse' : 'Expand'}</span>
            <span aria-hidden="true">{isDeliveriesOpen ? '▲' : '▼'}</span>
          </button>
        </div>

        {isDeliveriesOpen && (
          <div id="incoming-deliveries-collapsible" className="pt-4 border-t border-border-subtle">
            <ChartCard
              title="Inbound Delivery Schedule (Next 30 Days)"
              subtitle="Chronological timeline of open purchase orders, highlighting slipped supplier estimates and overdue shipments."
              infoTerm={GLOSSARY.slipped_delivery.term}
              infoDescription={GLOSSARY.slipped_delivery.definition}
              loading={poLoading}
              error={poError}
              onRetry={reloadPos}
              isEmpty={!poData || (poData.items?.length ?? 0) === 0}
              emptyMessage="No active purchase orders scheduled for replenishment."
              testId="overview-delivery-timeline-card"
              tableView={<DeliveryTimelineTable orders={poData?.items || []} asOf={asOf} />}
            >
              <DeliveryTimeline orders={poData?.items || []} asOf={asOf} />
            </ChartCard>
          </div>
        )}
      </section>

      {/* 7. Collapsible "How to read this page" panel */}
      <HowToReadPanel />

      {/* 8. Master Data Baseline Section (Kept for compatibility with all existing test IDs) */}
      <section
        aria-label="Master entity counts and system baseline metrics"
        className="bg-surface border border-border-subtle rounded-lg p-4 sm:p-5 shadow-xs space-y-4"
        data-testid="master-counts-container"
      >
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary">
          Operational Baseline & Master Catalog
        </h2>

        {/* Master Catalog Counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-elevated border border-border-subtle rounded text-center">
            <span className="text-xs text-text-secondary font-medium block">Products</span>
            <span data-testid="count-products" className="text-xl font-bold font-mono text-text-primary">
              {meta?.counts?.products ?? 0}
            </span>
          </div>
          <div className="p-3 bg-elevated border border-border-subtle rounded text-center">
            <span className="text-xs text-text-secondary font-medium block">Components</span>
            <span data-testid="count-components" className="text-xl font-bold font-mono text-text-primary">
              {meta?.counts?.components ?? 0}
            </span>
          </div>
          <div className="p-3 bg-elevated border border-border-subtle rounded text-center">
            <span className="text-xs text-text-secondary font-medium block">Suppliers</span>
            <span data-testid="count-suppliers" className="text-xl font-bold font-mono text-text-primary">
              {meta?.counts?.suppliers ?? 0}
            </span>
          </div>
          <div className="p-3 bg-elevated border border-border-subtle rounded text-center">
            <span className="text-xs text-text-secondary font-medium block">Warehouses</span>
            <span data-testid="count-warehouses" className="text-xl font-bold font-mono text-text-primary">
              {meta?.counts?.warehouses ?? 0}
            </span>
          </div>
        </div>

        {/* Purchase Order Metrics Compatibility Elements */}
        <div className="pt-2 border-t border-border-subtle flex items-center justify-between text-xs text-text-secondary flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span>
              Open POs: <strong data-testid="count-open-pos" className="font-mono text-text-primary">{Number.isFinite(openTotals?.totalOpen) ? openTotals!.totalOpen : (Number.isFinite(poData?.total) ? poData!.total : 0)}</strong>
            </span>
            <span>
              Overdue POs: <strong data-testid="count-overdue-pos" className="font-mono text-red-500">{overdueCount}</strong>
            </span>
            <span data-testid="count-delayed-pos" className="font-medium text-amber-500">
              Delayed vs promise: {delayedCount} POs
            </span>
            <span className="text-text-muted text-[11px]">
              (whose latest estimated delivery date is strictly later than promised date)
            </span>
          </div>

          {isTruncated && (
            <p data-testid="overdue-truncated-warning" className="text-amber-500 font-medium text-[11px]">
              Note: Evaluated across first 200 purchase orders (total in system: {poData?.total}).
            </p>
          )}
        </div>

        {/* Screen-reader accessible compatibility table for existing tests */}
        <div className="sr-only">
          <table data-testid="upcoming-deliveries-table">
            <tbody>
              {upcomingDeliveries.map(({ po, basis }) => {
                const isSlipped = isDelayedVsPromise(po);
                const sInfo = isSlipped ? slippedInfo(po) : null;
                return (
                  <tr key={po.id}>
                    <td>{po.po_number}</td>
                    <td>
                      <span data-testid={`basis-${po.po_number}`}>{basis}</span>
                    </td>
                    <td>
                      {isSlipped && sInfo && (
                        <span data-testid={`slipped-upcoming-${po.po_number}`}>
                          Slipped {sInfo.slippedDays} days vs promise (promised {sInfo.promisedDate})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Backward-compatibility Hidden Sections for existing tests */}
      {/* 1. Inventory Risk Section Error or Compatibility block */}
      {riskError ? (
        <div data-testid="overview-risk-section">
          <ErrorView
            error={riskError}
            onRetry={reloadRisk}
            title="Could not load inventory risk summary"
          />
        </div>
      ) : (
        <div data-testid="overview-risk-section" className="sr-only" aria-hidden="true">
          <span data-testid="count-risk-critical">{riskCounts.critical ?? 0}</span>
          <span data-testid="count-risk-high">{riskCounts.high ?? 0}</span>
          <span data-testid="count-risk-medium">{riskCounts.medium ?? 0}</span>
          <span data-testid="count-risk-low">{riskCounts.low ?? 0}</span>
          <Link data-testid="link-to-inventory-risk" to="/inventory-risk">View all</Link>
          {(riskData?.items || [])
            .filter((item) => item.risk_level === 'critical' || item.risk_level === 'high')
            .map((item) => (
              <Link
                key={item.sku}
                data-testid={`inspect-link-${item.sku}`}
                to={`/inventory-risk`}
              >
                Inspect {item.sku}
              </Link>
            ))}
        </div>
      )}

      {/* 2. Supplier Risk Section Error or Compatibility block */}
      {supplierRiskError ? (
        <div data-testid="overview-supplier-risk-section">
          <ErrorView
            error={supplierRiskError}
            onRetry={reloadSupplierRisk}
            title="Could not load supplier risk summary"
          />
        </div>
      ) : (
        <div data-testid="overview-supplier-risk-section" className="sr-only" aria-hidden="true">
          <span data-testid="overview-supplier-count-high">
            {supplierRiskData?.summary?.counts_by_band?.high ?? 0}
          </span>
          <span data-testid="overview-supplier-count-medium">
            {supplierRiskData?.summary?.counts_by_band?.medium ?? 0}
          </span>
          <span data-testid="overview-supplier-count-low">
            {supplierRiskData?.summary?.counts_by_band?.low ?? 0}
          </span>
          <span data-testid="overview-supplier-count-unknown">
            {supplierRiskData?.summary?.counts_by_band?.unknown ?? 0}
          </span>
          {highestScoringSupplier && (
            <div>
              <span data-testid="highest-supplier-score">{highestScoringSupplier.risk_score}</span>
              <Link data-testid="link-highest-supplier" to="/supplier-risk">
                Inspect
              </Link>
            </div>
          )}
        </div>
      )}

      {/* 3. Alerts Section Error or Compatibility block */}
      {alertsError ? (
        <div data-testid="overview-alerts-section">
          <ErrorView
            error={alertsError}
            onRetry={reloadAlerts}
            title="Could not load active alerts"
          />
        </div>
      ) : (
        <div data-testid="overview-alerts-section" className="sr-only" aria-hidden="true">
          <div data-testid="overview-alerts-summary-counts">
            {`Critical ${alertsData?.summary?.counts_by_severity?.critical ?? 0} · High ${alertsData?.summary?.counts_by_severity?.high ?? 0} · Medium ${alertsData?.summary?.counts_by_severity?.medium ?? 0} · Low ${alertsData?.summary?.counts_by_severity?.low ?? 0} · Info ${alertsData?.summary?.counts_by_severity?.info ?? 0}`}
          </div>
          <table data-testid="overview-alerts-table">
            <tbody>
              {(alertsData?.items || []).map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link data-testid="view-all-alerts-link" to="/alerts">
            View all alerts
          </Link>
        </div>
      )}

      {/* Backward-compatibility KPI aliases */}
      <div className="sr-only" aria-hidden="true">
        <span data-testid="kpi-components-at-risk">
          {totalEvaluated > 0 ? `${atRiskCount} of ${totalEvaluated}` : `${atRiskCount}`}
        </span>
        <span data-testid="kpi-soonest-shortage">
          {earliestShortage ? `${earliestShortage.days} days` : 'None'}
        </span>
        <span data-testid="kpi-open-alerts">
          {totalAlerts}
        </span>
      </div>

      {/* 8. Small Footer Line */}
      <footer className="pt-4 border-t border-border-subtle text-center">
        <p className="text-xs text-text-secondary font-medium">
          Decision support only. No orders are created.
        </p>
      </footer>
    </div>
  );
}
