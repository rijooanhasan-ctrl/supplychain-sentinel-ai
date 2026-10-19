import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ReportPage } from './ReportPage';
import { MetaProvider } from '../context/MetaContext';

const mockExecutiveSummary = {
  seeded: true,
  as_of: '2026-10-18',
  label: 'USER-SUPPLIED DATA (file import)',
  headline: 'Immediate supply disruption detected across 2 critical component lines.',
  top_risks: [
    {
      component_id: 1,
      component_sku: 'CMP-CPU-001',
      component_name: 'Core Processor i7',
      category: 'Processors',
      criticality: 'critical',
      runway_days: 12,
      shortage_date: '2026-10-30',
      days_until_impact: 12,
      units_short_before_next_inbound: 150,
      first_shortage_window_days: 14,
      reason: 'Lead-time delay from primary supplier',
      related_alert_id: 'alt-001',
      has_later_shortage: false,
      exposed_orders_count: 5,
      exposed_selling_value: '18500.00',
      why: [],
    },
  ],
  priority_decision: {
    component_id: 1,
    component_sku: 'CMP-CPU-001',
    component_name: 'Core Processor i7',
    recommended_option_id: 'opt-expedite',
    recommended_option_kind: 'expedite',
    recommended_option_description: 'Expedite PO #PO-101 with premium freight delivery',
    quantity: 150,
    arrival_date: '2026-10-25',
    incremental_cost: '2400.00',
    cost_known: true,
    residual_unmet_before_next_inbound: 0,
    later_shortage_note: null,
    runner_up: null,
    scope_note: 'Resolves immediate window stockout before customer production runs.',
    why: [],
  },
  cost_comparison: {
    act: {
      cost: '2400.00',
      cost_known: true,
      residual_units_short: 0,
      affected_orders_count: 0,
      selling_value: '0.00',
    },
    do_nothing: {
      units_short: 150,
      affected_orders_count: 5,
      selling_value: '18500.00',
    },
    difference_sentence: 'Acting avoids 150 units of shortage across 5 customer orders.',
    exposure_disclaimer: 'Revenue exposure represents an upper bound assuming all affected customer orders are lost completely without recovery.',
  },
  exposure_totals: [],
  exposure_note: 'Assessment based on confirmed customer order backlog.',
  data_quality: {
    dataset_label: 'USER-SUPPLIED DATA (file import)',
    dataset_source: 'file-import',
    is_live: false,
    components_evaluated: 12,
    components_unknown_risk: 1,
    supplier_confidence_counts: {},
    top_risk_supplier_confidence: [],
    priority_component_demand_history_days: 60,
    flags: [],
    data_quality_note: 'Verified 12 components; 1 component has unknown risk due to absent demand history.',
  },
  assumptions: [
    'Daily demand rates projected from 60-day historical consumption.',
    'Lead times assumed fixed per supplier contractual agreements.',
  ],
  why: {},
  note: 'Decision support only.',
};

describe('ReportPage Component', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/executive-summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockExecutiveSummary),
        } as Response);
      }
      if (url.includes('/api/meta')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            seeded: true,
            data_source: 'file-import',
            label: 'USER-SUPPLIED DATA (file import)',
            display_currency: 'USD',
            display_currency_symbol: '$',
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all report sections from mocked data and asserts no savings text', async () => {
    render(
      <MemoryRouter>
        <MetaProvider>
          <ReportPage />
        </MetaProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('report-headline')).toBeInTheDocument();
    });

    // 1. Title and generation text
    expect(
      screen.getByText(/SupplyChain Sentinel AI — Executive Decision Support Report/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Decision support only\. No orders are created\./i).length).toBeGreaterThan(0);

    // 2. Dataset label and as of date
    expect(screen.getByTestId('report-dataset-label')).toHaveTextContent('USER-SUPPLIED DATA (file import)');
    expect(screen.getByText(/Snapshot As-Of Date: 2026-10-18/i)).toBeInTheDocument();

    // 3. Top risks
    expect(screen.getByText('CMP-CPU-001')).toBeInTheDocument();
    expect(screen.getByText('Core Processor i7')).toBeInTheDocument();

    // 4. Recommended action
    expect(screen.getByText(/Expedite PO #PO-101 with premium freight delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/Resolves immediate window stockout before customer production runs\./i)).toBeInTheDocument();

    // 5. Act vs Do nothing table with upper-bound wording
    const table = screen.getByTestId('report-comparison-table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText(/Revenue exposure represents an upper bound/i)).toBeInTheDocument();

    // CRITICAL REQUIREMENT: "savings" text must be absent
    const reportText = document.body.textContent || '';
    expect(reportText.toLowerCase()).not.toContain('savings');

    // 6. Data quality note and assumptions
    expect(
      screen.getByText(/Verified 12 components; 1 component has unknown risk/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Daily demand rates projected from 60-day historical consumption\./i)
    ).toBeInTheDocument();
  });

  it('calls window.print when Print / Save as PDF button is clicked', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <MetaProvider>
          <ReportPage />
        </MetaProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('print-report-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('print-report-button'));
    expect(printSpy).toHaveBeenCalledTimes(1);

    printSpy.mockRestore();
  });
});
