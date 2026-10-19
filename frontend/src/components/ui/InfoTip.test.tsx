import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InfoTip } from './InfoTip';

describe('InfoTip Component', () => {
  it('renders trigger button with accessible label and aria-expanded="false" by default', () => {
    render(<InfoTip term="Usable Stock" description="Physical inventory ready for production." />);
    const trigger = screen.getByRole('button', { name: /about usable stock/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens popover on click and updates aria-expanded to true', () => {
    render(<InfoTip term="Runway" description="Days of stock remaining." />);
    const trigger = screen.getByRole('button', { name: /about runway/i });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('Days of stock remaining.')).toBeInTheDocument();
  });

  it('closes popover when Escape key is pressed', () => {
    render(<InfoTip term="Runway" description="Days of stock remaining." />);
    const trigger = screen.getByRole('button', { name: /about runway/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('sets up aria-describedby relationship between trigger and popover', () => {
    render(<InfoTip term="Shortage Date" description="Projected day inventory hits 0." />);
    const trigger = screen.getByRole('button', { name: /about shortage date/i });
    fireEvent.click(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveAttribute('id');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.getAttribute('id'));
  });
});
