import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './app/AppLayout';
import { MetaProvider } from './context/MetaContext';
import { OverviewPage } from './pages/OverviewPage';
import { InventoryPage } from './pages/InventoryPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { DataSourcesPage } from './pages/DataSourcesPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <MetaProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
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
