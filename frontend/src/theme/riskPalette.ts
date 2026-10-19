/**
 * Unified Risk Color & Pattern Palette for SupplyChain Sentinel AI.
 *
 * Requirements:
 * - Every risk level defines: label, text color, background color, stroke color, fill color, and patternId.
 * - WCAG AA contrast (>= 4.5:1) verified mathematically between textColor and bgColor.
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
    textColor: '#7f1d1d', // red-900
    bgColor: '#fee2e2',   // red-100
    strokeColor: '#dc2626', // red-600
    fillColor: '#ef4444',   // red-500
    patternId: 'pattern-risk-critical',
    shapeDescription: 'Dense cross-hatch pattern with diamond indicators',
  },
  high: {
    key: 'high',
    label: 'High',
    textColor: '#7c2d12', // orange-900
    bgColor: '#ffedd5',   // orange-100
    strokeColor: '#ea580c', // orange-600
    fillColor: '#f97316',   // orange-500
    patternId: 'pattern-risk-high',
    shapeDescription: '45-degree diagonal stripes with square indicators',
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    textColor: '#713f12', // amber-900
    bgColor: '#fef3c7',   // amber-100
    strokeColor: '#d97706', // amber-600
    fillColor: '#f59e0b',   // amber-500
    patternId: 'pattern-risk-medium',
    shapeDescription: 'Polka-dot matrix with circular indicators',
  },
  low: {
    key: 'low',
    label: 'Low',
    textColor: '#14532d', // emerald-900
    bgColor: '#dcfce7',   // emerald-100
    strokeColor: '#16a34a', // emerald-600
    fillColor: '#22c55e',   // emerald-500
    patternId: 'pattern-risk-low',
    shapeDescription: 'Horizontal hatching with triangular indicators',
  },
  none: {
    key: 'none',
    label: 'None',
    textColor: '#1e293b', // slate-800
    bgColor: '#f1f5f9',   // slate-100
    strokeColor: '#94a3b8', // slate-400
    fillColor: '#cbd5e1',   // slate-300
    patternId: 'pattern-risk-none',
    shapeDescription: 'Clean solid fill with subtle border',
  },
  unknown: {
    key: 'unknown',
    label: 'Unknown',
    textColor: '#334155', // slate-700
    bgColor: '#f8fafc',   // slate-50
    strokeColor: '#64748b', // slate-500
    fillColor: '#94a3b8',   // slate-400
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
