import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import type { PurchaseOrder, PurchaseOrderDetail } from '../api/types';

const mockMeta = {
  seeded: true,
  data_source: 'demo',
  label: 'DEMO DATA',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '1.0.0',
  generated_at: '2026-10-17T12:00:00+00:00',
  counts: { purchase_orders: 22 },
  message: 'Demo dataset active.',
};

describe('PurchaseOrdersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders purchase orders, timing labels, and "None provided" for null estimate', async () => {
    const pos: PurchaseOrder[] = [
      {
        id: 1,
        po_number: 'PO-OD-01',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex Silicon',
        status: 'open',
        order_date: '2026-10-01',
        promised_date: '2026-10-12', // 5 days overdue relative to 2026-10-17
        latest_estimate_date: null,
      },
      {
        id: 2,
        po_number: 'PO-TODAY',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex Silicon',
        status: 'in_transit',
        order_date: '2026-10-01',
        promised_date: '2026-10-17', // due today
        latest_estimate_date: null,
      },
      {
        id: 3,
        po_number: 'PO-FUTURE',
        supplier_id: 2,
        supplier_code: 'SUP-02',
        supplier_name: 'Kyoto Optics',
        status: 'partially_received',
        order_date: '2026-10-01',
        promised_date: '2026-10-25', // due in 8 days
        latest_estimate_date: '2026-10-27', // due in 10 days with estimate!
      },
      {
        id: 4,
        po_number: 'PO-DONE',
        supplier_id: 2,
        supplier_code: 'SUP-02',
        supplier_name: 'Kyoto Optics',
        status: 'received',
        order_date: '2026-09-15',
        promised_date: '2026-10-01',
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
      if (urlStr.includes('/api/suppliers')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        } as Response;
      }
      if (urlStr.includes('/api/purchase-orders')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: pos, total: 4, limit: 50, offset: 0 }),
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
        <PurchaseOrdersPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('pos-table')).toBeInTheDocument();
    });

    // Timing labels check
    expect(screen.getByTestId('timing-PO-OD-01')).toHaveTextContent('Overdue by 5 days');
    expect(screen.getByTestId('timing-PO-TODAY')).toHaveTextContent('Due today');
    expect(screen.getByTestId('timing-PO-FUTURE')).toHaveTextContent('Due in 10 days'); // Uses latest_estimate_date (27th)
    expect(screen.getByTestId('timing-PO-DONE')).toHaveTextContent('—');

    // Slipped vs promise secondary text check
    expect(screen.getByTestId('slipped-PO-FUTURE')).toHaveTextContent('Slipped 2 days vs promise (promised 2026-10-25)');

    // "None provided" for null estimate
    expect(screen.getAllByText('None provided').length).toBeGreaterThanOrEqual(1);
  });

  it('renders PO-OVERDUE-01-like data with Due in 3 days and Slipped 7 days vs promise', async () => {
    const poOverdue01: PurchaseOrder = {
      id: 99,
      po_number: 'PO-OVERDUE-01',
      supplier_id: 1,
      supplier_code: 'SUP-01',
      supplier_name: 'Apex Silicon',
      status: 'in_transit',
      order_date: '2026-09-25',
      promised_date: '2026-10-13',
      latest_estimate_date: '2026-10-20',
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
      if (urlStr.includes('/api/suppliers')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        } as Response;
      }
      if (urlStr.includes('/api/purchase-orders')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [poOverdue01], total: 1, limit: 50, offset: 0 }),
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
        <PurchaseOrdersPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('pos-table')).toBeInTheDocument();
    });

    const timingCell = screen.getByTestId('timing-PO-OVERDUE-01');
    expect(timingCell).toHaveTextContent('Due in 3 days');
    expect(screen.getByTestId('slipped-PO-OVERDUE-01')).toHaveTextContent(
      'Slipped 7 days vs promise (promised 2026-10-13)'
    );
  });

  it('status filter sends the right param and resets offset to 0', async () => {
    let capturedPoUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/suppliers')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        } as Response;
      }
      if (urlStr.includes('/api/purchase-orders')) {
        capturedPoUrl = urlStr;
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
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
        <PurchaseOrdersPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/status:/i)).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText(/status:/i);
    fireEvent.change(statusSelect, { target: { value: 'in_transit' } });

    await waitFor(() => {
      expect(capturedPoUrl).toContain('status=in_transit');
      expect(capturedPoUrl).toContain('offset=0');
    });
  });

  it('row expansion toggles and renders lines with remaining quantity', async () => {
    const po: PurchaseOrder = {
      id: 10,
      po_number: 'PO-EXPAND-10',
      supplier_id: 1,
      supplier_code: 'SUP-01',
      supplier_name: 'Apex Silicon',
      status: 'partially_received',
      order_date: '2026-10-01',
      promised_date: '2026-10-25',
      latest_estimate_date: null,
    };

    const poDetail: PurchaseOrderDetail = {
      ...po,
      lines: [
        {
          id: 101,
          component_id: 1,
          component_sku: 'CPU-X7',
          component_name: 'Processor X7',
          warehouse_id: 1,
          warehouse_code: 'WH-PLANT',
          warehouse_name: 'Austin Plant',
          qty_ordered: 500,
          qty_received: 200, // Remaining should be 300
          unit_price: '250.00',
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
      if (urlStr.includes('/api/purchase-orders/10')) {
        return {
          ok: true,
          status: 200,
          json: async () => poDetail,
        } as Response;
      }
      if (urlStr.includes('/api/purchase-orders')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [po], total: 1, limit: 50, offset: 0 }),
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
        <PurchaseOrdersPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('toggle-po-10')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('toggle-po-10');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    await waitFor(() => {
      expect(screen.getByTestId('lines-table-10')).toBeInTheDocument();
    });

    // Remaining qty = 500 - 200 = 300
    expect(screen.getByTestId('remaining-101')).toHaveTextContent('300');
    expect(screen.getByText('$250.00')).toBeInTheDocument();
  });

  it('displays INR notice, changes header to Unit Price (INR), and formats line prices in ₹ without $ when display_currency is INR', async () => {
    const inrMeta = {
      ...mockMeta,
      display_currency: 'INR',
      usd_to_inr_rate: '83.50',
    };

    const po: PurchaseOrder = {
      id: 10,
      po_number: 'PO-EXPAND',
      supplier_id: 1,
      supplier_code: 'SUP-01',
      supplier_name: 'Apex Silicon',
      status: 'in_transit',
      order_date: '2026-10-01',
      promised_date: '2026-10-20',
      latest_estimate_date: null,
    };

    const poDetail: PurchaseOrderDetail = {
      ...po,
      lines: [
        {
          id: 101,
          component_id: 1,
          component_sku: 'CPU-X7',
          component_name: 'NovaCore X7 Processor',
          warehouse_id: 1,
          warehouse_code: 'WH-PLANT',
          warehouse_name: 'Austin Plant',
          qty_ordered: 500,
          qty_received: 200,
          unit_price: '250.00',
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
      if (urlStr.includes('/api/purchase-orders/10')) {
        return {
          ok: true,
          status: 200,
          json: async () => poDetail,
        } as Response;
      }
      if (urlStr.includes('/api/purchase-orders')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [po], total: 1, limit: 50, offset: 0 }),
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
        <PurchaseOrdersPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('currency-notice')).toBeInTheDocument();
    });

    expect(screen.getByTestId('currency-notice')).toHaveTextContent(
      'Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹83.50'
    );

    const toggleBtn = screen.getByTestId('toggle-po-10');
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByTestId('lines-table-10')).toBeInTheDocument();
    });

    expect(screen.getByText('Unit Price (INR)')).toBeInTheDocument();
    expect(screen.getByText('₹20,875.00')).toBeInTheDocument();
    expect(screen.queryByText('$250.00')).not.toBeInTheDocument();
  });
});
