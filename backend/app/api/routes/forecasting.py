"""API routes for demand forecasting evaluation and component-level forecasts."""

from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.domain.forecasting import DATA_CAVEAT, DECISION_RULE_DESCRIPTION, MODEL_METADATA_LIST
from app.schemas.forecasting import (
    ComponentForecastDetailResponse,
    DecisionResultSchema,
    ForecastEvaluationResponse,
    ModelMetadataSchema,
    ProtocolInfoSchema,
)
from app.services.forecasting import (
    get_component_forecast_service,
    get_forecast_evaluation_service,
)

router = APIRouter(prefix="/forecasting", tags=["forecasting"])


@router.get(
    "/evaluation",
    response_model=ForecastEvaluationResponse,
    summary="Get rolling-origin demand forecast evaluation across all components",
)
def get_forecasting_evaluation(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ForecastEvaluationResponse:
    """Returns rolling-origin backtesting evaluation metrics and champion vs challenger decision."""
    seeded, report = get_forecast_evaluation_service(db, settings=settings)
    if not seeded or report is None:
        return ForecastEvaluationResponse(
            as_of=date(2026, 1, 1),
            data_caveat=DATA_CAVEAT,
            protocol=ProtocolInfoSchema(
                min_train_days=settings.FORECAST_MIN_TRAIN_DAYS,
                horizon_days=settings.FORECAST_HORIZON_DAYS,
                step_days=settings.FORECAST_STEP_DAYS,
                folds=0,
                origin_dates=[],
            ),
            models=[ModelMetadataSchema.model_validate(m) for m in MODEL_METADATA_LIST],
            aggregate={},
            decision=DecisionResultSchema(
                rule_text=DECISION_RULE_DESCRIPTION,
                champion="weekday_average",
                challenger="ridge_weekday_trend",
                recommended=False,
                pooled_wape_improvement_pct=None,
                win_rate=None,
                reason="Dataset is unseeded; run `python -m app.cli seed` first.",
            ),
            per_component=[],
            skipped=[],
            seeded=False,
        )

    return ForecastEvaluationResponse(
        as_of=report.as_of,
        data_caveat=report.data_caveat,
        protocol=ProtocolInfoSchema.model_validate(report.protocol),
        models=[ModelMetadataSchema.model_validate(m) for m in report.models],
        aggregate=report.aggregate,  # type: ignore[arg-type]
        decision=DecisionResultSchema.model_validate(report.decision),
        per_component=report.per_component,  # type: ignore[arg-type]
        skipped=report.skipped,  # type: ignore[arg-type]
        seeded=True,
    )


@router.get(
    "/components/{component_id}",
    response_model=ComponentForecastDetailResponse,
    summary="Get future demand forecasts and backtest details for a component",
)
def get_component_forecast(
    component_id: int,
    days: int = Query(14, ge=1, le=60, description="Number of future forecast days (1..60)"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ComponentForecastDetailResponse:
    """Returns next N days of demand forecasts from each model, plus backtest points from the last fold."""
    seeded, detail = get_component_forecast_service(
        db, component_id=component_id, days=days, settings=settings
    )
    if not seeded:
        return ComponentForecastDetailResponse(
            component_id=component_id,
            sku="UNKNOWN",
            name="Unknown",
            as_of=date(2026, 1, 1),
            days=days,
            forecast_days=[],
            backtest_last_fold=[],
            seeded=False,
        )

    if detail is None:
        raise HTTPException(
            status_code=404,
            detail=f"Component with id {component_id} not found",
        )

    return ComponentForecastDetailResponse(
        component_id=detail.component_id,
        sku=detail.sku,
        name=detail.name,
        as_of=detail.as_of,
        days=detail.days,
        forecast_days=detail.forecast_days,  # type: ignore[arg-type]
        backtest_last_fold=detail.backtest_last_fold,  # type: ignore[arg-type]
        seeded=True,
    )
