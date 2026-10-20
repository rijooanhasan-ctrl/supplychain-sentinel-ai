import { describe, it, expect } from 'vitest';
import { computeOverallStatus } from './overviewStatus';

describe('computeOverallStatus Pre-registered Rule & Boundaries', () => {
  it('returns "Insufficient data" when not seeded', () => {
    const res = computeOverallStatus({ seeded: false });
    expect(res.status).toBe('Insufficient data');
    expect(res.riskBand).toBe('unknown');
    expect(res.reason).toContain('not initialized');
  });

  it('returns "Insufficient data" when componentsEvaluated is 0', () => {
    const res = computeOverallStatus({ seeded: true, componentsEvaluated: 0 });
    expect(res.status).toBe('Insufficient data');
    expect(res.riskBand).toBe('unknown');
  });

  it('returns "Insufficient data" when all evaluated component risks are unknown', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 5,
      riskCounts: { unknown: 5, critical: 0, high: 0, medium: 0, low: 0 },
    });
    expect(res.status).toBe('Insufficient data');
    expect(res.riskBand).toBe('unknown');
  });

  it('returns "Urgent action needed" when any component risk is critical', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 14,
      riskCounts: { critical: 1, high: 2, medium: 3, low: 8 },
      earliestShortage: { sku: 'CPU-X7', days: 5 },
    });
    expect(res.status).toBe('Urgent action needed');
    expect(res.riskBand).toBe('critical');
    expect(res.reason).toBe('1 part may run out within 5 days');
  });

  it('returns "Urgent action needed" when critical alerts exist even if no critical parts', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 14,
      riskCounts: { critical: 0, high: 0, medium: 0, low: 14 },
      alertsSummary: { counts_by_severity: { critical: 2 } },
    });
    expect(res.status).toBe('Urgent action needed');
    expect(res.riskBand).toBe('critical');
    expect(res.reason).toBe('2 critical disruption alerts');
  });

  it('generates combined reason when both critical parts and critical alerts exist', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 14,
      riskCounts: { critical: 2 },
      earliestShortage: { sku: 'BAT-400', days: 3 },
      alertsSummary: { counts_by_severity: { critical: 1 } },
    });
    expect(res.status).toBe('Urgent action needed');
    expect(res.reason).toBe('2 parts may run out within 3 days; 1 critical disruption alert');
  });

  it('returns "Needs attention" when high or medium risk components exist', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 10,
      riskCounts: { critical: 0, high: 1, medium: 1, low: 8 },
      earliestShortage: { sku: 'SEN-09', days: 12 },
    });
    expect(res.status).toBe('Needs attention');
    expect(res.riskBand).toBe('high');
    expect(res.reason).toBe('2 parts may run out within 12 days');
  });

  it('returns "Needs attention" when overdue or slipped deliveries exist', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 10,
      riskCounts: { critical: 0, high: 0, medium: 0, low: 10 },
      overdueCount: 1,
      delayedCount: 1,
    });
    expect(res.status).toBe('Needs attention');
    expect(res.riskBand).toBe('high');
    expect(res.reason).toBe('2 late deliveries');
  });

  it('returns "Needs attention" when high-risk suppliers exist', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 10,
      riskCounts: { critical: 0, high: 0, medium: 0, low: 10 },
      supplierCountsByBand: { high: 3 },
    });
    expect(res.status).toBe('Needs attention');
    expect(res.riskBand).toBe('high');
    expect(res.reason).toBe('3 high-risk suppliers');
  });

  it('combines counts dynamically in "Needs attention" reason', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 10,
      riskCounts: { critical: 0, high: 1, medium: 0, low: 9 },
      earliestShortage: { sku: 'MOD-01', days: 6 },
      overdueCount: 2,
      delayedCount: 0,
      supplierCountsByBand: { high: 1 },
    });
    expect(res.status).toBe('Needs attention');
    expect(res.reason).toBe('1 part may run out within 6 days; 2 late deliveries; 1 high-risk supplier');
  });

  it('returns "All clear" when no disruptions, overdue POs, or high risks exist', () => {
    const res = computeOverallStatus({
      seeded: true,
      componentsEvaluated: 15,
      riskCounts: { critical: 0, high: 0, medium: 0, low: 15 },
      alertsSummary: { counts_by_severity: { critical: 0, high: 0 } },
      overdueCount: 0,
      delayedCount: 0,
      supplierCountsByBand: { high: 0, medium: 0, low: 8 },
    });
    expect(res.status).toBe('All clear');
    expect(res.riskBand).toBe('low');
    expect(res.reason).toContain('within expected limits');
  });
});
