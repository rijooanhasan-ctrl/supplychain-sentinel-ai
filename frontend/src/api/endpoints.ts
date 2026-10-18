import { getJson } from './http';
import type {
  Component,
  ComponentDetail,
  CustomerOrder,
  DatasetMetaResponse,
  DeliveryRecord,
  DemandHistoryResponse,
  HealthResponse,
  InventoryItem,
  Paginated,
  Product,
  ProductDetail,
  PurchaseOrder,
  PurchaseOrderDetail,
  Supplier,
  SupplierDetail,
  Warehouse,
  InventoryRiskListResponse,
  InventoryRiskDetailResponse,
  RiskLevel,
  SupplierRiskBand,
  SupplierRiskListResponse,
  SupplierRiskDetailResponse,
  ForecastEvaluationResponse,
  ComponentForecastDetailResponse,
  AlertsFilterParams,
  AlertsListResponse,
  AlertDetail,
  RecommendationsFilterParams,
  RecommendationsResponse,
  SimulationRequestParams,
  SimulationResponse,
  IntegrationStatus,
} from './types';

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson<HealthResponse>('/api/health', { signal });
}

export function getMeta(signal?: AbortSignal): Promise<DatasetMetaResponse> {
  return getJson<DatasetMetaResponse>('/api/meta', { signal });
}

export function listProducts(
  params?: { limit?: number; offset?: number },
  signal?: AbortSignal
): Promise<Paginated<Product>> {
  return getJson<Paginated<Product>>('/api/products', { params, signal });
}

export function getProduct(id: number, signal?: AbortSignal): Promise<ProductDetail> {
  return getJson<ProductDetail>(`/api/products/${id}`, { signal });
}

export function listComponents(
  params?: {
    category?: string;
    q?: string;
    is_active?: boolean;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<Paginated<Component>> {
  return getJson<Paginated<Component>>('/api/components', { params, signal });
}

export function getComponent(id: number, signal?: AbortSignal): Promise<ComponentDetail> {
  return getJson<ComponentDetail>(`/api/components/${id}`, { signal });
}

export function getDemandHistory(
  id: number,
  days?: number,
  signal?: AbortSignal
): Promise<DemandHistoryResponse> {
  return getJson<DemandHistoryResponse>(`/api/components/${id}/demand-history`, {
    params: { days },
    signal,
  });
}

export function listSuppliers(
  params?: { limit?: number; offset?: number },
  signal?: AbortSignal
): Promise<Paginated<Supplier>> {
  return getJson<Paginated<Supplier>>('/api/suppliers', { params, signal });
}

export function getSupplier(id: number, signal?: AbortSignal): Promise<SupplierDetail> {
  return getJson<SupplierDetail>(`/api/suppliers/${id}`, { signal });
}

export function listWarehouses(
  params?: { limit?: number; offset?: number },
  signal?: AbortSignal
): Promise<Paginated<Warehouse>> {
  return getJson<Paginated<Warehouse>>('/api/warehouses', { params, signal });
}

export function listInventory(
  params?: {
    component_id?: number;
    warehouse_id?: number;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<Paginated<InventoryItem>> {
  return getJson<Paginated<InventoryItem>>('/api/inventory', { params, signal });
}

export function listPurchaseOrders(
  params?: {
    status?: string;
    supplier_id?: number;
    component_id?: number;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<Paginated<PurchaseOrder>> {
  return getJson<Paginated<PurchaseOrder>>('/api/purchase-orders', { params, signal });
}

export function getPurchaseOrder(
  id: number,
  signal?: AbortSignal
): Promise<PurchaseOrderDetail> {
  return getJson<PurchaseOrderDetail>(`/api/purchase-orders/${id}`, { signal });
}

export function listCustomerOrders(
  params?: {
    status?: string;
    priority?: string;
    product_id?: number;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<Paginated<CustomerOrder>> {
  return getJson<Paginated<CustomerOrder>>('/api/customer-orders', { params, signal });
}

export function listDeliveryRecords(
  params?: {
    supplier_id?: number;
    component_id?: number;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<Paginated<DeliveryRecord>> {
  return getJson<Paginated<DeliveryRecord>>('/api/delivery-records', { params, signal });
}

export function getInventoryRisk(
  params?: {
    risk_level?: RiskLevel | '';
    category?: string;
    criticality?: string;
    include_inactive?: boolean;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<InventoryRiskListResponse> {
  return getJson<InventoryRiskListResponse>('/api/inventory-risk', {
    params: {
      ...params,
      risk_level: params?.risk_level || undefined,
      category: params?.category || undefined,
      criticality: params?.criticality || undefined,
    },
    signal,
  });
}

export function getInventoryRiskDetail(
  id: number,
  signal?: AbortSignal
): Promise<InventoryRiskDetailResponse> {
  return getJson<InventoryRiskDetailResponse>(`/api/inventory-risk/${id}`, { signal });
}

export function getSupplierRisk(
  params?: {
    band?: SupplierRiskBand | '';
    country?: string;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<SupplierRiskListResponse> {
  return getJson<SupplierRiskListResponse>('/api/supplier-risk', {
    params: {
      ...params,
      band: params?.band || undefined,
      country: params?.country || undefined,
    },
    signal,
  });
}

export function getSupplierRiskDetail(
  supplierId: number,
  signal?: AbortSignal
): Promise<SupplierRiskDetailResponse> {
  return getJson<SupplierRiskDetailResponse>(`/api/supplier-risk/${supplierId}`, { signal });
}

export function getForecastEvaluation(
  signal?: AbortSignal
): Promise<ForecastEvaluationResponse> {
  return getJson<ForecastEvaluationResponse>('/api/forecasting/evaluation', { signal });
}

export function getComponentForecastDetail(
  componentId: number,
  days: number = 14,
  signal?: AbortSignal
): Promise<ComponentForecastDetailResponse> {
  return getJson<ComponentForecastDetailResponse>(`/api/forecasting/components/${componentId}`, {
    params: { days },
    signal,
  });
}

export function getAlerts(
  params?: AlertsFilterParams,
  signal?: AbortSignal
): Promise<AlertsListResponse> {
  return getJson<AlertsListResponse>('/api/alerts', {
    params: {
      ...params,
      severity: params?.severity || undefined,
      type: params?.type || undefined,
      component_id: params?.component_id || undefined,
      supplier_id: params?.supplier_id || undefined,
    },
    signal,
  });
}

export function getAlertDetail(
  alertId: string,
  signal?: AbortSignal
): Promise<AlertDetail> {
  return getJson<AlertDetail>(`/api/alerts/${encodeURIComponent(alertId)}`, { signal });
}

export function getRecommendations(
  params?: RecommendationsFilterParams,
  signal?: AbortSignal
): Promise<RecommendationsResponse> {
  return getJson<RecommendationsResponse>('/api/recommendations', {
    params: {
      component_id: params?.component_id || undefined,
    },
    signal,
  });
}

export function getSimulation(
  params: SimulationRequestParams,
  signal?: AbortSignal
): Promise<SimulationResponse> {
  return getJson<SimulationResponse>('/api/simulation', {
    params: {
      component_id: params.component_id,
      supplier_delay_days: params.supplier_delay_days !== undefined ? params.supplier_delay_days : undefined,
      demand_multiplier: params.demand_multiplier !== undefined ? params.demand_multiplier : undefined,
      on_hand_delta: params.on_hand_delta !== undefined ? params.on_hand_delta : undefined,
      alt_supplier_available: params.alt_supplier_available !== undefined ? params.alt_supplier_available : undefined,
    },
    signal,
  });
}

export function getIntegrationStatus(
  signal?: AbortSignal
): Promise<IntegrationStatus> {
  return getJson<IntegrationStatus>('/api/integration-status', { signal });
}




