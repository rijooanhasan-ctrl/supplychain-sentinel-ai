import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SupplyChainGlobe } from '../components/globe/SupplyChainGlobe';
import * as endpoints from '../api/endpoints';
import type { GlobeResponse } from '../api/types';
import { clearGlobeCache } from '../components/globe/useGlobeData';
import { clearAdmin1Cache } from '../lib/geoLabels';

// Mock react-globe.gl at module level
export const mockPointOfView = vi.fn();
const testState = {
  lastGlobeProps: null as any,
};

vi.mock('react-globe.gl', () => {
  return {
    default: React.forwardRef((props: any, ref: any) => {
      React.useEffect(() => {
        testState.lastGlobeProps = props;
      });
      React.useImperativeHandle(ref, () => ({
        pointOfView: mockPointOfView,
        getScreenCoords: () => ({ x: 200, y: 200 }),
      }));
      return (
        <div data-testid="mock-react-globe">
          <div data-testid="mock-labels-count">{props.labelsData?.length ?? 0}</div>
          <div data-testid="mock-paths-count">{props.pathsData?.length ?? 0}</div>
          {/* Test buttons to trigger label and polygon clicks */}
          <button
            data-testid="click-country-with-data"
            onClick={() =>
              props.onLabelClick?.({
                type: 'country',
                name: 'Germany',
                countryName: 'Germany',
                countryCode: 'DE',
              })
            }
          >
            Click DE Country Label
          </button>
          <button
            data-testid="click-country-no-data"
            onClick={() =>
              props.onLabelClick?.({
                type: 'country',
                name: 'Madagascar',
                countryName: 'Madagascar',
                countryCode: 'MG',
              })
            }
          >
            Click MG Country Label
          </button>
          <button
            data-testid="click-maharashtra-state"
            onClick={() =>
              props.onLabelClick?.({
                type: 'state',
                name: 'Maharashtra',
                countryName: 'India',
                countryCode: 'IN',
                feature: {
                  type: 'Feature',
                  properties: { name: 'Maharashtra', iso_a2: 'IN' },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [72.8, 18.9],
                        [80.0, 18.9],
                        [80.0, 21.5],
                        [72.8, 21.5],
                        [72.8, 18.9],
                      ],
                    ],
                  },
                },
              })
            }
          >
            Click Maharashtra State
          </button>
          <button
            data-testid="click-empty-state"
            onClick={() =>
              props.onLabelClick?.({
                type: 'state',
                name: 'Goa',
                countryName: 'India',
                countryCode: 'IN',
                feature: {
                  type: 'Feature',
                  properties: { name: 'Goa', iso_a2: 'IN' },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [73.7, 14.9],
                        [74.3, 14.9],
                        [74.3, 15.8],
                        [73.7, 15.8],
                        [73.7, 14.9],
                      ],
                    ],
                  },
                },
              })
            }
          >
            Click Goa State
          </button>
          <button
            data-testid="click-xss-state"
            onClick={() =>
              props.onLabelClick?.({
                type: 'state',
                name: '<script>alert("xss")</script><img src=x onerror=alert(1)>StateX',
                countryName: 'India',
                countryCode: 'IN',
                feature: {
                  type: 'Feature',
                  properties: { name: 'StateX', iso_a2: 'IN' },
                  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
                },
              })
            }
          >
            Click XSS State
          </button>
        </div>
      );
    }),
  };
});

const mockGlobeDataWithStates: GlobeResponse = {
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
      code: 'SUP-PUNE',
      name: 'Pune Precision Components',
      country: 'IN',
      risk_score: 75.0,
      risk_band: 'high',
      confidence: 'high',
      on_time_rate: 0.82,
      n_deliveries: 30,
      open_po_count: 2,
      overdue_po_count: 0,
      slipped_po_count: 0,
      remaining_qty: 300,
      components: [{ sku: 'CMP-PUNE', name: 'Valve' }],
      location: {
        lat: 19.5, // Inside Maharashtra fixture
        lon: 74.5,
        source: 'manual',
        precision: 'exact',
        country_code: 'IN',
        label: 'Pune Facility',
      },
    },
    {
      id: 2,
      code: 'SUP-APPROX',
      name: 'Approximate India Vendor',
      country: 'IN',
      risk_score: 40.0,
      risk_band: 'medium',
      confidence: 'medium',
      on_time_rate: 0.9,
      n_deliveries: 15,
      open_po_count: 1,
      overdue_po_count: 0,
      slipped_po_count: 0,
      remaining_qty: 100,
      components: [],
      location: {
        lat: 20.59,
        lon: 78.96,
        source: 'country_centroid',
        precision: 'country_centroid', // Country-level approximate
        country_code: 'IN',
        label: 'India Centroid',
      },
    },
  ],
  warehouses: [],
  routes: [],
  concentration: [
    {
      country_code: 'DE',
      country_name: 'Germany',
      supplier_count: 5,
      risk_distribution: { high: 2, medium: 3 },
      high_risk_suppliers: ['SUP-DE-1'],
      single_country_components: ['CMP-DE'],
      open_po_count: 4,
      remaining_qty: 1200,
      flagged: true,
      reason: 'Key European supplier hub',
    },
  ],
  unresolved: [],
  coverage: {
    suppliers_total: 2,
    suppliers_mapped: 2,
    suppliers_unresolved: 0,
    warehouses_total: 0,
    warehouses_mapped: 0,
    warehouses_unresolved: 0,
    approximate_count: 1,
  },
  config: {
    concentration_min_suppliers: 3,
    concentration_share: 0.4,
  },
  notes: [],
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

describe('Phase B — Geographic Labels & State/Country Panels on Globe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableMockWebGL();
    clearGlobeCache();
    clearAdmin1Cache();
    testState.lastGlobeProps = null;
    vi.spyOn(endpoints, 'getGlobe').mockResolvedValue(mockGlobeDataWithStates);
    vi.spyOn(endpoints, 'getImportStatus').mockResolvedValue({
      enabled: true,
      active_dataset: 'demo',
      demo_seeded: true,
      row_counts: { demo: { suppliers: 2, purchase_orders: 2, components: 2 } },
    } as any);
  });

  it('renders labels layer and handles toggle hiding/showing labels', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <SupplyChainGlobe mode="full" />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Geographic Labels toggle exists
    const labelsToggle = screen.getByLabelText('Toggle Geographic Labels layer');
    expect(labelsToggle).toBeInTheDocument();
    expect(labelsToggle).toBeChecked();

    // Toggle off
    fireEvent.click(labelsToggle);
    expect(labelsToggle).not.toBeChecked();

    // Last globe props received labelsData = [] when showLabels = false
    expect(testState.lastGlobeProps.labelsData).toEqual([]);

    // Toggle back on
    fireEvent.click(labelsToggle);
    expect(labelsToggle).toBeChecked();
    expect(testState.lastGlobeProps.labelsData).toBeDefined();
  });

  it('clicking a country with supply-chain data displays concentration metrics', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <SupplyChainGlobe mode="full" />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click Germany label
    fireEvent.click(screen.getByTestId('click-country-with-data'));

    // Inspection panel displays Germany
    expect(await screen.findByText('Germany')).toBeInTheDocument();
    expect(screen.getByText('Key European supplier hub')).toBeInTheDocument();
    expect(screen.getByText('CMP-DE')).toBeInTheDocument();
  });

  it('clicking a country with NO data displays exact text "No supply-chain data available for this region."', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <SupplyChainGlobe mode="full" />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click Madagascar label (no suppliers, no concentration)
    fireEvent.click(screen.getByTestId('click-country-no-data'));

    // Exact string requirement
    expect(await screen.findByText('No supply-chain data available for this region.')).toBeInTheDocument();
    expect(screen.getByText('Madagascar')).toBeInTheDocument();
  });

  it('assigns exact/manual suppliers to state polygon and excludes country-centroid approximate suppliers with notice', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <SupplyChainGlobe mode="full" />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click Maharashtra state
    fireEvent.click(screen.getByTestId('click-maharashtra-state'));

    // Pune supplier (exact coordinates) is inside Maharashtra
    expect(await screen.findByText('Pune Precision Components')).toBeInTheDocument();
    expect(screen.getByText('SUP-PUNE')).toBeInTheDocument();

    // Approximate India vendor is NOT in Maharashtra state list
    expect(screen.queryByText('Approximate India Vendor')).not.toBeInTheDocument();

    // Approximate notice sentence MUST appear
    expect(
      screen.getByText('Approximate (country-level) suppliers are not placed in states.')
    ).toBeInTheDocument();
  });

  it('clicking a state with no exact suppliers shows "No supply-chain data available for this region." and approximate sentence', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <SupplyChainGlobe mode="full" />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click Goa state (no exact suppliers in Goa)
    fireEvent.click(screen.getByTestId('click-empty-state'));

    expect(await screen.findByRole('heading', { name: 'Goa' })).toBeInTheDocument();
    expect(screen.getByText('No supply-chain data available for this region.')).toBeInTheDocument();
    expect(
      screen.getByText('Approximate (country-level) suppliers are not placed in states.')
    ).toBeInTheDocument();
  });

  it('renders state and label names containing markup safely as text without XSS execution', async () => {
    render(
      <MemoryRouter initialEntries={['/globe']}>
        <SupplyChainGlobe mode="full" />
      </MemoryRouter>
    );

    await screen.findByTestId('mock-react-globe');

    // Click state with script/img tags in name
    fireEvent.click(screen.getByTestId('click-xss-state'));

    // The script tag is escaped and rendered as text content, not an active DOM element
    const title = await screen.findByRole('heading', { name: /StateX/ });
    expect(title.textContent).toContain('<script>alert("xss")</script><img src=x onerror=alert(1)>StateX');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('verifies bundled geo datasets are fully offline and under the 3 MB cap', async () => {
    // Check sizes of the static files in public/globe
    const fs = await import('fs');
    const path = await import('path');

    const countryLabelsPath = path.resolve(__dirname, '../../public/globe/country-labels.json');
    const indPath = path.resolve(__dirname, '../../public/globe/admin1/IND.geojson');
    const usaPath = path.resolve(__dirname, '../../public/globe/admin1/USA.geojson');

    const countryStat = fs.statSync(countryLabelsPath);
    const indStat = fs.statSync(indPath);
    const usaStat = fs.statSync(usaPath);

    const totalBytes = countryStat.size + indStat.size + usaStat.size;
    const totalMb = totalBytes / (1024 * 1024);

    expect(totalMb).toBeLessThan(3.0);

    // Verify no remote URLs exist in the datasets
    const countryContent = fs.readFileSync(countryLabelsPath, 'utf8');
    const indContent = fs.readFileSync(indPath, 'utf8');
    const usaContent = fs.readFileSync(usaPath, 'utf8');

    expect(countryContent).not.toMatch(/https?:\/\//i);
    expect(indContent).not.toMatch(/https?:\/\//i);
    expect(usaContent).not.toMatch(/https?:\/\//i);
  });
});
