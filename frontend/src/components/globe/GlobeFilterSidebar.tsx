import React, { useState } from 'react';
import type {
  GlobeConcentration,
  GlobeRoute,
  GlobeSupplier,
  GlobeUnresolved,
  GlobeWarehouse,
} from '../../api/types';
import { RISK_PALETTE, type RiskLevelKey } from '../../theme/riskPalette';

export interface GlobeFilterState {
  searchTerm: string;
  selectedRisks: Set<RiskLevelKey>;
  selectedCountry: string;
  selectedComponent: string;
  selectedWarehouse: string;
  poStatus: 'all' | 'open' | 'in_transit' | 'partially_received' | 'overdue' | 'slipped';
  criticalComponentsOnly: boolean;
  showSuppliers: boolean;
  showWarehouses: boolean;
  showRoutes: boolean;
  showConcentration: boolean;
  showLabels?: boolean;
  showStateLabels?: boolean;
}

interface GlobeFilterSidebarProps {
  filters: GlobeFilterState;
  onChangeFilters: (next: GlobeFilterState) => void;
  onResetFilters: () => void;
  onResetView: () => void;
  onFitLocations: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  suppliers: GlobeSupplier[];
  warehouses: GlobeWarehouse[];
  routes: GlobeRoute[];
  concentration: GlobeConcentration[];
  unresolved: GlobeUnresolved[];
  onSelectEntity: (
    entity:
      | { type: 'supplier'; item: GlobeSupplier }
      | { type: 'warehouse'; item: GlobeWarehouse }
      | { type: 'country'; item: GlobeConcentration }
  ) => void;
  onSetLocation: (type: 'supplier' | 'warehouse', code: string, name: string) => void;
}

export const GlobeFilterSidebar: React.FC<GlobeFilterSidebarProps> = ({
  filters,
  onChangeFilters,
  onResetFilters,
  onResetView,
  onFitLocations,
  onToggleFullscreen,
  isFullscreen,
  suppliers,
  warehouses,
  routes,
  concentration,
  unresolved,
  onSelectEntity,
  onSetLocation,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'filters' | 'legend' | 'unresolved'>('filters');

  // Derive filter dropdown options
  const countryOptions = Array.from(
    new Set(suppliers.map((s) => s.country).filter(Boolean))
  ).sort();

  const componentOptions = Array.from(
    new Set(suppliers.flatMap((s) => s.components.map((c) => c.sku)))
  ).sort();

  const warehouseOptions = Array.from(new Set(warehouses.map((w) => w.code))).sort();

  // Search matches for type-ahead
  const trimmedSearch = filters.searchTerm.trim().toLowerCase();
  const searchResults = trimmedSearch
    ? [
        ...suppliers
          .filter(
            (s) =>
              s.code.toLowerCase().includes(trimmedSearch) ||
              s.name.toLowerCase().includes(trimmedSearch)
          )
          .slice(0, 5)
          .map((s) => ({ type: 'supplier' as const, item: s, label: `${s.code} - ${s.name}` })),
        ...warehouses
          .filter(
            (w) =>
              w.code.toLowerCase().includes(trimmedSearch) ||
              w.name.toLowerCase().includes(trimmedSearch)
          )
          .slice(0, 3)
          .map((w) => ({ type: 'warehouse' as const, item: w, label: `${w.code} - ${w.name}` })),
      ]
    : [];

  const toggleRisk = (risk: RiskLevelKey) => {
    const next = new Set(filters.selectedRisks);
    if (next.has(risk)) {
      next.delete(risk);
    } else {
      next.add(risk);
    }
    onChangeFilters({ ...filters, selectedRisks: next });
  };

  return (
    <aside
      aria-label="Globe Control & Filter Panel"
      className={`relative z-20 bg-[#091124]/95 border-r border-slate-700/60 text-slate-100 flex flex-col transition-all duration-300 backdrop-blur-md ${
        isCollapsed ? 'w-12 shrink-0' : 'w-80 md:w-84 shrink-0'
      }`}
    >
      {/* Collapse Toggle Bar */}
      <div className="p-3 border-b border-slate-700/60 flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-tight text-cyan-300">
              Supply Chain Sentinel
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold bg-cyan-950 text-cyan-400 border border-cyan-800">
              Control Tower
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand control panel' : 'Collapse control panel'}
          className="text-text-muted hover:text-white p-1 rounded hover:bg-slate-800 focus:outline-hidden focus:ring-1 focus:ring-cyan-400"
        >
          {isCollapsed ? '&rarr;' : '&larr;'}
        </button>
      </div>

      {/* When collapsed: Icon strip */}
      {isCollapsed ? (
        <div className="p-2 space-y-3 flex flex-col items-center text-xs">
          <button
            type="button"
            onClick={() => {
              setIsCollapsed(false);
              setActiveTab('filters');
            }}
            title="Filters & Search"
            className="p-2 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
          >
            &#128269;
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCollapsed(false);
              setActiveTab('legend');
            }}
            title="Legend"
            className="p-2 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
          >
            &#127912;
          </button>
          {unresolved.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsCollapsed(false);
                setActiveTab('unresolved');
              }}
              title={`Needs Location (${unresolved.length})`}
              className="p-2 rounded bg-amber-950/80 text-amber-300 border border-amber-700 text-xs font-bold"
            >
              !{unresolved.length}
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Subtabs */}
          <div className="flex border-b border-slate-700/60 bg-[#070d1c] text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('filters')}
              className={`flex-1 py-2 text-center border-b-2 transition-colors ${
                activeTab === 'filters'
                  ? 'border-cyan-400 text-cyan-300 bg-slate-800/40'
                  : 'border-transparent text-text-muted hover:text-slate-200'
              }`}
            >
              Controls
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('legend')}
              className={`flex-1 py-2 text-center border-b-2 transition-colors ${
                activeTab === 'legend'
                  ? 'border-cyan-400 text-cyan-300 bg-slate-800/40'
                  : 'border-transparent text-text-muted hover:text-slate-200'
              }`}
            >
              Legend
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unresolved')}
              className={`flex-1 py-2 text-center border-b-2 transition-colors relative ${
                activeTab === 'unresolved'
                  ? 'border-cyan-400 text-cyan-300 bg-slate-800/40'
                  : 'border-transparent text-text-muted hover:text-slate-200'
              }`}
            >
              Needs Location
              {unresolved.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-900 text-amber-200">
                  {unresolved.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab 1: Controls & Filters */}
          {activeTab === 'filters' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* Type-ahead search */}
              <div className="space-y-1 relative">
                <label htmlFor="globe-search-input" className="font-semibold text-slate-300 block">
                  Search Entity:
                </label>
                <input
                  id="globe-search-input"
                  type="text"
                  value={filters.searchTerm}
                  onChange={(e) => onChangeFilters({ ...filters, searchTerm: e.target.value })}
                  placeholder="Code or name..."
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 placeholder:text-text-secondary focus:outline-hidden focus:border-cyan-400"
                />
                {searchResults.length > 0 && (
                  <ul className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-cyan-500/50 rounded shadow-xl z-30 max-h-40 overflow-y-auto divide-y divide-slate-800">
                    {searchResults.map((res) => (
                      <li key={`${res.type}-${res.item.code}`}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectEntity(res as any);
                            onChangeFilters({ ...filters, searchTerm: '' });
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-cyan-950/70 text-slate-200 truncate flex items-center justify-between"
                        >
                          <span className="font-mono font-semibold">{res.label}</span>
                          <span className="text-[10px] uppercase text-cyan-400">{res.type}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Layer Toggles */}
              <div className="space-y-2 p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                <span className="font-semibold text-slate-300 block text-[11px] uppercase tracking-wider">
                  Visualization Layers
                </span>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filters.showSuppliers}
                      onChange={(e) =>
                        onChangeFilters({ ...filters, showSuppliers: e.target.checked })
                      }
                      className="rounded accent-cyan-500"
                    />
                    <span className="text-slate-300">Suppliers ({suppliers.length})</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filters.showWarehouses}
                      onChange={(e) =>
                        onChangeFilters({ ...filters, showWarehouses: e.target.checked })
                      }
                      className="rounded accent-cyan-500"
                    />
                    <span className="text-slate-300">Warehouses ({warehouses.length})</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filters.showRoutes}
                      onChange={(e) =>
                        onChangeFilters({ ...filters, showRoutes: e.target.checked })
                      }
                      className="rounded accent-cyan-500"
                    />
                    <span className="text-slate-300">Supply Routes ({routes.length})</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none pt-1 border-t border-slate-800">
                    <input
                      type="checkbox"
                      aria-label="Areas With the Most Problems (Supplier Risk Concentration)"
                      checked={filters.showConcentration}
                      onChange={(e) =>
                        onChangeFilters({ ...filters, showConcentration: e.target.checked })
                      }
                      className="rounded accent-amber-500"
                    />
                    <span className="text-amber-300 font-semibold">
                      Areas With the Most Problems ({concentration.filter((c) => c.flagged).length} flagged)
                    </span>
                    <span className="text-[10px] text-text-muted block">
                      Calculated from loaded supplier data, not a live disruption feed
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none pt-1 border-t border-slate-800">
                    <input
                      type="checkbox"
                      checked={filters.showLabels !== false}
                      aria-label="Toggle Geographic Labels layer"
                      onChange={(e) =>
                        onChangeFilters({ ...filters, showLabels: e.target.checked })
                      }
                      className="rounded accent-cyan-500"
                    />
                    <span className="text-slate-300 font-medium">Geographic Labels</span>
                  </label>
                  {filters.showLabels !== false && (
                    <label className="flex items-center gap-2 cursor-pointer select-none pl-6 text-[11px]">
                      <input
                        type="checkbox"
                        checked={filters.showStateLabels !== false}
                        aria-label="Toggle State and Province Names"
                        onChange={(e) =>
                          onChangeFilters({ ...filters, showStateLabels: e.target.checked })
                        }
                        className="rounded accent-cyan-500"
                      />
                      <span className="text-slate-400">State/province names</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Risk Multi-Select */}
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-300 block">Risk Band:</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['critical', 'high', 'medium', 'low', 'unknown'] as RiskLevelKey[]).map(
                    (risk) => {
                      const active = filters.selectedRisks.has(risk);
                      return (
                        <button
                          key={risk}
                          type="button"
                          onClick={() => toggleRisk(risk)}
                          className={`px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider border transition-colors ${
                            active
                              ? 'bg-slate-800 text-white border-cyan-400 shadow-xs'
                              : 'bg-slate-900/60 text-text-muted border-slate-800 hover:text-slate-200'
                          }`}
                          style={{
                            borderLeftWidth: '4px',
                            borderLeftColor: RISK_PALETTE[risk]?.fillColor || '#94a3b8',
                          }}
                        >
                          {risk}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Country Dropdown */}
              <div className="space-y-1">
                <label htmlFor="globe-country-filter" className="font-semibold text-slate-300 block">
                  Supplier Country:
                </label>
                <select
                  id="globe-country-filter"
                  value={filters.selectedCountry}
                  onChange={(e) => onChangeFilters({ ...filters, selectedCountry: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-400"
                >
                  <option value="">All Countries</option>
                  {countryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Component Dropdown */}
              <div className="space-y-1">
                <label htmlFor="globe-comp-filter" className="font-semibold text-slate-300 block">
                  Supplied Component SKU:
                </label>
                <select
                  id="globe-comp-filter"
                  value={filters.selectedComponent}
                  onChange={(e) =>
                    onChangeFilters({ ...filters, selectedComponent: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-400"
                >
                  <option value="">All Components</option>
                  {componentOptions.map((sku) => (
                    <option key={sku} value={sku}>
                      {sku}
                    </option>
                  ))}
                </select>
              </div>

              {/* Warehouse Dropdown */}
              <div className="space-y-1">
                <label htmlFor="globe-wh-filter" className="font-semibold text-slate-300 block">
                  Destination Warehouse:
                </label>
                <select
                  id="globe-wh-filter"
                  value={filters.selectedWarehouse}
                  onChange={(e) =>
                    onChangeFilters({ ...filters, selectedWarehouse: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-400"
                >
                  <option value="">All Warehouses</option>
                  {warehouseOptions.map((wh) => (
                    <option key={wh} value={wh}>
                      {wh}
                    </option>
                  ))}
                </select>
              </div>

              {/* PO Status */}
              <div className="space-y-1">
                <label htmlFor="globe-po-status-filter" className="font-semibold text-slate-300 block">
                  Purchase Order Status:
                </label>
                <select
                  id="globe-po-status-filter"
                  value={filters.poStatus}
                  onChange={(e) =>
                    onChangeFilters({ ...filters, poStatus: e.target.value as any })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-400"
                >
                  <option value="all">All Statuses</option>
                  <option value="overdue">Overdue Deliveries Only</option>
                  <option value="slipped">Slipped Deliveries Only</option>
                  <option value="in_transit">In Transit Only</option>
                  <option value="open">Open Only</option>
                </select>
              </div>

              {/* Critical Component Suppliers Only */}
              <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={filters.criticalComponentsOnly}
                  onChange={(e) =>
                    onChangeFilters({ ...filters, criticalComponentsOnly: e.target.checked })
                  }
                  className="rounded accent-cyan-500"
                />
                <span className="text-slate-300 font-medium">
                  Critical Components Suppliers Only
                </span>
              </label>

              {/* View Control Buttons */}
              <div className="pt-3 border-t border-slate-700/60 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-center font-medium"
                >
                  Reset Filters
                </button>
                <button
                  type="button"
                  onClick={onResetView}
                  className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-center font-medium"
                >
                  Reset Camera
                </button>
                <button
                  type="button"
                  onClick={onFitLocations}
                  className="py-1.5 px-2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 hover:bg-cyan-900 text-center font-medium"
                >
                  Fit Locations
                </button>
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-center font-medium"
                >
                  {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Map Legend */}
          {activeTab === 'legend' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-300">
              <div className="space-y-2">
                <h3 className="font-bold text-white text-sm">Entity Symbols</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3.5 h-3.5 rounded-full bg-cyan-400 border border-white" />
                    <span>Supplier (Circle filled with risk color)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-3.5 h-3.5 rotate-45 bg-sky-400 border border-white" />
                    <span>Warehouse Plant (Diamond, larger)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rotate-45 bg-indigo-400 border border-border-subtle" />
                    <span>Regional Warehouse Hub (Diamond, smaller)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-amber-400" />
                    <span>Approximate Location (Country centroid)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full border-2 border-cyan-400 flex items-center justify-center font-mono text-[9px] font-bold text-cyan-200">
                      3
                    </div>
                    <span>Grouped Marker (Multiple entities at same coordinate)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 text-center font-sans font-bold text-xs text-slate-300">
                      Aa
                    </span>
                    <span>Geographic labels (Country &amp; state boundaries)</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-700/60">
                <h3 className="font-bold text-white text-sm">Risk Bands</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500" />
                    <span>Critical Risk</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-orange-500" />
                    <span>High Risk</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <span>Medium Risk</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span>Low Risk</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-slate-500" />
                    <span>Unknown / New</span>
                  </div>
                </div>
                <p className="text-[11px] text-text-muted italic pt-1">
                  Note: Pulse animation indicates high/critical risk band, not live events.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-700/60">
                <h3 className="font-bold text-white text-sm">Routes &amp; Areas With the Most Problems</h3>
                <p className="text-[11px] leading-relaxed text-slate-300">
                  Arced routes indicate planned purchase orders connecting a vendor to a receiving facility. Red-orange arcs signify open purchase orders with delivery delays or high-risk suppliers.
                </p>
                <p className="text-[11px] leading-relaxed text-amber-200/90 bg-amber-950/40 p-2 rounded border border-amber-800/60">
                  Concentration layer highlights nations hosting &ge;40% of suppliers (min 3) or sole suppliers of critical parts.
                </p>
              </div>
            </div>
          )}

          {/* Tab 3: Unresolved Locations */}
          {activeTab === 'unresolved' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">Needs Location ({unresolved.length})</h3>
                <span className="text-[11px] text-text-muted">Unmapped entities</span>
              </div>

              {unresolved.length === 0 ? (
                <div className="p-4 text-center text-text-muted italic bg-slate-900/60 rounded-lg border border-slate-800">
                  All suppliers and warehouses have resolved geographic coordinates.
                </div>
              ) : (
                <ul className="space-y-2">
                  {unresolved.map((item) => (
                    <li
                      key={`${item.entity_type}-${item.code}`}
                      className="p-2.5 rounded bg-slate-900/80 border border-slate-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-cyan-300">{item.code}</span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-800 text-text-muted">
                          {item.entity_type}
                        </span>
                      </div>
                      <p className="text-slate-300 truncate" title={item.name}>
                        {item.name}
                      </p>
                      <p className="text-[11px] text-text-muted leading-normal">{item.reason}</p>
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => onSetLocation(item.entity_type, item.code, item.name)}
                          className="px-2.5 py-1 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-700 text-[11px] font-semibold w-full text-center"
                        >
                          Set Location &rarr;
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
