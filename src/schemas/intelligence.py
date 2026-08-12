from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from .base import CAMEL

# ---------------------------------------------------------------------------
# Request bodies — dict-shaped params (price_by_product, lead_time_days_by_product)
# don't fit cleanly in query strings, so these engines are POST endpoints
# even though generate_transfer_suggestions/classify_products have DB side
# effects (persisting classification / TransferSuggestion rows) while the
# others are pure reads.
# ---------------------------------------------------------------------------


class ClassifyProductsRequest(BaseModel):
    model_config = CAMEL

    history_days: int = Field(default=90, gt=0)
    price_by_product: Optional[dict[str, float]] = None
    persist: bool = True


class StockoutRiskRequest(BaseModel):
    model_config = CAMEL

    warehouse_id: str
    lead_time_days_by_product: dict[str, float] = Field(default_factory=dict)
    default_lead_time_days: float = Field(default=7.0, gt=0)
    history_days: int = Field(default=30, gt=0)


class TransferSuggestionsRequest(BaseModel):
    model_config = CAMEL

    lead_time_days_by_product: dict[str, float] = Field(default_factory=dict)
    default_lead_time_days: float = Field(default=7.0, gt=0)
    service_level: float = Field(default=0.95, gt=0, le=1)
    history_days: int = Field(default=90, gt=0)


# ---------------------------------------------------------------------------
# Response shapes for the dataclass-returning algorithms (ForecastResult is a
# dataclass, not an ORM row — reshaped here rather than exposing dataclasses
# directly over HTTP).
# ---------------------------------------------------------------------------


class ForecastResponse(BaseModel):
    model_config = CAMEL

    method: str
    forecast: float
    trend: Optional[float] = None


class ReorderPointResponse(BaseModel):
    model_config = CAMEL

    product_id: str
    warehouse_id: str
    avg_daily_demand: float
    demand_std_dev: float
    service_level: float
    lead_time_days: float
    safety_stock: float
    reorder_point: float


class StockoutRiskItem(BaseModel):
    model_config = CAMEL

    product_id: str
    current_stock: float
    days_remaining: float
    lead_time_days: float
    will_stock_out_before_delivery: bool
    criticality: str


class ClassificationItem(BaseModel):
    model_config = CAMEL

    abc: Optional[str] = None
    xyz: Optional[str] = None
