import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SupplierRiskPage } from './SupplierRiskPage';
import type {
  SupplierRiskListResponse,
  SupplierRiskDetailResponse,
  DatasetMetaResponse,
} from '../api/types';

const mockMeta: DatasetMetaResponse = {
  seeded: true,
  data_source: 'demo',
  as_of: '2026-10-17',
  label: 'Demo Dataset',
  seed: 42,
  generator_version: '0.1.0',
  generated_at: '2026-10-17T00:00:00Z',
  counts: { suppliers: 2, delivery_records: 50 },
  message: 'Demo dataset active.',
};

const mockSupplierRiskList: SupplierRiskListResponse = {
  seeded: true,
  as_of: '2026-10-17',
  summary: {
    counts_by_band: {
      high: 1,
      medium: 1,
      low: 0,
      unknown: 1,
    },
    total_suppliers: 3,
  },
  items: [
    {
      supplier_id: 1,
      supplier_code: 'SUP-HELIX',
      supplier_name: 'Helix Microelectronics',
      country: 'DE',
      n_deliveries: 40,
      risk_score: 68.2,
      risk_band: 'high',
      confidence: 'high',
      on_time_rate: 0.675,
      on_time_ci_lower: 0.52,
      on_time_ci_upper: 0.80,
      late_delivery_probability: 0.325,
      expected_delay_days_if_late: 4.5,
      avg_delay_days_all: 2.1,
      avg_delay_days_when_late: 4.5,
      rejection_rate: 0.015,
      fill_rate: 0.98,
      open_po_count: 2,
      open_pos_slipped_count: 1,
      open_pos_overdue_count: 0,
      open_remaining_qty: 400,
    },
    {
      supplier_id: 2,
      supplier_code: 'SUP-LUMEN',
      supplier_name: 'Lumen Photonics',
      country: 'US',
      n_deliveries: 35,
      risk_score: 12.4,
      risk_band: 'low',
      confidence: 'high',
      on_time_rate: 0.971,
      on_time_ci_lower: 0.85,
      on_time_ci_upper: 0.99,
      late_delivery_probability: 0.029,
      expected_delay_days_if_late: 1.0,
      avg_delay_days_all: 0.2,
      avg_delay_days_when_late: 1.0,
      rejection_rate: 0.001,
      fill_rate: 1.0,
      open_po_count: 1,
      open_pos_slipped_count: 0,
      open_pos_overdue_count: 0,
      open_remaining_qty: 200,
    },
    {
      supplier_id: 3,
      supplier_code: 'SUP-EMPTY',
      supplier_name: 'Empty Logistics',
      country: 'FR',
      n_deliveries: 0,
      risk_score: null,
      risk_band: 'unknown',
      confidence: 'none',
      on_time_rate: null,
      on_time_ci_lower: null,
      on_time_ci_upper: null,
      late_delivery_probability: null,
      expected_delay_days_if_late: null,
      avg_delay_days_all: null,
      avg_delay_days_when_late: null,
      rejection_rate: null,
      fill_rate: null,
      open_po_count: 0,
      open_pos_slipped_count: 0,
      open_pos_overdue_count: 0,
      open_remaining_qty: 0,
    },
  ],
  total: 3,
  limit: 50,
  offset: 0,
};

const mockDetailHelix: SupplierRiskDetailResponse = {
  ...mockSupplierRiskList.items[0],
  as_of: '2026-10-17',
  excluded_future_deliveries: 0,
  has_excluded_future_deliveries: false,
  p50_delay_days_when_late: 4.0,
  p90_delay_days_when_late: 8.0,
  max_delay_days: 9.0,
  total_ordered_qty: 4000,
  total_received_qty: 3950,
  total_rejected_qty: 60,
  metrics_breakdown: [
    {
      metric_name: 'on_time',
      raw_value: 0.675,
      penalty: 0.65,
      nominal_weight: 0.40,
      effective_weight: 0.40,
      contribution_points: 26.0,
      dropped: false,
      dropped_reason: null,
    },
    {
      metric_name: 'delay',
      raw_value: 2.1,
      penalty: 0.30,
      nominal_weight: 0.25,
      effective_weight: 0.25,
      contribution_points: 7.5,
      dropped: false,
      dropped_reason: null,
    },
    {
      metric_name: 'rejection',
      raw_value: 0.015,
      penalty: 0.30,
      nominal_weight: 0.20,
      effective_weight: 0.20,
      contribution_points: 6.0,
      dropped: false,
      dropped_reason: null,
    },
    {
      metric_name: 'fill',
      raw_value: 0.98,
      penalty: 0.10,
      nominal_weight: 0.15,
      effective_weight: 0.15,
      contribution_points: 1.5,
      dropped: false,
      dropped_reason: null,
    },
  ],
  nominal_weights: { on_time: 0.4, delay: 0.25, rejection: 0.2, fill: 0.15 },
  effective_weights: { on_time: 0.4, delay: 0.25, rejection: 0.2, fill: 0.15 },
  metrics_used: ['on_time', 'delay', 'rejection', 'fill'],
  metrics_dropped: [],
  thresholds_used: {
    lookback_days: 365,
    on_time_grace_days: 0,
    w_on_time: 0.4,
    w_delay: 0.25,
    w_rejection: 0.2,
    w_fill: 0.15,
    late_rate_full_penalty: 0.5,
    delay_full_penalty_days: 7.0,
    rejection_full_penalty: 0.05,
    fill_shortfall_full_penalty: 0.2,
    band_medium: 25.0,
    band_high: 50.0,
    low_confidence_below: 10,
    high_confidence_from: 30,
  },
  monthly_breakdown: [
    { month: '2026-10', n_deliveries: 4, on_time_rate: 0.75 },
    { month: '2026-09', n_deliveries: 5, on_time_rate: 0.60 },
  ],
  main_drivers: ['on_time (26.0 pts)', 'delay (7.5 pts)'],
  explanation: 'Supplier SUP-HELIX evaluated over 40 deliveries. High risk band with 68.2 points.',
  assumptions: [
    'Score is descriptive and does not predict individual deliveries.',
  ],
};

describe('SupplierRiskPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders rows, handles null score with "—", and shows text risk badges', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/supplier-risk')) {
        return { ok: true, status: 200, json: async () => mockSupplierRiskList } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MemoryRouter>
        <SupplierRiskPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('supplier-row-SUP-HELIX')).toBeInTheDocument();
      expect(screen.getByTestId('supplier-row-SUP-LUMEN')).toBeInTheDocument();
      expect(screen.getByTestId('supplier-row-SUP-EMPTY')).toBeInTheDocument();
    });

    // Check banner text
    expect(
      screen.getByText(/Score = transparent weighted formula/i)
    ).toBeInTheDocument();

    // Check null score displays "—"
    const emptyRow = screen.getByTestId('supplier-row-SUP-EMPTY');
    expect(emptyRow).toHaveTextContent('—');

    // Check text badges
    expect(screen.getByTestId('supplier-band-high')).toHaveTextContent('High Risk');
    expect(screen.getByTestId('supplier-band-unknown')).toHaveTextContent('Unknown');
    expect(screen.getAllByTestId('supplier-confidence-high')[0]).toHaveTextContent('HIGH CONFIDENCE');
    expect(screen.getByTestId('supplier-confidence-none')).toHaveTextContent('NONE CONFIDENCE');
  });

  it('filters send correct query parameters and reset offset to 0', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/supplier-risk')) {
        return { ok: true, status: 200, json: async () => mockSupplierRiskList } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MemoryRouter>
        <SupplierRiskPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('filter-band')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('filter-band'), {
      target: { value: 'high' },
    });

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0].toString();
      expect(lastCall).toContain('band=high');
      expect(lastCall).toContain('offset=0');
    });

    fireEvent.change(screen.getByTestId('filter-country'), {
      target: { value: 'DE' },
    });

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0].toString();
      expect(lastCall).toContain('country=DE');
      expect(lastCall).toContain('offset=0');
    });
  });

  it('row expansion toggles and renders explanation, breakdown table, and monthly trends', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/supplier-risk/1')) {
        return { ok: true, status: 200, json: async () => mockDetailHelix } as Response;
      }
      if (urlStr.includes('/api/supplier-risk')) {
        return { ok: true, status: 200, json: async () => mockSupplierRiskList } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MemoryRouter>
        <SupplierRiskPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('toggle-supplier-SUP-HELIX')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('toggle-supplier-SUP-HELIX');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    await waitFor(() => {
      expect(screen.getByTestId('supplier-detail-panel-1')).toBeInTheDocument();
      expect(screen.getByTestId('supplier-explanation-1')).toHaveTextContent(
        'Supplier SUP-HELIX evaluated over 40 deliveries.'
      );
      expect(screen.getByTestId('breakdown-table-1')).toBeInTheDocument();
      expect(screen.getByTestId('monthly-table-1')).toBeInTheDocument();
    });

    // Close expansion
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('supplier-detail-panel-1')).not.toBeInTheDocument();
  });

  it('handles empty state and error retry state gracefully', async () => {
    let shouldFail = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/supplier-risk')) {
        if (shouldFail) {
          return { ok: false, status: 500, json: async () => ({ detail: 'Server error' }) } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...mockSupplierRiskList, items: [], total: 0 }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MemoryRouter>
        <SupplierRiskPage />
      </MemoryRouter>
    );

    // Initial failure
    await waitFor(() => {
      expect(screen.getByText(/Failed to evaluate supplier risk/i)).toBeInTheDocument();
    });

    // Retry recovery
    shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.getByText(/No suppliers match criteria/i)).toBeInTheDocument();
    });
  });

  it('renders UnseededView when database is unseeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => ({ seeded: false }) } as Response;
      }
      if (urlStr.includes('/api/supplier-risk')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ seeded: false, items: [], total: 0, summary: { counts_by_band: {} } }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(
      <MemoryRouter>
        <SupplierRiskPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Database Unseeded/i)).toBeInTheDocument();
    });
  });
});
