import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { OverviewPage } from './OverviewPage';
import type { PurchaseOrder } from '../api/types';

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
        <OverviewPage />
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
        <OverviewPage />
      </MetaProvider>
    );

    // Overdue count should strictly be 1 (only PO-OVERDUE-01)
    await waitFor(() => {
      expect(screen.getByTestId('count-overdue-pos')).toHaveTextContent('1');
    });

    // Total open POs should be 2 + 1 + 0 = 3
    expect(screen.getByTestId('count-open-pos')).toHaveTextContent('3');

    // Warning should appear because total (245) > 200
    expect(screen.getByTestId('overdue-truncated-warning')).toHaveTextContent(
      'Note: Evaluated across first 200 purchase orders (total in system: 245).'
    );

    // Upcoming list ordering & basis:
    // PO-FUTURE-01 (expected 2026-10-20, basis: promised) should precede PO-EST-FUTURE (expected 2026-10-24, basis: estimated)
    expect(screen.getByTestId('basis-PO-FUTURE-01')).toHaveTextContent('promised');
    expect(screen.getByTestId('basis-PO-EST-FUTURE')).toHaveTextContent('estimated');

    const rows = screen.getAllByRole('row');
    const rowTexts = rows.map((r) => r.textContent);
    const poFutureIndex = rowTexts.findIndex((t) => t?.includes('PO-FUTURE-01'));
    const poEstIndex = rowTexts.findIndex((t) => t?.includes('PO-EST-FUTURE'));
    expect(poFutureIndex).toBeLessThan(poEstIndex);
  });
});
