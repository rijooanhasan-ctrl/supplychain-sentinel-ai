import { describe, it, expect } from 'vitest';
import {
  parseUtcDate,
  daysBetween,
  expectedDate,
  isOverdue,
  timingLabel,
  slippedInfo,
  isDelayedVsPromise,
} from './dates';
import type { PurchaseOrder } from '../api/types';

describe('dates.ts', () => {
  describe('parseUtcDate & daysBetween', () => {
    it('accurately calculates days across month and year boundaries in UTC', () => {
      expect(daysBetween('2026-10-17', '2026-10-17')).toBe(0);
      expect(daysBetween('2026-10-17', '2026-10-18')).toBe(1);
      expect(daysBetween('2026-10-17', '2026-10-16')).toBe(-1);

      // Month boundary
      expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);

      // Year boundary
      expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);

      // Leap year check (2028 is leap year)
      expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    });

    it('is immune to local DST changes', () => {
      // Days across DST shifts should still be exact integer days
      const d1 = parseUtcDate('2026-03-07');
      const d2 = parseUtcDate('2026-03-09');
      expect(Math.round((d2.getTime() - d1.getTime()) / 86400000)).toBe(2);
    });
  });

  describe('expectedDate precedence', () => {
    const basePo: PurchaseOrder = {
      id: 1,
      po_number: 'PO-1001',
      supplier_id: 1,
      supplier_code: 'SUP-01',
      supplier_name: 'Apex Silicon',
      status: 'open',
      order_date: '2026-10-01',
      promised_date: '2026-10-15',
      latest_estimate_date: null,
    };

    it('prefers latest_estimate_date over promised_date when provided', () => {
      const poWithEstimate: PurchaseOrder = {
        ...basePo,
        latest_estimate_date: '2026-10-25',
      };
      const result = expectedDate(poWithEstimate);
      expect(result.date).toBe('2026-10-25');
      expect(result.basis).toBe('estimated');
    });

    it('falls back to promised_date when latest_estimate_date is null', () => {
      const result = expectedDate(basePo);
      expect(result.date).toBe('2026-10-15');
      expect(result.basis).toBe('promised');
    });
  });

  describe('isOverdue and timingLabel', () => {
    const asOf = '2026-10-17';

    it('flags active order as overdue if effective date is before asOf', () => {
      const overduePo: PurchaseOrder = {
        id: 1,
        po_number: 'PO-OD-01',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'open',
        order_date: '2026-10-01',
        promised_date: '2026-10-10',
        latest_estimate_date: null,
      };
      expect(isOverdue(overduePo, asOf)).toBe(true);
      expect(timingLabel(overduePo, asOf)).toBe('Overdue by 7 days');
    });

    it('does NOT flag order as overdue if latest_estimate_date is future, even if promised is past', () => {
      const estimatedFuturePo: PurchaseOrder = {
        id: 2,
        po_number: 'PO-REV-01',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'in_transit',
        order_date: '2026-10-01',
        promised_date: '2026-10-10', // past
        latest_estimate_date: '2026-10-20', // future
      };
      expect(isOverdue(estimatedFuturePo, asOf)).toBe(false);
      expect(timingLabel(estimatedFuturePo, asOf)).toBe('Due in 3 days');
    });

    it('labels order due today', () => {
      const todayPo: PurchaseOrder = {
        id: 3,
        po_number: 'PO-TODAY',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'open',
        order_date: '2026-10-01',
        promised_date: '2026-10-17',
        latest_estimate_date: null,
      };
      expect(isOverdue(todayPo, asOf)).toBe(false);
      expect(timingLabel(todayPo, asOf)).toBe('Due today');
    });

    it('returns dash placeholder for received or cancelled orders', () => {
      const receivedPo: PurchaseOrder = {
        id: 4,
        po_number: 'PO-DONE',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'received',
        order_date: '2026-10-01',
        promised_date: '2026-10-10',
        latest_estimate_date: null,
      };
      expect(isOverdue(receivedPo, asOf)).toBe(false);
      expect(timingLabel(receivedPo, asOf)).toBe('—');

      const cancelledPo: PurchaseOrder = {
        ...receivedPo,
        status: 'cancelled',
      };
      expect(isOverdue(cancelledPo, asOf)).toBe(false);
      expect(timingLabel(cancelledPo, asOf)).toBe('—');
    });
  });

  describe('slippedInfo & isDelayedVsPromise', () => {
    const asOf = '2026-10-17';

    it('returns null and false when there is no latest_estimate_date', () => {
      const po: PurchaseOrder = {
        id: 1,
        po_number: 'PO-NO-EST',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'open',
        order_date: '2026-10-01',
        promised_date: '2026-10-20',
        latest_estimate_date: null,
      };
      expect(slippedInfo(po)).toBeNull();
      expect(isDelayedVsPromise(po)).toBe(false);
    });

    it('returns null and false when latest_estimate_date is on or before promised_date', () => {
      const poOnTime: PurchaseOrder = {
        id: 2,
        po_number: 'PO-ON-TIME',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'in_transit',
        order_date: '2026-10-01',
        promised_date: '2026-10-20',
        latest_estimate_date: '2026-10-20',
      };
      expect(slippedInfo(poOnTime)).toBeNull();
      expect(isDelayedVsPromise(poOnTime)).toBe(false);

      const poEarly: PurchaseOrder = {
        ...poOnTime,
        latest_estimate_date: '2026-10-18',
      };
      expect(slippedInfo(poEarly)).toBeNull();
      expect(isDelayedVsPromise(poEarly)).toBe(false);
    });

    it('handles PO-OVERDUE-01-like data: promised 2026-10-13, estimate 2026-10-20, as_of 2026-10-17 -> Due in 3 days, Slipped 7 days vs promise', () => {
      const poOverdue01: PurchaseOrder = {
        id: 3,
        po_number: 'PO-OVERDUE-01',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'in_transit',
        order_date: '2026-09-25',
        promised_date: '2026-10-13',
        latest_estimate_date: '2026-10-20',
      };
      // Primary timing label stays based on estimate
      expect(timingLabel(poOverdue01, asOf)).toBe('Due in 3 days');
      expect(isOverdue(poOverdue01, asOf)).toBe(false);

      // Slipped text
      const slipped = slippedInfo(poOverdue01);
      expect(slipped).not.toBeNull();
      expect(slipped?.slippedDays).toBe(7);
      expect(slipped?.promisedDate).toBe('2026-10-13');
      expect(slipped?.label).toBe('Slipped 7 days vs promise (promised 2026-10-13)');

      expect(isDelayedVsPromise(poOverdue01)).toBe(true);
    });

    it('handles singular day slipped (1 day)', () => {
      const po1Day: PurchaseOrder = {
        id: 4,
        po_number: 'PO-1-DAY',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'open',
        order_date: '2026-10-01',
        promised_date: '2026-10-15',
        latest_estimate_date: '2026-10-16',
      };
      const slipped = slippedInfo(po1Day);
      expect(slipped?.slippedDays).toBe(1);
      expect(slipped?.label).toBe('Slipped 1 day vs promise (promised 2026-10-15)');
    });

    it('returns false for isDelayedVsPromise on completed/cancelled orders even if estimate slipped', () => {
      const poReceived: PurchaseOrder = {
        id: 5,
        po_number: 'PO-DONE-SLIPPED',
        supplier_id: 1,
        supplier_code: 'SUP-01',
        supplier_name: 'Apex',
        status: 'received',
        order_date: '2026-09-01',
        promised_date: '2026-09-10',
        latest_estimate_date: '2026-09-15',
      };
      expect(isDelayedVsPromise(poReceived)).toBe(false);

      const poCancelled: PurchaseOrder = {
        ...poReceived,
        status: 'cancelled',
      };
      expect(isDelayedVsPromise(poCancelled)).toBe(false);
    });
  });
});

