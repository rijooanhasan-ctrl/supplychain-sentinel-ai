import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './app/AppLayout';
import { MetaProvider } from './context/MetaContext';
import { OverviewPage } from './pages/OverviewPage';
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
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <MetaProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="recommendations" element={<RecommendationsPage />} />
            <Route path="simulator" element={<SimulatorPage />} />
            <Route path="inventory-risk" element={<InventoryRiskPage />} />
            <Route path="supplier-risk" element={<SupplierRiskPage />} />
            <Route path="forecasting" element={<ForecastingPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="data-sources" element={<DataSourcesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MetaProvider>
  );
}

export default App;
