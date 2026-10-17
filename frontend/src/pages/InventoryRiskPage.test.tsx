import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { InventoryRiskPage } from './InventoryRiskPage';
import type {
  InventoryRiskDetailResponse,
  InventoryRiskListResponse,
} from '../api/types';

const mockMeta = {
  seeded: true,
  data_source: 'demo',
  label: 'DEMO DATA',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '1.0.0',
  generated_at: '2026-10-17T12:00:00+00:00',
  counts: { components: 14 },
  message: 'Demo dataset active.',
};

const mockRiskList: InventoryRiskListResponse = {
  seeded: true,
  as_of: '2026-10-17',
  model: {
    name: 'weekday_average',
    type: 'heuristic_baseline',
    description: 'Weekday-average heuristic baseline',
  },
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
    counts_by_risk_level: {
      critical: 1,
      high: 0,
      medium: 0,
      low: 1,
      none: 1,
      unknown: 1,
    },
    components_evaluated: 4,
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
      next_replenishment: {
        date: '2026-10-24',
        qty: 800,
        po_number: 'PO-CPU-701',
        date_basis: 'promised',
      },
      shortage_date: '2026-10-21',
      days_until_shortage: 4,
      unmet_demand_units: 36.0,
      runout_date_without_inbound: '2026-10-21',
      risk_level: 'critical',
      risk_reason: 'Projected shortage in 4 days (threshold <= 7 days).',
      forecast_status: 'adequate',
      flags: [
        { code: 'inbound_promise_only', message: 'Relies on promised date' },
      ],
    },
    {
      component_id: 2,
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
      runout_date_without_inbound: '2026-12-04',
      risk_level: 'low',
      risk_reason: 'No shortage projected within 60-day planning horizon.',
      forecast_status: 'adequate',
      flags: [],
    },
    {
      component_id: 3,
      sku: 'COMP-SPARE-01',
      name: 'Diagnostic Sensor',
      category: 'Sensor',
      criticality: 'normal',
      plant_usable_stock: 50,
      plant_on_hand: 50,
      plant_reserved: 0,
      mean_daily_demand: 0.0,
      coverage_days: null, // Null coverage days
      next_replenishment: null,
      shortage_date: null,
      days_until_shortage: null,
      unmet_demand_units: 0.0,
      runout_date_without_inbound: null,
      risk_level: 'none',
      risk_reason: 'No risk: zero historical demand over lookback window.',
      forecast_status: 'no_demand',
      flags: [{ code: 'zero_demand', message: 'Zero historical consumption' }],
    },
    {
      component_id: 4,
      sku: 'NO-STOCK-01',
      name: 'Unstocked Board',
      category: 'Motherboard',
      criticality: 'high',
      plant_usable_stock: null, // Null usable stock
      plant_on_hand: null,
      plant_reserved: null,
      mean_daily_demand: null,
      coverage_days: null,
      next_replenishment: null,
      shortage_date: null,
      days_until_shortage: null,
      unmet_demand_units: 0.0,
      runout_date_without_inbound: null,
      risk_level: 'unknown',
      risk_reason: 'Unknown risk: component has no inventory record at the plant.',
      forecast_status: 'no_plant_inventory',
      flags: [{ code: 'no_plant_inventory', message: 'No plant inventory' }],
    },
  ],
  total: 4,
  limit: 50,
  offset: 0,
};

const mockDetailCpuX7: InventoryRiskDetailResponse = {
  ...mockRiskList.items[0],
  as_of: '2026-10-17',
  model: mockRiskList.model,
  config: mockRiskList.config,
  explanation:
    'Usable plant stock 420 (on hand 520 − reserved 100). Expected demand ~101.4/day (weekday-aware: ~126 weekdays, ~40 weekends). Stock runs out on 2026-10-21 (in 4 days). Next inbound: 800 units on 2026-10-24 (promised date; supplier gave no updated estimate), 3 days after the projected shortage. Estimated unmet demand until then: 36.0 units.',
  usable_stock_breakdown: {
    on_hand: 520,
    reserved: 100,
    usable: 420,
    reserved_exceeds_on_hand: false,
  },
  forecast_by_weekday: [
    { weekday: 0, weekday_name: 'Monday', mean_demand: 129.0 },
    { weekday: 1, weekday_name: 'Tuesday', mean_demand: 125.0 },
    { weekday: 2, weekday_name: 'Wednesday', mean_demand: 124.0 },
    { weekday: 3, weekday_name: 'Thursday', mean_demand: 128.0 },
    { weekday: 4, weekday_name: 'Friday', mean_demand: 126.0 },
    { weekday: 5, weekday_name: 'Saturday', mean_demand: 40.0 },
    { weekday: 6, weekday_name: 'Sunday', mean_demand: 39.0 },
  ],
  counted_inbound: [
    {
      po_id: 1,
      po_number: 'PO-CPU-701',
      status: 'in_transit',
      warehouse_code: 'WH-PLANT',
      qty_ordered: 800,
      qty_received: 0,
      remaining_qty: 800,
      promised_date: '2026-10-24',
      latest_estimate_date: null,
      expected_date: '2026-10-24',
      date_basis: 'promised',
    },
  ],
  unconfirmed_inbound: [],
  out_of_horizon_inbound: [],
  regional_usable_stock: [
    {
      warehouse_id: 2,
      warehouse_code: 'WH-REG-EAST',
      warehouse_name: 'East Hub',
      on_hand: 150,
      reserved: 0,
      usable: 150,
    },
  ],
  regional_total_usable: 150,
  daily_projection: [
    { day_index: 0, date: '2026-10-17', forecast_demand: 40.0, receipts: 0.0, ending_balance: 380.0, unmet: 0.0 },
    { day_index: 1, date: '2026-10-18', forecast_demand: 39.0, receipts: 0.0, ending_balance: 341.0, unmet: 0.0 },
    { day_index: 2, date: '2026-10-19', forecast_demand: 126.0, receipts: 0.0, ending_balance: 215.0, unmet: 0.0 },
    { day_index: 3, date: '2026-10-20', forecast_demand: 126.0, receipts: 0.0, ending_balance: 89.0, unmet: 0.0 },
    { day_index: 4, date: '2026-10-21', forecast_demand: 125.0, receipts: 0.0, ending_balance: 0.0, unmet: 36.0 },
    { day_index: 5, date: '2026-10-22', forecast_demand: 128.0, receipts: 0.0, ending_balance: 0.0, unmet: 128.0 },
    { day_index: 6, date: '2026-10-23', forecast_demand: 126.0, receipts: 0.0, ending_balance: 0.0, unmet: 126.0 },
    { day_index: 7, date: '2026-10-24', forecast_demand: 40.0, receipts: 800.0, ending_balance: 760.0, unmet: 0.0 },
  ],
  assumptions: [
    'Demand projection uses a 28-day weekday-average heuristic baseline.',
    'Inbound receipts available at start of day.',
  ],
};

describe('InventoryRiskPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders table rows, handles null values with "—", and shows text risk badges', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/components')) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
      }
      if (urlStr.includes('/api/inventory-risk')) {
        return { ok: true, status: 200, json: async () => mockRiskList } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    });

    render(
      <MetaProvider>
        <InventoryRiskPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('risk-table')).toBeInTheDocument();
    });

    // Baseline notice banner check
    expect(screen.getByTestId('heuristic-banner')).toHaveTextContent(
      'Demand estimate: weekday-average heuristic baseline (not a trained ML model). Based on the last 28 days of demand history.'
    );

    // Row checks
    expect(screen.getByTestId('risk-row-CPU-X7')).toBeInTheDocument();
    expect(screen.getByTestId('risk-row-NO-STOCK-01')).toBeInTheDocument();

    // Text badges check (never color alone)
    expect(screen.getByTestId('risk-badge-critical')).toHaveTextContent('Critical');
    expect(screen.getByTestId('risk-badge-low')).toHaveTextContent('Low');
    expect(screen.getByTestId('risk-badge-none')).toHaveTextContent('Not applicable');
    expect(screen.getByTestId('risk-badge-unknown')).toHaveTextContent('Unknown');

    // Null values rendered as dash "—"
    const noStockRow = screen.getByTestId('risk-row-NO-STOCK-01');
    expect(noStockRow.textContent).toContain('—');

    // Next replenishment formatted
    expect(screen.getByTestId('replenishment-CPU-X7')).toHaveTextContent('800 units (promised)');
    expect(screen.getByTestId('replenishment-BAT-50WH')).toHaveTextContent('—');

    // Predicted shortage
    expect(screen.getByTestId('shortage-CPU-X7')).toHaveTextContent('in 4 days');
    expect(screen.getByTestId('shortage-BAT-50WH')).toHaveTextContent('None within horizon');
  });

  it('filters send correct query parameters and reset offset to 0', async () => {
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/components')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 1, sku: 'CPU-X7', name: 'CPU', category: 'Processor' },
              { id: 2, sku: 'BAT-50WH', name: 'Bat', category: 'Battery' },
            ],
          }),
        } as Response;
      }
      if (urlStr.includes('/api/inventory-risk')) {
        capturedUrl = urlStr;
        return { ok: true, status: 200, json: async () => mockRiskList } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    });

    render(
      <MetaProvider>
        <InventoryRiskPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/risk level:/i)).toBeInTheDocument();
    });

    const riskSelect = screen.getByLabelText(/risk level:/i);
    fireEvent.change(riskSelect, { target: { value: 'critical' } });

    await waitFor(() => {
      expect(capturedUrl).toContain('risk_level=critical');
      expect(capturedUrl).toContain('offset=0');
    });

    const critSelect = screen.getByLabelText(/criticality:/i);
    fireEvent.change(critSelect, { target: { value: 'high' } });

    await waitFor(() => {
      expect(capturedUrl).toContain('criticality=high');
      expect(capturedUrl).toContain('offset=0');
    });
  });

  it('row expansion toggles and renders explanation, flags, and 14-day projection with Shortage markers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/inventory-risk/1')) {
        return { ok: true, status: 200, json: async () => mockDetailCpuX7 } as Response;
      }
      if (urlStr.includes('/api/inventory-risk')) {
        return { ok: true, status: 200, json: async () => mockRiskList } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    });

    render(
      <MetaProvider>
        <InventoryRiskPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('toggle-expand-CPU-X7')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('toggle-expand-CPU-X7');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    await waitFor(() => {
      expect(screen.getByTestId('risk-detail-panel-1')).toBeInTheDocument();
    });

    // Explanation text
    expect(screen.getByTestId('explanation-text-1')).toHaveTextContent(
      'Usable plant stock 420 (on hand 520 − reserved 100)'
    );

    // Flags
    expect(screen.getByTestId('flag-inbound_promise_only')).toHaveTextContent('Relies on promised date');

    // Usable stock & regional stock
    expect(screen.getByTestId('usable-stock-val-1')).toHaveTextContent('420');
    expect(screen.getByTestId('reg-total-1')).toHaveTextContent('150');

    // Projection table
    expect(screen.getByTestId('projection-table-1')).toBeInTheDocument();

    // Shortage marker text (accessible text, not color alone!)
    expect(screen.getByTestId('shortage-badge-day-4')).toHaveTextContent('Shortage: 36.0 unmet units');
  });

  it('handles empty state and error retry state gracefully', async () => {
    let shouldFail = true;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/inventory-risk')) {
        if (shouldFail) {
          return { ok: false, status: 500, json: async () => ({ detail: 'Server Error' }) } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...mockRiskList, items: [], total: 0 }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    });

    render(
      <MetaProvider>
        <InventoryRiskPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to evaluate inventory risk')).toBeInTheDocument();
    });

    // Click retry
    shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('No components match criteria')).toBeInTheDocument();
    });
  });

  it('renders UnseededView when database is unseeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ seeded: false, message: 'Database not seeded.' }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    render(
      <MetaProvider>
        <InventoryRiskPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('unseeded-state')).toBeInTheDocument();
      expect(screen.getByText('Database not seeded.')).toBeInTheDocument();
    });
  });
});
