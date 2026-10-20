import type { PurchaseOrder } from '../api/types';

/**
 * Calendar and date calculation utilities anchored to the synthetic dataset's meta.as_of date.
 * All calendar calculations parse strings to UTC to eliminate timezone and DST discrepancies.
 */

export function parseUtcDate(dateStr: string): Date {
  const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const [year, month, day] = clean.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Returns integer calendar days between asOf and targetDate (targetDate - asOf).
 * Positive = future; Negative = past; 0 = same day.
 */
export function daysBetween(asOf: string, targetDate: string): number {
  const d1 = parseUtcDate(asOf);
  const d2 = parseUtcDate(targetDate);
  const MS_PER_DAY = 86_400_000;
  return Math.round((d2.getTime() - d1.getTime()) / MS_PER_DAY);
}

/**
 * Returns the effective delivery date and whether it was based on an estimate or promise.
 * Precedence rule: latest_estimate_date takes precedence over promised_date.
 */
export function expectedDate(po: PurchaseOrder): { date: string; basis: 'estimated' | 'promised' } {
  if (po.latest_estimate_date) {
    return { date: po.latest_estimate_date, basis: 'estimated' };
  }
  return { date: po.promised_date, basis: 'promised' };
}

/**
 * Returns true if an active purchase order (open, in_transit, partially_received)
 * has an effective expected date strictly before asOf.
 */
export function isOverdue(po: PurchaseOrder, asOf: string): boolean {
  if (po.status === 'received' || po.status === 'cancelled') {
    return false;
  }
  const { date } = expectedDate(po);
  return daysBetween(asOf, date) < 0;
}

/**
 * Returns human-readable timing descriptor relative to asOf.
 * - '—' for received or cancelled orders
 * - 'Overdue by N day(s)' when effective date < asOf
 * - 'Due today' when effective date === asOf
 * - 'Due in N day(s)' when effective date > asOf
 */
export function timingLabel(po: PurchaseOrder, asOf: string): string {
  if (po.status === 'received' || po.status === 'cancelled') {
    return '—';
  }
  const { date } = expectedDate(po);
  const diff = daysBetween(asOf, date);

  if (diff < 0) {
    const days = Math.abs(diff);
    return days === 1 ? 'Overdue by 1 day' : `Overdue by ${days} days`;
  }
  if (diff === 0) {
    return 'Due today';
  }
  return diff === 1 ? 'Due in 1 day' : `Due in ${diff} days`;
}

/**
 * Returns slipped-vs-promise details if latest_estimate_date is strictly after promised_date.
 * Returns null if no estimate or estimate <= promised_date.
 */
export function slippedInfo(po: PurchaseOrder): { slippedDays: number; promisedDate: string; label: string } | null {
  if (!po.latest_estimate_date) {
    return null;
  }
  const diff = daysBetween(po.promised_date, po.latest_estimate_date);
  if (diff <= 0) {
    return null;
  }
  const dayStr = diff === 1 ? '1 day' : `${diff} days`;
  return {
    slippedDays: diff,
    promisedDate: po.promised_date,
    label: `Slipped ${dayStr} vs promise (promised ${po.promised_date})`,
  };
}

/**
 * Returns true if an active purchase order (open, in_transit, partially_received)
 * has a latest_estimate_date strictly later than its promised_date.
 */
export function isDelayedVsPromise(po: PurchaseOrder): boolean {
  if (po.status === 'received' || po.status === 'cancelled') {
    return false;
  }
  return Boolean(po.latest_estimate_date && daysBetween(po.promised_date, po.latest_estimate_date) > 0);
}

