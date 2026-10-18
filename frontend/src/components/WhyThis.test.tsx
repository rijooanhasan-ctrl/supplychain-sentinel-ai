import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { WhyThis } from './WhyThis';

describe('WhyThis Component', () => {
  it('renders button with aria-expanded false by default and toggles on click', () => {
    const items = [{ label: 'Reason', text: 'Lowest residual unmet demand' }];
    render(<WhyThis items={items} />);

    const button = screen.getByRole('button', { name: /Why this\?/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // Panel is not in document initially
    expect(screen.queryByTestId('why-this-panel')).not.toBeInTheDocument();

    // Click to open
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('why-this-panel')).toBeInTheDocument();
    expect(screen.getByText('Reason:')).toBeInTheDocument();
    expect(screen.getByText('Lowest residual unmet demand')).toBeInTheDocument();

    // Click to close
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('why-this-panel')).not.toBeInTheDocument();
  });

  it('renders plain string item properly without error', () => {
    render(<WhyThis items="Operational supplier constraint applies." />);
    const button = screen.getByRole('button', { name: /Why this\?/i });
    fireEvent.click(button);
    expect(screen.getByText('Operational supplier constraint applies.')).toBeInTheDocument();
  });
});
