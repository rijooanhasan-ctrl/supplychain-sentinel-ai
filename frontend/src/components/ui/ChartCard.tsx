import React, { useState, type ReactNode } from 'react';
import { LoadingView, ErrorView, EmptyView } from '../StateViews';
import { InfoTip } from './InfoTip';

export interface ChartCardProps {
  title: string;
  subtitle: string;
  infoTerm?: string;
  infoDescription?: string;
  children: ReactNode;
  tableView: ReactNode;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  headerActions?: ReactNode;
  testId?: string;
  className?: string;
}

/**
 * ChartCard wrapper providing:
 * - Title and one-sentence "what this shows" plain-language explanation.
 * - Accessible "View as table" / "View as chart" toggle button.
 * - Loading, Error with Retry, and Empty states via shared StateViews.
 * - Guaranteed table view alternative for full accessibility (WCAG AA).
 */
export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  infoTerm,
  infoDescription,
  children,
  tableView,
  loading = false,
  error = null,
  onRetry,
  isEmpty = false,
  emptyTitle = 'No data available',
  emptyMessage = 'There are no active records matching this visual view.',
  headerActions,
  testId,
  className = '',
}) => {
  const [showTable, setShowTable] = useState(false);

  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={`bg-surface border border-border-subtle rounded-lg p-4 sm:p-5 shadow-xs space-y-4 ${className}`}
    >
      {/* Header with Title, Plain Subtitle, and View as Table Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h2 className="text-base sm:text-lg font-bold text-text-primary tracking-tight">
              {title}
            </h2>
            {infoTerm && infoDescription && (
              <InfoTip term={infoTerm} description={infoDescription} />
            )}
          </div>
          <p className="text-xs sm:text-sm text-text-secondary font-normal leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap">
          {headerActions}
          <button
            type="button"
            onClick={() => setShowTable((prev) => !prev)}
            aria-pressed={showTable}
            aria-label={showTable ? 'Switch to graphical chart view' : 'Switch to accessible tabular view'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text-primary bg-elevated hover:bg-hover border border-border-subtle rounded transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer"
          >
            <span aria-hidden="true">{showTable ? '📊' : '📋'}</span>
            <span>{showTable ? 'View as chart' : 'View as table'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div>
        {loading ? (
          <div className="py-12">
            <LoadingView message="Loading visual metrics..." />
          </div>
        ) : error ? (
          <div className="py-4" data-testid={testId ? `${testId}-error` : undefined}>
            <ErrorView
              error={error}
              onRetry={onRetry}
              title={`Could not load ${title.toLowerCase()}`}
            />
          </div>
        ) : isEmpty ? (
          <div className="py-8" data-testid={testId ? `${testId}-empty` : undefined}>
            <EmptyView title={emptyTitle} message={emptyMessage} />
          </div>
        ) : showTable ? (
          <div className="overflow-x-auto focus:outline-none focus:ring-1 focus:ring-accent-primary rounded">
            {tableView}
          </div>
        ) : (
          <div className="overflow-x-auto focus:outline-none focus:ring-1 focus:ring-accent-primary rounded">
            {children}
          </div>
        )}
      </div>
    </section>
  );
};
