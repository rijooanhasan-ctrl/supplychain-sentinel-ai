/**
 * TypeScript interfaces mirroring the backend FastAPI / Pydantic response models.
 * Note: Decimal monetary amounts and percentages are serialized as strings by the backend
 * (e.g. "250.00") to preserve exact financial precision without IEEE-754 binary floating-point roundoff errors.
 */

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface DatasetMetaResponse {
  seeded: boolean;
  data_source: string;
  label: string | null;
  seed: number | null;
  as_of: string | null;
  generator_version: string | null;
  generated_at: string | null; // UTC ISO-8601 (ends with +00:00 or Z)
  counts: Record<string, number>;
  message: string | null;
}

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  environment: string;
  data_source: string;
  timestamp: string; // UTC ISO-8601 (ends with +00:00 or Z)
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  role: 'plant' | 'regional';
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  selling_price: string; // Exact decimal representation (e.g. "1499.00")
}

export interface BomLine {
  id: number;
  component_id: number;
  component_sku: string;
  component_name: string;
  quantity_per_unit: number;
}

export interface ProductDetail extends Product {
  bom_lines: BomLine[];
}

export type ComponentCriticality = 'critical' | 'high' | 'normal';

export interface Component {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit_of_measure: string;
  criticality: ComponentCriticality;
  is_active: boolean;
}

export interface SupplierComponent {
  id: number;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  unit_cost: string; // Exact decimal representation (e.g. "250.00")
  lead_time_days: number;
  min_order_qty: number;
  max_weekly_capacity: number | null;
  is_preferred: boolean;
  expedite_available: boolean;
  expedite_lead_time_days: number | null;
  expedite_cost_premium_pct: string | null; // Exact decimal percentage (e.g. "0.2500")
}

export interface SupplierOffer {
  id: number;
  component_id: number;
  component_sku: string;
  component_name: string;
  unit_cost: string; // Exact decimal representation (e.g. "250.00")
  lead_time_days: number;
  min_order_qty: number;
  max_weekly_capacity: number | null;
  is_preferred: boolean;
  expedite_available: boolean;
  expedite_lead_time_days: number | null;
  expedite_cost_premium_pct: string | null; // Exact decimal percentage (e.g. "0.2500")
}

export interface ComponentInventory {
  id: number;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  on_hand: number;
  reserved: number;
  as_of_ts: string; // UTC ISO-8601
}

export interface ComponentDetail extends Component {
  supplier_offers: SupplierComponent[];
  inventory: ComponentInventory[];
}

export interface DemandRecord {
  id: number;
  component_id: number;
  date: string;
  quantity: number;
}

export interface DemandHistoryResponse {
  items: DemandRecord[];
  total: number;
  days: number;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  country: string;
}

export interface SupplierDetail extends Supplier {
  offers: SupplierOffer[];
}

export interface InventoryItem {
  id: number;
  component_id: number;
  component_sku: string;
  component_name: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  on_hand: number;
  reserved: number;
  as_of_ts: string; // UTC ISO-8601
}

export type PurchaseOrderStatus =
  | 'open'
  | 'in_transit'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseOrderLine {
  id: number;
  component_id: number;
  component_sku: string;
  component_name: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  qty_ordered: number;
  qty_received: number;
  unit_price: string; // Exact decimal string
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  status: PurchaseOrderStatus;
  order_date: string;
  promised_date: string;
  latest_estimate_date: string | null;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseOrderLine[];
}

export type CustomerOrderPriority = 'critical' | 'high' | 'normal' | 'low';
export type CustomerOrderStatus = 'open' | 'in_production' | 'shipped' | 'cancelled';

export interface CustomerOrder {
  id: number;
  order_number: string;
  customer_name: string;
  product_id: number;
  product_sku: string;
  product_name: string;
  quantity: number;
  due_date: string;
  priority: CustomerOrderPriority;
  status: CustomerOrderStatus;
}

export interface DeliveryRecord {
  id: number;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  component_id: number;
  component_sku: string;
  component_name: string;
  purchase_order_id: number | null;
  promised_date: string;
  actual_date: string;
  qty_ordered: number;
  qty_received: number;
  qty_rejected: number;
}

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none' | 'unknown';

export interface ModelMetadata {
  name: string;
  type: string;
  description: string;
}

export interface InventoryRiskConfig {
  lookback_days: number;
  min_history_days: number;
  min_coverage_ratio: number;
  horizon_days: number;
  critical_days: number;
  high_days: number;
  medium_days: number;
  overdue_inbound_policy: string;
}

export interface RiskFlag {
  code: string;
  message: string;
}

export interface ReplenishmentInfo {
  date: string;
  qty: number;
  po_number: string;
  date_basis: 'estimated' | 'promised';
}

export interface InventoryRiskSummary {
  counts_by_risk_level: Record<RiskLevel, number>;
  components_evaluated: number;
}

export interface InventoryRiskItem {
  component_id: number;
  sku: string;
  name: string;
  category: string;
  criticality: ComponentCriticality;
  plant_usable_stock: number | null;
  plant_on_hand: number | null;
  plant_reserved: number | null;
  mean_daily_demand: number | null;
  coverage_days: number | null;
  next_replenishment: ReplenishmentInfo | null;
  shortage_date: string | null;
  days_until_shortage: number | null;
  unmet_demand_units: number;
  runout_date_without_inbound: string | null;
  risk_level: RiskLevel;
  risk_reason: string;
  forecast_status: string;
  flags: RiskFlag[];
}

export interface InventoryRiskListResponse {
  seeded: boolean;
  as_of: string | null;
  model: ModelMetadata;
  config: InventoryRiskConfig;
  summary: InventoryRiskSummary;
  items: InventoryRiskItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface UsableStockBreakdown {
  on_hand: number;
  reserved: number;
  usable: number;
  reserved_exceeds_on_hand: boolean;
}

export interface WeekdayForecast {
  weekday: number;
  weekday_name: string;
  mean_demand: number;
}

export interface InboundLineDetail {
  po_id: number;
  po_number: string;
  status: string;
  warehouse_code: string;
  qty_ordered: number;
  qty_received: number;
  remaining_qty: number;
  promised_date: string;
  latest_estimate_date: string | null;
  expected_date: string;
  date_basis: 'estimated' | 'promised';
}

export interface RegionalStock {
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  on_hand: number;
  reserved: number;
  usable: number;
}

export interface DailyProjectionItem {
  day_index: number;
  date: string;
  forecast_demand: number;
  receipts: number;
  ending_balance: number;
  unmet: number;
}

export interface InventoryRiskDetailResponse extends InventoryRiskItem {
  as_of: string;
  model: ModelMetadata;
  config: InventoryRiskConfig;
  explanation: string;
  usable_stock_breakdown: UsableStockBreakdown | null;
  forecast_by_weekday: WeekdayForecast[] | null;
  counted_inbound: InboundLineDetail[];
  unconfirmed_inbound: InboundLineDetail[];
  out_of_horizon_inbound: InboundLineDetail[];
  regional_usable_stock: RegionalStock[];
  regional_total_usable: number;
  daily_projection: DailyProjectionItem[];
  assumptions: string[];
}

