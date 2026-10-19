import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RiskMixBar, RiskMixTable } from './RiskMixBar';
import { ChartCard } from '../ui/ChartCard';
import { SvgPatternDefs } from '../ui/SvgPatternDefs';

describe('RiskMixBar Component', () => {
  const counts = {
    critical: 2,
    high: 3,
    medium: 5,
    low: 10,
    none: 0,
    unknown: 0,
  };
  const totalEvaluated = 20;

  it('renders stacked SVG bar with segments proportional to counts', () => {
    render(
      <MemoryRouter>
        <SvgPatternDefs />
        <RiskMixBar counts={counts} totalEvaluated={totalEvaluated} />
      </MemoryRouter>
    );

    // Assert text labels and counts are rendered
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Medium').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Low').length).toBeGreaterThan(0);

    // Zero-count levels are shown in text buttons with 0 and (0%)
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('provides accessible buttons for each risk level that filter to /inventory-risk?risk_level=<lvl>', () => {
    render(
      <MemoryRouter>
        <SvgPatternDefs />
        <RiskMixBar counts={counts} totalEvaluated={totalEvaluated} />
      </MemoryRouter>
    );

    const criticalBtn = screen.getByRole('button', { name: /filter by critical risk: 2 components/i });
    expect(criticalBtn).toBeInTheDocument();
  });

  it('supports ChartCard table view toggle with full tabular alternative', () => {
    render(
      <MemoryRouter>
        <ChartCard
          title="Component Risk Mix"
          subtitle="Proportion of components across risk tiers."
          tableView={<RiskMixTable counts={counts} totalEvaluated={totalEvaluated} />}
        >
          <RiskMixBar counts={counts} totalEvaluated={totalEvaluated} />
        </ChartCard>
      </MemoryRouter>
    );

    // Initial state: table not rendered, visual view active
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    // Toggle to table view
    const toggleBtn = screen.getByRole('button', { name: /switch to accessible tabular view|view as table/i });
    fireEvent.click(toggleBtn);

    // Now table is rendered
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Pattern / Shape Indicator')).toBeInTheDocument();

    // Toggle back to visual chart
    fireEvent.click(screen.getByRole('button', { name: /graphical chart view|view as chart/i }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
