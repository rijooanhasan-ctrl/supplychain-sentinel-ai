"""Pydantic schemas for demand forecasting evaluation and component forecasts."""

from datetime import date
from typing import Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ModelMetricSummarySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    n_points: int = Field(..., description="Number of evaluated points")
    mae: float = Field(..., description="Mean absolute error")
    rmse: float = Field(..., description="Root mean squared error")
    wape: Optional[float] = Field(None, description="Weighted absolute percentage error (null when total actual is 0)")
    bias: float = Field(..., description="Mean forecast error (forecast - actual)")


class AggregateModelSummarySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_name: str
    model_type: str
    description: str
    used_by_inventory_risk: bool
    pooled_wape: Optional[float]
    macro_wape: Optional[float]
    mae: float
    rmse: float
    bias: float
    n_points: int
    n_components: int


class ProtocolInfoSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    min_train_days: int
    horizon_days: int
    step_days: int
    folds: int
    origin_dates: List[date]


class ModelMetadataSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    type: str
    description: str
    used_by_inventory_risk: bool


class DecisionResultSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rule_text: str
    champion: str
    challenger: str
    recommended: bool
    pooled_wape_improvement_pct: Optional[float]
    win_rate: Optional[float]
    reason: str


class ComponentEvaluationSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    component_id: int
    sku: str
    name: str
    zero_demand: bool
    models: Dict[str, ModelMetricSummarySchema]
    best_model: Optional[str]


class SkippedComponentSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    component_id: int
    sku: str
    name: str
    reason: str


class ForecastEvaluationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    as_of: date
    data_caveat: str
    protocol: ProtocolInfoSchema
    models: List[ModelMetadataSchema]
    aggregate: Dict[str, AggregateModelSummarySchema]
    decision: DecisionResultSchema
    per_component: List[ComponentEvaluationSchema]
    skipped: List[SkippedComponentSchema]
    seeded: bool = True


class DayForecastSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: date
    weekday: str
    forecasts: Dict[str, float]


class BacktestPointSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: date
    actual: float
    forecasts: Dict[str, float]


class ComponentForecastDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    component_id: int
    sku: str
    name: str
    as_of: date
    days: int
    forecast_days: List[DayForecastSchema]
    backtest_last_fold: List[BacktestPointSchema]
    seeded: bool = True
