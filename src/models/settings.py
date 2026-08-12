from __future__ import annotations

from typing import Optional

from sqlalchemy import Enum as SqlEnum, Float, Index, Integer, String

from sqlalchemy.orm import Mapped, mapped_column

from .base import JSON_VARIANT, ModelBase, TenantMixin
from .enums import AlertType


class StockSettings(TenantMixin, ModelBase):
    """
    Tenant-configurable scalar knobs for xstock's engines and tasks. One row
    per tenant — created lazily with defaults on first access
    (StockSettingsService.get_settings), not at tenant onboarding time.
    """

    __tablename__ = "xstock_settings"

    default_lead_time_days: Mapped[float] = mapped_column(Float, nullable=False, default=7.0)
    default_service_level: Mapped[float] = mapped_column(Float, nullable=False, default=0.95)
    expiry_warning_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)

    __table_args__ = (
        Index("idx_xstock_settings_tenant", "tenant_id", unique=True),
    )

    def __repr__(self) -> str:
        return f"<StockSettings(tenant_id={self.tenant_id!r})>"


class AlertSubscription(TenantMixin, ModelBase):
    """
    Which users should receive a given xstock alert type. Exactly one of
    user_ids/role_id/permission is expected to be set — same targeting modes
    as AlertRecipients (services/alert.py), just persisted per tenant instead
    of hardcoded in permissions.py. One row per (tenant_id, alert_type).
    """

    __tablename__ = "xstock_alert_subscriptions"

    alert_type: Mapped[AlertType] = mapped_column(SqlEnum(AlertType), nullable=False)

    user_ids: Mapped[Optional[list]] = mapped_column(JSON_VARIANT, nullable=True)
    role_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    permission: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        Index("idx_xstock_alert_sub_tenant_type", "tenant_id", "alert_type", unique=True),
    )

    def __repr__(self) -> str:
        return f"<AlertSubscription(tenant_id={self.tenant_id!r}, alert_type={self.alert_type!r})>"
