import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center space-y-4" data-testid="not-found-page">
      <h1 className="text-3xl font-bold text-slate-900">404 — Page Not Found</h1>
      <p className="text-sm text-slate-600 max-w-md mx-auto">
        The requested URL does not match any route in the SupplyChain Sentinel system.
      </p>
      <div className="pt-2">
        <Link
          to="/"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-xs text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Return to Overview
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
