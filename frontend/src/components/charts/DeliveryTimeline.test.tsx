import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DeliveryTimeline, DeliveryTimelineTable } from './DeliveryTimeline';
import { ChartCard } from '../ui/ChartCard';
import type { PurchaseOrder } from '../../api/types';

describe('DeliveryTimeline Component', () => {
  const asOf = '2026-10-17';

  // 14 test orders to verify 12-item cap and "show all" link
  const mockOrders: PurchaseOrder[] = [
    // Overdue order
    {
      id: 1,
      po_number: 'PO-TEST-OVERDUE-01',
      supplier_id: 10,
      supplier_code: 'SUP-A',
      supplier_name: 'Alpha Supplier',
      status: 'in_transit',
      order_date: '2026-09-20',
      promised_date: '2026-10-10',
      latest_estimate_date: '2026-10-14', // before 2026-10-17 -> Overdue
    },
    // Slipped order (promised 2026-10-18, estimated 2026-10-25 -> slipped 7 days)
    {
      id: 2,
      po_number: 'PO-TEST-SLIPPED-02',
      supplier_id: 11,
      supplier_code: 'SUP-B',
      supplier_name: 'Beta Supplier',
      status: 'in_transit',
      order_date: '2026-09-22',
      promised_date: '2026-10-18',
      latest_estimate_date: '2026-10-25',
    },
    // On-time orders to fill to 14 total
    ...Array.from({ length: 12 }, (_, i) => ({
      id: 10 + i,
      po_number: `PO-TEST-FUTURE-${i + 1}`,
      supplier_id: 20 + i,
      supplier_code: `SUP-${i + 1}`,
      supplier_name: `Supplier ${i + 1}`,
      status: 'open' as const,
      order_date: '2026-10-01',
      promised_date: `2026-10-${20 + Math.min(i, 10)}`,
      latest_estimate_date: null,
      lines: [],
    })),
  ];

  it('renders overdue strip when overdue orders exist', () => {
    render(
      <MemoryRouter>
        <DeliveryTimeline orders={mockOrders} asOf={asOf} />
      </MemoryRouter>
    );

    const overdueStrip = screen.getByTestId('overdue-strip');
    expect(overdueStrip).toBeInTheDocument();
    expect(overdueStrip).toHaveTextContent(/already overdue/i);
    expect(overdueStrip).toHaveTextContent('PO-TEST-OVERDUE-01');
  });

  it('draws slipped indicator and text label for estimated date later than promised date', () => {
    render(
      <MemoryRouter>
        <DeliveryTimeline orders={mockOrders} asOf={asOf} />
      </MemoryRouter>
    );

    expect(screen.getByText('Slipped 7d')).toBeInTheDocument();
    expect(screen.getByText('PO-TEST-SLIPPED-02')).toBeInTheDocument();
  });

  it('caps displayed upcoming list at 12 and provides "Show all in Purchase Orders" link', () => {
    render(
      <MemoryRouter>
        <DeliveryTimeline orders={mockOrders} asOf={asOf} />
      </MemoryRouter>
    );

    // Showing 12 of 13 upcoming orders
    expect(screen.getByText(/showing 12 of 13 upcoming orders within 30-day window/i)).toBeInTheDocument();

    const showAllLink = screen.getByRole('link', { name: /show all in purchase orders/i });
    expect(showAllLink).toBeInTheDocument();
    expect(showAllLink).toHaveAttribute('href', '/purchase-orders');
  });

  it('provides accessible tabular alternative with all columns', () => {
    render(
      <MemoryRouter>
        <ChartCard
          title="Inbound Deliveries"
          subtitle="Next 30 days."
          tableView={<DeliveryTimelineTable orders={mockOrders} asOf={asOf} />}
        >
          <DeliveryTimeline orders={mockOrders} asOf={asOf} />
        </ChartCard>
      </MemoryRouter>
    );

    // Toggle table
    fireEvent.click(screen.getByRole('button', { name: /switch to accessible tabular view/i }));

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('PO Number')).toBeInTheDocument();
    expect(screen.getByText('Supplier')).toBeInTheDocument();
    expect(screen.getByText('Schedule Status')).toBeInTheDocument();

    // Check status tags
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Slipped 7 days')).toBeInTheDocument();
    expect(screen.getAllByText('On track').length).toBeGreaterThan(0);
  });
});
