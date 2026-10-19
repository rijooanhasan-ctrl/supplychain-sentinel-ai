import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RecommendationsPage } from './RecommendationsPage';
import { MetaProvider } from '../context/MetaContext';
import type { RecommendationsResponse } from '../api/types';

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

const mockRecommendationsResponse: RecommendationsResponse = {
  seeded: true,
  as_of: '2026-10-17',
  config: {
    transfer_days: 2,
    transfer_cost_per_unit: null,
  },
  total: 1,
  note: 'Decision support only. No orders are created.',
  items: [
    {
      component_id: 1,
      sku: 'CPU-X7',
      name: 'High-Performance Processor 8-Core',
      risk_level: 'critical',
      baseline_shortage_date: '2026-10-21',
      baseline_unmet_before_next_inbound: 289.5,
      need_units: 290,
      baseline_summary: 'Projected shortage of 289.5 units before next replenishment',
      recommended_option_id: 'alt_supplier.SUP-NEXUS',
      recommended_option_kind: 'alternative_supplier',
      reason:
        "Recommended 'alt_supplier.SUP-NEXUS' because it achieves lowest residual (0.0 units). Preferred over runner-up 'expedite.PO-CPU-701'.",
      alternatives_note: 'Transfers from regional hubs provide partial relief.',
      later_shortage_note:
        'Later shortage episode begins 2026-11-02 (4498.0 units over 44 days); not covered by this recommendation.',
      combined_plan: null,
      options: [
        {
          id: 'alt_supplier.SUP-NEXUS',
          kind: 'alternative_supplier',
          description: 'Place order of 290 units with SUP-NEXUS arriving 2026-10-21.',
          source_code: 'SUP-NEXUS',
          source_name: 'Nexus Electronics',
          quantity: 290,
          arrival_date: '2026-10-21',
          arrival_within_time: true,
          incremental_cost: '85550.00',
          cost_known: true,
          unit_premium_vs_shortage_supplier: '45.00',
          residual_unmet_before_next_inbound: 0.0,
          new_shortage_date: '2026-11-02',
          remaining_total_unmet: 4498.0,
          constraints_applied: [
            'Procure from alternative supplier SUP-NEXUS.',
            'Standard procurement lead time: 4 days.',
          ],
          assumptions: [
            'Order would be placed immediately on snapshot date.',
            'Receipts are available at the start of the arrival day.',
          ],
          flags: [],
          feasible: true,
          infeasible_reason: null,
          impact: null,
        },
        {
          id: 'expedite.PO-CPU-701',
          kind: 'expedite_existing',
          description: 'Expedite PO PO-CPU-701 from SUP-HELIX to arrive on 2026-10-22 (800 units).',
          source_code: 'SUP-HELIX',
          source_name: 'Helix Semiconductor',
          quantity: 800,
          arrival_date: '2026-10-22',
          arrival_within_time: false,
          incremental_cost: '50000.00',
          cost_known: true,
          unit_premium_vs_shortage_supplier: null,
          residual_unmet_before_next_inbound: 36.2,
          new_shortage_date: '2026-10-21',
          remaining_total_unmet: 36.2,
          constraints_applied: ['Expedites existing purchase order PO-CPU-701.'],
          assumptions: ['Supplier expedite lead time is 5 days.'],
          flags: [],
          feasible: true,
          infeasible_reason: null,
          impact: null,
        },
        {
          id: 'transfer.WH-REG-EAST',
          kind: 'transfer',
          description: 'Transfer 150 units from regional hub WH-REG-EAST arriving 2026-10-19.',
          source_code: 'WH-REG-EAST',
          source_name: 'Eastern Regional DC',
          quantity: 150,
          arrival_date: '2026-10-19',
          arrival_within_time: true,
          incremental_cost: null,
          cost_known: false,
          unit_premium_vs_shortage_supplier: null,
          residual_unmet_before_next_inbound: 139.5,
          new_shortage_date: '2026-10-22',
          remaining_total_unmet: 139.5,
          constraints_applied: ['Transfer quantity limited to available usable stock of 150 units.'],
          assumptions: ['Transfer cost per unit is unconfigured (None); financial impact is unknown.'],
          flags: ['transfer_cost_unknown'],
          feasible: true,
          infeasible_reason: null,
          impact: null,
        },
        {
          id: 'transfer.WH-REG-EMPTY',
          kind: 'transfer',
          description: 'Transfer from WH-REG-EMPTY.',
          source_code: 'WH-REG-EMPTY',
          source_name: 'Empty Regional DC',
          quantity: 0,
          arrival_date: '2026-10-19',
          arrival_within_time: true,
          incremental_cost: null,
          cost_known: false,
          unit_premium_vs_shortage_supplier: null,
          residual_unmet_before_next_inbound: 289.5,
          new_shortage_date: '2026-10-21',
          remaining_total_unmet: 4498.5,
          constraints_applied: [],
          assumptions: [],
          flags: [],
          feasible: false,
          infeasible_reason: 'Regional warehouse WH-REG-EMPTY has zero usable stock.',
          impact: null,
        },
        {
          id: 'accept_delay',
          kind: 'accept_delay',
          description: 'Take no recovery action; accept projected shortage.',
          source_code: null,
          source_name: null,
          quantity: 0,
          arrival_date: null,
          arrival_within_time: false,
          incremental_cost: '0.00',
          cost_known: true,
          unit_premium_vs_shortage_supplier: null,
          residual_unmet_before_next_inbound: 289.5,
          new_shortage_date: '2026-10-21',
          remaining_total_unmet: 4498.5,
          constraints_applied: ['No procurement or transfer intervention applied.'],
          assumptions: ['Assumes plant absorbs shortage delay.'],
          flags: [],
          feasible: true,
          infeasible_reason: null,
          impact: {
            orders_count: 15,
            count_by_priority: { critical: 4, high: 6, normal: 5 },
            total_component_units_required: 600,
            exposed_revenue: '2507110.00',
            exposed_orders: [
              {
                order_number: 'ORD-901',
                customer_name: 'Apex Computing',
                product_sku: 'LAPTOP-PRO-16',
                product_name: 'Pro Laptop 16-inch',
                quantity: 50,
                due_date: '2026-10-22',
                priority: 'critical',
                component_units_required: 50,
              },
            ],
          },
        },
      ],
    },
  ],
};

function renderPage(initialEntry = '/recommendations') {
  return render(
    <MetaProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RecommendationsPage />
      </MemoryRouter>
    </MetaProvider>
  );
}

describe('RecommendationsPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders permanent disclaimer note banner', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockRecommendationsResponse,
      } as Response;
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('permanent-recommendations-note')).toBeInTheDocument();
    });

    expect(screen.getByTestId('permanent-recommendations-note')).toHaveTextContent(
      'Decision support only. No orders are created.'
    );
    expect(screen.getByTestId('permanent-recommendations-note')).toHaveTextContent(
      'Transfer time and cost are assumptions you can configure'
    );
  });

  it('renders component card with options table and text "Recommended" badge', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockRecommendationsResponse,
      } as Response;
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('recommendation-card-CPU-X7')).toBeInTheDocument();
    });

    // Check header values
    expect(screen.getByText('CPU-X7')).toBeInTheDocument();
    expect(screen.getByText('289.5 units')).toBeInTheDocument();

    // Check recommended option text badge
    const badge = screen.getByTestId('recommended-badge-alt_supplier.SUP-NEXUS');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Recommended');

    // Check cost "Unknown" displayed when cost is not known
    const unkCost = screen.getByTestId('cost-unknown-transfer.WH-REG-EAST');
    expect(unkCost).toHaveTextContent('Unknown');

    // Check infeasible reason rendered in text
    expect(
      screen.getByText(/Regional warehouse WH-REG-EMPTY has zero usable stock/)
    ).toBeInTheDocument();

    // Check later-shortage note rendered
    expect(screen.getByTestId('later-shortage-CPU-X7')).toHaveTextContent(
      'Later shortage episode begins 2026-11-02'
    );
  });

  it('expands option details to show constraints, assumptions, and exposed orders', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockRecommendationsResponse,
      } as Response;
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('expand-btn-accept_delay')).toBeInTheDocument();
    });

    const expandBtn = screen.getByTestId('expand-btn-accept_delay');
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');

    // Click expand
    fireEvent.click(expandBtn);
    expect(expandBtn).toHaveAttribute('aria-expanded', 'true');

    // Check constraints, assumptions, and exposure wording
    await waitFor(() => {
      expect(screen.getByTestId('accept-delay-impact-panel')).toBeInTheDocument();
    });

    expect(screen.getByText(/Upper bound of exposure/)).toBeInTheDocument();
    expect(screen.getByText('ORD-901')).toBeInTheDocument();
    expect(screen.getByText('Apex Computing')).toBeInTheDocument();
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
      return {
        ok: true,
        status: 200,
        json: async () => ({ seeded: false, items: [], total: 0 }),
      } as Response;
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('unseeded-state')).toBeInTheDocument();
    });
  });

  it('renders empty view when items list is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...mockRecommendationsResponse, items: [], total: 0 }),
      } as Response;
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No components currently need recovery')).toBeInTheDocument();
    });
  });

  it('renders error view with retry button on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      throw new Error('Network failure loading recommendations');
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
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
      return {
        ok: true,
        status: 200,
        json: async () => mockRecommendationsResponse,
      } as Response;
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('currency-notice')).toBeInTheDocument();
    });

    expect(screen.getByTestId('currency-notice')).toHaveTextContent(
      'Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹83.50'
    );
    // 85550.00 * 83.50 = 7143425.00 INR -> ₹71,43,425.00
    expect(screen.getByText('₹71,43,425.00')).toBeInTheDocument();
    expect(screen.queryByText('$85,550.00')).not.toBeInTheDocument();
  });
});
