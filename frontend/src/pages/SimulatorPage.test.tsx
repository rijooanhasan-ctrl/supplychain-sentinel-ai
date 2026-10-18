import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SimulatorPage } from './SimulatorPage';
import { MetaProvider } from '../context/MetaContext';
import type { SimulationResponse, Paginated, Component } from '../api/types';

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

const mockComponents: Paginated<Component> = {
  total: 2,
  limit: 50,
  offset: 0,
  items: [
    {
      id: 1,
      sku: 'CPU-X7',
      name: 'High-Performance Processor 8-Core',
      category: 'processor',
      unit_of_measure: 'EA',
      criticality: 'critical',
      is_active: true,
    },
    {
      id: 2,
      sku: 'GPU-RTX',
      name: 'Graphics Card Discrete',
      category: 'graphics',
      unit_of_measure: 'EA',
      criticality: 'high',
      is_active: true,
    },
  ],
};

const createProjection = (baseEnding: number) => {
  return Array.from({ length: 30 }, (_, i) => ({
    day_index: i + 1,
    date: `2026-10-${String(18 + i).padStart(2, '0')}`,
    forecast_demand: 100.0,
    receipts: i === 6 ? 800.0 : 0.0,
    ending_balance: Math.max(0, baseEnding - i * 50),
    unmet: i >= 4 && i <= 6 ? 50.0 : 0.0,
  }));
};

const mockSimulationResponse: SimulationResponse = {
  seeded: true,
  as_of: '2026-10-17',
  component: {
    id: 1,
    sku: 'CPU-X7',
    name: 'High-Performance Processor 8-Core',
  },
  params: {
    supplier_delay_days: 7,
    demand_multiplier: 1.0,
    on_hand_delta: 0,
    alt_supplier_available: true,
  },
  baseline: {
    risk_level: 'critical',
    shortage_date: '2026-10-21',
    days_until_shortage: 4,
    first_shortage_episode: {
      start_date: '2026-10-21',
      end_date: '2026-10-23',
      days: 3,
      unmet_units: 289.5,
    },
    unmet_before_next_inbound: 289.5,
    later_episodes_note: 'Later shortage episode begins 2026-11-02 (4498.0 units over 44 days)',
    next_inbound: {
      date: '2026-10-24',
      qty: 800.0,
      po_number: 'PO-CPU-701',
      date_basis: 'po_promised_date',
    },
    mean_daily_demand: 102.5,
    plant_usable_stock: 420,
    exposed_orders_count: 5,
    exposed_revenue: '125000.00',
    exposed_orders_summary: '5 orders exposed',
    applied_actions: [],
    recovery_note: null,
    daily_projection_30d: createProjection(500),
  },
  disrupted: {
    risk_level: 'critical',
    shortage_date: '2026-10-21',
    days_until_shortage: 4,
    first_shortage_episode: {
      start_date: '2026-10-21',
      end_date: '2026-10-30',
      days: 10,
      unmet_units: 1008.0,
    },
    unmet_before_next_inbound: 1008.0,
    later_episodes_note: null,
    next_inbound: {
      date: '2026-10-31',
      qty: 800.0,
      po_number: 'PO-CPU-701',
      date_basis: 'po_promised_date',
    },
    mean_daily_demand: 102.5,
    plant_usable_stock: 420,
    exposed_orders_count: 12,
    exposed_revenue: '300000.00',
    exposed_orders_summary: '12 orders exposed',
    applied_actions: [],
    recovery_note: null,
    daily_projection_30d: createProjection(400),
  },
  recovered: {
    risk_level: 'low',
    shortage_date: '2026-11-02',
    days_until_shortage: 16,
    first_shortage_episode: null,
    unmet_before_next_inbound: 0.0,
    later_episodes_note: 'Later shortage episode begins 2026-11-02',
    next_inbound: {
      date: '2026-10-21',
      qty: 1008.0,
      po_number: 'PO-REC-001',
      date_basis: 'planned_recovery_receipt',
    },
    mean_daily_demand: 102.5,
    plant_usable_stock: 420,
    exposed_orders_count: 0,
    exposed_revenue: '0.00',
    exposed_orders_summary: '0 orders exposed',
    applied_actions: [
      {
        id: 'alt_supplier.SUP-NEXUS',
        kind: 'alternative_supplier',
        description: 'Procure 1008 units from SUP-NEXUS arriving 2026-10-21',
        quantity: 1008,
        arrival_date: '2026-10-21',
        incremental_cost: '297360.00',
        cost_known: true,
        source_code: 'SUP-NEXUS',
      },
    ],
    recovery_note: 'Intervention resolves first shortage window.',
    daily_projection_30d: createProjection(600),
  },
  what_changed: [
    'First shortage window extended from 3 days to 10 days.',
    'Units short before next inbound increased from 289.5 to 1008.0 units.',
    'Recovery option eliminates unmet demand before next inbound.',
  ],
  assumptions: [
    'The delay applies to all inbound lines of this component.',
    'Demand multiplier scales recent history uniformly.',
    'Unmet demand is not carried forward.',
    'This is a what-if scenario, not a forecast prediction.',
  ],
  note: 'What-if simulation. Nothing is saved and no orders are created.',
};

describe('SimulatorPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/meta')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(mockMeta),
          } as Response);
        }
        if (urlStr.includes('/api/components')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(mockComponents),
          } as Response);
        }
        if (urlStr.includes('/api/simulation')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(mockSimulationResponse),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock for ${urlStr}`));
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders simulator page with controls and default values', async () => {
    render(
      <MetaProvider>
        <MemoryRouter initialEntries={['/simulator']}>
          <SimulatorPage />
        </MemoryRouter>
      </MetaProvider>
    );

    expect(screen.getByText('What-If Disruption Simulator')).toBeInTheDocument();
    expect(
      screen.getByText('What-if simulation. Nothing is saved and no orders are created.')
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('component-select')).toBeInTheDocument();
    });

    const delayInput = screen.getByTestId('delay-input') as HTMLInputElement;
    const demandInput = screen.getByTestId('demand-input') as HTMLInputElement;
    const stockInput = screen.getByTestId('stock-input') as HTMLInputElement;
    const altCheckbox = screen.getByTestId('alt-supplier-checkbox') as HTMLInputElement;

    expect(delayInput.value).toBe('0');
    expect(demandInput.value).toBe('1');
    expect(stockInput.value).toBe('0');
    expect(altCheckbox.checked).toBe(true);
  });

  it('preselects component from URL query param ?component_id=2', async () => {
    render(
      <MetaProvider>
        <MemoryRouter initialEntries={['/simulator?component_id=2']}>
          <SimulatorPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      const select = screen.getByTestId('component-select') as HTMLSelectElement;
      expect(select.value).toBe('2');
    });
  });

  it('example buttons fill controls with preset values without triggering instant submit', async () => {
    render(
      <MetaProvider>
        <MemoryRouter initialEntries={['/simulator']}>
          <SimulatorPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('preset-delay-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('preset-delay-btn'));
    const delayInput = screen.getByTestId('delay-input') as HTMLInputElement;
    expect(delayInput.value).toBe('7');

    fireEvent.click(screen.getByTestId('preset-demand-btn'));
    const demandInput = screen.getByTestId('demand-input') as HTMLInputElement;
    expect(demandInput.value).toBe('1.3');
  });

  it('shows client-side validation errors when inputs are out of bounds', async () => {
    render(
      <MetaProvider>
        <MemoryRouter initialEntries={['/simulator']}>
          <SimulatorPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('delay-input')).toBeInTheDocument();
    });

    // Enter out of range delay > 60
    const delayInput = screen.getByTestId('delay-input');
    fireEvent.change(delayInput, { target: { value: '99' } });

    const form = delayInput.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(
        screen.getByText('Supplier delay must be between 0 and 60 days.')
      ).toBeInTheDocument();
    });
  });

  it('runs simulation and displays 3-column comparison table, what-changed list, and upper-bound wording', async () => {
    render(
      <MetaProvider>
        <MemoryRouter initialEntries={['/simulator']}>
          <SimulatorPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('comparison-table')).toBeInTheDocument();
    });

    // Check 3-column table headers
    expect(screen.getByText('1. Baseline (Unchanged)')).toBeInTheDocument();
    expect(screen.getByText('2. Disrupted (With Shock)')).toBeInTheDocument();
    expect(screen.getByText('3. With Recovery (Intervention)')).toBeInTheDocument();

    // Check text badges
    expect(screen.getAllByText('Critical Risk').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Low Risk')).toBeInTheDocument();

    // Check what-changed section
    expect(
      screen.getByText('First shortage window extended from 3 days to 10 days.')
    ).toBeInTheDocument();

    // Check mandatory upper bound disclosure
    expect(
      screen.getByText(/Upper bound: production lead time and stock allocation are unknown/i)
    ).toBeInTheDocument();

    // Check SVG chart legend and table
    expect(screen.getByTestId('chart-legend')).toBeInTheDocument();
    expect(screen.getByText(/Solid: Baseline/)).toBeInTheDocument();
    expect(screen.getByText(/Dashed: Disrupted/)).toBeInTheDocument();
    expect(screen.getByText(/Dotted: With Recovery/)).toBeInTheDocument();
    expect(screen.getByTestId('projection-table')).toBeInTheDocument();
  });

  it('handles API errors gracefully and offers a Retry button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/meta')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(mockMeta),
          } as Response);
        }
        if (urlStr.includes('/api/components')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(mockComponents),
          } as Response);
        }
        if (urlStr.includes('/api/simulation')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ detail: 'Simulated backend calculation failure' }),
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unhandled mock for ${urlStr}`));
      })
    );

    render(
      <MetaProvider>
        <MemoryRouter initialEntries={['/simulator']}>
          <SimulatorPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Simulated backend calculation failure/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  it('renders unseeded view when meta is unseeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/meta')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ seeded: false, label: 'UNSEEDED' }),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock for ${urlStr}`));
      })
    );

    render(
      <MetaProvider>
        <MemoryRouter initialEntries={['/simulator']}>
          <SimulatorPage />
        </MemoryRouter>
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Database Unseeded/i)).toBeInTheDocument();
    });
  });
});
