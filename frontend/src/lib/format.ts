/**
 * Shared formatting utilities for numbers, currencies, dates, and timestamps.
 * 
 * Rules:
 * - Currency formatting supports USD ($) and INR (₹) at a configured exchange rate.
 * - Uses exact string/BigInt arithmetic keeping two decimal places with half-up rounding,
 *   strictly avoiding binary floating-point roundoff errors.
 * - Null/undefined values return the requested placeholder (default '—').
 */

export interface CurrencyMetaLike {
  display_currency?: string;
  usd_to_inr_rate?: string | null;
}

export function formatInteger(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num)) {
    return '—';
  }
  return num.toLocaleString('en-US');
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function parseDecimal(str: string): { mantissa: bigint; decimals: number; isNegative: boolean } | null {
  const trimmed = str.trim();
  if (trimmed === '') {
    return null;
  }
  const isNegative = trimmed.startsWith('-');
  const unsigned = isNegative ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    return null;
  }
  const parts = unsigned.split('.');
  const intPart = parts[0] || '0';
  const decPart = parts[1] || '';
  const cleanInt = intPart.replace(/^0+(?=\d)/, '') || '0';
  const mantissa = BigInt(`${cleanInt}${decPart}`);
  return { mantissa, decimals: decPart.length, isNegative };
}

function formatIndianInteger(intStr: string): string {
  const cleanInt = intStr.replace(/^0+(?=\d)/, '') || '0';
  if (cleanInt.length <= 3) {
    return cleanInt;
  }
  const lastThree = cleanInt.slice(-3);
  const remaining = cleanInt.slice(0, -3);
  const formattedRemaining = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${formattedRemaining},${lastThree}`;
}

/**
 * Formats a USD monetary decimal string into either USD ($) or INR (₹) based on meta.
 * Uses exact BigInt decimal-scaled arithmetic to prevent precision loss.
 */
export function formatMoney(
  value: string | number | null | undefined,
  meta?: CurrencyMetaLike | null,
  nullPlaceholder = '—',
): string {
  if (value === null || value === undefined) {
    return nullPlaceholder;
  }

  const strVal = typeof value === 'number' ? String(value) : value.trim();
  if (strVal === '') {
    return nullPlaceholder;
  }
  if (strVal === 'Unknown' || strVal === 'None provided' || strVal === '—') {
    return strVal;
  }

  const parsedVal = parseDecimal(strVal);
  if (!parsedVal) {
    return nullPlaceholder;
  }

  let isINR = false;
  let parsedRate: { mantissa: bigint; decimals: number; isNegative: boolean } | null = null;

  if (meta?.display_currency === 'INR' && meta.usd_to_inr_rate) {
    parsedRate = parseDecimal(meta.usd_to_inr_rate);
    if (parsedRate && parsedRate.mantissa > 0n && !parsedRate.isNegative) {
      isINR = true;
    }
  }

  let mantissa: bigint;
  let totalDecimals: number;
  let isNegative = parsedVal.isNegative;

  if (isINR && parsedRate) {
    mantissa = parsedVal.mantissa * parsedRate.mantissa;
    totalDecimals = parsedVal.decimals + parsedRate.decimals;
    isNegative = parsedVal.isNegative !== parsedRate.isNegative;
  } else {
    mantissa = parsedVal.mantissa;
    totalDecimals = parsedVal.decimals;
  }

  // Scale to exactly 2 decimals using round-half-up
  const targetDecimals = 2;
  if (totalDecimals > targetDecimals) {
    const diff = totalDecimals - targetDecimals;
    const divisor = 10n ** BigInt(diff);
    const half = divisor / 2n;
    mantissa = (mantissa + half) / divisor;
  } else if (totalDecimals < targetDecimals) {
    const diff = targetDecimals - totalDecimals;
    mantissa = mantissa * (10n ** BigInt(diff));
  }

  if (mantissa === 0n) {
    isNegative = false;
  }

  const intPart = (mantissa / 100n).toString();
  const decPart = (mantissa % 100n).toString().padStart(2, '0');

  if (isINR) {
    const formattedInt = formatIndianInteger(intPart);
    const prefix = isNegative ? '-₹' : '₹';
    return `${prefix}${formattedInt}.${decPart}`;
  } else {
    const cleanInt = intPart.replace(/^0+(?=\d)/, '') || '0';
    const formattedInt = cleanInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const prefix = isNegative ? '-$' : '$';
    return `${prefix}${formattedInt}.${decPart}`;
  }
}

/**
 * Backward-compatible helper for USD currency string formatting.
 */
export function formatUsd(value: string | number | null | undefined, nullPlaceholder = '—'): string {
  return formatMoney(value, { display_currency: 'USD' }, nullPlaceholder);
}

/**
 * Formats a decimal fraction string (e.g. "0.2500") into a percentage string (e.g. "25%"),
 * trimming unnecessary trailing zeros up to 2 decimal places.
 */
export function formatPercentFromFraction(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') {
    return '—';
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return '—';
  }

  const isNegative = trimmed.startsWith('-');
  const unsigned = isNegative ? trimmed.slice(1) : trimmed;

  const [rawInt = '0', rawDec = ''] = unsigned.split('.');
  // Shift 2 places to the right
  const paddedDec = (rawDec + '0000').slice(0, 4);
  const shiftedInt = `${rawInt}${paddedDec.slice(0, 2)}`.replace(/^0+(?=\d)/, '') || '0';
  const remainingDec = paddedDec.slice(2, 4).replace(/0+$/, '');

  const percentStr = remainingDec.length > 0 ? `${shiftedInt}.${remainingDec}%` : `${shiftedInt}%`;
  return isNegative ? `-${percentStr}` : percentStr;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return value.includes('T') ? value.split('T')[0] : value;
}

export function formatUtcTimestamp(isoString: string | null | undefined): string {
  if (!isoString) {
    return '—';
  }
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm} UTC`;
  } catch {
    return isoString;
  }
}
