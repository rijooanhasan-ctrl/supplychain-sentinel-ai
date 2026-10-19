import React from 'react';
import { RISK_PALETTE, type RiskLevelKey } from '../../theme/riskPalette';

export interface StatusLegendProps {
  levels?: RiskLevelKey[];
  onSelect?: (level: RiskLevelKey) => void;
  selectedLevel?: RiskLevelKey | null;
  className?: string;
  itemClassName?: string;
}

export const StatusLegend: React.FC<StatusLegendProps> = ({
  levels = ['critical', 'high', 'medium', 'low'],
  onSelect,
  selectedLevel,
  className = '',
  itemClassName = '',
}) => {
  return (
    <div
      role="group"
      aria-label="Risk level legend"
      className={`flex flex-wrap items-center gap-2 sm:gap-3 text-xs ${className}`}
    >
      {levels.map((lvl) => {
        const item = RISK_PALETTE[lvl];
        if (!item) return null;
        const isSelected = selectedLevel === lvl;

        const content = (
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
              isSelected
                ? 'ring-2 ring-blue-500 font-bold'
                : 'hover:bg-slate-50'
            } ${itemClassName}`}
            style={{
              borderColor: item.strokeColor,
              backgroundColor: item.bgColor,
              color: item.textColor,
            }}
          >
            {/* Visual swatch with SVG pattern preview */}
            <svg
              className="w-3.5 h-3.5 rounded-xs shrink-0 border border-slate-300"
              aria-hidden="true"
              viewBox="0 0 16 16"
            >
              <rect width="16" height="16" fill={item.bgColor} />
              <rect width="16" height="16" fill={`url(#${item.patternId})`} />
            </svg>
            <span className="font-semibold">{item.label}</span>
          </span>
        );

        if (onSelect) {
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => onSelect(lvl)}
              aria-pressed={isSelected}
              className="focus:outline-none focus:ring-2 focus:ring-blue-500 rounded cursor-pointer"
            >
              {content}
            </button>
          );
        }

        return <span key={lvl}>{content}</span>;
      })}
    </div>
  );
};
