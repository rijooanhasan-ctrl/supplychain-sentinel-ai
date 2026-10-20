import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { OverviewPage } from './OverviewPage';
import { SupplyChainGlobe } from '../components/globe/SupplyChainGlobe';

// Mock react-globe.gl
const mockControls = {
  enableZoom: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  autoRotate: false,
};

const mockGlobeInstance = {
  pointOfView: vi.fn(() => ({ lat: 20, lng: 0, altitude: 2.5 })),
  controls: vi.fn(() => mockControls),
  scene: vi.fn(() => ({
    traverse: vi.fn(),
  })),
  renderer: vi.fn(() => ({
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  })),
  onZoom: vi.fn(),
};

vi.mock('react-globe.gl', () => {
  return {
    default: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => mockGlobeInstance);
      return (
        <div data-testid="mock-react-globe-gl" data-labels-count={props.labelsData?.length || 0}>
          <div data-testid="mock-points-count">{props.pointsData?.length || 0}</div>
          <button
            type="button"
            data-testid="mock-click-first-point"
            onClick={() => {
              if (props.pointsData?.[0]) {
                props.onPointClick?.(props.pointsData[0]);
              }
            }}
          >
            Click Point
          </button>
        </div>
      );
    }),
  };
});

const mockGlobeApiData = {
  dataset: 'demo',
  generated_at: '2026-10-17T12:00:00+00:00',
  suppliers: [
    {
      code: 'SUP-01',
      name: 'Apex Silicon',
      country: 'USA',
      location: { lat: 37.7749, lon: -122.4194, precision: 'exact', source: 'test' },
      risk_band: 'critical',
      risk_score: 88,
      on_time_rate: 0.65,
      open_po_count: 3,
      slipped_po_count: 1,
      overdue_po_count: 1,
      components_supplied: ['CPU-X7'],
      critical_components_supplied: ['CPU-X7'],
    },
    {
      code: 'SUP-02',
      name: 'Kyoto Optics',
      country: 'JPN',
      location: { lat: 35.0116, lon: 135.7681, precision: 'exact', source: 'test' },
      risk_band: 'low',
      risk_score: 22,
      on_time_rate: 0.98,
      open_po_count: 1,
      slipped_po_count: 0,
      overdue_po_count: 0,
      components_supplied: ['LENS-01'],
      critical_components_supplied: [],
    },
  ],
  warehouses: [
    {
      code: 'WH-01',
      name: 'Main Assembly Plant',
      location: { lat: 40.7128, lon: -74.006, precision: 'exact', source: 'test' },
      role: 'Manufacturing Plant',
      inventory_summary: { total_on_hand: 5000 },
    },
  ],
  routes: [
    {
      supplier_code: 'SUP-01',
      warehouse_code: 'WH-01',
      open_po_count: 3,
      remaining_qty: 450,
      any_overdue: true,
      any_slipped: true,
      supplier_risk_band: 'critical',
    },
  ],
  concentration: [
    {
      country_code: 'USA',
      country_name: 'United States',
      supplier_count: 4,
      flagged: true,
      reason: 'Hosts 50% of component suppliers',
      open_po_count: 5,
      remaining_qty: 1200,
    },
  ],
  unresolved: [],
  coverage: { total_suppliers: 2, resolved_suppliers: 2, unresolved_suppliers: 0 },
};

const mockOverviewMeta = {
  seeded: true,
  data_source: 'demo',
  label: 'DEMO DATA',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '1.0.0',
  generated_at: '2026-10-17T12:00:00+00:00',
  counts: {
    warehouses: 3,
    products: 4,
    components: 14,
    suppliers: 8,
    purchase_orders: 22,
  },
  message: 'Demo dataset active.',
};

const mockExecSummary = {
  headline: 'Active critical shortage on CPU-X7 requires action',
  priority_decision: {
    decision: 'Expedite 500 units of CPU-X7 from alternate supplier',
    rationale: 'Primary supplier Apex Silicon is delayed by 14 days, risking line stoppage in 5 days.',
    action_type: 'expedite',
  },
  top_risks: [{ component_sku: 'CPU-X7', risk_level: 'critical', days_until_shortage: 5 }],
  as_of: '2026-10-17',
  seeded: true,
};

const mockInventoryRisk = {
  items: [
    {
      sku: 'CPU-X7',
      name: 'Quad-Core Processor',
      risk_level: 'critical',
      days_until_shortage: 5,
      first_shortage_date: '2026-10-22',
      usable_stock: 50,
    },
    {
      sku: 'MEM-16G',
      name: '16GB DDR4 RAM',
      risk_level: 'high',
      days_until_shortage: 12,
      first_shortage_date: '2026-10-29',
      usable_stock: 120,
    },
  ],
  summary: {
    components_evaluated: 14,
    counts_by_risk_level: { critical: 1, high: 1, medium: 2, low: 10, unknown: 0 },
  },
};

const mockSupplierRisk = {
  items: [
    {
      code: 'SUP-01',
      name: 'Apex Silicon',
      country: 'USA',
      risk_score: 88,
      risk_band: 'high',
      on_time_rate: 0.65,
      open_pos: 3,
    },
    {
      code: 'SUP-03',
      name: 'Global Connectors',
      country: 'TWN',
      risk_score: 72,
      risk_band: 'medium',
      on_time_rate: 0.75,
      open_pos: 2,
    },
  ],
  summary: {
    total_suppliers: 8,
    counts_by_band: { high: 1, medium: 1, low: 6, unknown: 0 },
  },
};

const mockAlerts = {
  items: [
    {
      id: 1,
      title: 'Critical delivery delay on CPU-X7 from Apex Silicon',
      severity: 'critical',
      component_sku: 'CPU-X7',
      supplier_code: 'SUP-01',
      created_at: '2026-10-17T08:00:00Z',
    },
  ],
  summary: {
    total_alerts: 1,
    counts_by_severity: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
  },
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

describe('Phase C+D — Overview Page & Compact Globe', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    enableMockWebGL();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = url.toString();
      if (u.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockOverviewMeta } as Response;
      }
      if (u.includes('/api/globe')) {
        return { ok: true, status: 200, json: async () => mockGlobeApiData } as Response;
      }
      if (u.includes('/api/executive-summary')) {
        return { ok: true, status: 200, json: async () => mockExecSummary } as Response;
      }
      if (u.includes('/api/inventory-risk')) {
        return { ok: true, status: 200, json: async () => mockInventoryRisk } as Response;
      }
      if (u.includes('/api/supplier-risk')) {
        return { ok: true, status: 200, json: async () => mockSupplierRisk } as Response;
      }
      if (u.includes('/api/alerts')) {
        return { ok: true, status: 200, json: async () => mockAlerts } as Response;
      }
      if (u.includes('/api/purchase-orders')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 1,
                po_number: 'PO-1001',
                supplier_id: 1,
                supplier_code: 'SUP-01',
                supplier_name: 'Apex Silicon',
                status: 'open',
                order_date: '2026-10-01',
                promised_date: '2026-10-10', // overdue relative to 2026-10-17
                latest_estimate_date: null,
              },
            ],
            total: 1,
            limit: 200,
          }),
        } as Response;
      }
      if (u.includes('/globe/country-labels.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { name: 'United States', code: 'USA', lat: 38, lng: -97, rank: 1, min_label: 1 },
          ],
        } as Response;
      }
      if (u.includes('/globe/countries-110m.geojson')) {
        return { ok: true, status: 200, json: async () => ({ features: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders overall status badge and generated reason correctly', async () => {
    render(
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      const badge = screen.getByTestId('overall-status-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(/urgent action needed/i);
    });

    const reason = screen.getByTestId('overall-status-reason');
    expect(reason).toHaveTextContent(/1 part may run out within 5 days; 1 critical disruption alert/i);
  });

  it('renders 4 KPI cards with plain-language labels and expected values', async () => {
    render(
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    // 1. Suppliers at risk
    await waitFor(() => {
      expect(screen.getByTestId('kpi-suppliers-at-risk')).toBeInTheDocument();
      expect(screen.getByTestId('kpi-suppliers-at-risk')).toHaveTextContent('2 of 8');
    });

    // 2. Parts that may run out
    expect(screen.getByTestId('kpi-parts-at-risk')).toHaveTextContent('4 of 14');

    // 3. Late deliveries
    expect(screen.getByTestId('kpi-late-deliveries')).toHaveTextContent('1');

    // 4. Earliest projected shortage
    expect(screen.getByTestId('kpi-earliest-shortage')).toHaveTextContent('5 days');
  });

  it('renders What You Should Do Next card with priority decision and links', async () => {
    render(
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overview-what-next-card')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Expedite 500 units of CPU-X7 from alternate supplier')
    ).toBeInTheDocument();

    const recLink = screen.getByRole('link', { name: /review recommendation/i });
    expect(recLink).toHaveAttribute('href', '/recommendations');

    const allRecLink = screen.getByRole('link', { name: /all recommendations/i });
    expect(allRecLink).toHaveAttribute('href', '/recommendations');
  });

  it('renders collapsible "More detail: incoming deliveries" and toggles aria-expanded', async () => {
    render(
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    const toggleBtn = await screen.findByRole('button', {
      name: /expand/i,
    });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    // Expand
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Inbound Delivery Schedule (Next 30 Days)')).toBeInTheDocument();

    // Collapse
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders compact globe with toolbar actions, scroll guard, and navigation', async () => {
    render(
      <MemoryRouter>
        <SupplyChainGlobe mode="compact" />
      </MemoryRouter>
    );

    // Wait for globe load
    await waitFor(() => {
      expect(screen.getByTestId('overview-compact-globe-card')).toBeInTheDocument();
    });

    // Toolbar buttons
    const zoomInBtn = screen.getByRole('button', { name: /zoom in/i });
    const zoomOutBtn = screen.getByRole('button', { name: /zoom out/i });
    const resetBtn = screen.getByRole('button', { name: /reset view/i });
    const labelsToggle = screen.getByRole('button', { name: /toggle geographic labels/i });

    expect(zoomInBtn).toBeInTheDocument();
    expect(zoomOutBtn).toBeInTheDocument();
    expect(resetBtn).toBeInTheDocument();
    expect(labelsToggle).toBeInTheDocument();

    // Open Full Global Map link
    const fullMapLink = screen.getByTestId('open-full-globe-btn');
    expect(fullMapLink).toHaveAttribute('href', '/globe');

    // Scroll guard hint visible when not activated
    expect(
      screen.getByText('Click the globe to zoom with the mouse wheel')
    ).toBeInTheDocument();

    // Clicking globe activates it
    const canvasContainer = screen.getByTestId('globe-canvas-container');
    fireEvent.click(canvasContainer);

    // Hint disappears
    expect(
      screen.queryByText('Click the globe to zoom with the mouse wheel')
    ).not.toBeInTheDocument();

    // Clicking a point opens popover
    const clickPointBtn = screen.getByTestId('mock-click-first-point');
    fireEvent.click(clickPointBtn);

    await waitFor(() => {
      expect(screen.getByTestId('compact-globe-popover')).toBeInTheDocument();
    });
    expect(screen.getByText('Apex Silicon')).toBeInTheDocument();
    expect(screen.getByText(/critical risk/i)).toBeInTheDocument();

    // "Open in Global Map" inside popover
    const popoverOpenBtn = screen.getByRole('button', { name: /open in global map/i });
    expect(popoverOpenBtn).toBeInTheDocument();
  });

  it('renders fallback top 5 locations list when WebGL is unavailable', async () => {
    // Mock getContext to return null (no WebGL)
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);

    render(
      <MemoryRouter>
        <SupplyChainGlobe mode="compact" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('compact-globe-fallback-list')).toBeInTheDocument();
    });

    expect(screen.getByText(/top locations by evaluated risk \(webgl unavailable\)/i)).toBeInTheDocument();
    expect(screen.getByText('Apex Silicon')).toBeInTheDocument();
    expect(screen.getByText('Kyoto Optics')).toBeInTheDocument();

    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  it('never references external HTTP URLs and maintains data source transparency text', async () => {
    render(
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overview-page')).toBeInTheDocument();
    });

    // Check transparency footer
    expect(
      screen.getByText('Decision support only. No orders are created.')
    ).toBeInTheDocument();

    // Check dataset tag
    expect(screen.getByText(/dataset: demo data/i)).toBeInTheDocument();
  });

  it('activates scroll guard with Ctrl+wheel or Cmd+wheel', async () => {
    render(
      <MemoryRouter>
        <SupplyChainGlobe mode="compact" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overview-compact-globe-card')).toBeInTheDocument();
    });

    const canvasContainer = screen.getByTestId('globe-canvas-container');
    expect(
      screen.getByText('Click the globe to zoom with the mouse wheel')
    ).toBeInTheDocument();

    // Trigger wheel with ctrlKey
    fireEvent.wheel(canvasContainer, { ctrlKey: true });

    // Hint should disappear as globe is now activated
    expect(
      screen.queryByText('Click the globe to zoom with the mouse wheel')
    ).not.toBeInTheDocument();
  });

  it('unmounts cleanly and releases references without errors', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <SupplyChainGlobe mode="compact" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overview-compact-globe-card')).toBeInTheDocument();
    });

    expect(() => unmount()).not.toThrow();
  });
});
