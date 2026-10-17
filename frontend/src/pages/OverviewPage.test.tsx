import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { OverviewPage } from './OverviewPage';
import type { InventoryRiskListResponse, PurchaseOrder } from '../api/types';

const mockMeta = {
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
    bom_lines: 30,
    suppliers: 8,
    supplier_components: 17,
    inventory_levels: 42,
    purchase_orders: 22,
    purchase_order_lines: 22,
    customer_orders: 28,
    demand_records: 2520,
    delivery_records: 195,
  },
  message: 'Demo dataset active.',
};

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders master entity counts from meta', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
      } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('count-products')).toHaveTextContent('4');
      expect(screen.getByTestId('count-components')).toHaveTextContent('14');
      expect(screen.getByTestId('count-suppliers')).toHaveTextContent('8');
      expect(screen.getByTestId('count-warehouses')).toHaveTextContent('3');
    });
  });

  it('correctly computes overdue count, respecting estimate precedence over promised date, and handles total > 200 warning', async () => {
    const pos: PurchaseOrder[] = [
      // PO 1: overdue (promised date before as_of 2026-10-17, no estimate)
      {
        id: 1,
        po_number: 'PO-OVERDUE-01',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex Silicon',
        status: 'open',
        order_date: '2026-10-01',
        promised_date: '2026-10-10',
        latest_estimate_date: null,
      },
      // PO 2: NOT overdue because latest_estimate_date is future, even though promised is past
      {
        id: 2,
        po_number: 'PO-EST-FUTURE',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex Silicon',
        status: 'in_transit',
        order_date: '2026-10-01',
        promised_date: '2026-10-12', // past
        latest_estimate_date: '2026-10-24', // future!
      },
      // PO 3: future promised date, no estimate -> NOT overdue
      {
        id: 3,
        po_number: 'PO-FUTURE-01',
        supplier_id: 2,
        supplier_code: 'SUP-02',
        supplier_name: 'Kyoto Optics',
        status: 'open',
        order_date: '2026-10-05',
        promised_date: '2026-10-20',
        latest_estimate_date: null,
      },
      // PO 4: past promised date but status is received -> NOT overdue
      {
        id: 4,
        po_number: 'PO-RECEIVED',
        supplier_id: 2,
        supplier_code: 'SUP-02',
        supplier_name: 'Kyoto Optics',
        status: 'received',
        order_date: '2026-10-01',
        promised_date: '2026-10-08',
        latest_estimate_date: null,
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('status=open')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 2, limit: 1, offset: 0 }),
        } as Response;
      }
      if (urlStr.includes('status=in_transit')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 1, limit: 1, offset: 0 }),
        } as Response;
      }
      if (urlStr.includes('status=partially_received')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0, limit: 1, offset: 0 }),
        } as Response;
      }
      // General list with total > 200 to test warning path
      if (urlStr.includes('/api/purchase-orders?limit=200')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: pos,
            total: 245, // total > 200
            limit: 200,
            offset: 0,
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
      } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MetaProvider>
    );

    // Overdue count should strictly be 1 (only PO-OVERDUE-01)
    await waitFor(() => {
      expect(screen.getByTestId('count-overdue-pos')).toHaveTextContent('1');
    });

    // Total open POs should be 2 + 1 + 0 = 3
    expect(screen.getByTestId('count-open-pos')).toHaveTextContent('3');

    // Delayed vs promise count should be 1 (only PO-EST-FUTURE has estimate 2026-10-24 > promised 2026-10-12)
    expect(screen.getByTestId('count-delayed-pos')).toHaveTextContent('Delayed vs promise: 1 POs');
    expect(screen.getByText(/whose latest estimated delivery date is strictly later than promised date/i)).toBeInTheDocument();

    // Warning should appear because total (245) > 200
    expect(screen.getByTestId('overdue-truncated-warning')).toHaveTextContent(
      'Note: Evaluated across first 200 purchase orders (total in system: 245).'
    );

    // Upcoming list ordering & basis:
    // PO-FUTURE-01 (expected 2026-10-20, basis: promised) should precede PO-EST-FUTURE (expected 2026-10-24, basis: estimated)
    expect(screen.getByTestId('basis-PO-FUTURE-01')).toHaveTextContent('promised');
    expect(screen.getByTestId('basis-PO-EST-FUTURE')).toHaveTextContent('estimated');

    // Slipped secondary text in upcoming table for PO-EST-FUTURE (2026-10-12 to 2026-10-24 = 12 days)
    expect(screen.getByTestId('slipped-upcoming-PO-EST-FUTURE')).toHaveTextContent(
      'Slipped 12 days vs promise (promised 2026-10-12)'
    );

    const rows = screen.getAllByRole('row');
    const rowTexts = rows.map((r) => r.textContent);
    const poFutureIndex = rowTexts.findIndex((t) => t?.includes('PO-FUTURE-01'));
    const poEstIndex = rowTexts.findIndex((t) => t?.includes('PO-EST-FUTURE'));
    expect(poFutureIndex).toBeLessThan(poEstIndex);
  });

  it('handles PO-OVERDUE-01-like data in upcoming deliveries with Slipped 7 days vs promise', async () => {
    const pos: PurchaseOrder[] = [
      {
        id: 99,
        po_number: 'PO-OVERDUE-01',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex Silicon',
        status: 'in_transit',
        order_date: '2026-09-25',
        promised_date: '2026-10-13',
        latest_estimate_date: '2026-10-20', // Due in 3 days relative to 2026-10-17
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/purchase-orders?limit=200')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: pos, total: 1, limit: 200, offset: 0 }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 1, limit: 1, offset: 0 }),
      } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('count-delayed-pos')).toHaveTextContent('Delayed vs promise: 1 POs');
    });

    // In upcoming deliveries, PO-OVERDUE-01 appears because its latest_estimate_date (2026-10-20) is >= as_of (2026-10-17)
    expect(screen.getByTestId('slipped-upcoming-PO-OVERDUE-01')).toHaveTextContent(
      'Slipped 7 days vs promise (promised 2026-10-13)'
    );
  });

  it('renders inventory risk section with summary counts and critical/high priority components linking to /inventory-risk', async () => {
    const mockRisk: InventoryRiskListResponse = {
      seeded: true,
      as_of: '2026-10-17',
      model: { name: 'weekday_average', type: 'heuristic_baseline', description: 'baseline' },
      config: {
        lookback_days: 28,
        min_history_days: 14,
        min_coverage_ratio: 0.8,
        horizon_days: 60,
        critical_days: 7,
        high_days: 14,
        medium_days: 30,
        overdue_inbound_policy: 'exclude',
      },
      summary: {
        counts_by_risk_level: { critical: 2, high: 1, medium: 3, low: 8, none: 1, unknown: 0 },
        components_evaluated: 15,
      },
      items: [
        {
          component_id: 1,
          sku: 'CPU-X7',
          name: 'NovaCore X7 Processor',
          category: 'Processor',
          criticality: 'critical',
          plant_usable_stock: 420,
          plant_on_hand: 520,
          plant_reserved: 100,
          mean_daily_demand: 101.4,
          coverage_days: 4.1,
          next_replenishment: null,
          shortage_date: '2026-10-21',
          days_until_shortage: 4,
          unmet_demand_units: 36.0,
          runout_date_without_inbound: '2026-10-21',
          risk_level: 'critical',
          risk_reason: 'Projected shortage in 4 days.',
          forecast_status: 'adequate',
          flags: [],
        },
        {
          component_id: 2,
          sku: 'RAM-16GB',
          name: 'DDR5 16GB Module',
          category: 'Memory',
          criticality: 'high',
          plant_usable_stock: 200,
          plant_on_hand: 200,
          plant_reserved: 0,
          mean_daily_demand: 20.0,
          coverage_days: 10.0,
          next_replenishment: null,
          shortage_date: '2026-10-27',
          days_until_shortage: 10,
          unmet_demand_units: 50.0,
          runout_date_without_inbound: '2026-10-27',
          risk_level: 'high',
          risk_reason: 'Projected shortage in 10 days.',
          forecast_status: 'adequate',
          flags: [],
        },
        {
          component_id: 3,
          sku: 'BAT-50WH',
          name: '50Wh Battery',
          category: 'Battery',
          criticality: 'normal',
          plant_usable_stock: 1200,
          plant_on_hand: 1200,
          plant_reserved: 0,
          mean_daily_demand: 25.0,
          coverage_days: 48.0,
          next_replenishment: null,
          shortage_date: null,
          days_until_shortage: null,
          unmet_demand_units: 0.0,
          runout_date_without_inbound: null,
          risk_level: 'low',
          risk_reason: 'No shortage.',
          forecast_status: 'adequate',
          flags: [],
        },
      ],
      total: 3,
      limit: 100,
      offset: 0,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/inventory-risk')) {
        return { ok: true, status: 200, json: async () => mockRisk } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overview-risk-section')).toBeInTheDocument();
    });

    // Counts from API
    expect(screen.getByTestId('count-risk-critical')).toHaveTextContent('2');
    expect(screen.getByTestId('count-risk-high')).toHaveTextContent('1');
    expect(screen.getByTestId('count-risk-medium')).toHaveTextContent('3');
    expect(screen.getByTestId('count-risk-low')).toHaveTextContent('8');

    // Priority table includes CPU-X7 and RAM-16GB, but NOT BAT-50WH (low risk)
    expect(screen.getByTestId('inspect-link-CPU-X7')).toBeInTheDocument();
    expect(screen.getByTestId('inspect-link-RAM-16GB')).toBeInTheDocument();
    expect(screen.queryByTestId('inspect-link-BAT-50WH')).not.toBeInTheDocument();

    // Link to /inventory-risk
    const link = screen.getByTestId('link-to-inventory-risk');
    expect(link).toHaveAttribute('href', '/inventory-risk');
  });

  it('handles independent failure of inventory risk without breaking other overview sections', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/inventory-risk')) {
        return { ok: false, status: 500, json: async () => ({ detail: 'Database error' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MetaProvider>
    );

    // Master counts still render successfully
    await waitFor(() => {
      expect(screen.getByTestId('count-products')).toHaveTextContent('4');
    });

    // Inventory risk section shows error view independently
    expect(screen.getByText('Could not load inventory risk summary')).toBeInTheDocument();
  });
});
