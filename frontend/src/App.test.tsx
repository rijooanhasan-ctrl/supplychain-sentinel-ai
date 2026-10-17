import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';

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

describe('Data Sources & Integration Status Page (App)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading states initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByText('SupplyChain Sentinel AI')).toBeInTheDocument();
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
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('health-data')).toBeInTheDocument();
      expect(screen.getByTestId('dataset-meta')).toBeInTheDocument();
    });

    // DEMO DATA badge
    expect(screen.getByTestId('demo-badge')).toHaveTextContent('DEMO DATA');

    // Health details
    expect(screen.getByTestId('health-version')).toHaveTextContent('0.1.0');

    // Record counts table
    expect(screen.getByTestId('record-counts-table')).toBeInTheDocument();
    expect(screen.getByText('Warehouses')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Components')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Bill of Materials (BOM) Lines')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('Suppliers')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Supplier Component Offers')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Inventory Levels')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('Purchase Orders')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Purchase Order Lines')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('Customer Orders')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Daily Demand Records')).toBeInTheDocument();
    expect(screen.getByText('1,080')).toBeInTheDocument();
    expect(screen.getByText('Historical Delivery Records')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
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
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<App />);

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
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<App />);

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
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<App />);

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

  it('displays demo connector and not configured for data_source "demo"', async () => {
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
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Demo connector — synthetic data, not a live SAP integration/i)).toBeInTheDocument();
      expect(screen.getByText(/SAP connection: not configured/i)).toBeInTheDocument();
    });
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
      throw new Error(`Unhandled URL: ${urlStr}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/oracle_mock \(unverified integration\)/i)).toBeInTheDocument();
      expect(screen.getByText(/SAP connection: unverified integration/i)).toBeInTheDocument();
    });

    // Must NOT claim live connection
    expect(screen.queryByText(/\blive\b/i)).not.toBeInTheDocument();
  });
});
