from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, model_validator

from ..models.enums import AlertType
from .base import CAMEL

# ---------------------------------------------------------------------------
# StockSettings
# ---------------------------------------------------------------------------


class StockSettingsUpdate(BaseModel):
    model_config = CAMEL

    default_lead_time_days: Optional[float] = Field(None, gt=0)
    default_service_level: Optional[float] = Field(None, gt=0, le=1)
    expiry_warning_days: Optional[int] = Field(None, ge=0)


class StockSettingsResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    default_lead_time_days: float
    default_service_level: float
    expiry_warning_days: int


# ---------------------------------------------------------------------------
# AlertSubscription
# ---------------------------------------------------------------------------


class AlertSubscriptionUpsert(BaseModel):
    model_config = CAMEL

    alert_type: AlertType
    user_ids: Optional[list[str]] = None
    role_id: Optional[str] = None
    permission: Optional[str] = None

    @model_validator(mode="after")
    def exactly_one_targeting_mode(self) -> "AlertSubscriptionUpsert":
        modes = [self.user_ids, self.role_id, self.permission]
        if sum(1 for m in modes if m) != 1:
            raise ValueError("exactly one of user_ids, role_id, permission must be set")
        return self


class AlertSubscriptionResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str
    alert_type: AlertType
    user_ids: Optional[list[str]]
    role_id: Optional[str]
    permission: Optional[str]
