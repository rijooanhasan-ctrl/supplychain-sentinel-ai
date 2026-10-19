import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  SupplierReliabilityBars,
  SupplierReliabilityTable,
} from './SupplierReliabilityBars';
import { ChartCard } from '../ui/ChartCard';
import type { SupplierRiskItem } from '../../api/types';

describe('SupplierReliabilityBars Component', () => {
  const mockSuppliers: SupplierRiskItem[] = [
    {
      supplier_id: 1,
      supplier_code: 'SUP-BEST',
      supplier_name: 'Best Quality Inc',
      country: 'Germany',
      n_deliveries: 45,
      risk_score: 12.5,
      risk_band: 'low',
      confidence: 'high',
      on_time_rate: 0.95, // 95%
      on_time_ci_lower: 0.88,
      on_time_ci_upper: 0.98,
      late_delivery_probability: 0.05,
      expected_delay_days_if_late: 2.0,
      avg_delay_days_all: 0.2,
      avg_delay_days_when_late: 2.0,
      rejection_rate: 0.01,
      fill_rate: 0.99,
      open_po_count: 2,
      open_pos_slipped_count: 0,
      open_pos_overdue_count: 0,
      open_remaining_qty: 200,
    },
    {
      supplier_id: 2,
      supplier_code: 'SUP-WORST',
      supplier_name: 'Worst Reliability Ltd',
      country: 'USA',
      n_deliveries: 30,
      risk_score: 78.0,
      risk_band: 'high',
      confidence: 'high',
      on_time_rate: 0.52, // 52% -> worst
      on_time_ci_lower: 0.40,
      on_time_ci_upper: 0.65,
      late_delivery_probability: 0.48,
      expected_delay_days_if_late: 6.5,
      avg_delay_days_all: 3.1,
      avg_delay_days_when_late: 6.5,
      rejection_rate: 0.05,
      fill_rate: 0.90,
      open_po_count: 4,
      open_pos_slipped_count: 2,
      open_pos_overdue_count: 1,
      open_remaining_qty: 600,
    },
    {
      supplier_id: 3,
      supplier_code: 'SUP-NEW',
      supplier_name: 'Newcomer Corp',
      country: 'Japan',
      n_deliveries: 3, // < 10 deliveries -> limited history
      risk_score: 40.0,
      risk_band: 'medium',
      confidence: 'low',
      on_time_rate: 0.667,
      on_time_ci_lower: 0.20,
      on_time_ci_upper: 0.90,
      late_delivery_probability: 0.33,
      expected_delay_days_if_late: 4.0,
      avg_delay_days_all: 1.3,
      avg_delay_days_when_late: 4.0,
      rejection_rate: 0.0,
      fill_rate: 1.0,
      open_po_count: 1,
      open_pos_slipped_count: 0,
      open_pos_overdue_count: 0,
      open_remaining_qty: 50,
    },
  ];

  it('orders suppliers worst on-time rate first', () => {
    render(
      <MemoryRouter>
        <SupplierReliabilityBars suppliers={mockSuppliers} />
      </MemoryRouter>
    );

    const rows = screen.getAllByRole('link');
    // SUP-WORST (52%) should appear before SUP-NEW (66.7%) and SUP-BEST (95%)
    expect(rows[0]).toHaveTextContent('SUP-WORST');
    expect(rows[0]).toHaveTextContent('52.0%');
    expect(rows[1]).toHaveTextContent('SUP-NEW');
    expect(rows[2]).toHaveTextContent('SUP-BEST');
    expect(rows[2]).toHaveTextContent('95.0%');
  });

  it('marks low-confidence / low-delivery suppliers with "limited history" text', () => {
    render(
      <MemoryRouter>
        <SupplierReliabilityBars suppliers={mockSuppliers} />
      </MemoryRouter>
    );

    const limitedBadge = screen.getByTestId('limited-history-SUP-NEW');
    expect(limitedBadge).toBeInTheDocument();
    expect(limitedBadge).toHaveTextContent('limited history');

    // SUP-BEST has 45 deliveries, should not have limited history badge
    expect(screen.queryByTestId('limited-history-SUP-BEST')).not.toBeInTheDocument();
  });

  it('links each supplier row to /supplier-risk', () => {
    render(
      <MemoryRouter>
        <SupplierReliabilityBars suppliers={mockSuppliers} />
      </MemoryRouter>
    );

    const worstLink = screen.getByTestId('supplier-bar-row-SUP-WORST');
    expect(worstLink).toHaveAttribute('href', '/supplier-risk?supplier_code=SUP-WORST');
  });

  it('provides accessible tabular alternative', () => {
    render(
      <MemoryRouter>
        <ChartCard
          title="Supplier Reliability"
          subtitle="On-time delivery performance."
          tableView={<SupplierReliabilityTable suppliers={mockSuppliers} />}
        >
          <SupplierReliabilityBars suppliers={mockSuppliers} />
        </ChartCard>
      </MemoryRouter>
    );

    // Switch to table
    fireEvent.click(screen.getByRole('button', { name: /switch to accessible tabular view/i }));

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('SUP-WORST')).toBeInTheDocument();
    expect(screen.getByText('52.0%')).toBeInTheDocument();
    expect(screen.getByText('30 deliveries')).toBeInTheDocument();
  });
});
