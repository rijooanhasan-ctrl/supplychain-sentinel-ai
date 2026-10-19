import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MetaProvider } from '../context/MetaContext';
import { OverviewPage } from './OverviewPage';
import { AppLayout } from '../app/AppLayout';

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
    purchase_orders: 22,
  },
  message: 'Demo dataset active.',
};

describe('OverviewPage Modular Blocks & Resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks fail independently: when one endpoint fails, others still render with individual Retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/executive-summary')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            headline: 'Active critical shortage on CPU-X7 requires action',
            top_risks: [],
            priority_decision: null,
            cost_comparison: null,
            data_quality: null,
            as_of: '2026-10-17',
            seeded: true,
          }),
        } as Response;
      }
      // Simulate supplier-risk failing with 500
      if (urlStr.includes('/api/supplier-risk')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: 'Supplier scoring service unavailable' }),
        } as Response;
      }
      // Other endpoints succeed
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0 }),
      } as Response;
    });

    render(
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    // Headline strip succeeded
    await waitFor(() => {
      expect(screen.getByText('Active critical shortage on CPU-X7 requires action')).toBeInTheDocument();
    });

    let cardError: HTMLElement | null = null;
    await waitFor(() => {
      cardError = screen.getByTestId('overview-supplier-reliability-card-error');
      expect(cardError).toBeInTheDocument();
    });
    expect(cardError).not.toBeNull();
    const retryBtn = cardError!.querySelector('button');
    expect(retryBtn).toHaveTextContent(/retry/i);

    // Other cards still rendered normally
    expect(screen.getByTestId('overview-risk-mix-card')).toBeInTheDocument();
    expect(screen.getByTestId('overview-runway-card')).toBeInTheDocument();
  });

  it('renders calm no-risk state when headline indicates zero components at risk', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/meta')) {
        return { ok: true, status: 200, json: async () => mockMeta } as Response;
      }
      if (urlStr.includes('/api/executive-summary')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            headline: 'No components currently at risk across the planning horizon.',
            top_risks: [],
            priority_decision: null,
            cost_comparison: null,
            data_quality: null,
            as_of: '2026-10-17',
            seeded: true,
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
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText('No components currently at risk across the planning horizon.')
      ).toBeInTheDocument();
    });
  });

  it('toggles "How to read this page" guidance with aria-expanded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockMeta,
    } as Response);

    render(
      <MemoryRouter>
        <MetaProvider>
          <OverviewPage />
        </MetaProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show guidance/i })).toBeInTheDocument();
    });

    const toggleBtn = screen.getByRole('button', { name: /show guidance/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    // Expand
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/runway chart \(stock duration\)/i)).toBeInTheDocument();

    // Collapse
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders grouped sidebar navigation in AppLayout with section headings', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockMeta,
    } as Response);

    render(
      <MemoryRouter initialEntries={['/']}>
        <MetaProvider>
          <AppLayout />
        </MetaProvider>
      </MemoryRouter>
    );

    // Section headings
    expect(screen.getByText('Start here')).toBeInTheDocument();
    expect(screen.getByText('Act')).toBeInTheDocument();
    expect(screen.getByText('Analyse')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();

    // Overview link active
    const overviewLink = screen.getByRole('link', { name: 'Overview' });
    expect(overviewLink).toHaveAttribute('aria-current', 'page');
  });
});
