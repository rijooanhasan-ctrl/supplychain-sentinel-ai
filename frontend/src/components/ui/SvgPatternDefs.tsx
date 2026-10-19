import type { FC } from 'react';

/**
 * Global SVG pattern definitions for accessible, greyscale-readable charts.
 */
export const SvgPatternDefs: FC = () => {
  return (
    <svg className="sr-only pointer-events-none" aria-hidden="true" width="0" height="0">
      <defs>
        {/* Critical: Dense diagonal cross-hatch */}
        <pattern
          id="pattern-risk-critical"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 0,0 l 8,8 M 8,0 l -8,8"
            stroke="#dc2626"
            strokeWidth="1.8"
          />
        </pattern>

        {/* High: 45-degree diagonal stripes */}
        <pattern
          id="pattern-risk-high"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 0,8 l 8,-8 M -2,2 l 4,-4 M 6,10 l 4,-4"
            stroke="#ea580c"
            strokeWidth="2.2"
          />
        </pattern>

        {/* Medium: Polka dot matrix */}
        <pattern
          id="pattern-risk-medium"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="4" r="2" fill="#d97706" />
        </pattern>

        {/* Low: Horizontal hatching */}
        <pattern
          id="pattern-risk-low"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <line x1="0" y1="4" x2="8" y2="4" stroke="#16a34a" strokeWidth="2" />
        </pattern>

        {/* None: Subtle dot pattern */}
        <pattern
          id="pattern-risk-none"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="4" r="1" fill="#94a3b8" />
        </pattern>

        {/* Unknown: Vertical hatching */}
        <pattern
          id="pattern-risk-unknown"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <line x1="4" y1="0" x2="4" y2="8" stroke="#64748b" strokeWidth="1.5" strokeDasharray="2,2" />
        </pattern>

        {/* Gap: Deficit window hatched red stripes */}
        <pattern
          id="pattern-runway-gap"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <path d="M 0,6 l 6,-6 M -1,1 l 2,-2 M 5,7 l 2,-2" stroke="#dc2626" strokeWidth="1.5" />
        </pattern>

        {/* Unscheduled gap pattern: dashed diagonal stripes */}
        <pattern
          id="pattern-unscheduled-gap"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <path d="M 0,6 l 6,-6" stroke="#991b1b" strokeWidth="1.5" strokeDasharray="3,2" />
        </pattern>
      </defs>
    </svg>
  );
};
