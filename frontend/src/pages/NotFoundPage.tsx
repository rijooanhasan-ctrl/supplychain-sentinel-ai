import { Link, useLocation } from 'react-router-dom';

export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="py-16 text-center space-y-4" data-testid="not-found-page">
      <h1 className="text-3xl font-bold text-text-primary">404 — Page Not Found</h1>
      <p className="text-sm text-text-secondary max-w-md mx-auto">
        The requested path <code className="px-1.5 py-0.5 bg-elevated rounded text-text-primary border border-border-subtle font-mono text-xs">{location.pathname}</code> does not match any route in the SupplyChain Sentinel system.
      </p>
      <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-xs text-sm font-semibold text-text-primary bg-accent-primary hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer"
        >
          Return to Overview
        </Link>
        <Link
          to="/globe"
          className="inline-flex items-center px-4 py-2 border border-border-subtle rounded-md shadow-xs text-sm font-medium text-text-primary bg-elevated hover:bg-hover focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer"
        >
          Open Global Map
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
