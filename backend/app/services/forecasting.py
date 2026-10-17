"""Service layer for demand forecasting evaluation and component-level forecasts.

Handles database querying, caching, and calls to domain/forecasting.
"""

from datetime import date
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import Component, DatasetMeta, DemandRecord
from app.domain.forecasting import (
    ComponentDemandInput,
    ComponentForecastDetail,
    ForecastEvalConfig,
    ForecastEvaluationReport,
    compute_component_forecast_detail,
    run_forecast_evaluation,
)
from app.domain.inventory import DemandHistoryRecordInput

# In-process cache: (as_of, generated_at, config_tuple) -> ForecastEvaluationReport
_EVALUATION_CACHE: Dict[Tuple, ForecastEvaluationReport] = {}


def _get_eval_config(settings: Settings) -> ForecastEvalConfig:
    return ForecastEvalConfig(
        min_train_days=settings.FORECAST_MIN_TRAIN_DAYS,
        horizon_days=settings.FORECAST_HORIZON_DAYS,
        step_days=settings.FORECAST_STEP_DAYS,
        min_improvement_pct=settings.FORECAST_MIN_IMPROVEMENT_PCT,
        min_win_rate=settings.FORECAST_MIN_WIN_RATE,
        lookback_weekday_days=settings.INVENTORY_LOOKBACK_DAYS,
    )


def get_forecast_evaluation_service(
    session: Session,
    settings: Optional[Settings] = None,
) -> Tuple[bool, Optional[ForecastEvaluationReport]]:
    """Evaluates demand forecasting models across all components using rolling-origin backtesting.

    Returns (seeded, report). If unseeded, returns (False, None).
    """
    if settings is None:
        settings = get_settings()

    meta = session.query(DatasetMeta).order_by(DatasetMeta.id.desc()).first()
    if meta is None or not meta.as_of:
        return False, None

    as_of = meta.as_of
    generated_at_str = str(meta.generated_at) if meta.generated_at else ""
    config = _get_eval_config(settings)
    cache_key = (
        as_of,
        generated_at_str,
        config.min_train_days,
        config.horizon_days,
        config.step_days,
        config.min_improvement_pct,
        config.min_win_rate,
        config.lookback_weekday_days,
    )

    if cache_key in _EVALUATION_CACHE:
        return True, _EVALUATION_CACHE[cache_key]

    # Bulk load components and demand records
    components = session.query(Component).filter(Component.is_active == True).order_by(Component.id).all()
    records = session.query(DemandRecord).order_by(DemandRecord.component_id, DemandRecord.date).all()

    records_by_comp: Dict[int, List[DemandHistoryRecordInput]] = {c.id: [] for c in components}
    for r in records:
        if r.component_id in records_by_comp:
            records_by_comp[r.component_id].append(
                DemandHistoryRecordInput(date=r.date, quantity=float(r.quantity))
            )

    comp_inputs: List[ComponentDemandInput] = []
    for c in components:
        comp_inputs.append(
            ComponentDemandInput(
                component_id=c.id,
                sku=c.sku,
                name=c.name,
                demand_records=records_by_comp[c.id],
            )
        )

    report = run_forecast_evaluation(comp_inputs, as_of=as_of, config=config)
    _EVALUATION_CACHE[cache_key] = report
    return True, report


def get_component_forecast_service(
    session: Session,
    component_id: int,
    days: int = 14,
    settings: Optional[Settings] = None,
) -> Tuple[bool, Optional[ComponentForecastDetail]]:
    """Generates future forecasts and last-fold backtest detail for a single component.

    Returns (seeded, detail). If component not found, detail is None.
    """
    if settings is None:
        settings = get_settings()

    meta = session.query(DatasetMeta).order_by(DatasetMeta.id.desc()).first()
    if meta is None or not meta.as_of:
        return False, None

    comp = session.query(Component).filter(Component.id == component_id).first()
    if comp is None:
        return True, None

    records = (
        session.query(DemandRecord)
        .filter(DemandRecord.component_id == component_id)
        .order_by(DemandRecord.date)
        .all()
    )

    comp_input = ComponentDemandInput(
        component_id=comp.id,
        sku=comp.sku,
        name=comp.name,
        demand_records=[
            DemandHistoryRecordInput(date=r.date, quantity=float(r.quantity)) for r in records
        ],
    )

    config = _get_eval_config(settings)
    detail = compute_component_forecast_detail(
        component=comp_input,
        as_of=meta.as_of,
        days=days,
        config=config,
    )
    return True, detail
