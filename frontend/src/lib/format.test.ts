import { describe, it, expect } from 'vitest';
import {
  formatInteger,
  formatUsd,
  formatMoney,
  formatPercentFromFraction,
  formatDate,
  formatUtcTimestamp,
} from './format';

describe('format.ts', () => {
  describe('formatUsd', () => {
    it('formats standard decimal amounts without float math', () => {
      expect(formatUsd('250.00')).toBe('$250.00');
      expect(formatUsd('1499.5')).toBe('$1,499.50');
      expect(formatUsd('0.00')).toBe('$0.00');
      expect(formatUsd('0')).toBe('$0.00');
    });

    it('formats large values with comma thousands separators', () => {
      expect(formatUsd('1234567.89')).toBe('$1,234,567.89');
      expect(formatUsd('10000000.00')).toBe('$10,000,000.00');
    });

    it('handles negative values correctly', () => {
      expect(formatUsd('-25.50')).toBe('-$25.50');
    });

    it('handles null, undefined, or empty values', () => {
      expect(formatUsd(null)).toBe('—');
      expect(formatUsd(undefined)).toBe('—');
      expect(formatUsd('')).toBe('—');
    });
  });

  describe('formatPercentFromFraction', () => {
    it('formats decimal fraction strings into percentages and trims extra zeros', () => {
      expect(formatPercentFromFraction('0.2500')).toBe('25%');
      expect(formatPercentFromFraction('0.2550')).toBe('25.5%');
      expect(formatPercentFromFraction('0.0525')).toBe('5.25%');
      expect(formatPercentFromFraction('0.0000')).toBe('0%');
      expect(formatPercentFromFraction('1.0000')).toBe('100%');
    });

    it('handles null or empty values', () => {
      expect(formatPercentFromFraction(null)).toBe('—');
      expect(formatPercentFromFraction(undefined)).toBe('—');
      expect(formatPercentFromFraction('')).toBe('—');
    });
  });

  describe('formatInteger', () => {
    it('formats integers with thousands separators', () => {
      expect(formatInteger(12345)).toBe('12,345');
      expect(formatInteger('2520')).toBe('2,520');
      expect(formatInteger(0)).toBe('0');
      expect(formatInteger(null)).toBe('—');
      expect(formatInteger(undefined)).toBe('—');
    });
  });

  describe('formatDate', () => {
    it('extracts date part from ISO or returns plain date', () => {
      expect(formatDate('2026-10-17')).toBe('2026-10-17');
      expect(formatDate('2026-10-17T12:00:00+00:00')).toBe('2026-10-17');
      expect(formatDate(null)).toBe('—');
    });
  });

  describe('formatUtcTimestamp', () => {
    it('formats ISO timestamps to YYYY-MM-DD HH:mm UTC', () => {
      expect(formatUtcTimestamp('2026-10-17T12:53:00+00:00')).toBe('2026-10-17 12:53 UTC');
      expect(formatUtcTimestamp(null)).toBe('—');
      expect(formatUtcTimestamp('invalid')).toBe('invalid');
    });
  });

  describe('formatMoney', () => {
    const inrMeta = { display_currency: 'INR', usd_to_inr_rate: '83.5' };
    const inrMetaZeroRate = { display_currency: 'INR', usd_to_inr_rate: '0' };
    const usdMeta = { display_currency: 'USD', usd_to_inr_rate: null };

    it('converts USD to INR at rate 83.5 with exact decimal precision', () => {
      expect(formatMoney('250.00', inrMeta)).toBe('₹20,875.00');
    });

    it('shows Indian lakh/crore grouping for large amounts', () => {
      // 2507110.00 * 83.5 = 20,93,43,685.00
      expect(formatMoney('2507110.00', inrMeta)).toBe('₹20,93,43,685.00');
      // Single lakh grouping check (e.g. 100000)
      expect(formatMoney('1000.00', inrMeta)).toBe('₹83,500.00');
      expect(formatMoney('10000.00', inrMeta)).toBe('₹8,35,000.00');
    });

    it('preserves null placeholders ("—", "Unknown", "None provided")', () => {
      expect(formatMoney(null, inrMeta)).toBe('—');
      expect(formatMoney(undefined, inrMeta)).toBe('—');
      expect(formatMoney(null, inrMeta, 'Unknown')).toBe('Unknown');
      expect(formatMoney(null, inrMeta, 'None provided')).toBe('None provided');
      expect(formatMoney('Unknown', inrMeta)).toBe('Unknown');
      expect(formatMoney('None provided', inrMeta)).toBe('None provided');
      expect(formatMoney('—', inrMeta)).toBe('—');
    });

    it('falls back to USD formatting when display_currency is not INR or rate is missing/zero', () => {
      expect(formatMoney('250.00', usdMeta)).toBe('$250.00');
      expect(formatMoney('2507110.00', usdMeta)).toBe('$2,507,110.00');
      expect(formatMoney('250.00', null)).toBe('$250.00');
      expect(formatMoney('250.00', inrMetaZeroRate)).toBe('$250.00');
    });

    it('avoids floating point drift on decimal additions and multiplications', () => {
      // 0.10 + 0.20 = 0.30, multiplied by 83.5 = 25.05
      expect(formatMoney('0.30', inrMeta)).toBe('₹25.05');
      // Half-up rounding on fractional paise: 0.005 * 83.5 = 0.4175 -> 0.42
      expect(formatMoney('0.005', inrMeta)).toBe('₹0.42');
    });

    it('handles negative amounts correctly', () => {
      expect(formatMoney('-250.00', inrMeta)).toBe('-₹20,875.00');
      expect(formatMoney('-250.00', usdMeta)).toBe('-$250.00');
    });
  });
});
