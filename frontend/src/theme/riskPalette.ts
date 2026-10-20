/**
 * Unified Risk Color & Pattern Palette for SupplyChain Sentinel AI.
 *
 * Requirements:
 * - Every risk level defines: label, text color, background color, stroke color, fill color, and patternId.
 * - WCAG AA contrast (>= 4.5:1) verified mathematically between textColor and bgColor, and against dark surfaces.
 * - Distinct SVG patterns allow charts and visual widgets to remain readable in greyscale or for color-blind users.
 */

export type RiskLevelKey = 'critical' | 'high' | 'medium' | 'low' | 'none' | 'unknown';

export interface RiskPaletteEntry {
  key: RiskLevelKey;
  label: string;
  textColor: string;
  bgColor: string;
  strokeColor: string;
  fillColor: string;
  patternId: string;
  shapeDescription: string;
}

export const RISK_PALETTE: Record<RiskLevelKey, RiskPaletteEntry> = {
  critical: {
    key: 'critical',
    label: 'Critical',
    textColor: '#fca5a5', // red-300
    bgColor: '#3c1214',   // dark red
    strokeColor: '#dc2626', // red-600
    fillColor: '#ef4444',   // red-500
    patternId: 'pattern-risk-critical',
    shapeDescription: 'Dense cross-hatch pattern with diamond indicators',
  },
  high: {
    key: 'high',
    label: 'High',
    textColor: '#fdba74', // orange-300
    bgColor: '#431d09',   // dark orange
    strokeColor: '#ea580c', // orange-600
    fillColor: '#f97316',   // orange-500
    patternId: 'pattern-risk-high',
    shapeDescription: '45-degree diagonal stripes with square indicators',
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    textColor: '#fcd34d', // amber-300
    bgColor: '#3f2905',   // dark amber
    strokeColor: '#d97706', // amber-600
    fillColor: '#f59e0b',   // amber-500
    patternId: 'pattern-risk-medium',
    shapeDescription: 'Polka-dot matrix with circular indicators',
  },
  low: {
    key: 'low',
    label: 'Low',
    textColor: '#86efac', // emerald-300
    bgColor: '#06341d',   // dark emerald
    strokeColor: '#16a34a', // emerald-600
    fillColor: '#22c55e',   // emerald-500
    patternId: 'pattern-risk-low',
    shapeDescription: 'Horizontal hatching with triangular indicators',
  },
  none: {
    key: 'none',
    label: 'None',
    textColor: '#cbd5e1', // slate-300
    bgColor: '#161f2e',   // dark slate
    strokeColor: '#64748b', // slate-500
    fillColor: '#475569',   // slate-600
    patternId: 'pattern-risk-none',
    shapeDescription: 'Clean solid fill with subtle border',
  },
  unknown: {
    key: 'unknown',
    label: 'Unknown',
    textColor: '#cbd5e1', // slate-300
    bgColor: '#1e242b',   // dark charcoal
    strokeColor: '#64748b', // slate-500
    fillColor: '#475569',   // slate-600
    patternId: 'pattern-risk-unknown',
    shapeDescription: 'Vertical dashed lines with neutral badge',
  },
};

/**
 * Calculates sRGB relative luminance according to W3C WCAG 2.1 specs.
 */
export function getLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const a = [r, g, b].map((v) => {
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });

  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Calculates WCAG contrast ratio between two hex colors.
 * WCAG AA normal text requires contrast >= 4.5.
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
