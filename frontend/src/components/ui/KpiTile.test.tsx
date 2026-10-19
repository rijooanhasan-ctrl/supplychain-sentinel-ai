import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { KpiTile } from './KpiTile';

describe('KpiTile Component', () => {
  it('renders big number, label, and explanation', () => {
    render(
      <KpiTile
        label="Components at risk"
        value="5 of 14"
        explanation="Components facing projected shortages within planning horizon."
        testId="test-kpi"
      />
    );

    expect(screen.getByTestId('test-kpi')).toBeInTheDocument();
    expect(screen.getByText('Components at risk')).toBeInTheDocument();
    expect(screen.getByText('5 of 14')).toBeInTheDocument();
    expect(
      screen.getByText('Components facing projected shortages within planning horizon.')
    ).toBeInTheDocument();
  });

  it('renders optional link with accessible target', () => {
    render(
      <MemoryRouter>
        <KpiTile
          label="Late deliveries"
          value="3"
          explanation="Overdue or delayed purchase orders."
          to="/purchase-orders"
        />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /late deliveries/i });
    expect(link).toHaveAttribute('href', '/purchase-orders');
  });

  it('renders "None" state when value is None', () => {
    render(
      <KpiTile
        label="Soonest shortage"
        value="None"
        explanation="No component shortages predicted."
      />
    );

    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('No component shortages predicted.')).toBeInTheDocument();
  });
});
