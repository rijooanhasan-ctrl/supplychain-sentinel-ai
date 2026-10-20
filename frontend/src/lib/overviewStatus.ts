export type OverallStatusType =
  | 'Insufficient data'
  | 'Urgent action needed'
  | 'Needs attention'
  | 'All clear';

export interface StatusRuleInputs {
  seeded?: boolean;
  componentsEvaluated?: number;
  riskCounts?: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    unknown?: number;
  };
  alertsSummary?: {
    total_alerts?: number;
    counts_by_severity?: {
      critical?: number;
      high?: number;
      medium?: number;
      low?: number;
      info?: number;
    };
  };
  overdueCount?: number;
  delayedCount?: number;
  supplierCountsByBand?: {
    high?: number;
    medium?: number;
    low?: number;
    unknown?: number;
  };
  earliestShortage?: {
    sku: string;
    days: number;
    date?: string;
  } | null;
}

export interface OverallStatusResult {
  status: OverallStatusType;
  reason: string;
  riskBand: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
}

export function computeOverallStatus(inputs: StatusRuleInputs): OverallStatusResult {
  const {
    seeded,
    componentsEvaluated = 0,
    riskCounts = {},
    alertsSummary = {},
    overdueCount = 0,
    delayedCount = 0,
    supplierCountsByBand = {},
    earliestShortage = null,
  } = inputs;

  const critRisk = riskCounts.critical || 0;
  const highRisk = riskCounts.high || 0;
  const medRisk = riskCounts.medium || 0;
  const lowRisk = riskCounts.low || 0;
  const unkRisk = riskCounts.unknown || 0;

  const totalKnownRisk = critRisk + highRisk + medRisk + lowRisk;
  const isAllUnknown = totalKnownRisk === 0 && unkRisk > 0;

  // 1. Insufficient data: if not seeded, or no components evaluated, or every component risk is unknown
  if (seeded === false || componentsEvaluated === 0 || isAllUnknown) {
    return {
      status: 'Insufficient data',
      reason: 'Dataset is not initialized or no component risk evaluations are available.',
      riskBand: 'unknown',
    };
  }

  const critAlerts = alertsSummary.counts_by_severity?.critical || 0;

  // 2. Urgent action needed: if any component risk is critical OR any alert is critical
  if (critRisk > 0 || critAlerts > 0) {
    const reasons: string[] = [];
    if (critRisk > 0) {
      if (earliestShortage?.days != null && earliestShortage.days <= 7) {
        reasons.push(
          `${critRisk} part${critRisk === 1 ? '' : 's'} may run out within ${earliestShortage.days} day${earliestShortage.days === 1 ? '' : 's'}`
        );
      } else {
        reasons.push(
          `${critRisk} part${critRisk === 1 ? '' : 's'} facing critical stockout risk`
        );
      }
    }
    if (critAlerts > 0) {
      reasons.push(
        `${critAlerts} critical disruption alert${critAlerts === 1 ? '' : 's'}`
      );
    }

    return {
      status: 'Urgent action needed',
      reason: reasons.join('; '),
      riskBand: 'critical',
    };
  }

  const highSuppliers = supplierCountsByBand.high || 0;
  const totalLateDeliveries = overdueCount + delayedCount;
  const highOrMedRiskParts = highRisk + medRisk;

  // 3. Needs attention: if any component is high or medium risk OR any open PO is overdue or slipped OR any supplier band is high
  if (
    highOrMedRiskParts > 0 ||
    totalLateDeliveries > 0 ||
    highSuppliers > 0
  ) {
    const reasons: string[] = [];
    if (highOrMedRiskParts > 0) {
      if (earliestShortage?.days != null && earliestShortage.days <= 14) {
        reasons.push(
          `${highOrMedRiskParts} part${highOrMedRiskParts === 1 ? '' : 's'} may run out within ${earliestShortage.days} day${earliestShortage.days === 1 ? '' : 's'}`
        );
      } else {
        reasons.push(
          `${highOrMedRiskParts} part${highOrMedRiskParts === 1 ? '' : 's'} with elevated stockout risk`
        );
      }
    }
    if (totalLateDeliveries > 0) {
      reasons.push(
        `${totalLateDeliveries} late deliver${totalLateDeliveries === 1 ? 'y' : 'ies'}`
      );
    }
    if (highSuppliers > 0) {
      reasons.push(
        `${highSuppliers} high-risk supplier${highSuppliers === 1 ? '' : 's'}`
      );
    }

    return {
      status: 'Needs attention',
      reason: reasons.join('; '),
      riskBand: 'high',
    };
  }

  // 4. All clear
  return {
    status: 'All clear',
    reason: 'All evaluated inventory levels, suppliers, and purchase orders are within expected limits.',
    riskBand: 'low',
  };
}
