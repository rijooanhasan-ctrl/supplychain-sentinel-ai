import React from 'react';
import { Link } from 'react-router-dom';
import type { SupplierRiskItem, RiskLevel } from '../../api/types';
import { RiskBadge } from '../Badge';

export interface SupplierReliabilityBarsProps {
  suppliers: SupplierRiskItem[];
  className?: string;
}

export const SupplierReliabilityBars: React.FC<SupplierReliabilityBarsProps> = ({
  suppliers,
  className = '',
}) => {
  // Sort worst first: ascending on_time_rate (null rates at the end or treated as 0)
  const sorted = [...suppliers].sort((a, b) => {
    const rateA = a.on_time_rate ?? -1;
    const rateB = b.on_time_rate ?? -1;
    return rateA - rateB;
  });

  return (
    <div className={`space-y-3 ${className}`} data-testid="supplier-reliability-bars-container">
      {sorted.map((s) => {
        const rate = s.on_time_rate;
        const ratePercent = rate != null ? rate * 100 : 0;
        const isLimited = s.confidence === 'low' || (s.n_deliveries ?? 0) < 10;

        // Visual bar color based on on_time_rate
        let barColor = 'bg-emerald-500';
        let barStroke = 'border-emerald-600';
        if (rate == null || rate < 0.6) {
          barColor = 'bg-red-500';
          barStroke = 'border-red-600';
        } else if (rate < 0.8) {
          barColor = 'bg-amber-500';
          barStroke = 'border-amber-600';
        }

        return (
          <Link
            key={s.supplier_id}
            to={`/supplier-risk?supplier_code=${s.supplier_code}`}
            className="group block p-2.5 bg-slate-50 hover:bg-slate-100/90 border border-slate-200 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid={`supplier-bar-row-${s.supplier_code}`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs mb-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-slate-900 group-hover:text-blue-700">
                  {s.supplier_code}
                </span>
                <span className="text-slate-600 font-medium truncate max-w-[180px]">
                  {s.supplier_name || (s as unknown as { name?: string }).name}
                </span>
                <RiskBadge level={s.risk_band as RiskLevel} />
                {isLimited && (
                  <span
                    data-testid={`limited-history-${s.supplier_code}`}
                    className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-200 text-slate-700 border border-slate-300"
                  >
                    limited history
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="font-bold text-slate-900">
                  {rate != null ? `${(rate * 100).toFixed(1)}%` : '—'}
                </span>
                <span className="text-slate-500 font-normal">
                  ({s.n_deliveries} {s.n_deliveries === 1 ? 'delivery' : 'deliveries'})
                </span>
              </div>
            </div>

            {/* Horizontal Bar */}
            <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
              <div
                className={`h-full ${barColor} ${barStroke} rounded-full transition-all duration-300`}
                style={{ width: `${Math.max(2, Math.min(100, ratePercent))}%` }}
                role="progressbar"
                aria-valuenow={ratePercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${s.supplier_name} on-time delivery rate: ${ratePercent.toFixed(1)}%`}
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
};

export const SupplierReliabilityTable: React.FC<{ suppliers: SupplierRiskItem[] }> = ({ suppliers }) => {
  const sorted = [...suppliers].sort((a, b) => (a.on_time_rate ?? -1) - (b.on_time_rate ?? -1));

  return (
    <table className="min-w-full divide-y divide-slate-200 text-xs">
      <thead className="bg-slate-50 text-slate-700 font-semibold">
        <tr>
          <th scope="col" className="px-3 py-2.5 text-left">Supplier</th>
          <th scope="col" className="px-3 py-2.5 text-left">Country</th>
          <th scope="col" className="px-3 py-2.5 text-center">Risk Band</th>
          <th scope="col" className="px-3 py-2.5 text-right font-mono">On-Time Rate</th>
          <th scope="col" className="px-3 py-2.5 text-right font-mono">Deliveries (On-Time / Total)</th>
          <th scope="col" className="px-3 py-2.5 text-center">History Status</th>
          <th scope="col" className="px-3 py-2.5 text-center">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {sorted.map((s) => {
          const isLimited = s.confidence === 'low' || (s.n_deliveries ?? 0) < 10;
          return (
            <tr key={s.supplier_id} className="hover:bg-slate-50/80">
              <td className="px-3 py-2.5">
                <span className="font-mono font-bold text-slate-900">{s.supplier_code}</span>
                <span className="text-slate-500 ml-1.5">{s.supplier_name || (s as unknown as { name?: string }).name}</span>
              </td>
              <td className="px-3 py-2.5 text-slate-600 font-mono">{s.country || '—'}</td>
              <td className="px-3 py-2.5 text-center">
                <RiskBadge level={s.risk_band as RiskLevel} />
              </td>
              <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900">
                {s.on_time_rate != null ? `${(s.on_time_rate * 100).toFixed(1)}%` : '—'}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-slate-700">
                {s.n_deliveries} deliveries
              </td>
              <td className="px-3 py-2.5 text-center">
                {isLimited ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-200 text-slate-700">
                    limited history
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold text-emerald-800">
                    sufficient
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-center">
                <Link
                  to={`/supplier-risk?supplier_code=${s.supplier_code}`}
                  className="text-blue-600 hover:text-blue-800 font-semibold underline px-1 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                >
                  View Profile &rarr;
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
