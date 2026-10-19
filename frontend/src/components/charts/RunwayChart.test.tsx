import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RunwayChart, RunwayTable } from './RunwayChart';
import { ChartCard } from '../ui/ChartCard';
import { SvgPatternDefs } from '../ui/SvgPatternDefs';
import type { InventoryRiskItem } from '../../api/types';

describe('RunwayChart Component', () => {
  const asOf = '2026-10-17';

  // Use test-specific non-demo SKUs to verify no hardcoded SKUs in component
  const mockItems: InventoryRiskItem[] = [
    {
      component_id: 101,
      sku: 'NON-DEMO-ALPHA-01',
      name: 'Alpha Module',
      category: 'Electronics',
      criticality: 'critical',
      plant_usable_stock: 50,
      mean_daily_demand: 10,
      coverage_days: 5,
      shortage_date: '2026-10-22',
      days_until_shortage: 5,
      next_replenishment: {
        date: '2026-10-27', // 10 days from asOf -> 5 days after shortage (gap of 5 days)
        qty: 500,
        po_number: 'PO-TEST-1',
        date_basis: 'promised',
      },
      unmet_before_next_inbound: 50,
      risk_level: 'critical',
    },
    {
      component_id: 102,
      sku: 'NON-DEMO-BETA-02',
      name: 'Beta Power Unit',
      category: 'Power',
      criticality: 'high',
      plant_usable_stock: 80,
      mean_daily_demand: 8,
      coverage_days: 10,
      shortage_date: '2026-10-27',
      days_until_shortage: 10,
      next_replenishment: null, // "no delivery scheduled" case
      unmet_before_next_inbound: null,
      risk_level: 'high',
    },
    {
      component_id: 103,
      sku: 'NON-DEMO-GAMMA-03',
      name: 'Gamma Chassis',
      category: 'Structural',
      criticality: 'normal',
      plant_usable_stock: 400,
      mean_daily_demand: 10,
      coverage_days: 40,
      shortage_date: '2026-11-26',
      days_until_shortage: 40, // 30+ days overflow case
      next_replenishment: null,
      unmet_before_next_inbound: null,
      risk_level: 'medium',
    },
    {
      component_id: 104,
      sku: 'NON-DEMO-DELTA-04',
      name: 'Delta Resistor',
      category: 'Passive',
      criticality: 'normal',
      plant_usable_stock: 1000,
      mean_daily_demand: 10,
      coverage_days: 100,
      shortage_date: null,
      days_until_shortage: null, // should be excluded (low risk & no shortage)
      next_replenishment: null,
      unmet_before_next_inbound: null,
      risk_level: 'low',
    },
  ] as unknown as InventoryRiskItem[];

  it('renders rows ordered by days_until_shortage ascending', () => {
    render(
      <MemoryRouter>
        <SvgPatternDefs />
        <RunwayChart items={mockItems} asOf={asOf} />
      </MemoryRouter>
    );

    // Dynamic text summary derived strictly from data
    const summary = screen.getByTestId('runway-summary-text');
    expect(summary).toHaveTextContent('the earliest shortage is NON-DEMO-ALPHA-01 in 5 days');

    // Rows rendered
    expect(screen.getByTestId('runway-row-NON-DEMO-ALPHA-01')).toBeInTheDocument();
    expect(screen.getByTestId('runway-row-NON-DEMO-BETA-02')).toBeInTheDocument();
    expect(screen.getByTestId('runway-row-NON-DEMO-GAMMA-03')).toBeInTheDocument();

    // Low risk component excluded
    expect(screen.queryByTestId('runway-row-NON-DEMO-DELTA-04')).not.toBeInTheDocument();
  });

  it('each row links to the simulator with the component id', () => {
    render(
      <MemoryRouter>
        <SvgPatternDefs />
        <RunwayChart items={mockItems} asOf={asOf} />
      </MemoryRouter>
    );

    const alphaLink = screen.getByRole('link', { name: /NON-DEMO-ALPHA-01/i });
    expect(alphaLink).toHaveAttribute('href', '/simulator?component_id=101');

    const betaLink = screen.getByRole('link', { name: /NON-DEMO-BETA-02/i });
    expect(betaLink).toHaveAttribute('href', '/simulator?component_id=102');
  });

  it('handles "no delivery scheduled" case with hatched segment to chart edge', () => {
    render(
      <MemoryRouter>
        <SvgPatternDefs />
        <RunwayChart items={mockItems} asOf={asOf} />
      </MemoryRouter>
    );

    const betaRow = screen.getByTestId('runway-row-NON-DEMO-BETA-02');
    expect(betaRow.textContent).toContain('no delivery scheduled');
  });

  it('handles "30+ days" overflow case with overflow indicator', () => {
    render(
      <MemoryRouter>
        <SvgPatternDefs />
        <RunwayChart items={mockItems} asOf={asOf} />
      </MemoryRouter>
    );

    const gammaRow = screen.getByTestId('runway-row-NON-DEMO-GAMMA-03');
    expect(gammaRow.textContent).toContain('30+ days');
  });

  it('renders accessible tabular alternative with all required columns', () => {
    render(
      <MemoryRouter>
        <ChartCard
          title="Runway Chart"
          subtitle="Component shortage runway."
          tableView={<RunwayTable items={mockItems} asOf={asOf} />}
        >
          <RunwayChart items={mockItems} asOf={asOf} />
        </ChartCard>
      </MemoryRouter>
    );

    // Switch to table view
    fireEvent.click(screen.getByRole('button', { name: /switch to accessible tabular view/i }));

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Check table headers
    expect(screen.getByText('Component')).toBeInTheDocument();
    expect(screen.getByText('Risk Level')).toBeInTheDocument();
    expect(screen.getByText('Stock Lasts (Days)')).toBeInTheDocument();
    expect(screen.getByText('Shortage Date')).toBeInTheDocument();
    expect(screen.getByText('Next Inbound Delivery')).toBeInTheDocument();
    expect(screen.getByText('Units Short Before Delivery')).toBeInTheDocument();
    expect(screen.getByText('Simulate')).toBeInTheDocument();

    // Check rows and simulation link in table
    expect(screen.getByText('NON-DEMO-ALPHA-01')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();
    expect(screen.getAllByText('No delivery scheduled').length).toBe(2);
  });
});
