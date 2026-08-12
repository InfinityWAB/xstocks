"""
StockSettingsService — per-tenant configurable knobs for xstock's engines/
tasks (StockSettings), and per-alert-type recipient lists (AlertSubscription)
that override the hardcoded permission defaults in permissions.py.

Settings rows are created lazily with defaults on first read — there's no
tenant-onboarding hook that pre-creates them.
"""
from __future__ import annotations

from ..models.enums import AlertType
from ..models.settings import AlertSubscription, StockSettings
from ..repositories.settings import AlertSubscriptionRepository, StockSettingsRepository
from ..schemas.settings import (
    AlertSubscriptionResponse,
    AlertSubscriptionUpsert,
    StockSettingsResponse,
    StockSettingsUpdate,
)
from .alert import AlertRecipients


class StockSettingsService:
    def __init__(self, db, tenant_id: str) -> None:
        self._db = db
        self.tenant_id = tenant_id

    # ── StockSettings ────────────────────────────────────────

    async def get_settings(self) -> StockSettingsResponse:
        async with self._db.session() as session:
            repo = StockSettingsRepository(session)
            settings = await repo.get_for_tenant(self.tenant_id)
            if settings is None:
                settings = await repo.save(StockSettings(tenant_id=self.tenant_id))
                await session.commit()
            return StockSettingsResponse.model_validate(settings)

    async def update_settings(self, data: StockSettingsUpdate) -> StockSettingsResponse:
        async with self._db.session() as session:
            repo = StockSettingsRepository(session)
            settings = await repo.get_for_tenant(self.tenant_id)
            if settings is None:
                settings = await repo.save(StockSettings(tenant_id=self.tenant_id))

            patch = data.model_dump(exclude_unset=True)
            if patch:
                settings = await repo.update(settings, **patch)
            await session.commit()
            return StockSettingsResponse.model_validate(settings)

    # ── AlertSubscription ────────────────────────────────────

    async def list_alert_subscriptions(self) -> list[AlertSubscriptionResponse]:
        async with self._db.session() as session:
            subs = await AlertSubscriptionRepository(session).list_for_tenant(self.tenant_id)
            return [AlertSubscriptionResponse.model_validate(s) for s in subs]

    async def upsert_alert_subscription(self, data: AlertSubscriptionUpsert) -> AlertSubscriptionResponse:
        async with self._db.session() as session:
            repo = AlertSubscriptionRepository(session)
            existing = await repo.get_by_type(data.alert_type, self.tenant_id)
            if existing is None:
                existing = await repo.save(
                    AlertSubscription(
                        tenant_id=self.tenant_id,
                        alert_type=data.alert_type,
                        user_ids=data.user_ids,
                        role_id=data.role_id,
                        permission=data.permission,
                    )
                )
            else:
                existing = await repo.update(
                    existing, user_ids=data.user_ids, role_id=data.role_id, permission=data.permission
                )
            await session.commit()
            return AlertSubscriptionResponse.model_validate(existing)

    async def delete_alert_subscription(self, alert_type: AlertType) -> None:
        """Revert an alert type to its hardcoded default (permissions.py)."""
        async with self._db.session() as session:
            repo = AlertSubscriptionRepository(session)
            existing = await repo.get_by_type(alert_type, self.tenant_id)
            if existing is not None:
                await repo.delete(existing)
                await session.commit()

    async def get_alert_recipients(self, alert_type: AlertType, default_permission: str) -> AlertRecipients:
        """
        Recipients for an alert type: the tenant's configured subscription if
        any, otherwise the hardcoded default permission from permissions.py.
        """
        async with self._db.session() as session:
            sub = await AlertSubscriptionRepository(session).get_by_type(alert_type, self.tenant_id)
            if sub is None:
                return AlertRecipients(permission=default_permission)
            return AlertRecipients(user_ids=sub.user_ids, role_id=sub.role_id, permission=sub.permission)
