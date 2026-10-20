import React from 'react';
import { Link } from 'react-router-dom';
import type { PurchaseOrder } from '../../api/types';
import { expectedDate, isOverdue, daysBetween, isDelayedVsPromise, slippedInfo } from '../../lib/dates';
import { formatDate } from '../../lib/format';

export interface DeliveryTimelineProps {
  orders: PurchaseOrder[];
  asOf: string;
  className?: string;
}

export const DeliveryTimeline: React.FC<DeliveryTimelineProps> = ({ orders, asOf, className = '' }) => {
  // Filter active POs (open, in_transit, partially_received)
  const activeOrders = orders.filter(
    (po) => po.status === 'open' || po.status === 'in_transit' || po.status === 'partially_received'
  );

  // Categorize: overdue vs upcoming in next 30 days
  const overdueList: PurchaseOrder[] = [];
  const upcomingList: { po: PurchaseOrder; expDate: string; basis: 'estimated' | 'promised'; days: number; isSlipped: boolean; slippedDays: number; promisedDate: string }[] = [];

  for (const po of activeOrders) {
    if (isOverdue(po, asOf)) {
      overdueList.push(po);
    } else {
      const { date, basis } = expectedDate(po);
      const days = daysBetween(asOf, date);
      if (days >= 0 && days <= 30) {
        const slipped = isDelayedVsPromise(po);
        let sDays = 0;
        let pDate = po.promised_date;
        if (slipped) {
          const sInfo = slippedInfo(po);
          if (sInfo) {
            sDays = sInfo.slippedDays;
            pDate = sInfo.promisedDate;
          }
        }
        upcomingList.push({
          po,
          expDate: date,
          basis,
          days,
          isSlipped: slipped,
          slippedDays: sDays,
          promisedDate: pDate,
        });
      }
    }
  }

  // Sort upcoming soonest first, cap at 12
  upcomingList.sort((a, b) => a.days - b.days);
  const displayedUpcoming = upcomingList.slice(0, 12);
  const hasMore = upcomingList.length > 12;

  const MAX_DAYS = 30;
  const TIMELINE_WIDTH = 580; // px
  const pxPerDay = TIMELINE_WIDTH / MAX_DAYS;

  return (
    <div className={`space-y-4 ${className}`} data-testid="delivery-timeline-container">
      {/* 1. Overdue Strip (if any overdue orders exist) */}
      {overdueList.length > 0 && (
        <div
          data-testid="overdue-strip"
          className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold shrink-0"
              aria-hidden="true"
            >
              !
            </span>
            <div>
              <p className="text-xs font-bold text-red-200">
                Already Overdue ({overdueList.length} Order{overdueList.length === 1 ? '' : 's'})
              </p>
              <p className="text-[11px] text-red-300">
                Expected delivery date has already passed prior to {formatDate(asOf)}.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {overdueList.slice(0, 4).map((po) => (
              <span
                key={po.id}
                className="font-mono text-xs font-bold bg-elevated px-2 py-0.5 rounded border border-red-700/60 text-red-200 shadow-2xs"
              >
                {po.po_number}
              </span>
            ))}
            {overdueList.length > 4 && (
              <span className="text-xs text-red-300 font-semibold">+{overdueList.length - 4} more</span>
            )}
            <Link
              to="/purchase-orders"
              className="text-xs text-red-300 hover:text-red-100 font-bold underline ml-2"
            >
              Review overdue &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* 2. Timeline Axis Scale */}
      <div className="relative border-b border-border-subtle pb-1 flex justify-between text-[11px] font-mono text-text-secondary">
        <span className="font-bold text-text-primary">Today ({formatDate(asOf)})</span>
        <span>+7 days</span>
        <span>+14 days</span>
        <span>+21 days</span>
        <span>+28 days</span>
        <span>+30 days</span>
      </div>

      {/* 3. Visual Timeline Canvas */}
      {displayedUpcoming.length === 0 ? (
        <p className="text-xs text-text-secondary italic py-4">No active replenishment deliveries expected in the next 30 days.</p>
      ) : (
        <div className="space-y-2.5">
          {displayedUpcoming.map((item) => {
            const expPos = Math.min(item.days * pxPerDay, TIMELINE_WIDTH - 20);
            let promisedPos = expPos;
            if (item.isSlipped) {
              const pDays = Math.max(0, daysBetween(asOf, item.promisedDate));
              promisedPos = Math.min(pDays * pxPerDay, TIMELINE_WIDTH - 20);
            }

            return (
              <div
                key={item.po.id}
                className="p-2 bg-elevated hover:bg-hover border border-border-subtle rounded-md transition-colors"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-text-primary">{item.po.po_number}</span>
                    <span className="text-text-secondary truncate max-w-[140px]">{item.po.supplier_name}</span>
                    {item.isSlipped && (
                      <span className="inline-flex items-center px-1.5 py-0.2 bg-amber-950/60 text-amber-200 border border-amber-700/60 rounded text-[10px] font-bold">
                        Slipped {item.slippedDays}d
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-text-primary font-semibold">
                    Expected: {formatDate(item.expDate)} ({item.days}d)
                  </span>
                </div>

                {/* SVG Visual Track */}
                <svg
                  viewBox={`0 0 ${TIMELINE_WIDTH} 18`}
                  className="w-full h-4.5 overflow-visible"
                  role="img"
                  aria-label={`${item.po.po_number}: expected ${formatDate(item.expDate)}${item.isSlipped ? `, slipped from ${item.promisedDate}` : ''}`}
                >
                  {/* Axis baseline */}
                  <line x1="0" y1="9" x2={TIMELINE_WIDTH} y2="9" stroke="#30363B" strokeWidth="2" />

                  {/* Slipped arrow from promised to estimated date */}
                  {item.isSlipped && promisedPos < expPos && (
                    <g>
                      <line
                        x1={promisedPos}
                        y1="9"
                        x2={expPos}
                        y2="9"
                        stroke="#f59e0b"
                        strokeWidth="2.5"
                        strokeDasharray="3,2"
                      />
                      {/* Original promised tick */}
                      <circle cx={promisedPos} cy="9" r="3" fill="#22272B" stroke="#A0A6AD" strokeWidth="1" />
                      {/* Arrowhead pointing to new estimated date */}
                      <polygon
                        points={`${expPos - 4},6 ${expPos},9 ${expPos - 4},12`}
                        fill="#d97706"
                      />
                    </g>
                  )}

                  {/* Final expected marker */}
                  <circle
                    cx={expPos}
                    cy="9"
                    r="4.5"
                    fill={item.isSlipped ? '#d97706' : '#38bdf8'}
                    stroke="#101214"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Show All Footer */}
      <div className="flex items-center justify-between text-xs pt-2 border-t border-border-subtle">
        <span className="text-text-secondary">
          Showing {displayedUpcoming.length} of {upcomingList.length} upcoming orders within 30-day window
        </span>
        {hasMore && (
          <Link
            to="/purchase-orders"
            className="text-accent-primary hover:text-sky-300 font-semibold underline focus:outline-none focus:ring-1 focus:ring-accent-primary rounded px-1"
          >
            Show all in Purchase Orders &rarr;
          </Link>
        )}
      </div>
    </div>
  );
};

export const DeliveryTimelineTable: React.FC<{ orders: PurchaseOrder[]; asOf: string }> = ({ orders, asOf }) => {
  const activeOrders = orders.filter(
    (po) => po.status === 'open' || po.status === 'in_transit' || po.status === 'partially_received'
  );

  return (
    <table className="min-w-full divide-y divide-border-subtle text-xs bg-surface">
      <thead className="bg-elevated text-text-secondary font-semibold">
        <tr>
          <th scope="col" className="px-3 py-2.5 text-left">PO Number</th>
          <th scope="col" className="px-3 py-2.5 text-left">Supplier</th>
          <th scope="col" className="px-3 py-2.5 text-left">Status</th>
          <th scope="col" className="px-3 py-2.5 text-left">Promised Date</th>
          <th scope="col" className="px-3 py-2.5 text-left">Expected Arrival</th>
          <th scope="col" className="px-3 py-2.5 text-left">Schedule Status</th>
          <th scope="col" className="px-3 py-2.5 text-center">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border-subtle bg-surface">
        {activeOrders.slice(0, 16).map((po) => {
          const overdue = isOverdue(po, asOf);
          const { date: expDate, basis } = expectedDate(po);
          const slipped = isDelayedVsPromise(po);
          const sInfo = slipped ? slippedInfo(po) : null;

          return (
            <tr key={po.id} className="hover:bg-hover">
              <td className="px-3 py-2.5 font-mono font-bold text-text-primary">{po.po_number}</td>
              <td className="px-3 py-2.5 text-text-primary">{po.supplier_name}</td>
              <td className="px-3 py-2.5 text-text-secondary font-medium">{po.status}</td>
              <td className="px-3 py-2.5 font-mono text-text-secondary">{formatDate(po.promised_date)}</td>
              <td className="px-3 py-2.5 font-mono font-bold text-text-primary">
                {formatDate(expDate)}{' '}
                <span className="text-[10px] text-text-secondary font-normal">({basis})</span>
              </td>
              <td className="px-3 py-2.5">
                {overdue ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-red-950/60 text-red-200 border border-red-700/60">
                    Overdue
                  </span>
                ) : slipped ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950/60 text-amber-200 border border-amber-700/60">
                    Slipped {sInfo?.slippedDays ?? 0} days
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/60 text-emerald-200 border border-emerald-700/60">
                    On track
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-center">
                <Link
                  to={`/purchase-orders?po_number=${po.po_number}`}
                  className="text-accent-primary hover:text-sky-300 font-semibold underline px-1 focus:outline-none focus:ring-1 focus:ring-accent-primary rounded"
                >
                  View PO &rarr;
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
