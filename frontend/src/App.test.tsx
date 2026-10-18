import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './app/AppLayout';
import { MetaProvider } from './context/MetaContext';
import { OverviewPage } from './pages/OverviewPage';
import { InventoryPage } from './pages/InventoryPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { DataSourcesPage } from './pages/DataSourcesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { InventoryRiskPage } from './pages/InventoryRiskPage';
import { AlertsPage } from './pages/AlertsPage';
import { Route, Routes } from 'react-router-dom';

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

function renderWithRouter(initialEntry: string) {
  return render(
    <MetaProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="inventory-risk" element={<InventoryRiskPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="data-sources" element={<DataSourcesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MetaProvider>
  );
}

describe('App Layout & Routing Shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders DEMO DATA banner with as-of date when meta is demo', async () => {
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

    renderWithRouter('/');

    await waitFor(() => {
      expect(screen.getByTestId('demo-banner')).toBeInTheDocument();
    });

    expect(screen.getByTestId('demo-badge')).toHaveTextContent('DEMO DATA');
    expect(screen.getByTestId('as-of-badge')).toHaveTextContent('2026-10-17');
  });

  it('renders Overview route and highlights active nav link with aria-current="page"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockMeta,
    } as Response);

    renderWithRouter('/');

    await waitFor(() => {
      expect(screen.getByTestId('overview-page')).toBeInTheDocument();
    });

    const overviewLink = screen.getByRole('link', { name: 'Overview' });
    expect(overviewLink).toHaveAttribute('aria-current', 'page');

    const inventoryLink = screen.getByRole('link', { name: 'Inventory' });
    expect(inventoryLink).not.toHaveAttribute('aria-current');
  });

  it('navigates to /inventory and marks inventory link as active', async () => {
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

    renderWithRouter('/inventory');

    await waitFor(() => {
      expect(screen.getByTestId('inventory-page')).toBeInTheDocument();
    });

    const inventoryLink = screen.getByRole('link', { name: 'Inventory' });
    expect(inventoryLink).toHaveAttribute('aria-current', 'page');
  });

  it('navigates to /alerts and marks alerts link as active', async () => {
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
        json: async () => ({
          seeded: true,
          as_of: '2026-10-17',
          summary: {
            counts_by_severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
            counts_by_type: {},
            total_alerts: 0,
          },
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        }),
      } as Response;
    });

    renderWithRouter('/alerts');

    await waitFor(() => {
      const alertsLink = screen.getByRole('link', { name: 'Alerts' });
      expect(alertsLink).toHaveAttribute('aria-current', 'page');
    });
  });

  it('navigates to /inventory-risk and marks inventory-risk link as active', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/inventory-risk')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            as_of: '2026-10-17',
            model: { name: 'weekday_average', type: 'heuristic_baseline', description: 'test' },
            config: { lookback_days: 28, horizon_days: 60, critical_days: 7, high_days: 14, medium_days: 30 },
            summary: { counts_by_risk_level: { critical: 0, high: 0, medium: 0, low: 0, none: 0, unknown: 0 }, components_evaluated: 0 },
            items: [],
            total: 0,
            limit: 50,
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

    renderWithRouter('/inventory-risk');

    await waitFor(() => {
      expect(screen.getByTestId('inventory-risk-page')).toBeInTheDocument();
    });

    const riskLink = screen.getByRole('link', { name: 'Inventory Risk' });
    expect(riskLink).toHaveAttribute('aria-current', 'page');
  });

  it('navigates to /suppliers and renders SuppliersPage', async () => {
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

    renderWithRouter('/suppliers');

    await waitFor(() => {
      expect(screen.getByTestId('suppliers-page')).toBeInTheDocument();
    });
  });

  it('navigates to /purchase-orders and renders PurchaseOrdersPage', async () => {
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

    renderWithRouter('/purchase-orders');

    await waitFor(() => {
      expect(screen.getByTestId('purchase-orders-page')).toBeInTheDocument();
    });
  });

  it('navigates to /data-sources and renders DataSourcesPage', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'ok',
            app: 'SupplyChain Sentinel AI',
            version: '0.1.0',
            environment: 'development',
            data_source: 'demo',
            timestamp: '2026-10-17T12:00:00+00:00',
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
      } as Response;
    });

    renderWithRouter('/data-sources');

    await waitFor(() => {
      expect(screen.getByTestId('data-sources-page')).toBeInTheDocument();
    });
  });

  it('renders NotFoundPage on unknown route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockMeta,
    } as Response);

    renderWithRouter('/unknown/non-existent-path');

    await waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    });

    expect(screen.getByText('404 — Page Not Found')).toBeInTheDocument();
  });

  it('renders unseeded state on data pages when meta.seeded is false', async () => {
    const unseededMeta = {
      seeded: false,
      data_source: 'demo',
      label: null,
      seed: null,
      as_of: null,
      generator_version: null,
      generated_at: null,
      counts: {},
      message: 'Database is unseeded. Run seed command.',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => unseededMeta,
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
      } as Response;
    });

    renderWithRouter('/inventory');

    await waitFor(() => {
      expect(screen.getByTestId('unseeded-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Database Unseeded')).toBeInTheDocument();
    expect(screen.getByText('python -m app.cli seed')).toBeInTheDocument();
  });
});
