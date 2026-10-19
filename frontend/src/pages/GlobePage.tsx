import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getGlobe, getImportStatus } from '../api/endpoints';
import { useApi } from '../api/useApi';
import type {
  GlobeSupplier,
  GlobeWarehouse,
} from '../api/types';
import { GlobeBottomStrip } from '../components/globe/GlobeBottomStrip';
import {
  GlobeCanvas,
  type GlobeCanvasHandle,
  type GroupedPoint,
} from '../components/globe/GlobeCanvas';
import { GlobeDetailPanel, type SelectedEntity } from '../components/globe/GlobeDetailPanel';
import {
  GlobeFilterSidebar,
  type GlobeFilterState,
} from '../components/globe/GlobeFilterSidebar';
import { GlobeListFallback } from '../components/globe/GlobeListFallback';
import { SetLocationModal } from '../components/globe/SetLocationModal';
import type { RiskLevelKey } from '../theme/riskPalette';

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

export const GlobePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const globeRef = useRef<GlobeCanvasHandle>(null);
  const rootContainerRef = useRef<HTMLDivElement>(null);

  // WebGL availability
  const webGlAvailable = useMemo(() => isWebGLSupported(), []);


  // Display states
  const [viewMode, setViewMode] = useState<'globe' | 'list'>(() =>
    isWebGLSupported() ? 'globe' : 'list'
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Selection states
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [activeCluster, setActiveCluster] = useState<GroupedPoint | null>(null);

  // Set location modal states
  const [overrideTarget, setOverrideTarget] = useState<{
    type: 'supplier' | 'warehouse';
    code: string;
    name: string;
  } | null>(null);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [isClickToPlaceActive, setIsClickToPlaceActive] = useState<boolean>(false);

  // Filters state (initialized from URL params)
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
    };
  });

  // Core data fetching via standard useApi hook
  const fetchGlobe = useCallback((signal: AbortSignal) => getGlobe(signal), []);
  const { data, loading, error: apiError, reload: loadGlobe } = useApi(fetchGlobe);
  const error = apiError ? apiError.message : null;

  const fetchStatus = useCallback((signal: AbortSignal) => getImportStatus(signal), []);
  const { data: statusData } = useApi(fetchStatus);
  const isSavingEnabled = Boolean(statusData?.enabled);

  // Sync URL search params
  const updateFiltersAndUrl = (nextFilters: GlobeFilterState) => {
    setFilters(nextFilters);
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

    // Keep deep-linked supplier param if present
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

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    if (!data?.suppliers) return [];
    return data.suppliers.filter((s) => {
      // Risk filter
      if (filters.selectedRisks.size > 0 && !filters.selectedRisks.has(s.risk_band)) {
        return false;
      }
      // Country filter
      if (filters.selectedCountry && s.country !== filters.selectedCountry) {
        return false;
      }
      // Component filter
      if (
        filters.selectedComponent &&
        !s.components.some((c) => c.sku === filters.selectedComponent)
      ) {
        return false;
      }
      // Critical components only
      if (filters.criticalComponentsOnly) {
        // Supplying at least one critical component
        const hasCritical = s.components.length > 0;
        if (!hasCritical) return false;
      }
      // PO status
      if (filters.poStatus === 'overdue' && s.overdue_po_count === 0) return false;
      if (filters.poStatus === 'slipped' && s.slipped_po_count === 0) return false;
      if (filters.poStatus === 'open' && s.open_po_count === 0) return false;

      return true;
    });
  }, [data, filters]);

  // Filtered warehouses
  const filteredWarehouses = useMemo(() => {
    if (!data?.warehouses) return [];
    return data.warehouses.filter((w) => {
      if (filters.selectedWarehouse && w.code !== filters.selectedWarehouse) {
        return false;
      }
      return true;
    });
  }, [data, filters.selectedWarehouse]);

  // Reset controls
  const handleResetFilters = () => {
    updateFiltersAndUrl({
      ...filters,
      searchTerm: '',
      selectedRisks: new Set(),
      selectedCountry: '',
      selectedComponent: '',
      selectedWarehouse: '',
      poStatus: 'all',
      criticalComponentsOnly: false,
    });
  };

  const handleResetView = () => {
    globeRef.current?.resetView();
  };

  const handleFitLocations = () => {
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
  };

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

  // Handle set location modal opening
  const handleOpenSetLocation = (
    type: 'supplier' | 'warehouse',
    code: string,
    name: string
  ) => {
    setOverrideTarget({ type, code, name });
    setClickedCoords(null);
  };

  // ----------------- RENDER STATES -----------------

  // 1. Loading Skeleton
  if (loading) {
    return (
      <div
        data-testid="globe-loading-view"
        className="min-h-[calc(100vh-80px)] bg-[#070b14] flex flex-col items-center justify-center p-6 text-slate-300 space-y-4"
      >
        <div className="w-16 h-16 rounded-full border-4 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        <div className="text-center space-y-1">
          <h2 className="text-base font-bold text-slate-100">Initializing Supply Chain Globe</h2>
          <p className="text-xs text-slate-400">
            Resolving vendor coordinates, calculating routes, and assessing geographic concentration...
          </p>
        </div>
      </div>
    );
  }

  // 2. Error State with Retry
  if (error || !data) {
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
            onClick={loadGlobe}
            className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs shadow-md transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // 3. Unseeded State
  if (!data.seeded) {
    return (
      <div
        data-testid="globe-unseeded-view"
        className="min-h-[calc(100vh-80px)] bg-[#070b14] flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full bg-[#0d1629] border border-slate-800 rounded-xl p-6 text-center space-y-3 text-slate-300">
          <h2 className="text-base font-bold text-white">Database Not Seeded</h2>
          <p className="text-xs text-slate-400">
            No supply chain records are present in the active dataset. Import a CSV dataset or seed demo data.
          </p>
        </div>
      </div>
    );
  }

  // 4. Empty Suppliers State
  if (data.suppliers.length === 0) {
    return (
      <div
        data-testid="globe-empty-view"
        className="min-h-[calc(100vh-80px)] bg-[#070b14] flex items-center justify-center p-6 text-slate-400"
      >
        No suppliers to display in active dataset.
      </div>
    );
  }

  return (
    <div
      ref={rootContainerRef}
      data-testid="globe-page-root"
      className="relative flex flex-col h-[calc(100vh-64px)] w-full bg-[#070b14] text-slate-100 overflow-hidden font-sans"
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
                  : 'text-slate-400 hover:text-slate-200'
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
                  : 'text-slate-400 hover:text-slate-200'
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
          onResetFilters={handleResetFilters}
          onResetView={handleResetView}
          onFitLocations={handleFitLocations}
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
            routes={data.routes}
            concentration={data.concentration}
            showSuppliers={filters.showSuppliers}
            showWarehouses={filters.showWarehouses}
            showRoutes={filters.showRoutes}
            showConcentration={filters.showConcentration}
            selectedEntityCode={
              activeSelectedEntity && activeSelectedEntity.type !== 'country'
                ? activeSelectedEntity.item.code
                : null
            }
            onSelectEntity={(ent) => setSelectedEntity(ent)}
            onSelectCluster={(cl) => setActiveCluster(cl)}
            onSelectCountry={(c) => setSelectedEntity({ type: 'country', item: c })}
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
                className="text-slate-400 hover:text-white p-1"
                aria-label="Close cluster selection"
              >
                &times;
              </button>
            </div>
            <p className="text-xs text-slate-400">
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
                    className="w-full text-left p-2 rounded hover:bg-slate-800 transition-colors flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-white">{it.item.name}</div>
                      <div className="font-mono text-[10px] text-slate-400">
                        {it.item.code} &bull;{' '}
                        {it.type === 'supplier'
                          ? `Risk: ${(it.item as GlobeSupplier).risk_band}`
                          : `Role: ${(it.item as GlobeWarehouse).role}`}
                      </div>
                    </div>
                    <span className="text-cyan-400 font-semibold">&rarr;</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Manual Override Modal */}
      {overrideTarget && (
        <SetLocationModal
          entityType={overrideTarget.type}
          code={overrideTarget.code}
          name={overrideTarget.name}
          currentLocation={
            overrideTarget.type === 'supplier'
              ? data.suppliers.find((s) => s.code === overrideTarget.code)?.location
              : data.warehouses.find((w) => w.code === overrideTarget.code)?.location
          }
          isOpen={true}
          onClose={() => {
            setOverrideTarget(null);
            setIsClickToPlaceActive(false);
          }}
          onSaved={loadGlobe}
          isSavingEnabled={isSavingEnabled}
          clickedCoords={clickedCoords}
          isClickToPlaceActive={isClickToPlaceActive}
          onEnableClickToPlace={() => setIsClickToPlaceActive(true)}
          onDisableClickToPlace={() => setIsClickToPlaceActive(false)}
        />
      )}

      {/* Bottom Data-Source & Metrics Strip */}
      <GlobeBottomStrip
        dataset={data.dataset}
        as_of={data.as_of}
        coverage={data.coverage}
        suppliers={data.suppliers}
        warehouses={data.warehouses}
      />
    </div>
  );
};
