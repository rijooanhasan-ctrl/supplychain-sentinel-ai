import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HeadlineStrip } from './HeadlineStrip';

describe('HeadlineStrip Component', () => {
  it('renders headline text, dataset badge, and snapshot date', () => {
    render(
      <MemoryRouter>
        <HeadlineStrip
          headline="9 components face shortage risk; the most urgent is CPU-X7, short from 2026-10-21 (4 days)."
          datasetLabel="DEMO DATA"
          asOf="2026-10-17"
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/9 components face shortage risk/i)).toBeInTheDocument();
    expect(screen.getByText('DEMO DATA')).toBeInTheDocument();
    expect(screen.getByText('2026-10-17')).toBeInTheDocument();
    expect(screen.queryByTestId('most-severe-vs-soonest-badge')).not.toBeInTheDocument();
  });

  it('renders disambiguation badge when most severe SKU and soonest SKU differ', () => {
    render(
      <MemoryRouter>
        <HeadlineStrip
          headline="2 components face shortage risk; the most urgent is CMP-CAM-103, short from 2026-10-25 (7 days)."
          datasetLabel="USER-SUPPLIED DATA"
          asOf="2026-10-18"
          mostSevereSku="CMP-CAM-103"
          soonestSku="BAT-5000"
        />
      </MemoryRouter>
    );

    const badge = screen.getByTestId('most-severe-vs-soonest-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/Most severe: CMP-CAM-103 vs Soonest: BAT-5000/i);
  });
});
