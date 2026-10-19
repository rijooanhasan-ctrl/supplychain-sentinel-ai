import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { SuppliersPage } from './SuppliersPage';
import type { Supplier, SupplierDetail } from '../api/types';

const mockMeta = {
  seeded: true,
  data_source: 'demo',
  label: 'DEMO DATA',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '1.0.0',
  generated_at: '2026-10-17T12:00:00+00:00',
  counts: { suppliers: 8 },
  message: 'Demo dataset active.',
};

describe('SuppliersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders suppliers table and toggles row expansion with aria-expanded', async () => {
    const suppliers: Supplier[] = [
      { id: 1, code: 'SUP-01', name: 'Apex Silicon Global', country: 'United States' },
      { id: 2, code: 'SUP-02', name: 'Kyoto Optics Ltd', country: 'Japan' },
    ];

    const supplierDetail: SupplierDetail = {
      ...suppliers[0],
      offers: [
        {
          id: 101,
          component_id: 1,
          component_sku: 'CPU-X7',
          component_name: 'NovaCore X7',
          unit_cost: '250.00',
          lead_time_days: 14,
          min_order_qty: 100,
          max_weekly_capacity: null, // Test null capacity -> "Unknown"
          is_preferred: true,
          expedite_available: false, // Test expedite false -> "Not available"
          expedite_lead_time_days: null,
          expedite_cost_premium_pct: null,
        },
        {
          id: 102,
          component_id: 2,
          component_sku: 'RAM-16GB',
          component_name: '16GB DDR5',
          unit_cost: '180.50',
          lead_time_days: 20,
          min_order_qty: 50,
          max_weekly_capacity: 5000,
          is_preferred: false,
          expedite_available: true,
          expedite_lead_time_days: null, // Test null expedite lead time -> never render number
          expedite_cost_premium_pct: '0.2500',
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/suppliers/1')) {
        return {
          ok: true,
          status: 200,
          json: async () => supplierDetail,
        } as Response;
      }
      if (urlStr.includes('/api/suppliers')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: suppliers, total: 2, limit: 50, offset: 0 }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0 }),
      } as Response;
    });

    render(
      <MetaProvider>
        <SuppliersPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('suppliers-table')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('toggle-supplier-1');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    // Expand
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    // Offers load
    await waitFor(() => {
      expect(screen.getByTestId('offers-table-1')).toBeInTheDocument();
    });

    // Null capacity must render as "Unknown", never 0
    expect(screen.getByTestId('capacity-101')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('capacity-102')).toHaveTextContent('5,000');

    // Expedite false must render "Not available"
    expect(screen.getByTestId('expedite-101')).toHaveTextContent('Not available');

    // Null expedite lead time must NOT render as 0
    expect(screen.getByTestId('expedite-102')).toHaveTextContent('Unknown lead time');
    expect(screen.getByTestId('expedite-102')).toHaveTextContent('+25%');

    // Collapse
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('displays INR notice, changes header to Unit Cost (INR), and formats offer unit costs in ₹ without $ when display_currency is INR', async () => {
    const inrMeta = {
      ...mockMeta,
      display_currency: 'INR',
      usd_to_inr_rate: '83.50',
    };

    const suppliers: Supplier[] = [
      { id: 1, code: 'SUP-01', name: 'Apex Silicon Global', country: 'United States' },
    ];

    const supplierDetail: SupplierDetail = {
      ...suppliers[0],
      offers: [
        {
          id: 101,
          component_id: 1,
          component_sku: 'CPU-X7',
          component_name: 'NovaCore X7',
          unit_cost: '250.00',
          lead_time_days: 14,
          min_order_qty: 100,
          max_weekly_capacity: 5000,
          is_preferred: true,
          expedite_available: false,
          expedite_lead_time_days: null,
          expedite_cost_premium_pct: null,
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => inrMeta,
        } as Response;
      }
      if (urlStr.includes('/api/suppliers/1')) {
        return {
          ok: true,
          status: 200,
          json: async () => supplierDetail,
        } as Response;
      }
      if (urlStr.includes('/api/suppliers')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: suppliers, total: 1, limit: 50, offset: 0 }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0 }),
      } as Response;
    });

    render(
      <MetaProvider>
        <SuppliersPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('currency-notice')).toBeInTheDocument();
    });

    expect(screen.getByTestId('currency-notice')).toHaveTextContent(
      'Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹83.50'
    );

    const toggleBtn = screen.getByTestId('toggle-supplier-1');
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByTestId('offers-table-1')).toBeInTheDocument();
    });

    expect(screen.getByText('Unit Cost (INR)')).toBeInTheDocument();
    expect(screen.getByText('₹20,875.00')).toBeInTheDocument();
    expect(screen.queryByText('$250.00')).not.toBeInTheDocument();
  });
});
