import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import type {
  GlobeConcentration,
  GlobeRoute,
  GlobeSupplier,
  GlobeWarehouse,
} from '../../api/types';
import { RISK_PALETTE, type RiskLevelKey } from '../../theme/riskPalette';
import { computePointOnPolygon, declutterLabels, isFarSide } from '../../lib/geo';
import {
  ADMIN1_REGISTRY,
  isCameraOverCountry,
  loadAdmin1Data,
  selectCountryLabels,
  type GlobeLabelItem,
} from '../../lib/geoLabels';
import { escapeHtml } from './escapeHtml';

export interface GlobeCanvasHandle {
  pointOfView: (pov: { lat?: number; lng?: number; altitude?: number }, duration?: number) => void;
  fitToLocations: (locations: { lat: number; lon: number }[]) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export interface GroupedPoint {
  lat: number;
  lng: number;
  count: number;
  type: 'supplier' | 'warehouse' | 'cluster';
  primaryRisk?: RiskLevelKey;
  isApproximate: boolean;
  hasOverdueOrSlipped: boolean;
  openPoCount: number;
  items: Array<
    | { type: 'supplier'; item: GlobeSupplier }
    | { type: 'warehouse'; item: GlobeWarehouse }
  >;
}

interface GlobeCanvasProps {
  suppliers: GlobeSupplier[];
  warehouses: GlobeWarehouse[];
  routes: GlobeRoute[];
  concentration: GlobeConcentration[];
  showSuppliers: boolean;
  showWarehouses: boolean;
  showRoutes: boolean;
  showConcentration: boolean;
  showLabels?: boolean;
  showStateLabels?: boolean;
  selectedEntityCode?: string | null;
  onSelectEntity: (
    entity:
      | { type: 'supplier'; item: GlobeSupplier }
      | { type: 'warehouse'; item: GlobeWarehouse }
  ) => void;
  onSelectCluster: (cluster: GroupedPoint) => void;
  onSelectCountry: (country: GlobeConcentration | { country_code: string; country_name: string; [key: string]: any }) => void;
  onSelectState?: (stateName: string, countryName: string, countryCode: string, feature: any) => void;
  isClickToPlaceActive?: boolean;
  onGlobeClickCoords?: (coords: { lat: number; lon: number }) => void;
  onWebGLFailure?: () => void;
  scrollGuard?: boolean;
  isGlobeActive?: boolean;
  onActivateGlobe?: () => void;
}

export const GlobeCanvas = React.forwardRef<GlobeCanvasHandle, GlobeCanvasProps>(
  (
    {
      suppliers,
      warehouses,
      routes,
      concentration,
      showSuppliers,
      showWarehouses,
      showRoutes,
      showConcentration,
      showLabels = true,
      showStateLabels = true,
      selectedEntityCode,
      onSelectEntity,
      onSelectCluster,
      onSelectCountry,
      onSelectState,
      isClickToPlaceActive = false,
      onGlobeClickCoords,
      scrollGuard = false,
      isGlobeActive = false,
      onActivateGlobe,
    }: GlobeCanvasProps,
    ref
  ) => {
    const globeEl = useRef<GlobeMethods | undefined>(undefined);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
      width: 800,
      height: 600,
    });
    const [countriesGeoJson, setCountriesGeoJson] = useState<any[]>([]);
    const [countryLabelsRaw, setCountryLabelsRaw] = useState<any[]>([]);
    const [admin1Features, setAdmin1Features] = useState<any[]>([]);
    const [admin1Country, setAdmin1Country] = useState<string | null>(null);
    const [cameraPov, setCameraPov] = useState<{ lat: number; lng: number; altitude: number }>({
      lat: 20,
      lng: 0,
      altitude: 2.5,
    });
    const [isReducedMotion, setIsReducedMotion] = useState<boolean>(() => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
    });

    // Detect prefers-reduced-motion changes
    useEffect(() => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      const listener = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
      mediaQuery?.addEventListener?.('change', listener);
      return () => mediaQuery?.removeEventListener?.('change', listener);
    }, []);

    // Resize handling
    useEffect(() => {
      if (!containerRef.current) return;
      const updateSize = () => {
        if (containerRef.current) {
          setDimensions({
            width: containerRef.current.clientWidth || 800,
            height: containerRef.current.clientHeight || 600,
          });
        }
      };
      updateSize();
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Load bundled Natural Earth GeoJSON for country concentration
    useEffect(() => {
      let isMounted = true;
      fetch('/globe/countries-110m.geojson')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isMounted && data && Array.isArray(data.features)) {
            setCountriesGeoJson(data.features);
          }
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }, []);

    // Load country labels dataset
    useEffect(() => {
      let isMounted = true;
      fetch('/globe/country-labels.json')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (isMounted && Array.isArray(data)) {
            setCountryLabelsRaw(data);
          }
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }, []);

    // Track camera POV throttled on orbit controls change
    useEffect(() => {
      if (!globeEl.current) return;
      const controls = (globeEl.current as any).controls?.();
      if (!controls) return;

      let timeoutId: any = null;
      const handleChange = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (globeEl.current) {
            const pov = globeEl.current.pointOfView();
            if (pov) {
              setCameraPov(pov);
            }
          }
        }, 120);
      };

      controls.addEventListener('end', handleChange);
      return () => {
        controls.removeEventListener('end', handleChange);
        if (timeoutId) clearTimeout(timeoutId);
      };
    }, []);

    // Scroll guard configuration on OrbitControls
    useEffect(() => {
      if (!scrollGuard || !globeEl.current) return;
      const controls = (globeEl.current as any).controls?.();
      if (controls) {
        controls.enableZoom = Boolean(isGlobeActive);
      }
    }, [scrollGuard, isGlobeActive]);

    // Check camera over India or USA and lazily load Admin-1 when altitude < 1.5
    useEffect(() => {
      if (cameraPov.altitude >= 1.5) {
        if (admin1Features.length > 0) {
          setAdmin1Features([]);
          setAdmin1Country(null);
        }
        return;
      }

      const matchedCountry = ADMIN1_REGISTRY.find((c) => isCameraOverCountry(cameraPov, c, 1.5));
      if (!matchedCountry) {
        if (admin1Features.length > 0) {
          setAdmin1Features([]);
          setAdmin1Country(null);
        }
        return;
      }

      if (admin1Country === matchedCountry.code && admin1Features.length > 0) {
        return;
      }

      let isMounted = true;
      loadAdmin1Data(matchedCountry.code)
        .then((data) => {
          if (isMounted && data && Array.isArray(data.features)) {
            setAdmin1Features(data.features);
            setAdmin1Country(matchedCountry.code);
          }
        })
        .catch(() => {});

      return () => {
        isMounted = false;
      };
    }, [cameraPov, admin1Country, admin1Features.length]);

    // Extract Admin-1 boundary paths for lines on globe
    const admin1Paths = useMemo(() => {
      if (!admin1Features || admin1Features.length === 0) return [];
      const paths: Array<{ coords: [number, number][]; name: string }> = [];
      for (const feat of admin1Features) {
        const geom = feat.geometry;
        if (!geom) continue;
        if (geom.type === 'Polygon') {
          for (const ring of geom.coordinates) {
            paths.push({
              coords: ring.map(([lon, lat]: [number, number]) => [lat, lon]),
              name: feat.properties?.name || '',
            });
          }
        } else if (geom.type === 'MultiPolygon') {
          for (const poly of geom.coordinates) {
            for (const ring of poly) {
              paths.push({
                coords: ring.map(([lon, lat]: [number, number]) => [lat, lon]),
                name: feat.properties?.name || '',
              });
            }
          }
        }
      }
      return paths;
    }, [admin1Features]);

    // Active Labels (Countries + States/Provinces with LOD and Screen-space declutter)
    const candidateLabels = useMemo(() => {
      if (showLabels === false) return [];

      // 1. Country candidates filtered by altitude and far-side
      const candidateCountries = selectCountryLabels(countryLabelsRaw, cameraPov);

      // 2. State candidates if camera is zoomed over country
      const candidateStates: GlobeLabelItem[] = [];
      if (showStateLabels !== false && admin1Features.length > 0 && admin1Country) {
        const cfg = ADMIN1_REGISTRY.find((c) => c.code === admin1Country);
        for (const feat of admin1Features) {
          const lat = feat.properties?.latitude ?? computePointOnPolygon(feat.geometry).lat;
          const lng = feat.properties?.longitude ?? computePointOnPolygon(feat.geometry).lon;
          if (!isFarSide(cameraPov, { lat, lng }, 80)) {
            candidateStates.push({
              id: `state-${feat.properties?.name || lat}`,
              name: feat.properties?.name_en || feat.properties?.name || '',
              lat,
              lng,
              rank: (feat.properties?.labelrank ?? 4) + 1,
              type: 'state',
              countryCode: cfg?.iso2 || '',
              countryName: cfg?.name || '',
              feature: feat,
              fontSize: 10,
            });
          }
        }
      }

      return [...candidateCountries, ...candidateStates];
    }, [
      showLabels,
      showStateLabels,
      countryLabelsRaw,
      cameraPov,
      admin1Features,
      admin1Country,
    ]);

    const [activeLabels, setActiveLabels] = useState<any[]>(candidateLabels);

    useEffect(() => {
      if (candidateLabels.length === 0) {
        setActiveLabels([]);
        return;
      }

      if (globeEl.current && typeof (globeEl.current as any).getScreenCoords === 'function') {
        const decluttered = declutterLabels(
          candidateLabels,
          (lat, lng) => (globeEl.current as any).getScreenCoords(lat, lng, 0.01),
          dimensions
        );
        setActiveLabels(decluttered);
      } else {
        setActiveLabels(candidateLabels);
      }
    }, [candidateLabels, dimensions]);

    // Map concentration data keyed by ISO alpha-2 and name
    const concentrationMap = useMemo(() => {
      const map = new Map<string, GlobeConcentration>();
      concentration.forEach((c) => {
        if (c.country_code) map.set(c.country_code.toUpperCase(), c);
        if (c.country_name) map.set(c.country_name.toLowerCase(), c);
      });
      return map;
    }, [concentration]);

    // Supplier coordinates map
    const supplierCoordMap = useMemo(() => {
      const map = new Map<string, { lat: number; lng: number; s: GlobeSupplier }>();
      suppliers.forEach((s) => {
        if (s.location && s.location.lat != null && s.location.lon != null) {
          map.set(s.code, { lat: s.location.lat, lng: s.location.lon, s });
        }
      });
      return map;
    }, [suppliers]);

    // Warehouse coordinates map
    const warehouseCoordMap = useMemo(() => {
      const map = new Map<string, { lat: number; lng: number; w: GlobeWarehouse }>();
      warehouses.forEach((w) => {
        if (w.location && w.location.lat != null && w.location.lon != null) {
          map.set(w.code, { lat: w.location.lat, lng: w.location.lon, w });
        }
      });
      return map;
    }, [warehouses]);

    // Group overlapping points (never jitter or randomly offset)
    const pointsData = useMemo(() => {
      const groups = new Map<string, GroupedPoint>();

      if (showSuppliers) {
        suppliers.forEach((s) => {
          if (!s.location || s.location.lat == null || s.location.lon == null) return;
          const key = `${s.location.lat.toFixed(3)},${s.location.lon.toFixed(3)}`;
          const isApprox = s.location.precision === 'country_centroid';
          const hasDelays = s.overdue_po_count > 0 || s.slipped_po_count > 0;

          if (!groups.has(key)) {
            groups.set(key, {
              lat: s.location.lat,
              lng: s.location.lon,
              count: 0,
              type: 'supplier',
              primaryRisk: s.risk_band,
              isApproximate: isApprox,
              hasOverdueOrSlipped: hasDelays,
              openPoCount: s.open_po_count,
              items: [],
            });
          }

          const g = groups.get(key)!;
          g.count += 1;
          g.items.push({ type: 'supplier', item: s });
          g.openPoCount += s.open_po_count;
          if (hasDelays) g.hasOverdueOrSlipped = true;
          if (isApprox) g.isApproximate = true;
          if (s.risk_band === 'critical') g.primaryRisk = 'critical';
          else if (s.risk_band === 'high' && g.primaryRisk !== 'critical') g.primaryRisk = 'high';
          if (g.count > 1) g.type = 'cluster';
        });
      }

      if (showWarehouses) {
        warehouses.forEach((w) => {
          if (!w.location || w.location.lat == null || w.location.lon == null) return;
          const key = `${w.location.lat.toFixed(3)},${w.location.lon.toFixed(3)}`;

          if (!groups.has(key)) {
            groups.set(key, {
              lat: w.location.lat,
              lng: w.location.lon,
              count: 0,
              type: 'warehouse',
              isApproximate: false,
              hasOverdueOrSlipped: false,
              openPoCount: 0,
              items: [],
            });
          }

          const g = groups.get(key)!;
          g.count += 1;
          g.items.push({ type: 'warehouse', item: w });
          if (g.count > 1) g.type = 'cluster';
        });
      }

      return Array.from(groups.values());
    }, [suppliers, warehouses, showSuppliers, showWarehouses]);

    // Arcs for open PO routes (supplier -> warehouse)
    const arcsData = useMemo(() => {
      if (!showRoutes) return [];
      const arcs: any[] = [];

      routes.forEach((r) => {
        const sCoord = supplierCoordMap.get(r.supplier_code);
        const wCoord = warehouseCoordMap.get(r.warehouse_code);
        if (!sCoord || !wCoord) return;

        const isSupplierSelected = selectedEntityCode === r.supplier_code;
        const isWarehouseSelected = selectedEntityCode === r.warehouse_code;
        const isHighlighted =
          !selectedEntityCode || isSupplierSelected || isWarehouseSelected;

        const suppRisk = sCoord.s.risk_band || 'unknown';
        const startColor = RISK_PALETTE[suppRisk]?.fillColor || '#94a3b8';
        const endColor = '#38bdf8'; // warehouse accent

        const isProblematic =
          r.any_overdue || r.any_slipped || suppRisk === 'critical' || suppRisk === 'high';

        let sLat = sCoord.lat;
        let sLng = sCoord.lng;
        let eLat = wCoord.lat;
        let eLng = wCoord.lng;

        const dLat = Math.abs(sLat - eLat);
        const dLng = Math.abs(sLng - eLng);
        const isLocal = dLat < 0.25 && dLng < 0.25;

        if (isLocal) {
          // Provide distinct separation for co-located or intra-city facility routes
          sLat -= 0.15;
          sLng -= 0.15;
          eLat += 0.15;
          eLng += 0.15;
        }

        const approxDegDist = Math.hypot(sLat - eLat, sLng - eLng);
        const arcAlt = isLocal
          ? 0.06
          : Math.max(0.08, Math.min(0.38, (approxDegDist / 120) * 0.22 + Math.min(0.08, (r.remaining_qty / 5000) * 0.03)));

        arcs.push({
          startLat: sLat,
          startLng: sLng,
          endLat: eLat,
          endLng: eLng,
          color: isProblematic
            ? ['#ea580c', '#f43f5e']
            : [startColor, endColor],
          stroke: isHighlighted ? (isProblematic ? 2.0 : 1.4) : 0.5,
          altitude: arcAlt,
          raw: r,
          supplierName: sCoord.s.name,
          warehouseName: wCoord.w.name,
          isProblematic,
        });
      });

      return arcs;
    }, [routes, supplierCoordMap, warehouseCoordMap, showRoutes, selectedEntityCode]);

    // Imperative Camera Controls
    useImperativeHandle(ref, () => ({
      pointOfView: (pov, duration) => {
        if (globeEl.current) {
          const dur = isReducedMotion ? 0 : duration ?? 1000;
          globeEl.current.pointOfView(pov, dur);
        }
      },
      fitToLocations: (locs) => {
        if (!globeEl.current || locs.length === 0) return;
        if (locs.length === 1) {
          const dur = isReducedMotion ? 0 : 1000;
          globeEl.current.pointOfView(
            { lat: locs[0].lat, lng: locs[0].lon, altitude: 1.6 },
            dur
          );
          return;
        }
        const avgLat = locs.reduce((sum, l) => sum + l.lat, 0) / locs.length;
        const avgLon = locs.reduce((sum, l) => sum + l.lon, 0) / locs.length;
        const dur = isReducedMotion ? 0 : 1000;
        globeEl.current.pointOfView({ lat: avgLat, lng: avgLon, altitude: 2.2 }, dur);
      },
      resetView: () => {
        if (globeEl.current) {
          const dur = isReducedMotion ? 0 : 1000;
          globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, dur);
        }
      },
      zoomIn: () => {
        if (globeEl.current) {
          const pov = globeEl.current.pointOfView();
          const dur = isReducedMotion ? 0 : 400;
          globeEl.current.pointOfView({ ...pov, altitude: Math.max(0.5, pov.altitude * 0.7) }, dur);
        }
      },
      zoomOut: () => {
        if (globeEl.current) {
          const pov = globeEl.current.pointOfView();
          const dur = isReducedMotion ? 0 : 400;
          globeEl.current.pointOfView({ ...pov, altitude: Math.min(5.0, pov.altitude * 1.4) }, dur);
        }
      },
    }));

    return (
      <div
        ref={containerRef}
        data-testid="globe-canvas-container"
        onClick={() => {
          if (scrollGuard && !isGlobeActive && onActivateGlobe) {
            onActivateGlobe();
          }
        }}
        onWheel={(e) => {
          if (scrollGuard && !isGlobeActive && (e.ctrlKey || e.metaKey)) {
            onActivateGlobe?.();
          }
        }}
        className="relative w-full h-full flex-1 bg-[#070b14] overflow-hidden select-none outline-none"
      >
        <Globe
          ref={globeEl as any}
          width={dimensions.width}
          height={dimensions.height}
          rendererConfig={{
            antialias: true,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false,
          }}
          globeImageUrl="/globe/earth-night.jpg"
          bumpImageUrl="/globe/earth-topology.png"
          backgroundImageUrl="/globe/night-sky.png"
          showAtmosphere={true}
          atmosphereColor="#38bdf8"
          atmosphereAltitude={0.15}
          // Point layer
          pointsData={pointsData}
          pointLat="lat"
          pointLng="lng"
          pointAltitude={0.02}
          pointRadius={(d: any) => {
            const p = d as GroupedPoint;
            if (p.type === 'cluster') return Math.min(0.9, 0.45 + p.count * 0.1);
            if (p.type === 'warehouse') return 0.55;
            return Math.min(0.8, 0.4 + (p.openPoCount / 500) * 0.1);
          }}
          pointColor={(d: any) => {
            const p = d as GroupedPoint;
            if (p.type === 'cluster') return '#22d3ee';
            if (p.type === 'warehouse') return '#38bdf8';
            const band = p.primaryRisk || 'unknown';
            return RISK_PALETTE[band]?.fillColor || '#94a3b8';
          }}
          pointLabel={(d: any) => {
            const p = d as GroupedPoint;
            if (p.type === 'cluster') {
              const names = p.items
                .map((it) => `&bull; ${escapeHtml(it.item.name)} (${escapeHtml(it.item.code)})`)
                .join('<br/>');
              return `
                <div style="background:#0b1329;border:1px solid #22d3ee;padding:6px 10px;border-radius:6px;color:#fff;font-family:sans-serif;font-size:11px;">
                  <strong style="color:#22d3ee;">${p.count} Entities at this location</strong><br/>
                  ${p.isApproximate ? '<span style="color:#f59e0b;font-size:10px;">Approximate Country Centroid</span><br/>' : ''}
                  <div style="margin-top:4px;max-height:100px;overflow-y:auto;">${names}</div>
                  <span style="font-size:10px;color:#94a3b8;">Click to select entity</span>
                </div>
              `;
            }

            const item = p.items[0];
            if (item.type === 'supplier') {
              const s = item.item;
              return `
                <div style="background:#0b1329;border:1px solid #38bdf8;padding:8px 12px;border-radius:6px;color:#fff;font-family:sans-serif;font-size:11px;min-width:180px;">
                  <div style="font-weight:bold;color:#fff;font-size:12px;">${escapeHtml(s.name)}</div>
                  <div style="color:#94a3b8;font-family:monospace;font-size:11px;">${escapeHtml(s.code)} &bull; ${escapeHtml(s.country)}</div>
                  <div style="margin-top:4px;color:${RISK_PALETTE[s.risk_band]?.fillColor || '#94a3b8'};font-weight:bold;text-transform:uppercase;">
                    ${escapeHtml(s.risk_band)} Risk (${s.risk_score}/100)
                  </div>
                  <div style="color:#cbd5e1;font-size:10px;margin-top:2px;">
                    On-time: ${(s.on_time_rate * 100).toFixed(1)}% &bull; ${s.open_po_count} Open POs
                  </div>
                  ${s.location?.precision === 'country_centroid' ? '<div style="color:#f59e0b;font-size:10px;margin-top:2px;">Approximate Location</div>' : ''}
                </div>
              `;
            } else {
              const w = item.item;
              return `
                <div style="background:#0b1329;border:1px solid #38bdf8;padding:8px 12px;border-radius:6px;color:#fff;font-family:sans-serif;font-size:11px;">
                  <div style="font-weight:bold;color:#38bdf8;font-size:12px;">${escapeHtml(w.name)}</div>
                  <div style="color:#94a3b8;font-family:monospace;">${escapeHtml(w.code)} &bull; ${escapeHtml(w.role)}</div>
                  <div style="color:#cbd5e1;font-size:10px;margin-top:4px;">
                    Stock: ${w.inventory_summary.total_on_hand.toLocaleString()} units (${w.inventory_summary.components_held} SKUs)
                  </div>
                </div>
              `;
            }
          }}
          onPointClick={(d: any) => {
            const p = d as GroupedPoint;
            if (p.count > 1) {
              onSelectCluster(p);
            } else if (p.items.length === 1) {
              onSelectEntity(p.items[0]);
              if (globeEl.current) {
                const dur = isReducedMotion ? 0 : 800;
                globeEl.current.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.5 }, dur);
              }
            }
          }}
          // Arcs layer
          arcsData={arcsData}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor="color"
          arcAltitude="altitude"
          arcStroke="stroke"
          arcDashLength={isReducedMotion ? 0 : 0.4}
          arcDashGap={isReducedMotion ? 0 : 0.25}
          arcDashInitialGap={(d: any) => (d.isProblematic ? 0.3 : 0)}
          arcDashAnimateTime={isReducedMotion ? 0 : 2200}
          arcLabel={(d: any) => `
            <div style="background:#0b1329;border:1px solid #38bdf8;padding:6px 10px;border-radius:6px;color:#fff;font-family:sans-serif;font-size:11px;">
              <strong style="color:#38bdf8;">${escapeHtml(d.supplierName)} &rarr; ${escapeHtml(d.warehouseName)}</strong><br/>
              <span style="color:#cbd5e1;">Open POs: ${d.raw.open_po_count} (${d.raw.remaining_qty.toLocaleString()} units)</span><br/>
              ${d.raw.any_overdue ? '<span style="color:#f43f5e;font-weight:bold;">Delivery Overdue</span><br/>' : ''}
              ${d.raw.any_slipped ? '<span style="color:#fb923c;font-weight:bold;">Delivery Slipped</span><br/>' : ''}
              <span style="font-size:10px;color:#94a3b8;font-style:italic;">Estimated route - not live shipment tracking</span>
            </div>
          `}
          // Polygons layer (Concentration)
          polygonsData={showConcentration ? countriesGeoJson : []}
          polygonSideColor={() => 'rgba(15, 23, 42, 0.4)'}
          polygonStrokeColor={(d: any) => {
            const cCode = d.properties?.ISO_A2 || d.properties?.ADM0_A3 || '';
            const cData = concentrationMap.get(cCode.toUpperCase()) || concentrationMap.get((d.properties?.NAME || '').toLowerCase());
            if (cData && cData.flagged) {
              return '#f59e0b';
            }
            return 'rgba(56, 189, 248, 0.2)';
          }}
          polygonCapColor={(d: any) => {
            const cCode = d.properties?.ISO_A2 || d.properties?.ADM0_A3 || '';
            const cData = concentrationMap.get(cCode.toUpperCase()) || concentrationMap.get((d.properties?.NAME || '').toLowerCase());
            if (!cData || cData.supplier_count === 0) {
              return 'rgba(15, 23, 42, 0.2)';
            }
            if (cData.flagged) {
              return 'rgba(245, 158, 11, 0.35)';
            }
            const alpha = Math.min(0.4, 0.15 + cData.supplier_count * 0.08);
            return `rgba(56, 189, 248, ${alpha})`;
          }}
          polygonAltitude={(d: any) => {
            const cCode = d.properties?.ISO_A2 || d.properties?.ADM0_A3 || '';
            const cData = concentrationMap.get(cCode.toUpperCase()) || concentrationMap.get((d.properties?.NAME || '').toLowerCase());
            return cData && cData.flagged ? 0.015 : 0.005;
          }}
          polygonLabel={(d: any) => {
            const cCode = d.properties?.ISO_A2 || d.properties?.ADM0_A3 || '';
            const cData = concentrationMap.get(cCode.toUpperCase()) || concentrationMap.get((d.properties?.NAME || '').toLowerCase());
            const countryName = escapeHtml(d.properties?.NAME || cCode);

            if (!cData || cData.supplier_count === 0) {
              return `
                <div style="background:#0b1329;border:1px solid #475569;padding:4px 8px;border-radius:4px;color:#94a3b8;font-size:10px;">
                  ${countryName} (No active suppliers)
                </div>
              `;
            }

            return `
              <div style="background:#0b1329;border:1px solid ${cData.flagged ? '#f59e0b' : '#38bdf8'};padding:8px 12px;border-radius:6px;color:#fff;font-family:sans-serif;font-size:11px;max-width:240px;">
                <strong style="color:${cData.flagged ? '#f59e0b' : '#38bdf8'};font-size:12px;">${countryName}</strong>
                <div style="color:#cbd5e1;margin-top:2px;">
                  Suppliers: <strong>${cData.supplier_count}</strong> &bull; Open POs: <strong>${cData.open_po_count}</strong>
                </div>
                ${cData.flagged ? `<div style="color:#fef08a;font-size:10px;margin-top:4px;border-top:1px solid #854d0e;padding-top:4px;">${escapeHtml(cData.reason)}</div>` : ''}
                <div style="font-size:9px;color:#94a3b8;font-style:italic;margin-top:4px;">
                  Calculated from loaded supplier data; not a live disruption feed.
                </div>
              </div>
            `;
          }}
          onPolygonClick={(d: any) => {
            const cCode = d.properties?.ISO_A2 || d.properties?.ADM0_A3 || '';
            const cData = concentrationMap.get(cCode.toUpperCase()) || concentrationMap.get((d.properties?.NAME || '').toLowerCase());
            if (cData) {
              onSelectCountry(cData);
            } else {
              onSelectCountry({
                country_code: cCode,
                country_name: d.properties?.NAME || cCode,
                supplier_count: 0,
                flagged: false,
                risk_distribution: {},
                high_risk_suppliers: [],
                single_country_components: [],
                open_po_count: 0,
                remaining_qty: 0,
                reason: null,
              });
            }
          }}
          // Geographic Labels Layer
          labelsData={activeLabels}
          labelLat="lat"
          labelLng="lng"
          labelText="name"
          labelSize={(d: any) => (d.type === 'state' ? 0.65 : 0.8)}
          labelColor={() => 'rgba(241, 245, 249, 0.95)'}
          labelAltitude={0.01}
          labelResolution={2}
          labelDotRadius={0}
          onLabelClick={(d: any) => {
            if (d.type === 'state') {
              onSelectState?.(d.name, d.countryName, d.countryCode, d.feature);
            } else {
              const cCode = d.countryCode || '';
              const cData =
                concentrationMap.get(cCode.toUpperCase()) ||
                concentrationMap.get((d.countryName || d.name).toLowerCase());
              if (cData) {
                onSelectCountry(cData);
              } else {
                onSelectCountry({
                  country_code: cCode,
                  country_name: d.countryName || d.name,
                  supplier_count: 0,
                  flagged: false,
                  risk_distribution: {},
                  high_risk_suppliers: [],
                  single_country_components: [],
                  open_po_count: 0,
                  remaining_qty: 0,
                  reason: null,
                });
              }
            }
          }}
          // Admin-1 State Boundary Paths Layer
          pathsData={admin1Paths}
          pathPoints="coords"
          pathColor={() => 'rgba(148, 163, 184, 0.4)'}
          pathStroke={0.6}
          pathPointAlt={0.003}
          // Globe surface click
          onGlobeClick={({ lat, lng }) => {
            if (isClickToPlaceActive && onGlobeClickCoords) {
              onGlobeClickCoords({ lat, lon: lng });
            }
          }}
        />

        {/* Scroll Guard Notice */}
        {scrollGuard && !isGlobeActive && (
          <div
            className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none z-10"
            aria-live="polite"
          >
            <span className="bg-slate-900/90 text-slate-200 text-xs px-3 py-1.5 rounded-full border border-slate-700 shadow-md backdrop-blur-xs">
              Click the globe to zoom with the mouse wheel
            </span>
          </div>
        )}

        {/* Click to place indicator banner */}
        {isClickToPlaceActive && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-cyan-950/90 border border-cyan-400 text-cyan-200 text-xs font-semibold shadow-2xl flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <span>Click-to-place active: click anywhere on globe to set coordinates</span>
          </div>
        )}
      </div>
    );
  }
);

GlobeCanvas.displayName = 'GlobeCanvas';
