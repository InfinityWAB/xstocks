from __future__ import annotations

from typing import Optional

from sqlalchemy import select

from ..models.enums import AlertType
from ..models.settings import AlertSubscription, StockSettings
from .base import BaseRepository


class StockSettingsRepository(BaseRepository[StockSettings]):
    model = StockSettings

    async def get_for_tenant(self, tenant_id: str) -> Optional[StockSettings]:
        result = await self.session.execute(
            select(StockSettings).where(StockSettings.tenant_id == tenant_id)
        )
        return result.scalars().first()


class AlertSubscriptionRepository(BaseRepository[AlertSubscription]):
    model = AlertSubscription

    async def get_by_type(self, alert_type: AlertType, tenant_id: str) -> Optional[AlertSubscription]:
        result = await self.session.execute(
            select(AlertSubscription).where(
                AlertSubscription.tenant_id == tenant_id,
                AlertSubscription.alert_type == alert_type,
            )
        )
        return result.scalars().first()

    async def list_for_tenant(self, tenant_id: str) -> list[AlertSubscription]:
        result = await self.session.execute(
            select(AlertSubscription).where(AlertSubscription.tenant_id == tenant_id)
        )
        return list(result.scalars().all())
