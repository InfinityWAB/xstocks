from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from ..models.enums import BatchStatus, StockMoveType
from .base import CAMEL

# ---------------------------------------------------------------------------
# Batch
# ---------------------------------------------------------------------------


class BatchCreate(BaseModel):
    model_config = CAMEL

    product_id: str
    batch_number: str = Field(..., min_length=1, max_length=100)
    expiry_date: Optional[date] = None
    initial_quantity: float = Field(..., gt=0)


class BatchUpdate(BaseModel):
    model_config = CAMEL

    status: Optional[BatchStatus] = None


class BatchResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    product_id: str
    batch_number: str
    expiry_date: Optional[date]
    initial_quantity: float
    status: BatchStatus


# ---------------------------------------------------------------------------
# StockMove
# ---------------------------------------------------------------------------


class StockMoveCreate(BaseModel):
    model_config = CAMEL

    product_id: str
    batch_id: Optional[str] = None
    type: StockMoveType
    quantity: float = Field(..., gt=0)

    warehouse_id: str
    source_location_id: Optional[str] = None
    destination_location_id: Optional[str] = None

    source_reference: Optional[str] = Field(None, max_length=255)
    reason: Optional[str] = Field(None, max_length=255)
    move_date: Optional[datetime] = None

    @model_validator(mode="after")
    def reason_required_for_adjustment(self) -> "StockMoveCreate":
        if self.type == StockMoveType.ADJUSTMENT and not self.reason:
            raise ValueError("reason is required for adjustment moves")
        return self


class StockMoveResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    product_id: str
    product_name: Optional[str] = None
    batch_id: Optional[str]
    type: StockMoveType
    quantity: float

    warehouse_id: str
    warehouse_name: Optional[str] = None
    source_location_id: Optional[str]
    destination_location_id: Optional[str]

    unit_cost: Optional[float]
    total_value: Optional[float]
    balance_before: float
    balance_after: float

    source_reference: Optional[str]
    reason: Optional[str]

    created_by: str
    move_date: datetime

    # Renseignés uniquement quand l'appel est un rejeu idempotent : le résultat est
    # celui du premier appel; idempotency_mismatch liste les champs divergents
    # (quantity, batch_number) entre la requête rejouée et le mouvement d'origine.
    idempotent_replay: bool = False
    idempotency_mismatch: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Movement operation requests — one per StockMovementService method.
# created_by is never client-supplied: it comes from the authenticated actor
# (routes/deps.py actor_dep), never trusted from the request body.
# ---------------------------------------------------------------------------


class ReceiveRequest(BaseModel):
    model_config = CAMEL

    product_id: str
    warehouse_id: str
    quantity: float = Field(..., gt=0)
    location_id: Optional[str] = None
    batch_number: Optional[str] = Field(None, min_length=1, max_length=100)
    expiry_date: Optional[date] = None
    unit_cost: Optional[float] = Field(None, ge=0)
    source_reference: Optional[str] = Field(None, max_length=255)
    reason: Optional[str] = Field(None, max_length=255)
    move_date: Optional[datetime] = None


class IssueRequest(BaseModel):
    model_config = CAMEL

    product_id: str
    warehouse_id: str
    quantity: float = Field(..., gt=0)
    location_id: Optional[str] = None
    witness_id: Optional[str] = None
    source_reference: Optional[str] = Field(None, max_length=255)
    reason: Optional[str] = Field(None, max_length=255)
    move_date: Optional[datetime] = None


class AdjustRequest(BaseModel):
    model_config = CAMEL

    product_id: str
    warehouse_id: str
    delta: float
    reason: str = Field(..., min_length=1, max_length=255)
    batch_id: Optional[str] = None
    location_id: Optional[str] = None
    move_date: Optional[datetime] = None

    @model_validator(mode="after")
    def delta_non_zero(self) -> "AdjustRequest":
        if self.delta == 0:
            raise ValueError("delta must be non-zero")
        return self


class TransferRequest(BaseModel):
    model_config = CAMEL

    product_id: str
    source_warehouse_id: str
    destination_warehouse_id: str
    quantity: float = Field(..., gt=0)
    batch_id: Optional[str] = None
    source_location_id: Optional[str] = None
    destination_location_id: Optional[str] = None
    reason: Optional[str] = Field(None, max_length=255)
    source_reference: Optional[str] = Field(None, max_length=255)
    move_date: Optional[datetime] = None

    @model_validator(mode="after")
    def warehouses_differ(self) -> "TransferRequest":
        if self.source_warehouse_id == self.destination_warehouse_id:
            raise ValueError("source and destination warehouses must differ")
        return self


# ---------------------------------------------------------------------------
# StockLevel (read-only, derived)
# ---------------------------------------------------------------------------


class StockLevelResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    product_id: str
    product_name: Optional[str] = None
    warehouse_id: str
    warehouse_name: Optional[str] = None
    location_id: Optional[str]
    batch_id: Optional[str]
    available_quantity: float
    reserved_quantity: float
    average_cost: Optional[float]


# ---------------------------------------------------------------------------
# ValuationLayer (read-only, derived — audit/transparency endpoint)
# ---------------------------------------------------------------------------


class ValuationLayerResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    product_id: str
    batch_id: Optional[str]
    warehouse_id: str
    source_move_id: str
    unit_cost: float
    quantity_remaining: float
    received_at: datetime
