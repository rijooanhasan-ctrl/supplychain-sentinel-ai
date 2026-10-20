import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RISK_PALETTE, getContrastRatio, type RiskLevelKey } from './riskPalette';

const indexCssContent = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8');

describe('App-Wide Dark Theme & Accessibility Tokens', () => {
  it('declares dark design tokens on :root and color-scheme: dark', () => {
    expect(indexCssContent).toContain('color-scheme: dark');
    expect(indexCssContent).toContain('--bg-canvas: #101214');
    expect(indexCssContent).toContain('--bg-sidebar: #151719');
    expect(indexCssContent).toContain('--bg-surface: #1B1F22');
    expect(indexCssContent).toContain('--bg-elevated: #22272B');
    expect(indexCssContent).toContain('--border-subtle: #30363B');
    expect(indexCssContent).toContain('--border-strong: #646C74');
    expect(indexCssContent).toContain('--text-primary: #E6E8EA');
    expect(indexCssContent).toContain('--text-secondary: #A0A6AD');
    expect(indexCssContent).toContain('--text-muted: #8B949E');
  });

  it('declares print media override with clean black text on white background and no dark surfaces', () => {
    expect(indexCssContent).toContain('@media print');
    // Inside @media print, tokens must override to white background and dark text
    const printSection = indexCssContent.slice(indexCssContent.indexOf('@media print'));
    expect(printSection).toContain('--bg-canvas: #ffffff');
    expect(printSection).toContain('--bg-surface: #ffffff');
    expect(printSection).toContain('color: #000000 !important');
  });

  describe('WCAG AA Contrast Ratios', () => {
    const tokens = {
      surface: '#1B1F22',
      canvas: '#101214',
      textPrimary: '#E6E8EA',
      textSecondary: '#A0A6AD',
      textMuted: '#8B949E',
      accentPrimary: '#38bdf8',
      linkColor: '#58a6ff',
      borderStrong: '#646C74',
    };

    it('ensures textPrimary meets normal body text contrast (>= 4.5:1) on surface and canvas', () => {
      expect(getContrastRatio(tokens.textPrimary, tokens.surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(tokens.textPrimary, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures textSecondary meets normal body text contrast (>= 4.5:1) on surface and canvas', () => {
      expect(getContrastRatio(tokens.textSecondary, tokens.surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(tokens.textSecondary, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures textMuted meets normal body text contrast (>= 4.5:1) on surface and canvas', () => {
      expect(getContrastRatio(tokens.textMuted, tokens.surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(tokens.textMuted, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures interactive accent and link colors meet contrast (>= 4.5:1) on surface', () => {
      expect(getContrastRatio(tokens.accentPrimary, tokens.surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(tokens.linkColor, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures UI border indicators meet UI element contrast (>= 3.0:1) on surface', () => {
      expect(getContrastRatio(tokens.borderStrong, tokens.surface)).toBeGreaterThanOrEqual(3.0);
    });

    it('ensures every risk palette level meets WCAG AA contrast (>= 4.5:1) against both its badge background and card surface', () => {
      const levels: RiskLevelKey[] = ['critical', 'high', 'medium', 'low', 'none', 'unknown'];
      levels.forEach((lvl) => {
        const item = RISK_PALETTE[lvl];
        const selfContrast = getContrastRatio(item.textColor, item.bgColor);
        const surfaceContrast = getContrastRatio(item.textColor, tokens.surface);
        expect(selfContrast).toBeGreaterThanOrEqual(4.5);
        expect(surfaceContrast).toBeGreaterThanOrEqual(4.5);
      });
    });
  });

  describe('Static Regression Scanner for Banned Light Utilities', () => {
    const bannedPatterns = [
      { name: 'bg-white (non-print)', regex: /\b(?<!print:)bg-white\b/ },
      { name: 'bg-slate-50/100/200 (non-print)', regex: /\b(?<!print:)bg-slate-(50|100|200)\b/ },
      { name: 'bg-gray-50/100/200 (non-print)', regex: /\b(?<!print:)bg-gray-(50|100|200)\b/ },
      { name: 'text-slate-900 (non-print)', regex: /\b(?<!print:)text-slate-900\b/ },
      { name: 'text-black (non-print)', regex: /\b(?<!print:)text-black\b/ },
    ];

    const sourceModules = import.meta.glob<string>('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    });

    it('finds zero un-allowlisted banned light utilities across all frontend source files', () => {
      const violations: string[] = [];

      for (const [filePath, content] of Object.entries(sourceModules)) {
        if (filePath.includes('.test.') || filePath.endsWith('setupTests.ts')) {
          continue;
        }

        const lines = content.split('\n');
        lines.forEach((line: string, idx: number) => {
          for (const pattern of bannedPatterns) {
            if (pattern.regex.test(line)) {
              violations.push(
                `${filePath}:${idx + 1} [${pattern.name}]: ${line.trim()}`
              );
            }
          }
        });
      }

      expect(violations).toEqual([]);
    });
  });
});
