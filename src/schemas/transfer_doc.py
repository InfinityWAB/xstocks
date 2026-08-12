from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from ..models.enums import StockMoveType, StockTransferStatus
from .base import CAMEL

# ---------------------------------------------------------------------------
# StockTransferLine
# ---------------------------------------------------------------------------


class StockTransferLineCreate(BaseModel):
    model_config = CAMEL

    product_id: str
    batch_id: Optional[str] = None
    requested_quantity: float = Field(..., gt=0)


class StockTransferLineResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    transfer_id: str
    product_id: str
    product_name: Optional[str] = None
    batch_id: Optional[str]
    requested_quantity: float
    done_quantity: Optional[float]


# ---------------------------------------------------------------------------
# StockTransfer
# ---------------------------------------------------------------------------


class StockTransferCreate(BaseModel):
    model_config = CAMEL

    type: StockMoveType
    source_warehouse_id: Optional[str] = None
    destination_warehouse_id: Optional[str] = None
    source_location_id: Optional[str] = None
    destination_location_id: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    source_reference: Optional[str] = Field(None, max_length=255)
    lines: list[StockTransferLineCreate] = Field(..., min_length=1)


class StockTransferResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    type: StockMoveType
    status: StockTransferStatus
    source_warehouse_id: Optional[str]
    source_warehouse_name: Optional[str] = None
    destination_warehouse_id: Optional[str]
    destination_warehouse_name: Optional[str] = None
    source_location_id: Optional[str]
    destination_location_id: Optional[str]
    scheduled_date: Optional[datetime]
    effective_date: Optional[datetime]
    source_reference: Optional[str]
    created_by: str


class StockTransferLineDone(BaseModel):
    model_config = CAMEL

    line_id: str
    done_quantity: float = Field(..., gt=0)


class ExecuteStockTransferRequest(BaseModel):
    model_config = CAMEL

    lines: Optional[list[StockTransferLineDone]] = None
