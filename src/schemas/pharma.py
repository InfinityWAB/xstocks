from __future__ import annotations

from pydantic import BaseModel

from ..models.enums import TransferSuggestionStatus
from .base import CAMEL

# ---------------------------------------------------------------------------
# TransferSuggestion
# ---------------------------------------------------------------------------


class TransferSuggestionResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    product_id: str
    source_site_id: str
    destination_site_id: str
    suggested_quantity: float
    reason: str
    status: TransferSuggestionStatus


# ---------------------------------------------------------------------------
# ControlledSubstanceRegister
# ---------------------------------------------------------------------------


class ControlledSubstanceRegisterResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    product_id: str
    batch_id: str
    move_id: str
    sequence_number: int
    signatory_id: str
    witness_id: str
    theoretical_balance_after: float
