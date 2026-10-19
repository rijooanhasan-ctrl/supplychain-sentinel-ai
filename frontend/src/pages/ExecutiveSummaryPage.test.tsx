import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MetaProvider } from '../context/MetaContext';
import { ExecutiveSummaryPage } from './ExecutiveSummaryPage';
import type { ExecutiveSummaryResponse, DatasetMetaResponse } from '../api/types';

const mockMeta: DatasetMetaResponse = {
  seeded: true,
  data_source: 'demo',
  label: 'DEMO DATA',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '1.0.0',
  generated_at: '2026-10-17T12:00:00+00:00',
  counts: { purchase_orders: 22 },
  message: 'Demo dataset active.',
  display_currency: 'USD',
  usd_to_inr_rate: null,
  stored_currency: 'USD',
};

const mockSummaryResponse: ExecutiveSummaryResponse = {
  seeded: true,
  as_of: '2026-10-17',
  label: 'DEMO DATA',
  headline: '9 components face shortage risk; the most urgent is CPU-X7, short from 2026-10-21 (4 days).',
  top_risks: [
    {
      component_id: 1,
      component_sku: 'CPU-X7',
      component_name: 'NovaCore X7 Processor',
      severity: 'critical',
      shortage_date: '2026-10-21',
      days_until_impact: 4,
      units_short_before_next_inbound: 289.5,
      first_shortage_window_days: 3,
      reason: 'Usable plant stock of 420 units for CPU-X7 is projected to run out on 2026-10-21.',
      related_alert_id: 'compound_risk.CPU-X7',
      has_later_shortage: true,
      exposed_orders_count: 15,
      exposed_selling_value: '2507110.00',
      why: [
        { label: 'Alert Summary', text: 'Multiple disruptions converging on CPU-X7.' },
        { label: 'Inventory Risk', text: 'Projected shortage in 4 days.' },
      ],
    },
    {
      component_id: 11,
      component_sku: 'MB-PRO-01',
      component_name: 'AeroMain Pro System Board',
      severity: 'high',
      shortage_date: '2026-10-26',
      days_until_impact: 9,
      units_short_before_next_inbound: 304.0,
      first_shortage_window_days: 4,
      reason: 'Usable plant stock of 510 units for MB-PRO-01 is projected to run out on 2026-10-26.',
      related_alert_id: 'compound_risk.MB-PRO-01',
      has_later_shortage: true,
      exposed_orders_count: 20,
      exposed_selling_value: '2931753.00',
      why: [{ label: 'Alert Summary', text: 'System board delay risk.' }],
    },
    {
      component_id: 5,
      component_sku: 'BAT-70WH',
      component_name: '70Wh Li-Ion Battery Pack',
      severity: 'high',
      shortage_date: '2026-10-30',
      days_until_impact: 13,
      units_short_before_next_inbound: 2896.8,
      first_shortage_window_days: 14,
      reason: 'Usable plant stock of 180 units projected to run out on 2026-10-30.',
      related_alert_id: 'inventory_shortage.BAT-70WH',
      has_later_shortage: false,
      exposed_orders_count: 12,
      exposed_selling_value: '2082427.00',
      why: [{ label: 'Alert Summary', text: 'Battery shortage projected.' }],
    },
  ],
  priority_decision: {
    component_id: 1,
    component_sku: 'CPU-X7',
    component_name: 'NovaCore X7 Processor',
    recommended_option_id: 'alt_supplier.SUP-NEXUS',
    recommended_option_kind: 'alternative_supplier',
    recommended_option_description:
      'Place order of 290 units with SUP-NEXUS (Nexus Micro Devices Corp) arriving 2026-10-21.',
    quantity: 290,
    arrival_date: '2026-10-21',
    incremental_cost: '85550.00',
    cost_known: true,
    residual_unmet_before_next_inbound: 0.0,
    later_shortage_note: 'Later shortage episode begins 2026-11-02 not covered by this recommendation.',
    runner_up: {
      id: 'expedite.PO-CPU-701',
      kind: 'expedite_existing',
      description: 'Expedite PO PO-CPU-701 from SUP-HELIX to arrive on 2026-10-22 (800 units).',
      incremental_cost: '120000.00',
      cost_known: true,
    },
    scope_note: 'Fixes the first shortage window only. Later shortages are not covered.',
    why: [
      { label: 'Reason', text: 'Eliminates 100% of first window unmet demand at lowest known cost.' },
    ],
  },
  cost_comparison: {
    act: {
      cost: '85550.00',
      cost_known: true,
      residual_units_short: 0.0,
      affected_orders_count: 10,
      selling_value: '1709176.00',
    },
    do_nothing: {
      units_short: 289.5,
      affected_orders_count: 15,
      selling_value: '2507110.00',
    },
    difference_sentence:
      'Acting costs $85,550.00; exposed order value in the first shortage window falls from $2,507,110.00 to $1,709,176.00 (upper bound, not a loss). Upper bound of exposure: production lead time and stock allocation to orders are unknown, so these orders are potentially exposed, not predicted to be late. Exposed revenue is the selling value of those orders, not an estimate of loss.',
    exposure_disclaimer:
      'Upper bound of exposure: production lead time and stock allocation to orders are unknown, so these orders are potentially exposed, not predicted to be late. Exposed revenue is the selling value of those orders, not an estimate of loss.',
  },
  exposure_totals: [
    {
      component_id: 1,
      component_sku: 'CPU-X7',
      component_name: 'NovaCore X7 Processor',
      orders_count: 15,
      selling_value: '2507110.00',
    },
  ],
  exposure_note:
    'Order counts and selling values are reported per component and are not summed across components to avoid double counting orders that depend on multiple disrupted components.',
  data_quality: {
    dataset_label: 'DEMO DATA',
    dataset_source: 'demo',
    is_live: false,
    components_evaluated: 14,
    components_unknown_risk: 0,
    supplier_confidence_counts: { high: 2, medium: 6, low: 0 },
    top_risk_supplier_confidence: [
      {
        supplier_id: 1,
        supplier_code: 'SUP-HELIX',
        supplier_name: 'Helix Silicon Technologies Inc',
        confidence: 'high',
        n_deliveries: 40,
      },
    ],
    priority_component_demand_history_days: 28,
    flags: [],
    data_quality_note:
      'Based on 14 components; 0 have insufficient history; supplier confidence for SUP-HELIX is high (40 deliveries); data source: DEMO DATA, not live',
  },
  assumptions: [
    'Analysis and recovery recommendations evaluate the first shortage window only; subsequent shortages are not covered.',
    'Unmet daily demand in stock projections is not carried forward as backorders (lost consumption model).',
  ],
  why: {},
  note: 'Decision support only. No orders are created.',
};

describe('ExecutiveSummaryPage', () => {
  function setupFetchMock(
    summaryResult: unknown = mockSummaryResponse,
    metaResult: unknown = mockMeta,
    failSummary = false
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/meta')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(metaResult),
          });
        }
        if (urlStr.includes('/api/executive-summary')) {
          if (failSummary) {
            return Promise.reject(new Error('Network error loading summary'));
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(summaryResult),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      })
    );
  }

  function renderPage() {
    return render(
      <MetaProvider>
        <MemoryRouter>
          <ExecutiveSummaryPage />
        </MemoryRouter>
      </MetaProvider>
    );
  }

  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders headline, DEMO DATA label, 3 top risk cards with text badges', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('executive-headline-text')).toHaveTextContent(
        '9 components face shortage risk; the most urgent is CPU-X7, short from 2026-10-21 (4 days).'
      );
    });

    // DEMO DATA label present
    expect(screen.getByTestId('data-source-badge')).toHaveTextContent('DEMO DATA');

    // 3 risk cards rendered with text badges
    expect(screen.getByTestId('risk-card-CPU-X7')).toBeInTheDocument();
    expect(screen.getByTestId('risk-card-MB-PRO-01')).toBeInTheDocument();
    expect(screen.getByTestId('risk-card-BAT-70WH')).toBeInTheDocument();

    expect(screen.getByTestId('severity-badge-CPU-X7')).toHaveTextContent('critical');
    expect(screen.getByTestId('severity-badge-MB-PRO-01')).toHaveTextContent('high');
    expect(screen.getByTestId('severity-badge-BAT-70WH')).toHaveTextContent('high');
  });

  it('renders recommended action card with text "Recommended" and fixes first shortage window sentence', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('recommended-action-card')).toBeInTheDocument();
    });

    expect(screen.getByTestId('recommended-badge')).toHaveTextContent('Recommended');
    expect(screen.getByText(/Fixes the first shortage window only/i)).toBeInTheDocument();
    expect(screen.getByTestId('decision-cost')).toHaveTextContent('$85,550.00');
    expect(screen.getByTestId('later-shortage-note')).toHaveTextContent(/2026-11-02/i);
  });

  it('renders cost comparison table and verifies upper-bound wording is present and "savings" is absent', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('cost-comparison-table')).toBeInTheDocument();
    });

    // Check table rows
    expect(screen.getByText('Intervention Cost')).toBeInTheDocument();
    expect(screen.getByText('Units Short Before Next Inbound')).toBeInTheDocument();
    expect(screen.getByText('Affected Customer Orders')).toBeInTheDocument();
    expect(screen.getByText('Selling Value of Affected Orders')).toBeInTheDocument();

    // Difference sentence & Upper bound wording present
    const diffBox = screen.getByTestId('difference-sentence-box');
    expect(diffBox).toHaveTextContent(/Acting costs \$85,550\.00/i);
    expect(diffBox).toHaveTextContent(/falls from \$2,507,110\.00 to \$1,709,176\.00/i);

    const disclaimer = screen.getByTestId('upper-bound-disclaimer');
    expect(disclaimer).toHaveTextContent(/Upper bound of exposure/i);
    expect(disclaimer).toHaveTextContent(/not an estimate of loss/i);

    // CRITICAL: NO words "savings" or "loss estimate" in the entire document
    const bodyText = document.body.textContent || '';
    expect(bodyText.toLowerCase()).not.toContain('savings');
    expect(bodyText.toLowerCase()).not.toContain('loss estimate');
  });

  it('renders "Unknown" for null cost when cost is unknown', async () => {
    const unknownCostResponse = {
      ...mockSummaryResponse,
      priority_decision: {
        ...mockSummaryResponse.priority_decision!,
        incremental_cost: null,
        cost_known: false,
      },
      cost_comparison: {
        ...mockSummaryResponse.cost_comparison!,
        act: {
          ...mockSummaryResponse.cost_comparison!.act,
          cost: null,
          cost_known: false,
        },
      },
    };

    setupFetchMock(unknownCostResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('decision-cost')).toHaveTextContent('Unknown');
    });
  });

  it('toggles data quality details with aria-expanded', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('data-quality-note')).toHaveTextContent(
        'Based on 14 components; 0 have insufficient history; supplier confidence for SUP-HELIX is high'
      );
    });

    const toggleBtn = screen.getByTestId('toggle-data-quality-btn');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('data-quality-expansion-panel')).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('data-quality-expansion-panel')).toBeInTheDocument();
    expect(screen.getByText('Components Evaluated:')).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('data-quality-expansion-panel')).not.toBeInTheDocument();
  });

  it('handles error state with Retry button', async () => {
    setupFetchMock(mockSummaryResponse, mockMeta, true);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();
  });

  it('handles unseeded state properly', async () => {
    setupFetchMock({ seeded: false }, { ...mockMeta, seeded: false });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Database Unseeded/i)).toBeInTheDocument();
    });
  });

  it('handles empty state with "No components currently at risk"', async () => {
    const emptyResponse = {
      ...mockSummaryResponse,
      headline: 'No components currently face shortage risk (none at risk).',
      top_risks: [],
      priority_decision: null,
      cost_comparison: null,
    };

    setupFetchMock(emptyResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No components currently at risk')).toBeInTheDocument();
    });
  });

  it('displays INR notice and formats amounts in ₹ without $ when display_currency is INR', async () => {
    const inrMeta: DatasetMetaResponse = {
      ...mockMeta,
      display_currency: 'INR',
      usd_to_inr_rate: '83.50',
    };

    const inrSummaryResponse: ExecutiveSummaryResponse = {
      ...mockSummaryResponse,
      cost_comparison: {
        ...mockSummaryResponse.cost_comparison!,
        difference_sentence:
          'Acting costs ₹71,43,425.00; exposed order value in the first shortage window falls from ₹20,93,43,685.00 to ₹14,27,16,196.00 (upper bound, not a loss). Upper bound of exposure: production lead time and stock allocation to orders are unknown, so these orders are potentially exposed, not predicted to be late. Exposed revenue is the selling value of those orders, not an estimate of loss.',
      },
    };

    setupFetchMock(inrSummaryResponse, inrMeta);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('currency-notice')).toBeInTheDocument();
    });

    expect(screen.getByTestId('currency-notice')).toHaveTextContent(
      'Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹83.50'
    );
    expect(screen.getByTestId('decision-cost')).toHaveTextContent('₹71,43,425.00');
    expect(screen.getByTestId('decision-cost')).not.toHaveTextContent('$');
    expect(screen.getByTestId('difference-sentence-box')).toHaveTextContent('₹71,43,425.00');
    expect(screen.getByTestId('difference-sentence-box')).not.toHaveTextContent('$');
  });
});
