import { describe, it, expect } from 'vitest';
import { RISK_PALETTE, getContrastRatio, type RiskLevelKey } from './riskPalette';

describe('Risk Palette & WCAG AA Accessibility Contrast', () => {
  const levels: RiskLevelKey[] = ['critical', 'high', 'medium', 'low', 'none', 'unknown'];

  it('defines valid palette properties for all required risk levels', () => {
    levels.forEach((lvl) => {
      const entry = RISK_PALETTE[lvl];
      expect(entry).toBeDefined();
      expect(entry.key).toBe(lvl);
      expect(entry.label).toBeTruthy();
      expect(entry.patternId).toBeTruthy();
      expect(entry.shapeDescription).toBeTruthy();
      expect(entry.textColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.bgColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.strokeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.fillColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it('ensures every risk level has text-to-background contrast meeting WCAG AA standard (>= 4.5:1)', () => {
    levels.forEach((lvl) => {
      const entry = RISK_PALETTE[lvl];
      const contrast = getContrastRatio(entry.textColor, entry.bgColor);
      // WCAG AA requires at least 4.5:1 for normal body text
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('ensures distinct patternId for greyscale/colorblind differentiation', () => {
    const patternIds = levels.map((lvl) => RISK_PALETTE[lvl].patternId);
    const uniquePatterns = new Set(patternIds);
    expect(uniquePatterns.size).toBe(levels.length);
  });
});
