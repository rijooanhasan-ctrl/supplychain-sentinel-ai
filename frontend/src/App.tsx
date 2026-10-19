import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './app/AppLayout';
import { MetaProvider } from './context/MetaContext';
import { GuidedDemoProvider } from './context/GuidedDemoContext';
import { OverviewPage } from './pages/OverviewPage';
import { ExecutiveSummaryPage } from './pages/ExecutiveSummaryPage';
import { AlertsPage } from './pages/AlertsPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { InventoryRiskPage } from './pages/InventoryRiskPage';
import { SupplierRiskPage } from './pages/SupplierRiskPage';
import { ForecastingPage } from './pages/ForecastingPage';
import { InventoryPage } from './pages/InventoryPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { DataSourcesPage } from './pages/DataSourcesPage';
import { SimulatorPage } from './pages/SimulatorPage';
import { ReportPage } from './pages/ReportPage';
import { ImportPage } from './pages/ImportPage';
import { NotFoundPage } from './pages/NotFoundPage';

const GlobePage = lazy(() => import('./pages/GlobePage').then((m) => ({ default: m.GlobePage })));

export function App() {
  return (
    <MetaProvider>
      <BrowserRouter>
        <GuidedDemoProvider>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="executive-summary" element={<ExecutiveSummaryPage />} />
              <Route path="report" element={<ReportPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="recommendations" element={<RecommendationsPage />} />
              <Route path="simulator" element={<SimulatorPage />} />
              <Route path="inventory-risk" element={<InventoryRiskPage />} />
              <Route path="supplier-risk" element={<SupplierRiskPage />} />
              <Route
                path="globe"
                element={
                  <Suspense
                    fallback={
                      <div className="min-h-[calc(100vh-80px)] bg-[#070b14] flex items-center justify-center text-slate-300">
                        Loading Global Control Tower...
                      </div>
                    }
                  >
                    <GlobePage />
                  </Suspense>
                }
              />
              <Route path="forecasting" element={<ForecastingPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
              <Route path="data-sources" element={<DataSourcesPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </GuidedDemoProvider>
      </BrowserRouter>
    </MetaProvider>
  );
}

export default App;
