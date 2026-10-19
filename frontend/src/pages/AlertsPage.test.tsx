import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { AlertsPage } from './AlertsPage';
import type { AlertsListResponse, AlertDetail } from '../api/types';

const mockMeta = {
  seeded: true,
  data_source: 'demo',
  label: 'DEMO DATA',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '1.0.0',
  generated_at: '2026-10-17T12:00:00+00:00',
  counts: {},
  message: 'Demo dataset active.',
};

const mockAlertsResponse: AlertsListResponse = {
  seeded: true,
  as_of: '2026-10-17',
  config: {
    surge_recent_days: 14,
    surge_baseline_days: 28,
    surge_ratio_medium: 1.25,
    surge_ratio_high: 1.5,
    quality_rejection_threshold: 0.02,
    delay_min_late_probability: 0.20,
    delay_min_deliveries: 10,
  },
  summary: {
    counts_by_severity: {
      critical: 1,
      high: 1,
      medium: 1,
      low: 1,
      info: 0,
    },
    counts_by_type: {
      inventory_shortage: 1,
      supplier_delay_exposure: 1,
      data_quality: 1,
      demand_surge: 1,
      po_slipped: 0,
      po_overdue: 0,
      quality_issue: 0,
      capacity_constraint: 0,
      compound_risk: 0,
    },
    total_alerts: 4,
  },
  items: [
    {
      id: 'inventory_shortage.CPU-X7',
      type: 'inventory_shortage',
      severity: 'critical',
      title: 'Projected Inventory Shortage for CPU-X7',
      summary: 'Usable plant stock of 420 units for CPU-X7 is projected to run out on 2026-10-21.',
      component_id: 1,
      component_sku: 'CPU-X7',
      component_name: 'Core Processor X7',
      supplier_id: null,
      supplier_code: null,
      po_number: null,
      days_until_impact: 4,
      affected_orders_count: 15,
      exposed_revenue: '2507110.00',
      related_alert_ids: ['compound_risk.CPU-X7'],
      flags: ['inbound_promise_only'],
    },
    {
      id: 'supplier_delay_exposure.CPU-X7.SUP-HELIX',
      type: 'supplier_delay_exposure',
      severity: 'critical',
      title: 'Supplier Delay Exposure for CPU-X7 (SUP-HELIX)',
      summary: 'Historical late delivery frequency of 45.0% for SUP-HELIX shifts first shortage episode.',
      component_id: 1,
      component_sku: 'CPU-X7',
      component_name: 'Core Processor X7',
      supplier_id: 2,
      supplier_code: 'SUP-HELIX',
      po_number: null,
      days_until_impact: 4,
      affected_orders_count: 15,
      exposed_revenue: '2507110.00',
      related_alert_ids: ['inventory_shortage.CPU-X7'],
      flags: [],
    },
    {
      id: 'demand_surge.RAM-16GB',
      type: 'demand_surge',
      severity: 'high',
      title: 'Demand Surge Detected for RAM-16GB',
      summary: 'Recent 14-day demand ratio is 2.35x baseline.',
      component_id: 3,
      component_sku: 'RAM-16GB',
      component_name: '16GB DDR5 Module',
      supplier_id: null,
      supplier_code: null,
      po_number: null,
      days_until_impact: null,
      affected_orders_count: null,
      exposed_revenue: null,
      related_alert_ids: [],
      flags: [],
    },
    {
      id: 'data_quality.GPU-M',
      type: 'data_quality',
      severity: 'low',
      title: 'Data Quality Flag for GPU-M',
      summary: 'Component GPU-M has unknown inventory risk level due to insufficient data.',
      component_id: 4,
      component_sku: 'GPU-M',
      component_name: 'Mobile GPU',
      supplier_id: null,
      supplier_code: null,
      po_number: null,
      days_until_impact: null,
      affected_orders_count: null,
      exposed_revenue: null,
      related_alert_ids: [],
      flags: ['insufficient_demand_history'],
    },
  ],
  total: 4,
  limit: 50,
  offset: 0,
};

const mockDetailCpu: AlertDetail = {
  ...mockAlertsResponse.items[0],
  detected_on: '2026-10-17',
  evidence: [
    { label: 'Usable Plant Stock', value: 420, unit: 'units' },
    { label: 'Mean Daily Demand', value: 101.43, unit: 'units/day' },
    { label: 'Projected Shortage Date', value: '2026-10-21', unit: null },
  ],
  assumptions: [
    'Upper bound of exposure: production lead time and stock allocation to orders are unknown, so these orders are potentially exposed, not predicted to be late. Exposed revenue is the selling value of those orders, not an estimate of loss.',
    'Demand projection assumes the 28-day weekday-average consumption profile continues without structural shifts.',
  ],
  impact: {
    orders_count: 15,
    count_by_priority: { critical: 4, high: 6, normal: 5, low: 0 },
    total_component_units_required: 1820,
    exposed_revenue: '2507110.00',
    exposed_orders: [
      {
        order_number: 'ORD-2026-1001',
        customer_name: 'Horizon Tech Corp',
        product_sku: 'LAPTOP-PRO-15',
        product_name: 'Pro Laptop 15-inch',
        quantity: 50,
        due_date: '2026-10-23',
        priority: 'critical',
        component_units_required: 50,
      },
    ],
  },
  impact_null_reason: null,
  delay_scenarios: null,
};

const mockDetailHelix: AlertDetail = {
  ...mockAlertsResponse.items[1],
  detected_on: '2026-10-17',
  evidence: [
    { label: 'Supplier Historical Late Rate', value: '45.0%', unit: null },
    { label: 'Supplier Deliveries Evaluated', value: 40, unit: null },
  ],
  assumptions: [
    'Upper bound of exposure: production lead time and stock allocation to orders are unknown, so these orders are potentially exposed, not predicted to be late. Exposed revenue is the selling value of those orders, not an estimate of loss.',
  ],
  impact: null,
  impact_null_reason: 'not applicable',
  delay_scenarios: [
    {
      scenario_name: 'baseline',
      shift_days: 0,
      expected_date: '2026-10-24',
      shortage_date: '2026-10-21',
      first_episode_start: '2026-10-21',
      first_episode_end: '2026-10-23',
      first_episode_days: 3,
      unmet_before_next_inbound: 289.5,
      total_unmet_demand: 1540.2,
      incremental_total_unmet: 0.0,
      change_in_shortage_days: 0,
    },
    {
      scenario_name: 'typical',
      shift_days: 7,
      expected_date: '2026-10-31',
      shortage_date: '2026-10-21',
      first_episode_start: '2026-10-21',
      first_episode_end: '2026-10-30',
      first_episode_days: 10,
      unmet_before_next_inbound: 999.5,
      total_unmet_demand: 2250.2,
      incremental_total_unmet: 710.0,
      change_in_shortage_days: 7,
    },
    {
      scenario_name: 'severe',
      shift_days: 14,
      expected_date: '2026-11-07',
      shortage_date: '2026-10-21',
      first_episode_start: '2026-10-21',
      first_episode_end: '2026-11-06',
      first_episode_days: 17,
      unmet_before_next_inbound: 1709.5,
      total_unmet_demand: 2960.2,
      incremental_total_unmet: 1420.0,
      change_in_shortage_days: 14,
    },
  ],
};

describe('AlertsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders top summary counts and table with text severity badges and dash for nulls', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockAlertsResponse,
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MetaProvider>
    );

    // Summary counts banner
    await waitFor(() => {
      expect(screen.getByTestId('summary-counts-text')).toHaveTextContent(
        'Critical 1 · High 1 · Medium 1 · Low 1 · Info 0'
      );
    });

    // Verify table rows and text badges
    expect(screen.getByTestId('alerts-table')).toBeInTheDocument();
    expect(screen.getAllByTestId('alert-severity-badge-critical')[0]).toHaveTextContent('Critical');

    // Demand surge row has null days_until_impact and null exposed revenue -> rendered as "—"
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(3);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('filters by severity and resets pagination to page 1', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      return { ok: true, status: 200, json: async () => mockAlertsResponse } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('severity-filter-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('severity-filter-select'), {
      target: { value: 'critical' },
    });

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0].toString();
      expect(lastCall).toContain('severity=critical');
      expect(lastCall).toContain('offset=0');
    });
  });

  it('expands row to show summary, evidence table, assumptions, and customer orders exposure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/alerts/inventory_shortage.CPU-X7')) {
        return { ok: true, status: 200, json: async () => mockDetailCpu } as Response;
      }
      if (urlStr.includes('/api/alerts')) {
        return { ok: true, status: 200, json: async () => mockAlertsResponse } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('toggle-expand-inventory_shortage.CPU-X7')).toBeInTheDocument();
    });

    // Expand CPU-X7 shortage alert
    const toggleBtn = screen.getByTestId('toggle-expand-inventory_shortage.CPU-X7');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    // Detail panel rendered
    await waitFor(() => {
      expect(screen.getByTestId('alert-detail-panel-inventory_shortage.CPU-X7')).toBeInTheDocument();
    });

    // Evidence table
    expect(screen.getByTestId('alert-evidence-table')).toBeInTheDocument();
    expect(screen.getByText('Usable Plant Stock')).toBeInTheDocument();

    // Mandatory upper-bound assumption text
    const assumptionsList = screen.getByTestId('alert-assumptions-list');
    expect(assumptionsList).toHaveTextContent('Upper bound of exposure');

    // Exposed orders table
    expect(screen.getByTestId('exposed-orders-table')).toBeInTheDocument();
    expect(screen.getByText('ORD-2026-1001')).toBeInTheDocument();
    expect(screen.getByText('Horizon Tech Corp')).toBeInTheDocument();
  });

  it('expands delay alert row to show delay scenario table with what-if wording', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/alerts/supplier_delay_exposure.CPU-X7.SUP-HELIX')) {
        return { ok: true, status: 200, json: async () => mockDetailHelix } as Response;
      }
      if (urlStr.includes('/api/alerts')) {
        return { ok: true, status: 200, json: async () => mockAlertsResponse } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('toggle-expand-supplier_delay_exposure.CPU-X7.SUP-HELIX')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('toggle-expand-supplier_delay_exposure.CPU-X7.SUP-HELIX'));

    await waitFor(() => {
      expect(screen.getByTestId('delay-scenarios-table')).toBeInTheDocument();
    });

    // What-if disclaimer line
    expect(
      screen.getByText('What-if cases from historical delays, not predictions')
    ).toBeInTheDocument();

    // Table rows
    expect(screen.getByText('+7d')).toBeInTheDocument();
    expect(screen.getByText('+14d')).toBeInTheDocument();
  });

  it('renders unseeded view when meta is unseeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...mockMeta, seeded: false }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => mockAlertsResponse } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('unseeded-state')).toBeInTheDocument();
    });
  });

  it('renders empty view when items are empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...mockAlertsResponse,
            items: [],
            total: 0,
            summary: {
              counts_by_severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
              counts_by_type: {},
              total_alerts: 0,
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText('No disruption alerts match the current filter criteria.')
      ).toBeInTheDocument();
    });
  });

  it('displays INR notice and formats amounts in ₹ without $ when display_currency is INR', async () => {
    const inrMeta = {
      ...mockMeta,
      display_currency: 'INR',
      usd_to_inr_rate: '83.50',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => inrMeta } as Response;
      }
      if (urlStr.includes('/api/alerts/inventory_shortage.CPU-X7')) {
        return { ok: true, status: 200, json: async () => mockDetailCpu } as Response;
      }
      if (urlStr.includes('/api/alerts')) {
        return { ok: true, status: 200, json: async () => mockAlertsResponse } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MetaProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('currency-notice')).toBeInTheDocument();
    });

    expect(screen.getByTestId('currency-notice')).toHaveTextContent(
      'Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹83.50'
    );

    // 2507110.00 * 83.50 = 209,343,685.00 INR -> ₹20,93,43,685.00
    await waitFor(() => {
      expect(screen.getAllByText('₹20,93,43,685.00').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('$2,507,110.00')).not.toBeInTheDocument();
  });
});
