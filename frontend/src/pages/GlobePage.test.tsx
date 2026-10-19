import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { GlobePage } from './GlobePage';
import * as endpoints from '../api/endpoints';
import type {
  GlobeResponse,
  SupplierRiskDetailResponse,
  InventoryRiskListResponse,
} from '../api/types';

// Mock react-globe.gl at module level
export const mockPointOfView = vi.fn();

vi.mock('react-globe.gl', () => {
  return {
    default: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        pointOfView: mockPointOfView,
      }));
      return (
        <div data-testid="mock-react-globe" data-points-count={props.pointsData?.length}>
          <div data-testid="mock-arcs-count">{props.arcsData?.length ?? 0}</div>
          <div data-testid="mock-polygons-count">{props.polygonsData?.length ?? 0}</div>
          {props.pointsData?.map((p: any, idx: number) => (
            <button
              key={idx}
              data-testid={`globe-point-${idx}`}
              onClick={() => props.onPointClick?.(p)}
            >
              {p.type}: {p.count}
            </button>
          ))}
          <button
            data-testid="mock-globe-click"
            onClick={() => props.onGlobeClick?.({ lat: 52.52, lng: 13.405 })}
          >
            Click Globe Surface
          </button>
        </div>
      );
    }),
  };
});

// Mock fetch for GeoJSON asset loading
const mockGeoJsonData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { ISO_A2: 'DE', NAME: 'Germany' },
      geometry: { type: 'Polygon', coordinates: [] },
    },
    {
      type: 'Feature',
      properties: { ISO_A2: 'TW', NAME: 'Taiwan' },
      geometry: { type: 'Polygon', coordinates: [] },
    },
  ],
};

const mockGlobeData: GlobeResponse = {
  seeded: true,
  as_of: '2026-10-17',
  dataset: {
    active_dataset: 'demo',
    label: 'DEMO DATA',
    source: 'demo',
    generated_at: '2026-10-17T00:00:00Z',
    is_live: false,
  },
  suppliers: [
    {
      id: 1,
      code: 'SUP-001',
      name: 'Helix Microelectronics',
      country: 'DE',
      risk_score: 68.2,
      risk_band: 'high',
      confidence: 'high',
      on_time_rate: 0.675,
      n_deliveries: 40,
      open_po_count: 3,
      overdue_po_count: 1,
      slipped_po_count: 0,
      remaining_qty: 450,
      components: [
        { sku: 'CMP-MICRO', name: 'Microcontroller' },
      ],
      location: {
        lat: 51.1657,
        lon: 10.4515,
        source: 'country_centroid',
        precision: 'country_centroid',
        country_code: 'DE',
        label: 'Germany',
      },
    },
    {
      id: 2,
      code: 'SUP-002',
      name: '<img src=x onerror=alert(1)>XSS Corp',
      country: 'TW',
      risk_score: 22.0,
      risk_band: 'low',
      confidence: 'medium',
      on_time_rate: 0.95,
      n_deliveries: 20,
      open_po_count: 1,
      overdue_po_count: 0,
      slipped_po_count: 0,
      remaining_qty: 120,
      components: [
        { sku: 'CMP-CAP', name: 'Capacitor' },
      ],
      location: {
        lat: 23.6978,
        lon: 120.9605,
        source: 'country_centroid',
        precision: 'country_centroid',
        country_code: 'TW',
        label: 'Taiwan',
      },
    },
  ],
  warehouses: [
    {
      id: 10,
      code: 'WH-MAIN',
      name: 'Central Assembly Hub',
      role: 'plant',
      location: {
        lat: 50.1109,
        lon: 8.6821,
        source: 'exact',
        precision: 'exact',
        country_code: 'DE',
        label: 'Frankfurt Hub',
      },
      inventory_summary: {
        components_held: 5,
        total_on_hand: 32000,
        zero_usable_components_count: 0,
      },
    },
  ],
  routes: [
    {
      supplier_code: 'SUP-001',
      warehouse_code: 'WH-MAIN',
      po_numbers: ['PO-2026-101'],
      open_po_count: 3,
      remaining_qty: 450,
      any_overdue: true,
      any_slipped: false,
      label: 'Helix Microelectronics -> Central Assembly Hub',
    },
  ],
  concentration: [
    {
      country_code: 'DE',
      country_name: 'Germany',
      supplier_count: 1,
      risk_distribution: { high: 1 },
      high_risk_suppliers: ['SUP-001'],
      single_country_components: ['CMP-MICRO'],
      open_po_count: 3,
      remaining_qty: 450,
      flagged: true,
      reason: 'Host to 50% of active suppliers',
    },
  ],
  unresolved: [
    {
      entity_type: 'supplier',
      code: 'SUP-UNMAPPED',
      name: 'Unmapped Logistics AG',
      reason: 'No geographic coordinates or country code available',
    },
  ],
  coverage: {
    suppliers_total: 3,
    suppliers_mapped: 2,
    suppliers_unresolved: 1,
    warehouses_total: 1,
    warehouses_mapped: 1,
    warehouses_unresolved: 0,
    approximate_count: 2,
  },
  config: {
    concentration_min_suppliers: 3,
    concentration_share: 0.4,
  },
  notes: [],
};

const mockSupplierDetail: SupplierRiskDetailResponse = {
  supplier_id: 1,
  supplier_code: 'SUP-001',
  supplier_name: 'Helix Microelectronics',
  country: 'DE',
  n_deliveries: 40,
  risk_score: 68.2,
  risk_band: 'high',
  confidence: 'high',
  on_time_rate: 0.675,
  on_time_ci_lower: 0.52,
  on_time_ci_upper: 0.8,
  late_delivery_probability: 0.325,
  expected_delay_days_if_late: 4.5,
  avg_delay_days_all: 2.1,
  avg_delay_days_when_late: 4.5,
  rejection_rate: 0.015,
  fill_rate: 0.98,
  open_po_count: 3,
  open_pos_slipped_count: 0,
  open_pos_overdue_count: 1,
  open_remaining_qty: 450,
  as_of: '2026-10-17',
  excluded_future_deliveries: 0,
  has_excluded_future_deliveries: false,
  p50_delay_days_when_late: 4.0,
  p90_delay_days_when_late: 8.0,
  max_delay_days: 9.0,
  total_ordered_qty: 4000,
  total_received_qty: 3950,
  total_rejected_qty: 60,
  metrics_breakdown: [],
  nominal_weights: {},
  effective_weights: {},
  metrics_used: [],
  metrics_dropped: [],
  thresholds_used: {} as any,
  monthly_breakdown: [],
  main_drivers: [],
  explanation: 'Calculated score 68.2 (high risk).',
  assumptions: [],
};

const mockInventoryList: InventoryRiskListResponse = {
  seeded: true,
  as_of: '2026-10-17',
  model: {
    name: 'deterministic_inventory',
    type: 'rules',
    description: 'Deterministic day-by-day inventory simulation',
  },
  summary: {
    counts_by_risk_level: {
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
      unknown: 0,
    },
    components_evaluated: 1,
  },
  items: [
    {
      component_id: 1,
      sku: 'CMP-MICRO',
      name: 'Microcontroller',
      category: 'Semiconductors',
      criticality: 'critical',
      plant_usable_stock: 50,
      plant_on_hand: 50,
      plant_reserved: 0,
      mean_daily_demand: 12.5,
      coverage_days: 3.5,
      next_replenishment: null,
      shortage_date: '2026-10-21',
      days_until_shortage: 4,
      unmet_demand_units: 100,
      unmet_before_next_inbound: 100,
      first_episode_start_date: '2026-10-21',
      first_episode_end_date: '2026-10-25',
      runout_date_without_inbound: '2026-10-21',
      risk_level: 'critical',
      risk_reason: 'Stockout imminent',
      forecast_status: 'ok',
      flags: [],
    },
  ],
  config: {} as any,
  total: 1,
  limit: 100,
  offset: 0,
};

function enableMockWebGL() {
  // @ts-expect-error mock WebGL context
  window.WebGLRenderingContext = function () {};
  HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextId) => {
    if (contextId === 'webgl' || contextId === 'experimental-webgl') {
      return {};
    }
    return null;
  });
}

function disableMockWebGL() {
  // @ts-expect-error mock WebGL context
  delete window.WebGLRenderingContext;
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
}

describe('GlobePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableMockWebGL();

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    // Mock fetch for GeoJSON loading
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeoJsonData,
    } as Response);

    // Mock API endpoints
    vi.spyOn(endpoints, 'getGlobe').mockResolvedValue(mockGlobeData);
    vi.spyOn(endpoints, 'getImportStatus').mockResolvedValue({
      enabled: true,
      active: 'demo',
      uploaded_available: false,
      limits: {
        max_file_bytes: 5242880,
        max_files: 11,
        max_total_bytes: 26214400,
      },
      accepted_files: [],
    });
    vi.spyOn(endpoints, 'getSupplierRiskDetail').mockResolvedValue(mockSupplierDetail);
    vi.spyOn(endpoints, 'getInventoryRisk').mockResolvedValue(mockInventoryList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders globe canvas with points, routes, and data strip', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    // Header / sidebar title
    expect(await screen.findByText('Supply Chain Sentinel')).toBeInTheDocument();
    expect(screen.getByText('Control Tower')).toBeInTheDocument();

    // Bottom strip dataset badge
    expect(screen.getByTestId('globe-dataset-badge')).toHaveTextContent('DEMO DATA');

    // React Globe canvas rendered
    await waitFor(() => {
      expect(screen.getByTestId('mock-react-globe')).toBeInTheDocument();
    });

    // Check points passed to react-globe.gl:
    // 2 suppliers + 1 warehouse = 3 points
    expect(screen.getByTestId('mock-react-globe')).toHaveAttribute('data-points-count', '3');

    // Route arcs rendered
    expect(screen.getByTestId('mock-arcs-count')).toHaveTextContent('1');
  });

  it('only renders concentration polygons when enabled via filter', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Concentration polygons should be empty by default
    expect(screen.getByTestId('mock-polygons-count')).toHaveTextContent('0');

    // Toggle concentration layer
    const concentrationCheckbox = screen.getByLabelText(/Supplier Risk Concentration/i);
    fireEvent.click(concentrationCheckbox);

    // Polygons should now be passed to Globe
    await waitFor(() => {
      expect(screen.getByTestId('mock-polygons-count')).toHaveTextContent('2');
    });
  });

  it('filters points by risk level and updates point count', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');
    expect(screen.getByTestId('mock-react-globe')).toHaveAttribute('data-points-count', '3');

    // Filter to only 'high' risk
    const highRiskButton = screen.getByRole('button', { name: /^high$/i });
    fireEvent.click(highRiskButton);

    // Now only high risk supplier (1) + warehouse (1) = 2 points
    await waitFor(() => {
      expect(screen.getByTestId('mock-react-globe')).toHaveAttribute('data-points-count', '2');
    });

    // Reset filters
    const resetButton = screen.getByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-globe')).toHaveAttribute('data-points-count', '3');
    });
  });

  it('supports deep-linking via ?supplier=SUP-001 to focus camera', async () => {
    render(
      <MemoryRouter initialEntries={['/globe?supplier=SUP-001']}>
        <GlobePage />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    await waitFor(() => {
      expect(mockPointOfView).toHaveBeenCalledWith(
        expect.objectContaining({
          lat: 51.1657,
          lng: 10.4515,
        }),
        1000
      );
    });
  });

  it('displays supplier detail panel on point selection and loads deep metrics', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click on point 0 (Helix Microelectronics)
    const pointBtn = screen.getByTestId('globe-point-0');
    fireEvent.click(pointBtn);

    // Detail panel should open
    const panel = await screen.findByLabelText('Entity Detail Inspection Panel');
    expect(within(panel).getByText('Helix Microelectronics')).toBeInTheDocument();
    expect(within(panel).getByText('SUP-001')).toBeInTheDocument();
    expect(within(panel).getByText('DE')).toBeInTheDocument();

    // Verify open PO badge and score
    expect(within(panel).getByText(/high \(68.2 \/ 100\)/i)).toBeInTheDocument();
    expect(within(panel).getByText('Active Orders:')).toBeInTheDocument();

    // Verify impacted critical component loaded from inventory risk endpoint and supplied components
    const compBadges = await within(panel).findAllByText(/CMP-MICRO/i);
    expect(compBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('displays warehouse detail panel on point selection', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click on point 2 (WH-MAIN)
    const whPointBtn = screen.getByTestId('globe-point-2');
    fireEvent.click(whPointBtn);

    // Detail panel for warehouse
    const panel = await screen.findByLabelText('Entity Detail Inspection Panel');
    expect(within(panel).getByText('Central Assembly Hub')).toBeInTheDocument();
    expect(within(panel).getByText('WH-MAIN')).toBeInTheDocument();
    expect(within(panel).getByText('Warehouse Role')).toBeInTheDocument();
    expect(within(panel).getByText('plant')).toBeInTheDocument();
    expect(within(panel).getByText(/32,000 units/i)).toBeInTheDocument();
  });

  it('renders Needs Location list and handles location override modal with click-to-place', async () => {
    const overrideSpy = vi.spyOn(endpoints, 'overrideLocation').mockResolvedValue({
      status: 'saved',
      entity_type: 'supplier',
      code: 'SUP-UNMAPPED',
      location: {
        lat: 52.52,
        lon: 13.405,
        source: 'manual_override',
        precision: 'manual',
        country_code: 'DE',
        label: 'Manual Pin',
      },
    });

    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click "Needs Location" tab
    const needsLocationTab = screen.getByRole('button', { name: /Needs Location/i });
    fireEvent.click(needsLocationTab);

    // Verify unresolved supplier item
    expect(screen.getByText('SUP-UNMAPPED')).toBeInTheDocument();
    expect(screen.getByText('Unmapped Logistics AG')).toBeInTheDocument();

    // Click "Set Location ->"
    const setLocBtn = screen.getByRole('button', { name: /Set Location \u2192/i });
    fireEvent.click(setLocBtn);

    // Modal dialog opens
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Set Location for SUP-UNMAPPED/i)).toBeInTheDocument();

    // Switch to Click to place mode
    const clickMethodBtn = screen.getByRole('button', { name: /\(c\) Click Globe/i });
    fireEvent.click(clickMethodBtn);

    // Click on mock globe surface
    const mockGlobeClickBtn = screen.getByTestId('mock-globe-click');
    fireEvent.click(mockGlobeClickBtn);

    // Re-verify modal displays captured coordinates
    expect(screen.getByText(/Selected: Lat 52.5200, Lon 13.4050/i)).toBeInTheDocument();

    // Submit modal
    const saveBtn = screen.getByRole('button', { name: /Save Location/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(overrideSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'supplier',
          code: 'SUP-UNMAPPED',
          lat: 52.52,
          lon: 13.405,
        })
      );
    });
  });

  it('escapes supplier and warehouse names against XSS in tooltips and text', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click point 1 (<img src=x onerror=alert(1)>XSS Corp) to open detail panel
    const pointBtn = screen.getByTestId('globe-point-1');
    fireEvent.click(pointBtn);

    // React should render this as text content, NOT as an <img> DOM node
    const imgTags = document.querySelectorAll('img[src="x"]');
    expect(imgTags.length).toBe(0);

    // The text content should be safely present
    expect(await screen.findByText('<img src=x onerror=alert(1)>XSS Corp')).toBeInTheDocument();
  });

  it('renders GlobeListFallback accessible table when WebGL is unavailable', async () => {
    disableMockWebGL();

    render(
      <MemoryRouter initialEntries={['/globe']}>
        <GlobePage />
      </MemoryRouter>
    );

    // Header and title load
    expect(await screen.findByText('Supply Chain Sentinel')).toBeInTheDocument();

    // Globe should NOT be rendered
    expect(screen.queryByTestId('mock-react-globe')).not.toBeInTheDocument();

    // WebGL Hardware Acceleration Unavailable banner should appear
    expect(
      screen.getByText('WebGL Hardware Acceleration is Unavailable')
    ).toBeInTheDocument();

    // Accessible table view should be present
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(within(table).getByText('SUP-001')).toBeInTheDocument();
    expect(within(table).getByText('Helix Microelectronics')).toBeInTheDocument();
    expect(within(table).getByText('WH-MAIN')).toBeInTheDocument();
  });
});
