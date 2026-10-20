import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { InfoTip } from './InfoTip';

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  explanation: string;
  to?: string;
  infoTerm?: string;
  infoDescription?: string;
  testId?: string;
  badge?: ReactNode;
  className?: string;
}

/**
 * Key Performance Indicator Tile.
 *
 * Requirements:
 * - Big number display.
 * - Short label with optional accessible InfoTip.
 * - One-line plain-language explanation.
 * - Optional routing link with visible keyboard focus states.
 */
export const KpiTile: React.FC<KpiTileProps> = ({
  label,
  value,
  explanation,
  to,
  infoTerm,
  infoDescription,
  testId,
  badge,
  className = '',
}) => {
  const content = (
    <div
      data-testid={testId}
      className={`bg-surface border border-border-subtle rounded-lg p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full transition-all duration-150 ${
        to
          ? 'hover:border-accent-primary hover:shadow-md focus-within:ring-2 focus-within:ring-accent-primary cursor-pointer group'
          : ''
      } ${className}`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center text-xs font-semibold uppercase tracking-wider text-text-secondary">
            <span>{label}</span>
            {infoTerm && infoDescription && (
              <InfoTip term={infoTerm} description={infoDescription} />
            )}
          </div>
          {badge}
        </div>

        <div className="text-2xl sm:text-3xl font-extrabold text-text-primary font-mono tracking-tight my-1">
          {value}
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-border-subtle flex items-center justify-between">
        <p className="text-xs text-text-secondary font-medium leading-snug">{explanation}</p>
        {to && (
          <span
            aria-hidden="true"
            className="text-xs text-accent-primary font-semibold ml-2 group-hover:translate-x-0.5 transition-transform shrink-0"
          >
            &rarr;
          </span>
        )}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="block focus:outline-none rounded-lg focus-visible:ring-2 focus-visible:ring-accent-primary"
      >
        {content}
      </Link>
    );
  }

  return content;
};
