/**
 * Plain-language glossary of supply chain decision-support terms.
 *
 * Rules:
 * - Plain language explanations without fixed or hardcoded numbers.
 * - Used in InfoTip popovers across Overview, Executive Summary, Inventory Risk,
 *   Alerts, Recommendations, and Simulator pages.
 */

export interface GlossaryTerm {
  term: string;
  shortLabel: string;
  definition: string;
}

export const GLOSSARY: Record<string, GlossaryTerm> = {
  usable_stock: {
    term: 'Usable Stock',
    shortLabel: 'Available physical inventory',
    definition:
      'Inventory physically present in the main assembly plant that is immediately available for manufacturing, calculated as on-hand stock minus units already reserved for existing commitments.',
  },
  runway: {
    term: 'Runway / Days of Cover',
    shortLabel: 'Estimated days until stockout',
    definition:
      'Estimated number of manufacturing days that current usable stock can support at projected daily consumption rates before running out, assuming zero new shipments arrive.',
  },
  shortage_date: {
    term: 'Shortage Date',
    shortLabel: 'First projected stockout date',
    definition:
      'The calendar date when projected inventory balance drops to zero or below, representing the point where assembly lines would halt without recovery intervention.',
  },
  units_short_before_delivery: {
    term: 'Units Short Before Next Delivery',
    shortLabel: 'Deficit before next replenishment',
    definition:
      'Total component units needed by manufacturing during a stockout period that cannot be fulfilled before the next scheduled replenishment order arrives.',
  },
  first_shortage_window: {
    term: 'First Shortage Window',
    shortLabel: 'Immediate critical stockout gap',
    definition:
      'The critical time interval from the initial runout date until the next scheduled shipment arrives. Tactical recommendations focus on closing this immediate window first.',
  },
  what_if_delay: {
    term: 'What-If Delay Scenario',
    shortLabel: 'Counterfactual stress-test',
    definition:
      'A simulation technique that tests supply chain resilience by hypothesizing extended supplier delays or demand shocks without modifying live or historical records.',
  },
  exposed_orders: {
    term: 'Exposed Customer Orders (Upper Bound)',
    shortLabel: 'Maximum revenue at risk',
    definition:
      'The gross selling price of customer orders scheduled to ship during a stockout window that depend on the missing component. This represents an upper bound of financial exposure, not an estimate of financial loss.',
  },
  supplier_risk_score: {
    term: 'Supplier Risk Score',
    shortLabel: 'Delivery reliability assessment',
    definition:
      'A composite indicator (0 to 100) reflecting historical supplier performance based on on-time shipment rate, delivery delay distribution, and quantity fulfillment accuracy.',
  },
  confidence: {
    term: 'Assessment Confidence',
    shortLabel: 'Statistical sample sufficiency',
    definition:
      'Indicates whether enough historical deliveries exist to draw statistically sound reliability conclusions. Suppliers with few deliveries are labeled with limited history.',
  },
  slipped_delivery: {
    term: 'Slipped Delivery',
    shortLabel: 'Estimated later than promised',
    definition:
      'An open purchase order whose latest supplier delivery estimate has shifted to a date later than the original contractually promised date.',
  },
  overdue_delivery: {
    term: 'Overdue Delivery',
    shortLabel: 'Past expected date',
    definition:
      'An open purchase order whose expected delivery date has already passed relative to the system snapshot date without confirmation of receipt.',
  },
};
