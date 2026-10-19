import React, { useState, useRef, useEffect, useId } from 'react';

export interface InfoTipProps {
  term: string;
  description: string;
  shortLabel?: string;
  id?: string;
  className?: string;
}

/**
 * Accessible InfoTip popover (ⓘ icon button).
 *
 * Requirements:
 * - Keyboard operable (Space/Enter toggles, Esc closes).
 * - Touch & click friendly.
 * - Closes on click outside or Escape.
 * - Fully accessible aria-expanded and aria-describedby attributes.
 */
export const InfoTip: React.FC<InfoTipProps> = ({
  term,
  description,
  shortLabel,
  id: customId,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const generatedId = useId();
  const tooltipId = customId || `infotip-${generatedId.replace(/:/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Esc key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <span className={`inline-flex items-center relative align-middle ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-label={`About ${term}`}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ml-1 text-[11px] font-bold select-none transition-colors"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          id={tooltipId}
          role="tooltip"
          aria-label={term}
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 max-w-[85vw] p-3 bg-slate-900 text-white rounded-lg shadow-xl text-left border border-slate-700 pointer-events-auto"
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-1.5 mb-2">
            <div>
              <p className="text-xs font-bold text-white">{term}</p>
              {shortLabel && <p className="text-[11px] text-slate-400">{shortLabel}</p>}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close tooltip"
              className="text-slate-400 hover:text-white text-xs px-1 rounded hover:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-normal">{description}</p>
          {/* Popover Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-900 pointer-events-none" />
        </div>
      )}
    </span>
  );
};
