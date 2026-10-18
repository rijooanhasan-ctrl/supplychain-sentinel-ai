import { useId, useState } from 'react';
import type { WhyItem } from '../api/types';

interface WhyThisProps {
  items: WhyItem[] | string | string[];
  title?: string;
  dataTestId?: string;
  className?: string;
}

export function WhyThis({
  items,
  title,
  dataTestId = 'why-this-button',
  className = '',
}: WhyThisProps) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();

  // Normalize items to an array of { label?: string; text: string }
  const normalizedItems: { label?: string; text: string }[] = Array.isArray(items)
    ? items.map((item) => {
        if (typeof item === 'string') {
          return { text: item };
        }
        return item;
      })
    : [{ text: items }];

  if (normalizedItems.length === 0 || (normalizedItems.length === 1 && !normalizedItems[0].text)) {
    return null;
  }

  return (
    <div className={`inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        data-testid={dataTestId}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span aria-hidden="true" className="font-bold text-[11px]">
          {isOpen ? '▼' : '▶'}
        </span>
        <span>{title || 'Why this?'}</span>
      </button>

      {isOpen && (
        <div
          id={contentId}
          data-testid="why-this-panel"
          className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-800 space-y-2 shadow-xs"
        >
          {normalizedItems.map((item, idx) => (
            <div key={idx} className="space-y-0.5">
              {item.label && (
                <span className="font-bold text-slate-900 text-[11px] uppercase tracking-wider block">
                  {item.label}:
                </span>
              )}
              <p className="text-slate-700 leading-relaxed font-sans">{item.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
