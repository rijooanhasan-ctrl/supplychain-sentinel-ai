import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';

describe('App Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByText('SupplyChain Sentinel AI')).toBeInTheDocument();
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(screen.getByText('Connecting to backend service...')).toBeInTheDocument();
  });

  it('renders success state with a mocked fetch and displays DEMO DATA badge', async () => {
    const mockHealth = {
      status: 'ok',
      app: 'SupplyChain Sentinel AI',
      version: '0.1.0',
      environment: 'development',
      data_source: 'demo',
      timestamp: '2026-10-17T12:00:00.000000+00:00',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockHealth,
    } as Response);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('success-state')).toBeInTheDocument();
    });

    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(screen.getByTestId('demo-badge')).toHaveTextContent('DEMO DATA');
    expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Backend connection refused'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Backend Connection Error')).toBeInTheDocument();
    expect(screen.getByText('Backend connection refused')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('success-state')).not.toBeInTheDocument();
  });
});
