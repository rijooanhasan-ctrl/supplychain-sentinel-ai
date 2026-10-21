import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getImportStatus } from '../../api/endpoints';
import { useApi } from '../../api/useApi';
import type { GlobeSupplier, GlobeWarehouse } from '../../api/types';
import { isPointInPolygon } from '../../lib/geo';
import { RISK_PALETTE, type RiskLevelKey } from '../../theme/riskPalette';
import { GlobeBottomStrip } from './GlobeBottomStrip';
import {
  GlobeCanvas,
  type GlobeCanvasHandle,
  type GroupedPoint,
} from './GlobeCanvas';
import { GlobeDetailPanel, type SelectedEntity } from './GlobeDetailPanel';
import {
  GlobeFilterSidebar,
  type GlobeFilterState,
} from './GlobeFilterSidebar';
import { GlobeListFallback } from './GlobeListFallback';
import { SetLocationModal } from './SetLocationModal';
import { useGlobeData } from './useGlobeData';
import { MetaContext } from '../../context/metaContextDef';

function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export interface SupplyChainGlobeProps {
  mode: 'compact' | 'full';
  className?: string;
  onNavigateToGlobe?: (supplierCode?: string) => void;
}

export const SupplyChainGlobe: React.FC<SupplyChainGlobeProps> = ({
  mode,
  className = '',
  onNavigateToGlobe,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const globeRef = useRef<GlobeCanvasHandle>(null);
  const rootContainerRef = useRef<HTMLDivElement>(null);

  // WebGL availability
  const webGlAvailable = useMemo(() => isWebGLSupported(), []);

  // Active dataset context for dynamic globe switching
  const metaCtx = useContext(MetaContext);
  const meta = metaCtx?.meta;
  const datasetKey = meta
    ? `${meta.active_dataset ?? 'demo'}|${meta.generated_at ?? ''}|${meta.label ?? ''}`
    : undefined;

  // Shared single data hook
  const { data, loading, error, reload: loadGlobe } = useGlobeData(datasetKey);

  const fetchStatus = useCallback((signal: AbortSignal) => getImportStatus(signal), []);
  const { data: statusData } = useApi(fetchStatus);
  const isSavingEnabled = Boolean(statusData?.enabled);

  // Full mode states
  const [viewMode, setViewMode] = useState<'globe' | 'list'>(() =>
    isWebGLSupported() ? 'globe' : 'list'
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [activeCluster, setActiveCluster] = useState<GroupedPoint | null>(null);

  // Compact mode states
  const [compactPopover, setCompactPopover] = useState<{
    title: string;
    code?: string;
    type: 'supplier' | 'warehouse' | 'country';
    riskBand?: RiskLevelKey;
    riskScore?: number;
    details?: string;
    linkUrl?: string;
  } | null>(null);
  const [isGlobeActive, setIsGlobeActive] = useState<boolean>(false);
  const [compactShowSuppliers, setCompactShowSuppliers] = useState<boolean>(true);
  const [compactShowRoutes, setCompactShowRoutes] = useState<boolean>(true);
  const [compactShowLabels, setCompactShowLabels] = useState<boolean>(true);

  // Set location modal states
  const [overrideTarget, setOverrideTarget] = useState<{
    type: 'supplier' | 'warehouse';
    code: string;
    name: string;
  } | null>(null);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [isClickToPlaceActive, setIsClickToPlaceActive] = useState<boolean>(false);

  // Filters state (in full mode, synced with searchParams)
  const [filters, setFilters] = useState<GlobeFilterState>(() => {
    const riskParam = searchParams.get('risk');
    const initialRisks = new Set<RiskLevelKey>();
    if (riskParam) {
      riskParam.split(',').forEach((r) => initialRisks.add(r as RiskLevelKey));
    }

    return {
      searchTerm: searchParams.get('search') || '',
      selectedRisks: initialRisks,
      selectedCountry: searchParams.get('country') || '',
      selectedComponent: searchParams.get('component') || '',
      selectedWarehouse: searchParams.get('warehouse') || '',
      poStatus: 'all',
      criticalComponentsOnly: searchParams.get('critical') === 'true',
      showSuppliers: true,
      showWarehouses: true,
      showRoutes: true,
      showConcentration: searchParams.get('concentration') === 'true',
      showLabels: true,
      showStateLabels: true,
    };
  });

  // Sync URL search params in full mode
  const updateFiltersAndUrl = (nextFilters: GlobeFilterState) => {
    setFilters(nextFilters);
    if (mode !== 'full') return;

    const newParams = new URLSearchParams();
    if (nextFilters.searchTerm) newParams.set('search', nextFilters.searchTerm);
    if (nextFilters.selectedRisks.size > 0) {
      newParams.set('risk', Array.from(nextFilters.selectedRisks).join(','));
    }
    if (nextFilters.selectedCountry) newParams.set('country', nextFilters.selectedCountry);
    if (nextFilters.selectedComponent) newParams.set('component', nextFilters.selectedComponent);
    if (nextFilters.selectedWarehouse) newParams.set('warehouse', nextFilters.selectedWarehouse);
    if (nextFilters.criticalComponentsOnly) newParams.set('critical', 'true');
    if (nextFilters.showConcentration) newParams.set('concentration', 'true');

    const supplierParam = searchParams.get('supplier');
    if (supplierParam) newParams.set('supplier', supplierParam);

    setSearchParams(newParams, { replace: true });
  };

  // Deep-link auto-selection of supplier from ?supplier=<code>
  const suppCode = searchParams.get('supplier');
  const deepLinkedSupplier = useMemo(() => {
    if (!data?.suppliers || !suppCode) return null;
    return data.suppliers.find((s) => s.code.toUpperCase() === suppCode.toUpperCase()) || null;
  }, [data, suppCode]);

  const activeSelectedEntity =
    selectedEntity ||
    (deepLinkedSupplier ? { type: 'supplier' as const, item: deepLinkedSupplier } : null);

  useEffect(() => {
    if (
      deepLinkedSupplier?.location &&
      deepLinkedSupplier.location.lat != null &&
      deepLinkedSupplier.location.lon != null
    ) {
      globeRef.current?.pointOfView(
        { lat: deepLinkedSupplier.location.lat, lng: deepLinkedSupplier.location.lon, altitude: 1.5 },
        1000
      );
    }
  }, [deepLinkedSupplier]);

  // Click outside to deactivate scroll guard in compact mode
  useEffect(() => {
    if (mode !== 'compact') return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootContainerRef.current && !rootContainerRef.current.contains(e.target as Node)) {
        setIsGlobeActive(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [mode]);

  // State selection handler
  const handleSelectState = (
    stateName: string,
    countryName: string,
    countryCode: string,
    feature: any
  ) => {
    if (!data) return;

    const exactOrManualSuppliers = (data.suppliers || []).filter(
      (s) =>
        s.location &&
        s.location.precision !== 'country_centroid' &&
        s.location.lat != null &&
        s.location.lon != null
    );
    const matchedSuppliers = exactOrManualSuppliers.filter((s) =>
      isPointInPolygon(
        { lat: s.location!.lat as number, lon: s.location!.lon as number },
        feature.geometry
      )
    );

    const exactOrManualWarehouses = (data.warehouses || []).filter(
      (w) =>
        w.location &&
        w.location.precision !== 'country_centroid' &&
        w.location.lat != null &&
        w.location.lon != null
    );
    const matchedWarehouses = exactOrManualWarehouses.filter((w) =>
      isPointInPolygon(
        { lat: w.location!.lat as number, lon: w.location!.lon as number },
        feature.geometry
      )
    );

    const hasApproximateInCountry = (data.suppliers || []).some(
      (s) =>
        (s.country?.toUpperCase() === countryCode.toUpperCase() ||
          s.country?.toLowerCase() === countryName.toLowerCase()) &&
        s.location?.precision === 'country_centroid'
    );

    if (mode === 'compact') {
      setCompactPopover({
        title: stateName,
        code: `${countryName} (${countryCode})`,
        type: 'country',
        details: `${matchedSuppliers.length} local suppliers located in this jurisdiction.`,
        linkUrl: `/globe?country=${encodeURIComponent(countryName)}`,
      });
    } else {
      setSelectedEntity({
        type: 'state',
        stateName,
        countryName,
        countryCode,
        matchedSuppliers,
        matchedWarehouses,
        hasApproximateInCountry,
      });
    }
  };

  // Country selection handler
  const handleSelectCountry = (country: any) => {
    if (!data) return;
    const cCode = country.country_code || country.code || '';
    const cName = country.country_name || country.name || '';
    const conc = data.concentration.find(
      (c) =>
        c.country_code.toUpperCase() === cCode.toUpperCase() ||
        c.country_name.toLowerCase() === cName.toLowerCase()
    );

    if (mode === 'compact') {
      setCompactPopover({
        title: cName || cCode,
        code: cCode,
        type: 'country',
        riskBand: conc?.flagged ? 'high' : 'low',
        details: conc
          ? `${conc.supplier_count} suppliers, ${conc.open_po_count} open PO lines.`
          : 'No active supply chain entities.',
        linkUrl: `/globe?country=${encodeURIComponent(cName || cCode)}`,
      });
    } else {
      setSelectedEntity({
        type: 'country',
        item: conc || (country.supplier_count ? country : null),
        countryName: cName || cCode,
        countryCode: cCode,
      });
    }
  };

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    if (!data?.suppliers) return [];
    if (mode === 'compact') {
      return compactShowSuppliers ? data.suppliers : [];
    }

    return data.suppliers.filter((s) => {
      if (filters.selectedRisks.size > 0 && !filters.selectedRisks.has(s.risk_band)) {
        return false;
      }
      if (filters.selectedCountry && s.country !== filters.selectedCountry) {
        return false;
      }
      if (
        filters.selectedComponent &&
        !s.components.some((c) => c.sku === filters.selectedComponent)
      ) {
        return false;
      }
      if (filters.criticalComponentsOnly && s.components.length === 0) {
        return false;
      }
      if (filters.poStatus === 'overdue' && s.overdue_po_count === 0) return false;
      if (filters.poStatus === 'slipped' && s.slipped_po_count === 0) return false;
      if (filters.poStatus === 'open' && s.open_po_count === 0) return false;

      return true;
    });
  }, [data, filters, mode, compactShowSuppliers]);

  // Filtered warehouses
  const filteredWarehouses = useMemo(() => {
    if (!data?.warehouses) return [];
    if (mode === 'compact') return data.warehouses;

    return data.warehouses.filter((w) => {
      if (filters.selectedWarehouse && w.code !== filters.selectedWarehouse) {
        return false;
      }
      return true;
    });
  }, [data, filters.selectedWarehouse, mode]);

  // Filtered routes
  const filteredRoutes = useMemo(() => {
    if (!data?.routes) return [];
    if (mode === 'compact') return compactShowRoutes ? data.routes : [];
    if (!filters.showRoutes) return [];

    return data.routes.filter((r) => {
      if (filters.poStatus === 'overdue' && !r.any_overdue) return false;
      if (filters.poStatus === 'slipped' && !r.any_slipped) return false;
      if (filters.selectedWarehouse && r.warehouse_code !== filters.selectedWarehouse) return false;
      return true;
    });
  }, [data, filters.showRoutes, filters.poStatus, filters.selectedWarehouse, mode, compactShowRoutes]);

  // Top 5 locations for compact WebGL fallback
  const topLocations = useMemo(() => {
    if (!data?.suppliers) return [];
    return [...data.suppliers]
      .sort((a, b) => b.risk_score - a.risk_score)
      .slice(0, 5);
  }, [data]);

  // Fullscreen toggle
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      rootContainerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  const handleOpenSetLocation = (
    type: 'supplier' | 'warehouse',
    code: string,
    name: string
  ) => {
    setOverrideTarget({ type, code, name });
    setClickedCoords(null);
  };

  // ----------------- LOADING & ERROR SKELETONS -----------------
  if (loading) {
    if (mode === 'compact') {
      return (
        <div
          data-testid="compact-globe-skeleton"
          className="h-[460px] w-full rounded-xl bg-bg-surface border border-border-subtle flex flex-col items-center justify-center p-6 space-y-3 animate-pulse"
        >
          <div className="w-12 h-12 rounded-full border-4 border-cyan-500/30 border-t-cyan-400 animate-spin" />
          <span className="text-xs text-text-muted">Loading Supply Chain Globe...</span>
        </div>
      );
    }

    return (
      <div
        data-testid="globe-loading-view"
        className="min-h-[calc(100vh-80px)] bg-[#070b14] flex flex-col items-center justify-center p-6 text-slate-300 space-y-4"
      >
        <div className="w-16 h-16 rounded-full border-4 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        <div className="text-center space-y-1">
          <h2 className="text-base font-bold text-slate-100">Initializing Supply Chain Globe</h2>
          <p className="text-xs text-text-muted">
            Resolving vendor coordinates, calculating routes, and assessing geographic concentration...
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    if (mode === 'compact') {
      return (
        <div
          role="alert"
          data-testid="compact-globe-error"
          className="h-[460px] w-full rounded-xl bg-bg-surface border border-border-subtle p-6 flex flex-col items-center justify-center text-center space-y-3"
        >
          <span className="text-2xl text-rose-400">&#9888;</span>
          <p className="text-xs text-text-muted">{error || 'Unable to load 3D globe visualization'}</p>
          <button
            type="button"
            onClick={() => loadGlobe()}
            className="px-3 py-1.5 rounded bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-500"
          >
            Retry Connection
          </button>
        </div>
      );
    }

    return (
      <div
        role="alert"
        data-testid="globe-error-view"
        className="min-h-[calc(100vh-80px)] bg-[#070b14] flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full bg-[#0d1629] border border-rose-800 rounded-xl p-6 text-center space-y-4 text-slate-100 shadow-2xl">
          <span className="text-3xl text-rose-400 block" aria-hidden="true">&#9888;</span>
          <h2 className="text-lg font-bold text-white">Globe Unavailable</h2>
          <p className="text-xs text-rose-200/90 leading-relaxed">{error || 'Unknown error'}</p>
          <button
            type="button"
            onClick={() => loadGlobe()}
            className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs shadow-md transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // ----------------- COMPACT MODE (OVERVIEW PAGE) -----------------
  if (mode === 'compact') {
    return (
      <div
        ref={rootContainerRef}
        data-testid="overview-compact-globe-card"
        className={`bg-bg-surface rounded-xl border border-border-subtle p-4 space-y-3 shadow-md flex flex-col justify-between ${className}`}
      >
        {/* Card Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border-subtle">
          <div>
            <h2 className="text-base font-bold text-text-primary tracking-tight">
              Where the problems are
            </h2>
            <p className="text-xs text-text-secondary">
              Areas With the Most Problems &bull; Geospatial disruption view
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/globe"
              data-testid="open-full-globe-btn"
              className="px-3 py-1 rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 border border-accent-primary/40 text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <span>Open Full Global Map</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>

        {/* Legend Chips */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <span>Supplier</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rotate-45 bg-sky-400" />
            <span>Warehouse</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-rose-500 rounded" />
            <span>Delayed Route</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-amber-400 bg-amber-950/60" />
            <span>Areas With the Most Problems</span>
          </div>
        </div>

        {/* Center 3D Globe with Toolbar or Fallback Table */}
        {webGlAvailable ? (
          <div
            className="relative h-[420px] sm:h-[460px] w-full rounded-lg overflow-hidden border border-border-subtle bg-[#070b14]"
            data-testid="compact-globe-canvas-wrapper"
          >
            {/* Compact Toolbar */}
            <div
              className="absolute top-2 right-2 z-20 flex flex-col gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-700/80 shadow-md backdrop-blur-xs"
              role="toolbar"
              aria-label="Compact Globe Controls"
            >
              <button
                type="button"
                onClick={() => globeRef.current?.zoomIn()}
                aria-label="Zoom in"
                title="Zoom in"
                className="w-7 h-7 rounded hover:bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-sm"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => globeRef.current?.zoomOut()}
                aria-label="Zoom out"
                title="Zoom out"
                className="w-7 h-7 rounded hover:bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-sm"
              >
                &minus;
              </button>
              <button
                type="button"
                onClick={() => globeRef.current?.resetView()}
                aria-label="Reset view"
                title="Reset view"
                className="w-7 h-7 rounded hover:bg-slate-800 text-slate-200 flex items-center justify-center text-xs"
              >
                &#8635;
              </button>
              <button
                type="button"
                onClick={() => setCompactShowLabels((prev) => !prev)}
                aria-label="Toggle geographic labels"
                title={compactShowLabels ? 'Hide Labels' : 'Show Labels'}
                className={`w-7 h-7 rounded text-[11px] font-bold flex items-center justify-center transition-colors ${
                  compactShowLabels
                    ? 'bg-cyan-600 text-white'
                    : 'text-text-muted hover:bg-slate-800'
                }`}
              >
                Aa
              </button>
              <button
                type="button"
                onClick={() => setCompactShowSuppliers((prev) => !prev)}
                aria-label="Toggle suppliers"
                title={compactShowSuppliers ? 'Hide Suppliers' : 'Show Suppliers'}
                className={`w-7 h-7 rounded text-xs flex items-center justify-center transition-colors ${
                  compactShowSuppliers
                    ? 'bg-cyan-600 text-white'
                    : 'text-text-muted hover:bg-slate-800'
                }`}
              >
                &#9679;
              </button>
              <button
                type="button"
                onClick={() => setCompactShowRoutes((prev) => !prev)}
                aria-label="Toggle supply routes"
                title={compactShowRoutes ? 'Hide Routes' : 'Show Routes'}
                className={`w-7 h-7 rounded text-xs flex items-center justify-center transition-colors ${
                  compactShowRoutes
                    ? 'bg-cyan-600 text-white'
                    : 'text-text-muted hover:bg-slate-800'
                }`}
              >
                &#8605;
              </button>
            </div>

            {/* Canvas */}
            <GlobeCanvas
              ref={globeRef}
              suppliers={filteredSuppliers}
              warehouses={filteredWarehouses}
              routes={filteredRoutes}
              concentration={data.concentration}
              showSuppliers={compactShowSuppliers}
              showWarehouses={true}
              showRoutes={compactShowRoutes}
              showConcentration={true}
              showLabels={compactShowLabels}
              showStateLabels={compactShowLabels}
              scrollGuard={true}
              isGlobeActive={isGlobeActive}
              onActivateGlobe={() => setIsGlobeActive(true)}
              onSelectEntity={(ent) => {
                if (ent.type === 'supplier') {
                  const s = ent.item;
                  setCompactPopover({
                    title: s.name,
                    code: s.code,
                    type: 'supplier',
                    riskBand: s.risk_band,
                    riskScore: s.risk_score,
                    details: `${s.country} • ${(s.on_time_rate * 100).toFixed(0)}% on-time • ${s.open_po_count} open POs`,
                    linkUrl: `/globe?supplier=${encodeURIComponent(s.code)}`,
                  });
                } else {
                  const w = ent.item;
                  setCompactPopover({
                    title: w.name,
                    code: w.code,
                    type: 'warehouse',
                    details: `${w.role} • ${w.inventory_summary.total_on_hand.toLocaleString()} units`,
                    linkUrl: '/inventory',
                  });
                }
              }}
              onSelectCluster={(cl) => {
                const first = cl.items[0];
                if (first.type === 'supplier') {
                  setCompactPopover({
                    title: `${cl.count} Entities at location`,
                    code: `${cl.lat.toFixed(2)}, ${cl.lng.toFixed(2)}`,
                    type: 'supplier',
                    riskBand: cl.primaryRisk,
                    details: `Includes ${first.item.name} (${first.item.code}) and others.`,
                    linkUrl: `/globe?search=${encodeURIComponent(first.item.code)}`,
                  });
                }
              }}
              onSelectCountry={handleSelectCountry}
              onSelectState={handleSelectState}
            />

            {/* Floating Popover Card for Clicked Entities */}
            {compactPopover && (
              <div
                data-testid="compact-globe-popover"
                className="absolute bottom-4 left-4 z-30 max-w-xs w-full bg-slate-900/95 border border-cyan-500/60 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs space-y-2 animate-in fade-in zoom-in-95"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-white text-sm truncate max-w-[200px]">
                      {compactPopover.title}
                    </h3>
                    {compactPopover.code && (
                      <span className="font-mono text-[11px] text-text-muted">
                        {compactPopover.code}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCompactPopover(null)}
                    className="text-text-muted hover:text-white p-0.5"
                    aria-label="Close popover"
                  >
                    &times;
                  </button>
                </div>

                {compactPopover.riskBand && (
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border"
                      style={{
                        color: RISK_PALETTE[compactPopover.riskBand]?.fillColor || '#94a3b8',
                        borderColor: RISK_PALETTE[compactPopover.riskBand]?.fillColor || '#94a3b8',
                      }}
                    >
                      {compactPopover.riskBand} Risk
                    </span>
                    {compactPopover.riskScore != null && (
                      <span className="text-text-muted text-[11px]">
                        Score: {compactPopover.riskScore}/100
                      </span>
                    )}
                  </div>
                )}

                {compactPopover.details && (
                  <p className="text-slate-300 text-[11px]">
                    {compactPopover.details}
                  </p>
                )}

                {compactPopover.linkUrl && (
                  <div className="pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        if (onNavigateToGlobe && compactPopover.code) {
                          onNavigateToGlobe(compactPopover.code);
                        } else if (compactPopover.linkUrl) {
                          navigate(compactPopover.linkUrl);
                        }
                      }}
                      className="text-cyan-400 hover:text-cyan-300 font-semibold text-[11px] flex items-center gap-1"
                    >
                      <span>Open in Global Map</span>
                      <span aria-hidden="true">&rarr;</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* WebGL Fallback Locations List */
          <div
            data-testid="compact-globe-fallback-list"
            className="p-4 bg-bg-surface border border-border-subtle rounded-lg space-y-2 text-xs"
          >
            <div className="font-semibold text-text-secondary">
              Top Locations by Evaluated Risk (WebGL Unavailable):
            </div>
            <ul className="divide-y divide-border-subtle">
              {topLocations.map((s) => (
                <li key={s.code} className="py-1.5 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-text-primary">{s.name}</span>
                    <span className="text-[11px] text-text-muted font-mono ml-2">{s.code}</span>
                  </div>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold border"
                    style={{
                      color: RISK_PALETTE[s.risk_band]?.fillColor || '#94a3b8',
                      borderColor: RISK_PALETTE[s.risk_band]?.fillColor || '#94a3b8',
                    }}
                  >
                    {s.risk_band}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              to="/globe"
              className="inline-block mt-2 text-accent-primary hover:underline text-xs font-semibold"
            >
              Open Locations in Global Map &rarr;
            </Link>
          </div>
        )}

        {/* Data Source Transparency Footer */}
        <div className="text-[11px] text-text-muted italic pt-1 border-t border-border-subtle flex items-center justify-between">
          <span>Calculated from loaded supplier data, not a live disruption feed.</span>
          <span>Offline local rendering</span>
        </div>
      </div>
    );
  }

  // ----------------- FULL MODE (GLOBAL MAP PAGE) -----------------
  return (
    <div
      ref={rootContainerRef}
      data-testid="globe-page-root"
      className={`relative flex flex-col h-[calc(100vh-64px)] w-full bg-[#070b14] text-slate-100 overflow-hidden font-sans ${className}`}
    >
      {/* Top Floating View Mode Switcher */}
      <div className="absolute top-3 right-4 z-30 flex items-center gap-2">
        {webGlAvailable && (
          <div className="bg-[#0b1329]/90 border border-slate-700/80 rounded-lg p-0.5 flex text-xs font-semibold backdrop-blur-md shadow-lg">
            <button
              type="button"
              onClick={() => setViewMode('globe')}
              className={`px-3 py-1 rounded transition-colors ${
                viewMode === 'globe'
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : 'text-text-muted hover:text-slate-200'
              }`}
            >
              3D Globe
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded transition-colors ${
                viewMode === 'list'
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : 'text-text-muted hover:text-slate-200'
              }`}
            >
              Locations List
            </button>
          </div>
        )}
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        {/* Left Filter & Legend Sidebar */}
        <GlobeFilterSidebar
          filters={filters}
          onChangeFilters={updateFiltersAndUrl}
          onResetFilters={() =>
            updateFiltersAndUrl({
              ...filters,
              searchTerm: '',
              selectedRisks: new Set(),
              selectedCountry: '',
              selectedComponent: '',
              selectedWarehouse: '',
              poStatus: 'all',
              criticalComponentsOnly: false,
            })
          }
          onResetView={() => globeRef.current?.resetView()}
          onFitLocations={() => {
            const locs: { lat: number; lon: number }[] = [];
            filteredSuppliers.forEach((s) => {
              if (s.location?.lat != null && s.location?.lon != null) {
                locs.push({ lat: s.location.lat, lon: s.location.lon });
              }
            });
            filteredWarehouses.forEach((w) => {
              if (w.location?.lat != null && w.location?.lon != null) {
                locs.push({ lat: w.location.lat, lon: w.location.lon });
              }
            });
            globeRef.current?.fitToLocations(locs);
          }}
          onToggleFullscreen={handleToggleFullscreen}
          isFullscreen={isFullscreen}
          suppliers={data.suppliers}
          warehouses={data.warehouses}
          routes={data.routes}
          concentration={data.concentration}
          unresolved={data.unresolved}
          onSelectEntity={(ent) => {
            setSelectedEntity(ent);
            if (ent.type === 'supplier' || ent.type === 'warehouse') {
              const loc = ent.item.location;
              if (loc && loc.lat != null && loc.lon != null) {
                globeRef.current?.pointOfView({ lat: loc.lat, lng: loc.lon, altitude: 1.5 }, 1000);
              }
            }
          }}
          onSetLocation={handleOpenSetLocation}
        />

        {/* Center Canvas or List View */}
        {viewMode === 'globe' && webGlAvailable ? (
          <GlobeCanvas
            ref={globeRef}
            suppliers={filteredSuppliers}
            warehouses={filteredWarehouses}
            routes={filteredRoutes}
            concentration={data.concentration}
            showSuppliers={filters.showSuppliers}
            showWarehouses={filters.showWarehouses}
            showRoutes={filters.showRoutes}
            showConcentration={filters.showConcentration}
            showLabels={filters.showLabels !== false}
            showStateLabels={filters.showStateLabels !== false}
            selectedEntityCode={
              activeSelectedEntity &&
              (activeSelectedEntity.type === 'supplier' || activeSelectedEntity.type === 'warehouse')
                ? activeSelectedEntity.item.code
                : null
            }
            onSelectEntity={(ent) => setSelectedEntity(ent)}
            onSelectCluster={(cl) => setActiveCluster(cl)}
            onSelectCountry={handleSelectCountry}
            onSelectState={handleSelectState}
            isClickToPlaceActive={isClickToPlaceActive}
            onGlobeClickCoords={(coords) => {
              setClickedCoords(coords);
              setIsClickToPlaceActive(false);
            }}
          />
        ) : (
          <GlobeListFallback
            suppliers={filteredSuppliers}
            warehouses={filteredWarehouses}
            onSelectEntity={(ent) => setSelectedEntity(ent)}
            webGlUnavailable={!webGlAvailable}
          />
        )}

        {/* Right Detail Inspection Panel */}
        <GlobeDetailPanel
          entity={activeSelectedEntity}
          onClose={() => setSelectedEntity(null)}
          onSetLocation={handleOpenSetLocation}
        />
      </div>

      {/* Cluster Picker Popover Modal */}
      {activeCluster && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Select entity at coordinate"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
        >
          <div className="bg-[#0e172e] border border-cyan-500/50 rounded-xl max-w-sm w-full p-4 text-slate-100 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
              <h3 className="font-bold text-sm text-cyan-300">
                {activeCluster.count} Entities at this Location
              </h3>
              <button
                type="button"
                onClick={() => setActiveCluster(null)}
                className="text-text-muted hover:text-white p-1"
                aria-label="Close cluster selection"
              >
                &times;
              </button>
            </div>
            <p className="text-xs text-text-muted">
              Multiple facilities share this coordinate (Lat: {activeCluster.lat.toFixed(2)}, Lon:{' '}
              {activeCluster.lng.toFixed(2)}). Select an entity to view detailed metrics:
            </p>
            <ul className="space-y-1.5 max-h-60 overflow-y-auto divide-y divide-slate-800">
              {activeCluster.items.map((it) => (
                <li key={`${it.type}-${it.item.code}`} className="pt-1.5 first:pt-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEntity(it);
                      setActiveCluster(null);
                    }}
                    className="w-full text-left p-2 rounded hover:bg-cyan-950/70 border border-slate-800 hover:border-cyan-500/50 flex items-center justify-between transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-white text-xs">{it.item.name}</div>
                      <div className="text-[10px] text-text-muted font-mono">{it.item.code}</div>
                    </div>
                    <span className="text-[10px] uppercase font-bold text-cyan-400">
                      {it.type === 'supplier'
                        ? `Risk: ${(it.item as GlobeSupplier).risk_band}`
                        : (it.item as GlobeWarehouse).role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Set / Override Coordinates Modal */}
      {overrideTarget && (
        <SetLocationModal
          isOpen={true}
          entityType={overrideTarget.type}
          code={overrideTarget.code}
          name={overrideTarget.name}
          clickedCoords={clickedCoords}
          isSavingEnabled={isSavingEnabled}
          onClose={() => {
            setOverrideTarget(null);
            setClickedCoords(null);
            setIsClickToPlaceActive(false);
          }}
          onSaved={() => {
            setOverrideTarget(null);
            setClickedCoords(null);
            setIsClickToPlaceActive(false);
            loadGlobe();
          }}
          onEnableClickToPlace={() => setIsClickToPlaceActive(true)}
          onDisableClickToPlace={() => setIsClickToPlaceActive(false)}
          isClickToPlaceActive={isClickToPlaceActive}
        />
      )}

      {/* Bottom Data Source & Coverage Strip */}
      <GlobeBottomStrip
        coverage={data.coverage}
        dataset={data.dataset}
        as_of={data.as_of}
        suppliers={data.suppliers}
        warehouses={data.warehouses}
      />
    </div>
  );
};
