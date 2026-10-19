import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GuidedDemoProvider } from '../context/GuidedDemoContext';
import { GuidedDemoPanel } from './GuidedDemoPanel';
import { useGuidedDemo } from '../hooks/useGuidedDemo';
import { DemoBanner } from './DemoBanner';
import { MetaProvider } from '../context/MetaContext';

const mockExecutiveSummaryWithRisks = {
  seeded: true,
  as_of: '2026-10-18',
  label: 'USER-SUPPLIED DATA (file import)',
  headline: 'Supply chain risk detected for critical component.',
  top_risks: [
    {
      component_id: 42,
      component_sku: 'CMP-TEST-42',
      component_name: 'Super Controller',
      shortage_date: '2026-10-28',
      days_until_impact: 10,
      units_short_before_next_inbound: 85,
      reason: 'Supplier delivery delay',
    },
  ],
  priority_decision: {
    component_id: 42,
    component_sku: 'CMP-TEST-42',
    component_name: 'Super Controller',
    recommended_option_description: 'Expedite primary order',
    scope_note: 'Immediate 14-day stockout prevention',
  },
};

const mockExecutiveSummaryNoRisks = {
  seeded: true,
  as_of: '2026-10-18',
  label: 'USER-SUPPLIED DATA (file import)',
  headline: 'All components stable.',
  top_risks: [],
  priority_decision: null,
};

function TestConsumer() {
  const { startDemo } = useGuidedDemo();
  const location = useLocation();
  return (
    <div>
      <span data-testid="current-pathname">{location.pathname}</span>
      <span data-testid="current-search">{location.search}</span>
      <button onClick={startDemo} data-testid="trigger-start-demo">
        Start
      </button>
      <GuidedDemoPanel />
    </div>
  );
}

describe('Guided Demo Mode & Dynamic Labels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/executive-summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockExecutiveSummaryWithRisks),
        } as Response);
      }
      if (url.includes('/api/meta')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            seeded: true,
            data_source: 'file-import',
            label: 'USER-SUPPLIED DATA (file import)',
            as_of: '2026-10-18',
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens panel, advances through 5 steps, routes properly, uses API data, and has aria attributes', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuidedDemoProvider>
          <TestConsumer />
        </GuidedDemoProvider>
      </MemoryRouter>
    );

    // Initial state: panel is not in DOM
    expect(screen.queryByTestId('guided-demo-panel')).not.toBeInTheDocument();

    // Trigger start demo
    fireEvent.click(screen.getByTestId('trigger-start-demo'));

    // Panel is opened
    await waitFor(() => {
      expect(screen.getByTestId('guided-demo-panel')).toBeInTheDocument();
    });

    // Check accessibility attributes
    const panel = screen.getByRole('dialog', { name: /guided demo/i });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('aria-modal', 'false');

    // Step 1: Executive Summary
    expect(screen.getByTestId('guided-demo-step-counter')).toHaveTextContent('1/5');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent('/executive-summary');
    expect(screen.getByTestId('guided-demo-instruction')).toHaveTextContent('CMP-TEST-42');
    expect(screen.getByTestId('guided-demo-instruction')).toHaveTextContent('85 units short');

    // Step 2: Next -> Alerts
    fireEvent.click(screen.getByTestId('guided-demo-next'));
    expect(screen.getByTestId('guided-demo-step-counter')).toHaveTextContent('2/5');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent('/alerts');
    expect(screen.getByTestId('guided-demo-instruction')).toHaveTextContent('Supplier delivery delay');

    // Step 3: Next -> Supplier delay what-if
    fireEvent.click(screen.getByTestId('guided-demo-next'));
    expect(screen.getByTestId('guided-demo-step-counter')).toHaveTextContent('3/5');
    expect(screen.getByTestId('guided-demo-instruction')).toHaveTextContent('CMP-TEST-42');

    // Step 4: Next -> Recommendations
    fireEvent.click(screen.getByTestId('guided-demo-next'));
    expect(screen.getByTestId('guided-demo-step-counter')).toHaveTextContent('4/5');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent('/recommendations');
    expect(screen.getByTestId('guided-demo-instruction')).toHaveTextContent('Expedite primary order');

    // Step 5: Next -> Simulator with component_id=42
    fireEvent.click(screen.getByTestId('guided-demo-next'));
    expect(screen.getByTestId('guided-demo-step-counter')).toHaveTextContent('5/5');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent('/simulator');
    expect(screen.getByTestId('current-search')).toHaveTextContent('component_id=42');

    // Back button works
    fireEvent.click(screen.getByTestId('guided-demo-back'));
    expect(screen.getByTestId('guided-demo-step-counter')).toHaveTextContent('4/5');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent('/recommendations');

    // Exit demo button closes panel
    fireEvent.click(screen.getByTestId('guided-demo-exit'));
    expect(screen.queryByTestId('guided-demo-panel')).not.toBeInTheDocument();
  });

  it('closes demo panel when Escape key is pressed', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuidedDemoProvider>
          <TestConsumer />
        </GuidedDemoProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('trigger-start-demo'));
    await waitFor(() => {
      expect(screen.getByTestId('guided-demo-panel')).toBeInTheDocument();
    });

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('guided-demo-panel')).not.toBeInTheDocument();
  });

  it('handles zero-risk dataset with No components currently at risk message and simulator option', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/executive-summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockExecutiveSummaryNoRisks),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    }));

    render(
      <MemoryRouter initialEntries={['/']}>
        <GuidedDemoProvider>
          <TestConsumer />
        </GuidedDemoProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('trigger-start-demo'));
    await waitFor(() => {
      expect(screen.getByTestId('guided-demo-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('guided-demo-instruction')).toHaveTextContent('No components currently at risk');
    expect(screen.getByTestId('guided-demo-no-risk-simulator-btn')).toBeInTheDocument();

    // Clicking shortcut jumps to simulator
    fireEvent.click(screen.getByTestId('guided-demo-no-risk-simulator-btn'));
    expect(screen.getByTestId('guided-demo-step-counter')).toHaveTextContent('5/5');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent('/simulator');
  });

  it('renders dynamic meta.label in DemoBanner for file-import source', async () => {
    render(
      <MetaProvider>
        <DemoBanner />
      </MetaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('demo-badge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('demo-badge')).toHaveTextContent('USER-SUPPLIED DATA (file import)');
    expect(screen.getByText(/User-supplied CSV import/i)).toBeInTheDocument();
  });
});
