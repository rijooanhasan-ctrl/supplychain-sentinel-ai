import React, { useState } from 'react';
import { StatusLegend } from './StatusLegend';

export const HowToReadPanel: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section
      aria-label="Guidance on interpreting overview metrics"
      className={`bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">📖</span>
          <h2 className="text-sm font-bold text-slate-900">
            How to read this overview
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls="how-to-read-content"
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1.5 py-0.5"
        >
          {isOpen ? 'Hide guidance ▲' : 'Show guidance ▼'}
        </button>
      </div>

      {isOpen && (
        <div id="how-to-read-content" className="space-y-4 pt-2 border-t border-slate-100 text-xs text-slate-700 leading-relaxed">
          <ul className="space-y-2 list-disc list-inside">
            <li>
              <strong>Executive Headline:</strong> Highlights the single most pressing supply chain disruption derived from live inventory models, giving immediate situational awareness.
            </li>
            <li>
              <strong>Runway Chart (Stock Duration):</strong> The solid colored bar shows how many days current usable plant inventory will last under average consumption.
            </li>
            <li>
              <strong>Shortage Gap & Red Hatching:</strong> When stock runs out before the next shipment arrives, a red hatched bar depicts the gap days along with the unmet component deficit.
            </li>
            <li>
              <strong>Delivery Markers (▼):</strong> Inbound purchase order arrival dates are marked along the timeline with their order quantities and date basis (promised vs estimated).
            </li>
            <li>
              <strong>Accessibility & Greyscale Patterns:</strong> Colors are reinforced with distinct geometric SVG patterns so charts remain clearly readable across monochrome screens and for color-blind viewers.
            </li>
          </ul>

          <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
              Pattern & Risk Level Legend
            </span>
            <StatusLegend levels={['critical', 'high', 'medium', 'low', 'none']} />
          </div>
        </div>
      )}
    </section>
  );
};
