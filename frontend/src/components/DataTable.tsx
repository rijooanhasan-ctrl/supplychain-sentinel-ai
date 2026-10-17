import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  render: (row: T, index: number) => ReactNode;
  isRowHeader?: boolean;
}

interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string | number;
  stickyHeader?: boolean;
  className?: string;
  testId?: string;
  expandedRowRender?: (row: T) => ReactNode;
  isRowExpanded?: (row: T) => boolean;
}

export function DataTable<T>({
  caption,
  columns,
  data,
  keyExtractor,
  stickyHeader = false,
  className = '',
  testId,
  expandedRowRender,
  isRowExpanded,
}: DataTableProps<T>) {
  const alignClass = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <div className={`overflow-x-auto border border-slate-200 rounded-lg bg-white shadow-xs ${className}`}>
      <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead className={`bg-slate-50 text-slate-700 text-xs uppercase font-semibold tracking-wider ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-4 py-3 ${alignClass[col.align || 'left']} ${col.className || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {data.map((row, index) => {
            const rowKey = keyExtractor(row, index);

            return (
              <tr key={rowKey} className="hover:bg-slate-50/80 transition-colors">
                {columns.map((col) => {
                  const alignment = alignClass[col.align || 'left'];
                  if (col.isRowHeader) {
                    return (
                      <th
                        key={col.key}
                        scope="row"
                        className={`px-4 py-3 font-semibold text-slate-900 ${alignment} ${col.className || ''}`}
                      >
                        {col.render(row, index)}
                      </th>
                    );
                  }
                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-3 text-slate-700 ${alignment} ${col.className || ''}`}
                    >
                      {col.render(row, index)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {expandedRowRender &&
        data.map((row, index) => {
          const rowKey = keyExtractor(row, index);
          const expanded = isRowExpanded ? isRowExpanded(row) : false;
          if (!expanded) return null;
          return (
            <div
              key={`${rowKey}-expansion`}
              className="p-4 bg-slate-50 border-t border-slate-200"
            >
              {expandedRowRender(row)}
            </div>
          );
        })}
    </div>
  );
}
