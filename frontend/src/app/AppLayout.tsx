import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { DemoBanner } from '../components/DemoBanner';

const NAV_ITEMS = [
  { label: 'Overview', to: '/' },
  { label: 'Alerts', to: '/alerts' },
  { label: 'Recommendations', to: '/recommendations' },
  { label: 'Inventory Risk', to: '/inventory-risk' },
  { label: 'Supplier Risk', to: '/supplier-risk' },
  { label: 'Demand Forecasting', to: '/forecasting' },
  { label: 'Inventory', to: '/inventory' },
  { label: 'Suppliers', to: '/suppliers' },
  { label: 'Purchase Orders', to: '/purchase-orders' },
  { label: 'Data Sources', to: '/data-sources' },
];

export function AppLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Banner (DEMO DATA & As-Of Date) */}
      <DemoBanner />

      <div className="flex-1 flex flex-col md:flex-row">
        {/* Navigation Sidebar (Desktop) and Top Bar (Mobile) */}
        <aside
          aria-label="Sidebar Navigation"
          className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-slate-200 shrink-0"
        >
          {/* Brand Header */}
          <div className="p-4 md:p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-900">
                  SupplyChain Sentinel
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                  AI
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Resilient Supply Chain</p>
            </div>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="md:hidden p-2 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Navigation Links */}
          <nav
            aria-label="Main Navigation"
            className={`${mobileMenuOpen ? 'block' : 'hidden'} md:block p-3 space-y-1`}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-sm rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                    isActive
                      ? 'bg-blue-50 text-blue-900 font-semibold border-l-4 border-blue-600'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
