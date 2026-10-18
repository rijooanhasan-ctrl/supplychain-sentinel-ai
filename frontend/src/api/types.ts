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

export interface ShortageEpisode {
  episode_index: number;
  start_date: string;
  end_date: string;
  days: number;
  unmet_units: number;
  ends_because: 'inbound_receipt' | 'horizon_end' | 'other';
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
  unmet_before_next_inbound: number | null;
  first_episode_start_date: string | null;
  first_episode_end_date: string | null;
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
  shortage_episodes: ShortageEpisode[];
  assumptions: string[];
}

// ==========================================
// Supplier Risk Types
// ==========================================

export type SupplierRiskBand = 'low' | 'medium' | 'high' | 'unknown';
export type SupplierConfidence = 'high' | 'medium' | 'low' | 'none';

export interface MetricScoreBreakdown {
  metric_name: string;
  raw_value: number | null;
  penalty: number | null;
  nominal_weight: number;
  effective_weight: number;
  contribution_points: number;
  dropped: boolean;
  dropped_reason: string | null;
}

export interface MonthlyPerformance {
  month: string;
  n_deliveries: number;
  on_time_rate: number | null;
}

export interface SupplierRiskConfig {
  lookback_days: number;
  on_time_grace_days: number;
  w_on_time: number;
  w_delay: number;
  w_rejection: number;
  w_fill: number;
  late_rate_full_penalty: number;
  delay_full_penalty_days: number;
  rejection_full_penalty: number;
  fill_shortfall_full_penalty: number;
  band_medium: number;
  band_high: number;
  low_confidence_below: number;
  high_confidence_from: number;
}

export interface SupplierRiskItem {
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  country: string;
  n_deliveries: number;
  risk_score: number | null;
  risk_band: SupplierRiskBand;
  confidence: SupplierConfidence;
  on_time_rate: number | null;
  on_time_ci_lower: number | null;
  on_time_ci_upper: number | null;
  late_delivery_probability: number | null;
  expected_delay_days_if_late: number | null;
  avg_delay_days_all: number | null;
  avg_delay_days_when_late: number | null;
  rejection_rate: number | null;
  fill_rate: number | null;
  open_po_count: number;
  open_pos_slipped_count: number;
  open_pos_overdue_count: number;
  open_remaining_qty: number;
}

export interface SupplierRiskSummary {
  counts_by_band: Record<SupplierRiskBand, number>;
  total_suppliers: number;
}

export interface SupplierRiskListResponse {
  seeded: boolean;
  as_of: string | null;
  summary: SupplierRiskSummary;
  items: SupplierRiskItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SupplierRiskDetailResponse extends SupplierRiskItem {
  as_of: string;
  excluded_future_deliveries: number;
  has_excluded_future_deliveries: boolean;
  p50_delay_days_when_late: number | null;
  p90_delay_days_when_late: number | null;
  max_delay_days: number | null;
  total_ordered_qty: number;
  total_received_qty: number;
  total_rejected_qty: number;
  metrics_breakdown: MetricScoreBreakdown[];
  nominal_weights: Record<string, number>;
  effective_weights: Record<string, number>;
  metrics_used: string[];
  metrics_dropped: string[];
  thresholds_used: SupplierRiskConfig;
  monthly_breakdown: MonthlyPerformance[];
  main_drivers: string[];
  explanation: string;
  assumptions: string[];
}

// ==========================================
// Demand Forecasting Types
// ==========================================

export interface ForecastingProtocol {
  min_train_days: number;
  horizon_days: number;
  step_days: number;
  folds: number;
  origin_dates: string[];
}

export interface ForecastModelInfo {
  name: string;
  type: string;
  description: string;
  used_by_inventory_risk: boolean;
}

export interface ForecastModelAggregate {
  model_name: string;
  pooled_wape: number | null;
  macro_wape: number | null;
  mae: number;
  rmse: number;
  bias: number;
  n_points: number;
  n_components: number;
}

export interface ForecastDecision {
  rule_text: string;
  champion: string;
  challenger: string;
  recommended: boolean;
  pooled_wape_improvement_pct: number | null;
  win_rate: number | null;
  reason: string;
}

export interface ComponentModelMetrics {
  n_points: number;
  mae: number;
  rmse: number;
  wape: number | null;
  bias: number;
}

export interface ComponentForecastEvaluation {
  component_id: number;
  sku: string;
  name: string;
  zero_demand: boolean;
  models: Record<string, ComponentModelMetrics>;
  best_model: string | null;
}

export interface SkippedComponentInfo {
  component_id: number;
  sku: string;
  name: string;
  reason: string;
}

export interface ForecastEvaluationResponse {
  seeded: boolean;
  as_of: string | null;
  data_caveat: string;
  protocol: ForecastingProtocol;
  models: ForecastModelInfo[];
  aggregate: Record<string, ForecastModelAggregate>;
  decision: ForecastDecision;
  per_component: ComponentForecastEvaluation[];
  skipped: SkippedComponentInfo[];
}

export interface DayForecastItem {
  date: string;
  weekday: string;
  forecasts: Record<string, number>;
}

export interface BacktestPointItem {
  date: string;
  actual: number;
  forecasts: Record<string, number>;
}

export interface ComponentForecastDetailResponse {
  seeded: boolean;
  component_id: number;
  sku: string;
  name: string;
  as_of: string;
  days: number;
  forecast_days: DayForecastItem[];
  backtest_last_fold: BacktestPointItem[];
}

// =====================================================================
// Disruption Detection and Alerts
// =====================================================================

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AlertType =
  | 'inventory_shortage'
  | 'data_quality'
  | 'supplier_delay_exposure'
  | 'po_slipped'
  | 'po_overdue'
  | 'demand_surge'
  | 'quality_issue'
  | 'capacity_constraint'
  | 'compound_risk';

export interface AlertEvidenceItem {
  label: string;
  value: string | number | null;
  unit?: string | null;
}

export interface ExposedCustomerOrder {
  order_number: string;
  customer_name: string;
  product_sku: string;
  product_name: string;
  quantity: number;
  due_date: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  component_units_required: number;
}

export interface AlertImpact {
  orders_count: number;
  count_by_priority: Record<string, number>;
  total_component_units_required: number;
  exposed_revenue: string;
  exposed_orders: ExposedCustomerOrder[];
}

export interface DelayScenarioItem {
  scenario_name: 'baseline' | 'typical' | 'severe';
  shift_days: number;
  expected_date: string | null;
  shortage_date: string | null;
  first_episode_start: string | null;
  first_episode_end: string | null;
  first_episode_days: number;
  unmet_before_next_inbound: number | null;
  total_unmet_demand: number;
  incremental_total_unmet: number;
  change_in_shortage_days: number;
}

export interface AlertListItem {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  summary: string;
  component_id: number | null;
  component_sku: string | null;
  component_name: string | null;
  supplier_id: number | null;
  supplier_code: string | null;
  po_number: string | null;
  days_until_impact: number | null;
  affected_orders_count: number | null;
  exposed_revenue: string | null;
  related_alert_ids: string[];
  flags: string[];
}

export interface AlertDetail extends AlertListItem {
  detected_on: string;
  evidence: AlertEvidenceItem[];
  assumptions: string[];
  impact: AlertImpact | null;
  impact_null_reason: string | null;
  delay_scenarios: DelayScenarioItem[] | null;
}

export interface AlertSummary {
  counts_by_severity: Record<AlertSeverity, number>;
  counts_by_type: Record<AlertType, number>;
  total_alerts: number;
}

export interface AlertConfigDto {
  surge_recent_days: number;
  surge_baseline_days: number;
  surge_ratio_medium: number;
  surge_ratio_high: number;
  quality_rejection_threshold: number;
  delay_min_late_probability: number;
  delay_min_deliveries: number;
}

export interface AlertsListResponse {
  seeded: boolean;
  as_of: string | null;
  config: AlertConfigDto | null;
  summary: AlertSummary;
  items: AlertListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AlertsFilterParams {
  severity?: AlertSeverity;
  type?: AlertType;
  component_id?: number;
  supplier_id?: number;
  limit?: number;
  offset?: number;
}

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  inventory_shortage: 'Inventory Shortage',
  data_quality: 'Data Quality',
  supplier_delay_exposure: 'Supplier Delay Exposure',
  po_slipped: 'PO Delivery Slipped',
  po_overdue: 'PO Overdue',
  demand_surge: 'Demand Surge',
  quality_issue: 'Quality Issue',
  capacity_constraint: 'Capacity Constraint',
  compound_risk: 'Compound Disruption',
};

