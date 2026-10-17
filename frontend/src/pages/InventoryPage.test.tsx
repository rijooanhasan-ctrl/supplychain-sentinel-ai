import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaProvider } from '../context/MetaContext';
import { InventoryPage } from './InventoryPage';
import type { InventoryItem } from '../api/types';

const mockMeta = {
  seeded: true,
  data_source: 'demo',
  label: 'DEMO DATA',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '1.0.0',
  generated_at: '2026-10-17T12:00:00+00:00',
  counts: { inventory_levels: 42 },
  message: 'Demo dataset active.',
};

describe('InventoryPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes usable stock and renders text badges for zero usable and deficit rows', async () => {
    const mockItems: InventoryItem[] = [
      {
        id: 1,
        component_id: 1,
        component_sku: 'CPU-X7',
        component_name: 'NovaCore X7 Processor',
        warehouse_id: 1,
        warehouse_code: 'WH-PLANT',
        warehouse_name: 'Austin Plant',
        on_hand: 520,
        reserved: 100,
        as_of_ts: '2026-10-17T12:00:00+00:00',
      },
      {
        id: 2,
        component_id: 2,
        component_sku: 'RAM-16GB',
        component_name: '16GB DDR5 Module',
        warehouse_id: 1,
        warehouse_code: 'WH-PLANT',
        warehouse_name: 'Austin Plant',
        on_hand: 50,
        reserved: 50,
        as_of_ts: '2026-10-17T12:00:00+00:00',
      },
      {
        id: 3,
        component_id: 3,
        component_sku: 'BAT-99WH',
        component_name: '99Wh Lithium Battery',
        warehouse_id: 2,
        warehouse_code: 'WH-REG-EAST',
        warehouse_name: 'East Distribution Hub',
        on_hand: 20,
        reserved: 35, // Deficit!
        as_of_ts: '2026-10-17T12:00:00+00:00',
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
      if (urlStr.includes('/api/components')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        } as Response;
      }
      if (urlStr.includes('/api/warehouses')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        } as Response;
      }
      if (urlStr.includes('/api/inventory')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: mockItems,
            total: 3,
            limit: 50,
            offset: 0,
          }),
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
        <InventoryPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('inventory-table')).toBeInTheDocument();
    });

    // Row 1: usable = 520 - 100 = 420
    expect(screen.getByTestId('usable-1')).toHaveTextContent('420');
    expect(screen.getByText('In Stock')).toBeInTheDocument();

    // Row 2: usable = 50 - 50 = 0 -> "No usable stock"
    expect(screen.getByTestId('usable-2')).toHaveTextContent('0');
    expect(screen.getByTestId('flag-2')).toHaveTextContent('No usable stock');

    // Row 3: reserved > on_hand (35 > 20) -> "Reserved exceeds on hand"
    expect(screen.getByTestId('flag-3')).toHaveTextContent('Reserved exceeds on hand');
  });

  it('filter change resets pagination offset to 0 and queries with filter parameter', async () => {
    let capturedInventoryUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/components')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 1, sku: 'CPU-X7', name: 'NovaCore X7' }],
            total: 1,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/warehouses')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        } as Response;
      }
      if (urlStr.includes('/api/inventory')) {
        capturedInventoryUrl = urlStr;
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
        <InventoryPage />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/filter by component/i)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/filter by component/i);
    fireEvent.change(select, { target: { value: '1' } });

    await waitFor(() => {
      expect(capturedInventoryUrl).toContain('component_id=1');
      expect(capturedInventoryUrl).toContain('offset=0');
    });
  });

  it('renders pagination range text and handles empty / error states with retry', async () => {
    let attempts = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/inventory')) {
        attempts++;
        if (attempts === 1) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Error',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ detail: 'Database locked' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 1,
                component_id: 1,
                component_sku: 'CPU-X7',
                component_name: 'Processor',
                warehouse_id: 1,
                warehouse_code: 'WH-01',
                warehouse_name: 'Plant',
                on_hand: 100,
                reserved: 10,
                as_of_ts: '2026-10-17T12:00:00+00:00',
              },
            ],
            total: 85,
            limit: 50,
            offset: 0,
          }),
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
        <InventoryPage />
      </MetaProvider>
    );

    // Initial error state
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Database locked')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    // After retry -> success with pagination
    await waitFor(() => {
      expect(screen.getByTestId('pagination-range')).toHaveTextContent('Showing 1–50 of 85');
    });
  });
});
