from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from ..models.enums import ABCClass, LocationType, ValuationMethod, XYZClass
from .base import CAMEL

# ---------------------------------------------------------------------------
# Product
# ---------------------------------------------------------------------------


class ProductCreate(BaseModel):
    model_config = CAMEL

    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    category_id: Optional[str] = None
    unit: str = Field(default="unit", max_length=20)

    purchase_price: Optional[float] = Field(None, ge=0)
    sale_price: Optional[float] = Field(None, ge=0)

    valuation_method: ValuationMethod = ValuationMethod.FEFO
    is_lot_tracked: bool = False

    min_threshold: Optional[float] = Field(None, ge=0)
    max_threshold: Optional[float] = Field(None, ge=0)

    abc_class: Optional[ABCClass] = None
    xyz_class: Optional[XYZClass] = None

    inn: Optional[str] = Field(None, max_length=255)
    dosage_form: Optional[str] = Field(None, max_length=100)
    dosage: Optional[str] = Field(None, max_length=100)
    therapeutic_class: Optional[str] = Field(None, max_length=100)
    is_controlled_substance: bool = False

    requires_cold_chain: bool = False
    min_temperature: Optional[float] = None
    max_temperature: Optional[float] = None

    extra: Optional[dict] = None


class ProductUpdate(BaseModel):
    model_config = CAMEL

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    category_id: Optional[str] = None
    unit: Optional[str] = Field(None, max_length=20)

    purchase_price: Optional[float] = Field(None, ge=0)
    sale_price: Optional[float] = Field(None, ge=0)

    valuation_method: Optional[ValuationMethod] = None
    is_lot_tracked: Optional[bool] = None

    min_threshold: Optional[float] = Field(None, ge=0)
    max_threshold: Optional[float] = Field(None, ge=0)

    abc_class: Optional[ABCClass] = None
    xyz_class: Optional[XYZClass] = None

    inn: Optional[str] = Field(None, max_length=255)
    dosage_form: Optional[str] = Field(None, max_length=100)
    dosage: Optional[str] = Field(None, max_length=100)
    therapeutic_class: Optional[str] = Field(None, max_length=100)
    is_controlled_substance: Optional[bool] = None

    requires_cold_chain: Optional[bool] = None
    min_temperature: Optional[float] = None
    max_temperature: Optional[float] = None

    is_active: Optional[bool] = None
    extra: Optional[dict] = None


class ProductResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str

    code: str
    name: str
    category_id: Optional[str]
    unit: str

    purchase_price: Optional[float]
    sale_price: Optional[float]

    valuation_method: ValuationMethod
    is_lot_tracked: bool

    min_threshold: Optional[float]
    max_threshold: Optional[float]

    abc_class: Optional[ABCClass]
    xyz_class: Optional[XYZClass]

    inn: Optional[str]
    dosage_form: Optional[str]
    dosage: Optional[str]
    therapeutic_class: Optional[str]
    is_controlled_substance: bool

    requires_cold_chain: bool
    min_temperature: Optional[float]
    max_temperature: Optional[float]

    is_active: bool
    extra: Optional[dict]
    created_at: datetime


# ---------------------------------------------------------------------------
# Warehouse
# ---------------------------------------------------------------------------


class WarehouseCreate(BaseModel):
    model_config = CAMEL

    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    site_id: Optional[str] = None


class WarehouseUpdate(BaseModel):
    model_config = CAMEL

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    site_id: Optional[str] = None
    is_active: Optional[bool] = None


class WarehouseResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    code: str
    name: str
    site_id: Optional[str]
    is_active: bool
    default_stock_location_id: Optional[str]


# ---------------------------------------------------------------------------
# StockLocation
# ---------------------------------------------------------------------------


class StockLocationCreate(BaseModel):
    model_config = CAMEL

    warehouse_id: str
    code: str = Field(..., min_length=1, max_length=64)
    location_type: LocationType = LocationType.STOCK_INTERNAL
    parent_id: Optional[str] = None


class StockLocationUpdate(BaseModel):
    model_config = CAMEL

    location_type: Optional[LocationType] = None
    parent_id: Optional[str] = None
    is_active: Optional[bool] = None


class StockLocationResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    warehouse_id: str
    code: str
    location_type: LocationType
    parent_id: Optional[str]
    is_active: bool
