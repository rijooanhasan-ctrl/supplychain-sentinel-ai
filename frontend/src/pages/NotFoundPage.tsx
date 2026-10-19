import { Link, useLocation } from 'react-router-dom';

export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="py-16 text-center space-y-4" data-testid="not-found-page">
      <h1 className="text-3xl font-bold text-slate-900">404 — Page Not Found</h1>
      <p className="text-sm text-slate-600 max-w-md mx-auto">
        The requested path <code className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-800 font-mono text-xs">{location.pathname}</code> does not match any route in the SupplyChain Sentinel system.
      </p>
      <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-xs text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 cursor-pointer"
        >
          Return to Overview
        </Link>
        <Link
          to="/globe"
          className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-xs text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 cursor-pointer"
        >
          Open Global Map
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
