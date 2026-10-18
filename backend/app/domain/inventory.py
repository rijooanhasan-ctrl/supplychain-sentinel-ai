"""Pure domain logic for Inventory Intelligence and Shortage Projections.

Conventions and Rules:
1. Pure business logic: strictly no database, no FastAPI, no system clock access.
   All calendar calculations are anchored to the provided `as_of` date ("Today").
2. Projection day k = as_of + k days, k = 0..horizon_days-1.
3. Plant usable stock = max(0, on_hand - reserved) at the warehouse with role 'plant'.
   If reserved > on_hand, usable is 0 and flag 'reserved_exceeds_on_hand' is raised.
   If the component has no inventory row at the plant, usable is unknown: status 'no_plant_inventory',
   risk 'unknown', flag 'no_plant_inventory' raised; zero is never assumed.
4. Regional stock is NOT counted toward plant cover. Reported separately as informational
   ('potentially transferable; no transfer assumed').
5. Demand forecast (heuristic baseline, 'weekday_average'):
   Window: [as_of - lookback_days, as_of - 1].
   If distinct dates present < min_history_days OR coverage ratio < min_coverage_ratio,
   forecast status is 'insufficient_history': no forecast, risk 'unknown', flag 'insufficient_history'.
   Otherwise weekday forecast (Mon..Sun) = mean quantity over present dates with that weekday.
   If a weekday has no samples, falls back to overall window mean and flags 'weekday_fallback'.
   Mean daily demand = overall window mean over present dates. Missing dates are treated as missing, not zero.
   A component whose window mean is exactly 0 has status 'no_demand': risk 'none', no shortage,
   coverage_days null, flag 'zero_demand'.
6. Inbound supply: lines of purchase orders with status open, in_transit, partially_received,
   destination warehouse role = 'plant'; remaining = qty_ordered - qty_received (> 0 only).
   expected_date = latest_estimate_date if present else promised_date, date_basis 'estimated' or 'promised'.
   Flag 'inbound_promise_only' raised when any counted inbound relies on promised date only.
   Inbound with expected_date < as_of is OVERDUE: under policy 'exclude' it is NOT counted toward
   projected supply; listed as unconfirmed_inbound and flagged 'overdue_inbound_excluded'.
   Inbound with expected_date >= as_of + horizon_days is outside horizon: listed and flagged 'inbound_outside_horizon'.
   Inbound destined for non-plant warehouses is not counted; tracked informationally.
7. Timing within a day:
   Receipts dated D are available at the START of day D.
   Demand for day D is consumed during day D.
   Ending balance_k = max(0, balance_{k-1} + receipts_k - forecast_demand_k).
   Unmet_k = max(0, forecast_demand_k - (balance_{k-1} + receipts_k)).
   Stock exactly equal to demand is NOT a shortage.
8. Shortage date = first projection day with unmet > 0 (with counted inbound).
   days_until_shortage = (shortage_date - as_of).days.
   unmet_demand_units = sum of unmet over horizon.
   shortage_days = count of days with unmet > 0.
   runout_date_without_inbound = first day with unmet > 0 in a projection with zero inbound.
   coverage_days = usable_stock / mean_daily_demand (null if demand 0 or usable unknown).
9. Next replenishment = earliest counted inbound (date, qty, po_number, date_basis) or null.
10. Risk level:
    - 'critical': shortage with days_until_shortage <= critical_days
    - 'high': shortage with days_until_shortage <= high_days
    - 'medium': shortage with days_until_shortage <= medium_days
    - 'low': no shortage within horizon, or shortage > medium_days
    - 'none': no_demand
    - 'unknown': insufficient_history or no_plant_inventory
11. Explanation dynamically composed from computed evidence.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, List, Optional, Sequence


@dataclass(frozen=True)
class InventoryRiskConfig:
    """Configuration parameters for inventory risk evaluation."""

    lookback_days: int = 28
    min_history_days: int = 14
    min_coverage_ratio: float = 0.8
    horizon_days: int = 60
    critical_days: int = 7
    high_days: int = 14
    medium_days: int = 30
    overdue_inbound_policy: str = "exclude"

    def __post_init__(self) -> None:
        if not (7 <= self.horizon_days <= 180):
            raise ValueError(
                f"horizon_days must be between 7 and 180 days, got {self.horizon_days}"
            )
        if not (0 < self.critical_days < self.high_days < self.medium_days <= self.horizon_days):
            raise ValueError(
                f"Invalid threshold ordering: must satisfy 0 < critical ({self.critical_days}) "
                f"< high ({self.high_days}) < medium ({self.medium_days}) <= horizon ({self.horizon_days})"
            )
        if self.overdue_inbound_policy != "exclude":
            raise ValueError(
                f"Unsupported overdue_inbound_policy '{self.overdue_inbound_policy}'. Only 'exclude' is supported."
            )
        if self.lookback_days < 7:
            raise ValueError(f"lookback_days must be at least 7, got {self.lookback_days}")
        if self.min_history_days <= 0 or self.min_history_days > self.lookback_days:
            raise ValueError(
                f"min_history_days must be > 0 and <= lookback_days ({self.lookback_days}), got {self.min_history_days}"
            )
        if not (0.0 < self.min_coverage_ratio <= 1.0):
            raise ValueError(
                f"min_coverage_ratio must be in (0, 1.0], got {self.min_coverage_ratio}"
            )


@dataclass(frozen=True)
class PlantInventoryInput:
    """Plant warehouse inventory balance."""

    on_hand: int
    reserved: int


@dataclass(frozen=True)
class RegionalInventoryInput:
    """Regional warehouse inventory balance."""

    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    on_hand: int
    reserved: int


@dataclass(frozen=True)
class InboundLineInput:
    """Purchase order line item for inbound replenishment."""

    po_id: int
    po_number: str
    po_status: str
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    warehouse_role: str
    qty_ordered: int
    qty_received: int
    promised_date: date
    latest_estimate_date: Optional[date]
    supplier_code: Optional[str] = None


@dataclass(frozen=True)
class DemandHistoryRecordInput:
    """Single daily demand observation."""

    date: date
    quantity: float


@dataclass(frozen=True)
class ComponentEvaluationInput:
    """Complete typed domain input for evaluating a single component."""

    as_of: date
    component_id: int
    sku: str
    name: str
    category: str
    criticality: str
    plant_inventory: Optional[PlantInventoryInput]
    regional_inventories: List[RegionalInventoryInput] = field(default_factory=list)
    demand_records: List[DemandHistoryRecordInput] = field(default_factory=list)
    inbound_lines: List[InboundLineInput] = field(default_factory=list)


@dataclass(frozen=True)
class RiskFlag:
    """Machine-readable risk/data flag and accompanying human-readable message."""

    code: str
    message: str


@dataclass(frozen=True)
class ReplenishmentInfo:
    """Earliest counted inbound replenishment event."""

    date: date
    qty: float
    po_number: str
    date_basis: str  # "estimated" | "promised"


@dataclass(frozen=True)
class InboundSummaryItem:
    """Summary of an inbound purchase order line evaluated by the domain."""

    po_id: int
    po_number: str
    status: str
    warehouse_code: str
    qty_ordered: int
    qty_received: int
    remaining_qty: int
    promised_date: date
    latest_estimate_date: Optional[date]
    expected_date: date
    date_basis: str  # "estimated" | "promised"
    reason: Optional[str] = None
    supplier_code: Optional[str] = None


@dataclass(frozen=True)
class RegionalStockItem:
    """Usable stock available at a regional warehouse."""

    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    on_hand: int
    reserved: int
    usable: int


@dataclass(frozen=True)
class DailyProjectionItem:
    """Daily simulation step for day k."""

    day_index: int
    date: date
    forecast_demand: float
    receipts: float
    ending_balance: float
    unmet: float


@dataclass(frozen=True)
class ShortageEpisode:
    """Contiguous run of projection days with unmet demand > 0."""

    start_date: date
    end_date: date
    days: int
    unmet_units: float
    ends_because: str  # "inbound_receipt" | "horizon_end" | "other"


@dataclass(frozen=True)
class UsableStockBreakdown:
    """Detailed components of plant usable stock."""

    on_hand: int
    reserved: int
    usable: int
    reserved_exceeds_on_hand: bool


@dataclass(frozen=True)
class ComponentRiskResult:
    """Full outcome of an inventory risk evaluation for a component."""

    component_id: int
    sku: str
    name: str
    category: str
    criticality: str
    plant_usable_stock: Optional[int]
    plant_on_hand: Optional[int]
    plant_reserved: Optional[int]
    usable_stock_breakdown: Optional[UsableStockBreakdown]
    forecast_status: str
    mean_daily_demand: Optional[float]
    weekday_forecast: Optional[Dict[int, float]]
    coverage_days: Optional[float]
    next_replenishment: Optional[ReplenishmentInfo]
    shortage_date: Optional[date]
    days_until_shortage: Optional[int]
    unmet_demand_units: float
    shortage_days: int
    runout_date_without_inbound: Optional[date]
    shortage_episodes: List[ShortageEpisode]
    unmet_before_next_inbound: Optional[float]
    first_episode_start_date: Optional[date]
    first_episode_end_date: Optional[date]
    risk_level: str
    risk_reason: str
    explanation: str
    flags: List[RiskFlag]
    assumptions: List[str]
    counted_inbound: List[InboundSummaryItem]
    unconfirmed_inbound: List[InboundSummaryItem]
    out_of_horizon_inbound: List[InboundSummaryItem]
    non_plant_inbound_count: int
    non_plant_inbound_qty: int
    regional_usable_stock: List[RegionalStockItem]
    regional_total_usable: int
    daily_projection: List[DailyProjectionItem]


WEEKDAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]

DEFAULT_ASSUMPTIONS = [
    "Demand projection uses a 28-day weekday-average heuristic baseline, not a trained ML model.",
    "Inbound receipts are assumed available at the start of their expected arrival date.",
    "Daily consumption occurs continuously throughout the day after receipts are stocked.",
    "Unmet demand is not carried forward as backlog (treated as lost or deferred), which makes the post-receipt projection optimistic.",
    "Overdue purchase orders (expected before as_of) are excluded from projected supply under conservative risk policy.",
    "Stock at regional warehouses is not automatically transferred to the production plant.",
    "Supplier lead time reliability and expedite options are not factored into baseline projections.",
]


@dataclass(frozen=True)
class WeekdayAverageProfile:
    """Result of computing weekday-average demand profile over a lookback window."""

    status: str  # "adequate", "insufficient_history", "no_demand"
    mean_daily_demand: Optional[float]
    weekday_forecast: Optional[Dict[int, float]]
    flags: List[RiskFlag]
    distinct_dates_count: int
    coverage_ratio: float


def compute_weekday_average_profile(
    demand_records: Sequence[DemandHistoryRecordInput],
    as_of: date,
    lookback_days: int = 28,
    min_history_days: int = 14,
    min_coverage_ratio: float = 0.5,
) -> WeekdayAverageProfile:
    """Pure function calculating the weekday average profile over [as_of - lookback_days, as_of - 1]."""
    window_start = as_of - timedelta(days=lookback_days)
    window_end = as_of - timedelta(days=1)

    window_records_by_date: Dict[date, float] = {}
    for rec in demand_records:
        if window_start <= rec.date <= window_end:
            window_records_by_date[rec.date] = window_records_by_date.get(rec.date, 0.0) + float(rec.quantity)

    distinct_dates_count = len(window_records_by_date)
    coverage_ratio = distinct_dates_count / lookback_days if lookback_days > 0 else 0.0
    flags: List[RiskFlag] = []

    if distinct_dates_count < min_history_days or coverage_ratio < min_coverage_ratio:
        return WeekdayAverageProfile(
            status="insufficient_history",
            mean_daily_demand=None,
            weekday_forecast=None,
            flags=[
                RiskFlag(
                    code="insufficient_history",
                    message=(
                        f"Only {distinct_dates_count} history days present in {lookback_days}-day "
                        f"window (minimum {min_history_days} days and {min_coverage_ratio * 100:.1f}% "
                        f"coverage required)."
                    ),
                )
            ],
            distinct_dates_count=distinct_dates_count,
            coverage_ratio=coverage_ratio,
        )

    total_demand = sum(window_records_by_date.values())
    mean_daily_demand = total_demand / distinct_dates_count

    if mean_daily_demand == 0.0:
        return WeekdayAverageProfile(
            status="no_demand",
            mean_daily_demand=0.0,
            weekday_forecast={i: 0.0 for i in range(7)},
            flags=[
                RiskFlag(
                    code="zero_demand",
                    message="Zero consumption recorded across all history days in lookback window.",
                )
            ],
            distinct_dates_count=distinct_dates_count,
            coverage_ratio=coverage_ratio,
        )

    weekday_samples: Dict[int, List[float]] = {i: [] for i in range(7)}
    for rec_date, qty in window_records_by_date.items():
        weekday_samples[rec_date.weekday()].append(qty)

    weekday_forecast = {}
    for w in range(7):
        samples = weekday_samples[w]
        if samples:
            weekday_forecast[w] = sum(samples) / len(samples)
        else:
            weekday_forecast[w] = mean_daily_demand
            flags.append(
                RiskFlag(
                    code="weekday_fallback",
                    message=(
                        f"{WEEKDAY_NAMES[w]} has no demand records in window; "
                        f"fell back to overall window mean ({mean_daily_demand:.1f})."
                    ),
                )
            )

    return WeekdayAverageProfile(
        status="adequate",
        mean_daily_demand=mean_daily_demand,
        weekday_forecast=weekday_forecast,
        flags=flags,
        distinct_dates_count=distinct_dates_count,
        coverage_ratio=coverage_ratio,
    )


def evaluate_component(
    inputs: ComponentEvaluationInput,
    config: Optional[InventoryRiskConfig] = None,
) -> ComponentRiskResult:
    """Evaluates inventory risk, shortage dates, and daily stock trajectory for one component.

    Pure function over frozen inputs and config.
    """
    if config is None:
        config = InventoryRiskConfig()

    as_of = inputs.as_of
    flags: List[RiskFlag] = []

    # 1. Plant Inventory & Usable Stock
    plant_usable_stock: Optional[int] = None
    plant_on_hand: Optional[int] = None
    plant_reserved: Optional[int] = None
    usable_breakdown: Optional[UsableStockBreakdown] = None

    if inputs.plant_inventory is None:
        flags.append(
            RiskFlag(
                code="no_plant_inventory",
                message="No inventory record found at production plant.",
            )
        )
    else:
        on_hand = inputs.plant_inventory.on_hand
        reserved = inputs.plant_inventory.reserved
        plant_on_hand = on_hand
        plant_reserved = reserved

        if reserved > on_hand:
            usable = 0
            reserved_exceeds = True
            flags.append(
                RiskFlag(
                    code="reserved_exceeds_on_hand",
                    message=f"Reserved stock ({reserved}) exceeds on-hand stock ({on_hand}); usable stock clamped to 0.",
                )
            )
        else:
            usable = on_hand - reserved
            reserved_exceeds = False

        plant_usable_stock = usable
        usable_breakdown = UsableStockBreakdown(
            on_hand=on_hand,
            reserved=reserved,
            usable=usable,
            reserved_exceeds_on_hand=reserved_exceeds,
        )

    # 2. Regional Inventory
    regional_usable_stock: List[RegionalStockItem] = []
    regional_total_usable = 0
    for reg in inputs.regional_inventories:
        reg_usable = max(0, reg.on_hand - reg.reserved)
        regional_usable_stock.append(
            RegionalStockItem(
                warehouse_id=reg.warehouse_id,
                warehouse_code=reg.warehouse_code,
                warehouse_name=reg.warehouse_name,
                on_hand=reg.on_hand,
                reserved=reg.reserved,
                usable=reg_usable,
            )
        )
        regional_total_usable += reg_usable

    if regional_total_usable > 0:
        flags.append(
            RiskFlag(
                code="regional_stock_available",
                message=(
                    f"Regional warehouses hold {regional_total_usable} usable units "
                    f"(potentially transferable; no transfer assumed)."
                ),
            )
        )

    # 3. Demand Forecast (weekday-average baseline)
    mean_daily_demand: Optional[float] = None
    weekday_forecast: Optional[Dict[int, float]] = None
    coverage_days: Optional[float] = None
    distinct_dates_count: int = 0
    coverage_ratio: float = 0.0
    forecast_status: str

    if inputs.plant_inventory is None:
        forecast_status = "no_plant_inventory"
    else:
        profile = compute_weekday_average_profile(
            demand_records=inputs.demand_records,
            as_of=as_of,
            lookback_days=config.lookback_days,
            min_history_days=config.min_history_days,
            min_coverage_ratio=config.min_coverage_ratio,
        )
        forecast_status = profile.status
        mean_daily_demand = profile.mean_daily_demand
        weekday_forecast = profile.weekday_forecast
        distinct_dates_count = profile.distinct_dates_count
        coverage_ratio = profile.coverage_ratio
        flags.extend(profile.flags)
        if profile.status == "adequate" and plant_usable_stock is not None and mean_daily_demand is not None:
            coverage_days = plant_usable_stock / mean_daily_demand
        elif profile.status == "no_demand":
            coverage_days = None

    # 4. Inbound Supply Classification
    counted_inbound: List[InboundSummaryItem] = []
    unconfirmed_inbound: List[InboundSummaryItem] = []
    out_of_horizon_inbound: List[InboundSummaryItem] = []
    non_plant_inbound_count = 0
    non_plant_inbound_qty = 0

    horizon_end = as_of + timedelta(days=config.horizon_days)

    for line in inputs.inbound_lines:
        if line.po_status not in ("open", "in_transit", "partially_received"):
            continue

        remaining = line.qty_ordered - line.qty_received
        if remaining <= 0:
            continue

        if line.warehouse_role != "plant":
            non_plant_inbound_count += 1
            non_plant_inbound_qty += remaining
            continue

        expected_d = line.latest_estimate_date if line.latest_estimate_date else line.promised_date
        basis = "estimated" if line.latest_estimate_date else "promised"

        item = InboundSummaryItem(
            po_id=line.po_id,
            po_number=line.po_number,
            status=line.po_status,
            warehouse_code=line.warehouse_code,
            qty_ordered=line.qty_ordered,
            qty_received=line.qty_received,
            remaining_qty=remaining,
            promised_date=line.promised_date,
            latest_estimate_date=line.latest_estimate_date,
            expected_date=expected_d,
            date_basis=basis,
            supplier_code=line.supplier_code,
        )

        if expected_d < as_of:
            unconfirmed_inbound.append(item)
        elif expected_d >= horizon_end:
            out_of_horizon_inbound.append(item)
        else:
            counted_inbound.append(item)

    if unconfirmed_inbound:
        total_overdue = sum(i.remaining_qty for i in unconfirmed_inbound)
        flags.append(
            RiskFlag(
                code="overdue_inbound_excluded",
                message=(
                    f"Excluded {len(unconfirmed_inbound)} overdue inbound shipment(s) totaling "
                    f"{total_overdue} units with expected arrival dates before snapshot date."
                ),
            )
        )

    if out_of_horizon_inbound:
        total_out = sum(i.remaining_qty for i in out_of_horizon_inbound)
        flags.append(
            RiskFlag(
                code="inbound_outside_horizon",
                message=(
                    f"Excluded {len(out_of_horizon_inbound)} inbound shipment(s) totaling "
                    f"{total_out} units arriving after the {config.horizon_days}-day horizon."
                ),
            )
        )

    if any(i.date_basis == "promised" for i in counted_inbound):
        flags.append(
            RiskFlag(
                code="inbound_promise_only",
                message=(
                    "One or more counted inbound shipments rely on promised date without updated supplier estimate."
                ),
            )
        )

    if plant_usable_stock is not None and plant_usable_stock > 0 and len(counted_inbound) == 0:
        flags.append(
            RiskFlag(
                code="no_open_inbound",
                message="No open inbound replenishment orders scheduled within the horizon.",
            )
        )

    # Next replenishment: earliest counted inbound
    next_replenishment: Optional[ReplenishmentInfo] = None
    if counted_inbound:
        sorted_counted = sorted(counted_inbound, key=lambda x: (x.expected_date, -x.remaining_qty))
        earliest = sorted_counted[0]
        next_replenishment = ReplenishmentInfo(
            date=earliest.expected_date,
            qty=float(earliest.remaining_qty),
            po_number=earliest.po_number,
            date_basis=earliest.date_basis,
        )

    # 5. Daily Stock Projection Simulation
    daily_projection: List[DailyProjectionItem] = []
    shortage_date: Optional[date] = None
    days_until_shortage: Optional[int] = None
    unmet_demand_units: float = 0.0
    shortage_days: int = 0
    runout_date_without_inbound: Optional[date] = None

    can_simulate = (
        plant_usable_stock is not None
        and forecast_status in ("adequate", "no_demand")
        and weekday_forecast is not None
    )

    if can_simulate and plant_usable_stock is not None and weekday_forecast is not None:
        receipts_by_date: Dict[date, float] = defaultdict(float)
        for i in counted_inbound:
            receipts_by_date[i.expected_date] += float(i.remaining_qty)

        # Simulation with counted inbound
        current_balance = float(plant_usable_stock)
        for k in range(config.horizon_days):
            date_k = as_of + timedelta(days=k)
            weekday_k = date_k.weekday()
            forecast_k = weekday_forecast[weekday_k]
            receipts_k = receipts_by_date.get(date_k, 0.0)

            balance_start_k = current_balance + receipts_k
            ending_balance_k = max(0.0, balance_start_k - forecast_k)
            unmet_k = max(0.0, forecast_k - balance_start_k)
            current_balance = ending_balance_k

            if unmet_k > 0.0:
                unmet_demand_units += unmet_k
                shortage_days += 1
                if shortage_date is None:
                    shortage_date = date_k
                    days_until_shortage = k

            daily_projection.append(
                DailyProjectionItem(
                    day_index=k,
                    date=date_k,
                    forecast_demand=forecast_k,
                    receipts=receipts_k,
                    ending_balance=ending_balance_k,
                    unmet=unmet_k,
                )
            )

        # Runout date without inbound
        cur_bal_no_inbound = float(plant_usable_stock)
        for k in range(config.horizon_days):
            date_k = as_of + timedelta(days=k)
            weekday_k = date_k.weekday()
            forecast_k = weekday_forecast[weekday_k]
            balance_start_k = cur_bal_no_inbound
            unmet_k = max(0.0, forecast_k - balance_start_k)
            cur_bal_no_inbound = max(0.0, balance_start_k - forecast_k)

            if unmet_k > 0.0:
                runout_date_without_inbound = date_k
                break

        # Compute shortage episodes (contiguous runs of days with unmet > 0)
        shortage_episodes: List[ShortageEpisode] = []
        ep_start_k: Optional[int] = None
        ep_unmet: float = 0.0

        for k, item in enumerate(daily_projection):
            if item.unmet > 0.0:
                if ep_start_k is None:
                    ep_start_k = k
                    ep_unmet = item.unmet
                else:
                    ep_unmet += item.unmet
            else:
                if ep_start_k is not None:
                    ep_end_k = k - 1
                    ep_days = ep_end_k - ep_start_k + 1
                    next_receipt = daily_projection[k].receipts if k < len(daily_projection) else 0.0
                    ends_because = "inbound_receipt" if next_receipt > 0.0 else "other"
                    shortage_episodes.append(
                        ShortageEpisode(
                            start_date=as_of + timedelta(days=ep_start_k),
                            end_date=as_of + timedelta(days=ep_end_k),
                            days=ep_days,
                            unmet_units=round(ep_unmet, 1),
                            ends_because=ends_because,
                        )
                    )
                    ep_start_k = None
                    ep_unmet = 0.0

        if ep_start_k is not None:
            ep_end_k = len(daily_projection) - 1
            ep_days = ep_end_k - ep_start_k + 1
            shortage_episodes.append(
                ShortageEpisode(
                    start_date=as_of + timedelta(days=ep_start_k),
                    end_date=as_of + timedelta(days=ep_end_k),
                    days=ep_days,
                    unmet_units=round(ep_unmet, 1),
                    ends_because="horizon_end",
                )
            )

        # Compute unmet_before_next_inbound and episode dates
        unmet_before_next_inbound: Optional[float] = None
        first_episode_start_date: Optional[date] = None
        first_episode_end_date: Optional[date] = None

        if shortage_date is not None:
            first_episode_start_date = shortage_episodes[0].start_date if shortage_episodes else None
            first_episode_end_date = shortage_episodes[0].end_date if shortage_episodes else None

            receipt_dates = sorted([d for d in receipts_by_date.keys() if d >= shortage_date and receipts_by_date[d] > 0.0])
            if not receipt_dates:
                unmet_before_next_inbound = round(unmet_demand_units, 1)
            else:
                first_receipt_date = receipt_dates[0]
                unmet_sum = sum(
                    p.unmet for p in daily_projection if shortage_date <= p.date < first_receipt_date
                )
                unmet_before_next_inbound = round(unmet_sum, 1)
    else:
        shortage_episodes = []
        unmet_before_next_inbound = None
        first_episode_start_date = None
        first_episode_end_date = None

    # 6. Risk Level & Risk Reason
    risk_level: str
    risk_reason: str

    if forecast_status == "no_plant_inventory":
        risk_level = "unknown"
        risk_reason = "Unknown risk: component has no inventory record at the plant."
    elif forecast_status == "insufficient_history":
        risk_level = "unknown"
        risk_reason = (
            f"Unknown risk: insufficient demand history ({distinct_dates_count} days present, "
            f"{config.min_history_days} required)."
        )
    elif forecast_status == "no_demand":
        risk_level = "none"
        risk_reason = "No risk: zero historical demand over lookback window."
    else:
        if days_until_shortage is not None:
            if days_until_shortage <= config.critical_days:
                risk_level = "critical"
                risk_reason = (
                    f"Projected shortage in {days_until_shortage} days "
                    f"(threshold <= {config.critical_days} days)."
                )
            elif days_until_shortage <= config.high_days:
                risk_level = "high"
                risk_reason = (
                    f"Projected shortage in {days_until_shortage} days "
                    f"(threshold <= {config.high_days} days)."
                )
            elif days_until_shortage <= config.medium_days:
                risk_level = "medium"
                risk_reason = (
                    f"Projected shortage in {days_until_shortage} days "
                    f"(threshold <= {config.medium_days} days)."
                )
            else:
                risk_level = "low"
                risk_reason = (
                    f"Projected shortage in {days_until_shortage} days exceeds "
                    f"medium risk horizon ({config.medium_days} days)."
                )
        else:
            risk_level = "low"
            risk_reason = f"No shortage projected within {config.horizon_days}-day planning horizon."

    # 7. Explanation string Generation
    explanation = _build_explanation(
        sku=inputs.sku,
        name=inputs.name,
        as_of=as_of,
        forecast_status=forecast_status,
        plant_usable_stock=plant_usable_stock,
        plant_on_hand=plant_on_hand,
        plant_reserved=plant_reserved,
        mean_daily_demand=mean_daily_demand,
        weekday_forecast=weekday_forecast,
        runout_date_without_inbound=runout_date_without_inbound,
        shortage_date=shortage_date,
        days_until_shortage=days_until_shortage,
        next_replenishment=next_replenishment,
        unmet_demand_units=unmet_demand_units,
        shortage_episodes=shortage_episodes,
        unmet_before_next_inbound=unmet_before_next_inbound,
        distinct_dates_count=distinct_dates_count,
        config=config,
    )

    return ComponentRiskResult(
        component_id=inputs.component_id,
        sku=inputs.sku,
        name=inputs.name,
        category=inputs.category,
        criticality=inputs.criticality,
        plant_usable_stock=plant_usable_stock,
        plant_on_hand=plant_on_hand,
        plant_reserved=plant_reserved,
        usable_stock_breakdown=usable_breakdown,
        forecast_status=forecast_status,
        mean_daily_demand=mean_daily_demand,
        weekday_forecast=weekday_forecast,
        coverage_days=coverage_days,
        next_replenishment=next_replenishment,
        shortage_date=shortage_date,
        days_until_shortage=days_until_shortage,
        unmet_demand_units=unmet_demand_units,
        shortage_days=shortage_days,
        runout_date_without_inbound=runout_date_without_inbound,
        shortage_episodes=shortage_episodes,
        unmet_before_next_inbound=unmet_before_next_inbound,
        first_episode_start_date=first_episode_start_date,
        first_episode_end_date=first_episode_end_date,
        risk_level=risk_level,
        risk_reason=risk_reason,
        explanation=explanation,
        flags=flags,
        assumptions=DEFAULT_ASSUMPTIONS,
        counted_inbound=counted_inbound,
        unconfirmed_inbound=unconfirmed_inbound,
        out_of_horizon_inbound=out_of_horizon_inbound,
        non_plant_inbound_count=non_plant_inbound_count,
        non_plant_inbound_qty=non_plant_inbound_qty,
        regional_usable_stock=regional_usable_stock,
        regional_total_usable=regional_total_usable,
        daily_projection=daily_projection,
    )


def _build_explanation(
    sku: str,
    name: str,
    as_of: date,
    forecast_status: str,
    plant_usable_stock: Optional[int],
    plant_on_hand: Optional[int],
    plant_reserved: Optional[int],
    mean_daily_demand: Optional[float],
    weekday_forecast: Optional[Dict[int, float]],
    runout_date_without_inbound: Optional[date],
    shortage_date: Optional[date],
    days_until_shortage: Optional[int],
    next_replenishment: Optional[ReplenishmentInfo],
    unmet_demand_units: float,
    shortage_episodes: List[ShortageEpisode],
    unmet_before_next_inbound: Optional[float],
    distinct_dates_count: int,
    config: InventoryRiskConfig,
) -> str:
    """Builds a plain-language explanation strictly from computed evidence."""
    if forecast_status == "no_plant_inventory":
        return (
            f"Component {sku} ({name}) has no inventory record at the plant warehouse. "
            f"Usable stock and stockout risk cannot be determined."
        )

    if forecast_status == "insufficient_history":
        return (
            f"Component {sku} ({name}) has insufficient historical demand data "
            f"({distinct_dates_count} records in {config.lookback_days} days; "
            f"minimum {config.min_history_days} required). Cannot construct a reliable demand forecast."
        )

    usable = plant_usable_stock if plant_usable_stock is not None else 0
    on_hand = plant_on_hand if plant_on_hand is not None else 0
    reserved = plant_reserved if plant_reserved is not None else 0

    if forecast_status == "no_demand":
        return (
            f"Usable plant stock {usable} (on hand {on_hand} − reserved {reserved}). "
            f"Historical demand across the last {config.lookback_days} days is zero. "
            f"No production shortage projected."
        )

    mean_demand = mean_daily_demand if mean_daily_demand is not None else 0.0
    if weekday_forecast:
        weekday_avg = sum(weekday_forecast[i] for i in range(5)) / 5.0
        weekend_avg = sum(weekday_forecast[i] for i in range(5, 7)) / 2.0
        demand_desc = (
            f"Expected demand ~{mean_demand:.1f}/day "
            f"(weekday-aware: ~{int(round(weekday_avg))} weekdays, ~{int(round(weekend_avg))} weekends)"
        )
    else:
        demand_desc = f"Expected demand ~{mean_demand:.1f}/day"

    stock_desc = f"Usable plant stock {usable} (on hand {on_hand} − reserved {reserved}). {demand_desc}."

    if shortage_date is None:
        return (
            f"{stock_desc} Plant stock and scheduled inbound are sufficient to cover "
            f"demand through the {config.horizon_days}-day horizon without shortage."
        )

    # Shortage is projected
    days_to_runout = (
        (runout_date_without_inbound - as_of).days
        if runout_date_without_inbound
        else days_until_shortage
    )
    runout_str = (
        f"Stock runs out on {runout_date_without_inbound} (in {days_to_runout} days)."
        if runout_date_without_inbound
        else f"Stock runs out on {shortage_date} (in {days_until_shortage} days)."
    )

    first_ep = shortage_episodes[0] if shortage_episodes else None
    first_ep_range = f" (from {first_ep.start_date} to {first_ep.end_date})" if first_ep else ""
    unmet_before = unmet_before_next_inbound if unmet_before_next_inbound is not None else unmet_demand_units

    if next_replenishment is not None:
        qty_int = int(round(next_replenishment.qty))
        basis_note = (
            "supplier confirmed estimate"
            if next_replenishment.date_basis == "estimated"
            else "promised date; supplier gave no updated estimate"
        )

        if next_replenishment.date > shortage_date:
            gap_days = (next_replenishment.date - shortage_date).days
            gap_str = f"{gap_days} days" if gap_days != 1 else "1 day"
            inbound_desc = (
                f"Next inbound: {qty_int} units on {next_replenishment.date} "
                f"({next_replenishment.date_basis} date; {basis_note}), "
                f"{gap_str} after the projected shortage. "
                f"Estimated unmet demand before next inbound: {unmet_before:.1f} units{first_ep_range}."
            )
        else:
            inbound_desc = (
                f"Next inbound: {qty_int} units on {next_replenishment.date} "
                f"({next_replenishment.date_basis} date; {basis_note}). "
                f"Shortage projected on {shortage_date} (in {days_until_shortage} days) "
                f"with {unmet_before:.1f} units unmet demand before next inbound."
            )
    else:
        inbound_desc = (
            f"No open inbound replenishment orders scheduled within the planning horizon. "
            f"Estimated unmet demand: {unmet_demand_units:.1f} units over horizon."
        )

    if len(shortage_episodes) > 1:
        second_ep = shortage_episodes[1]
        remaining_unmet = sum(ep.unmet_units for ep in shortage_episodes[1:])
        inbound_desc += (
            f" After this inbound is consumed, a further shortage begins on {second_ep.start_date} "
            f"(about {remaining_unmet:.1f} units over the rest of the horizon) unless more supply is secured."
        )

    return f"{stock_desc} {runout_str} {inbound_desc}"


def shift_inbound_for_supplier(
    inputs: ComponentEvaluationInput, supplier_code: str, days: int
) -> ComponentEvaluationInput:
    """Pure domain helper returning a new ComponentEvaluationInput with inbound lines shifted.

    Returns a new inputs object without mutating the original. Lines where supplier_code
    matches have their promised_date and (if present) latest_estimate_date shifted later
    by `days`. Lines for other suppliers or with supplier_code=None remain unchanged.
    """
    if days == 0:
        return inputs

    delta = timedelta(days=days)
    new_inbound: List[InboundLineInput] = []
    for line in inputs.inbound_lines:
        if line.supplier_code == supplier_code:
            new_promised = line.promised_date + delta
            new_estimate = (line.latest_estimate_date + delta) if line.latest_estimate_date is not None else None
            new_inbound.append(
                InboundLineInput(
                    po_id=line.po_id,
                    po_number=line.po_number,
                    po_status=line.po_status,
                    warehouse_id=line.warehouse_id,
                    warehouse_code=line.warehouse_code,
                    warehouse_name=line.warehouse_name,
                    warehouse_role=line.warehouse_role,
                    qty_ordered=line.qty_ordered,
                    qty_received=line.qty_received,
                    promised_date=new_promised,
                    latest_estimate_date=new_estimate,
                    supplier_code=line.supplier_code,
                )
            )
        else:
            new_inbound.append(line)

    return ComponentEvaluationInput(
        as_of=inputs.as_of,
        component_id=inputs.component_id,
        sku=inputs.sku,
        name=inputs.name,
        category=inputs.category,
        criticality=inputs.criticality,
        plant_inventory=inputs.plant_inventory,
        regional_inventories=list(inputs.regional_inventories),
        demand_records=list(inputs.demand_records),
        inbound_lines=new_inbound,
    )

