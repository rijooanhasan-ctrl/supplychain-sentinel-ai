import React, { useState } from 'react';
import { StatusLegend } from './StatusLegend';

export const HowToReadPanel: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section
      aria-label="Guidance on interpreting overview metrics"
      className={`bg-surface border border-border-subtle rounded-lg p-4 sm:p-5 shadow-xs space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">📖</span>
          <h2 className="text-sm font-bold text-text-primary">
            How to read this overview
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls="how-to-read-content"
          className="text-xs font-semibold text-accent-primary hover:text-sky-300 underline focus:outline-none focus:ring-2 focus:ring-accent-primary rounded px-1.5 py-0.5"
        >
          {isOpen ? 'Hide guidance ▲' : 'Show guidance ▼'}
        </button>
      </div>

      {isOpen && (
        <div id="how-to-read-content" className="space-y-4 pt-2 border-t border-border-subtle text-xs text-text-secondary leading-relaxed">
          <ul className="space-y-2 list-disc list-inside">
            <li>
              <strong>Overall Status Badge:</strong> Pre-registered assessment based on component stockouts, critical alerts, late deliveries, and supplier performance with a plain-language summary of counts.
            </li>
            <li>
              <strong>Where the Problems Are (Compact Globe):</strong> Geospatial view of vendors, warehouses, and delayed routes. Click to activate wheel zoom and select entities to view details or jump to the Global Map.
            </li>
            <li>
              <strong>What You Should Do Next:</strong> Plain-language prioritized decision guidance and urgent disruption alerts linking directly to evaluated recommendations.
            </li>
            <li>
              <strong>Runway Chart (Stock Duration):</strong> The solid colored bar shows how many days current usable stock will last under average consumption. Red hatched bars depict stockout gaps before replenishment.
            </li>
            <li>
              <strong>Suppliers Needing Attention & Delivery Schedule:</strong> Track vendor on-time fulfillment rates and expand the incoming delivery schedule for chronological purchase order details.
            </li>
          </ul>

          <div className="p-3 bg-elevated rounded border border-border-subtle space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted block">
              Pattern & Risk Level Legend
            </span>
            <StatusLegend levels={['critical', 'high', 'medium', 'low', 'none']} />
          </div>
        </div>
      )}
    </section>
  );
};
