from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field

from ..models.enums import InventoryStatus, InventoryType
from .base import CAMEL

# ---------------------------------------------------------------------------
# InventoryCount
# ---------------------------------------------------------------------------


class InventoryCountCreate(BaseModel):
    model_config = CAMEL

    warehouse_id: str
    type: InventoryType
    count_date: date
    # Omitted = full count (every product currently stocked in the warehouse).
    # Set = cycle count scoped to just these products.
    product_ids: Optional[list[str]] = None


class InventoryCountResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    warehouse_id: str
    warehouse_name: Optional[str] = None
    type: InventoryType
    status: InventoryStatus
    count_date: date


class InventoryCountValidateRequest(BaseModel):
    model_config = CAMEL

    override_reason: Optional[str] = Field(None, min_length=1, max_length=1000)


# ---------------------------------------------------------------------------
# InventoryCountLine
# ---------------------------------------------------------------------------


class InventoryCountLineCreate(BaseModel):
    model_config = CAMEL

    inventory_count_id: str
    product_id: str
    expected_quantity: float = Field(..., ge=0)


class InventoryCountLineUpdate(BaseModel):
    model_config = CAMEL

    counted_quantity: float = Field(..., ge=0)


class InventoryCountLineResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    inventory_count_id: str
    product_id: str
    product_name: Optional[str] = None
    expected_quantity: float
    counted_quantity: Optional[float]
    variance: Optional[float]
