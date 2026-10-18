import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DataSourcesPage from './DataSourcesPage';

const mockHealth = {
  status: 'ok',
  app: 'SupplyChain Sentinel AI',
  version: '0.1.0',
  environment: 'development',
  data_source: 'demo',
  timestamp: '2026-10-17T12:00:00.000000+00:00',
};

const mockMeta = {
  seeded: true,
  data_source: 'demo',
  label: 'Demo Supply Chain Dataset',
  seed: 42,
  as_of: '2026-10-17',
  generator_version: '0.1.0',
  generated_at: '2026-10-17T12:00:00.000000+00:00',
  counts: {
    warehouses: 4,
    products: 3,
    components: 12,
    bom_lines: 15,
    suppliers: 8,
    supplier_components: 18,
    inventory_levels: 48,
    purchase_orders: 25,
    purchase_order_lines: 60,
    customer_orders: 120,
    demand_records: 1080,
    delivery_records: 300,
  },
  message: 'Dataset loaded successfully.',
};

const mockIntegrationStatus = {
  active_source: 'demo',
  is_live: false,
  label: 'Demo Supply Chain Dataset',
  entities_covered: ['plants', 'materials', 'stock', 'purchase_orders', 'suppliers'],
  entities_missing: ['demand_history', 'delivery_performance', 'multi_source_offers'],
  disclaimer:
    'No live SAP connection is configured. To connect a real SAP system you need: an SAP BTP or S/4HANA account with API access, credentials stored as environment secrets, and verification of the API field mapping.',
};

describe('Data Sources & Integration Status Page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading states initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<DataSourcesPage />);

    expect(screen.getByText('Data Sources & Integration Status')).toBeInTheDocument();
    expect(screen.getByTestId('health-loading')).toBeInTheDocument();
    expect(screen.getByTestId('meta-loading')).toBeInTheDocument();
  });

  it('renders success state with DEMO DATA badge, version, and every count from mocked meta', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockHealth,
        } as Response;
      }
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/integration-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockIntegrationStatus,
        } as Response;
      }
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<DataSourcesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('health-data')).toBeInTheDocument();
      expect(screen.getByTestId('dataset-meta')).toBeInTheDocument();
    });

    // DEMO DATA badge
    expect(screen.getByTestId('demo-badge')).toHaveTextContent('DEMO DATA');

    // Health details
    expect(screen.getByTestId('health-version')).toHaveTextContent('0.1.0');

    // Record counts table
    const countsTable = screen.getByTestId('record-counts-table');
    expect(countsTable).toBeInTheDocument();
    expect(within(countsTable).getByText('Warehouses')).toBeInTheDocument();
    expect(within(countsTable).getByText('4')).toBeInTheDocument();
    expect(within(countsTable).getByText('Products')).toBeInTheDocument();
    expect(within(countsTable).getByText('3')).toBeInTheDocument();
    expect(within(countsTable).getByText('Components')).toBeInTheDocument();
    expect(within(countsTable).getByText('12')).toBeInTheDocument();
    expect(within(countsTable).getByText('Bill of Materials (BOM) Lines')).toBeInTheDocument();
    expect(within(countsTable).getByText('15')).toBeInTheDocument();
    expect(within(countsTable).getByText('Suppliers')).toBeInTheDocument();
    expect(within(countsTable).getByText('8')).toBeInTheDocument();
    expect(within(countsTable).getByText('Supplier Component Offers')).toBeInTheDocument();
    expect(within(countsTable).getByText('18')).toBeInTheDocument();
    expect(within(countsTable).getByText('Inventory Levels')).toBeInTheDocument();
    expect(within(countsTable).getByText('48')).toBeInTheDocument();
    expect(within(countsTable).getByText('Purchase Orders')).toBeInTheDocument();
    expect(within(countsTable).getByText('25')).toBeInTheDocument();
    expect(within(countsTable).getByText('Purchase Order Lines')).toBeInTheDocument();
    expect(within(countsTable).getByText('60')).toBeInTheDocument();
    expect(within(countsTable).getByText('Customer Orders')).toBeInTheDocument();
    expect(within(countsTable).getByText('120')).toBeInTheDocument();
    expect(within(countsTable).getByText('Daily Demand Records')).toBeInTheDocument();
    expect(within(countsTable).getByText('1,080')).toBeInTheDocument();
    expect(within(countsTable).getByText('Historical Delivery Records')).toBeInTheDocument();
    expect(within(countsTable).getByText('300')).toBeInTheDocument();
  });

  it('renders unseeded state and displays seed command when meta.seeded is false', async () => {
    const unseededMeta = {
      seeded: false,
      data_source: 'demo',
      label: null,
      seed: null,
      as_of: null,
      generator_version: null,
      generated_at: null,
      counts: {},
      message: 'Database contains no data. Please run seed command.',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockHealth,
        } as Response;
      }
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => unseededMeta,
        } as Response;
      }
      if (urlStr.includes('/api/integration-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockIntegrationStatus,
        } as Response;
      }
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<DataSourcesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('unseeded-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Database Unseeded')).toBeInTheDocument();
    expect(screen.getByText('Database contains no data. Please run seed command.')).toBeInTheDocument();
    expect(screen.getByText('python -m app.cli seed')).toBeInTheDocument();
    expect(screen.queryByTestId('record-counts-table')).not.toBeInTheDocument();
  });

  it('displays meta error alert and allows Retry to successfully recover', async () => {
    let metaAttempts = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockHealth,
        } as Response;
      }
      if (urlStr.includes('/api/meta')) {
        metaAttempts++;
        if (metaAttempts === 1) {
          return {
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ detail: 'Database warming up' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/integration-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockIntegrationStatus,
        } as Response;
      }
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<DataSourcesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('meta-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Database warming up')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry dataset load/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('dataset-meta')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('meta-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('record-counts-table')).toBeInTheDocument();
  });

  it('health error does not hide the dataset section', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health')) {
        throw new TypeError('Network connection refused');
      }
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/integration-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockIntegrationStatus,
        } as Response;
      }
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<DataSourcesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('health-error')).toBeInTheDocument();
      expect(screen.getByTestId('dataset-meta')).toBeInTheDocument();
    });

    expect(screen.getByText(/Network connection refused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry health/i })).toBeInTheDocument();

    // Dataset section and record counts table are still rendered
    expect(screen.getByTestId('dataset-meta')).toBeInTheDocument();
    expect(screen.getByTestId('record-counts-table')).toBeInTheDocument();
  });

  it('displays demo connector and integration status for data_source "demo"', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockHealth,
        } as Response;
      }
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/integration-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockIntegrationStatus,
        } as Response;
      }
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<DataSourcesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('integration-status-section')).toBeInTheDocument();
    });

    const section = screen.getByTestId('integration-status-section');
    expect(within(section).getByText('demo')).toBeInTheDocument();
    expect(screen.getByText(/False — Standalone decision support environment/i)).toBeInTheDocument();
    expect(screen.getByTestId('sap-disclaimer-box')).toBeInTheDocument();
  });

  it('displays unverified integration and does not say live for unknown data source', async () => {
    const customMeta = {
      ...mockMeta,
      data_source: 'oracle_mock',
    };
    const customHealth = {
      ...mockHealth,
      data_source: 'oracle_mock',
    };
    const customIntegrationStatus = {
      ...mockIntegrationStatus,
      active_source: 'oracle_mock',
      label: 'Oracle Mock Adapter',
      is_live: false,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => customHealth,
        } as Response;
      }
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => customMeta,
        } as Response;
      }
      if (urlStr.includes('/api/integration-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => customIntegrationStatus,
        } as Response;
      }
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<DataSourcesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('integration-status-section')).toBeInTheDocument();
    });

    const customSection = screen.getByTestId('integration-status-section');
    expect(within(customSection).getByText('oracle_mock')).toBeInTheDocument();
    expect(screen.getByText(/False — Standalone decision support environment/i)).toBeInTheDocument();

    // Must NOT claim connection to SAP
    expect(screen.queryByText(/connected to SAP/i)).not.toBeInTheDocument();
  });

  it('renders SAP integration status card and mandatory disclaimer from endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockHealth,
        } as Response;
      }
      if (urlStr.includes('/api/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockMeta,
        } as Response;
      }
      if (urlStr.includes('/api/integration-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockIntegrationStatus,
        } as Response;
      }
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<DataSourcesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('integration-status-section')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/No live SAP connection is configured/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Plants')).toBeInTheDocument();
    expect(screen.getByText('Demand History')).toBeInTheDocument();
    expect(screen.queryByText(/connected to SAP/i)).not.toBeInTheDocument();
  });
});
