from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Optional

from ..events.intelligence import IntelligenceEvents
from ..models.enums import AlertType
from ..permissions import ALERTS_STOCK
from ..repositories.movement import BatchRepository
from ..repositories.product import ProductRepository
from ..services.alert import AlertService, CallPlugin
from ..services.settings import StockSettingsService
from . import XStockTaskBase
from .base import Scheduler


class BatchExpiryTask(XStockTaskBase):
    """
    Spec §3.5 check_expiry_dates — daily. Alerts on batches expiring within
    the tenant's configured expiry_warning_days (StockSettings), falling
    back to `default_warning_days` for tenants with no settings row yet.
    """

    job_id = "xstock.check_expiry_dates"

    def __init__(
        self,
        db: Any,
        events_bus: Optional[Any] = None,
        call_plugin: Optional[CallPlugin] = None,
        default_warning_days: int = 30,
    ) -> None:
        super().__init__(db)
        self._events = IntelligenceEvents(events_bus)
        self._events_bus = events_bus
        self._call_plugin = call_plugin
        self.default_warning_days = default_warning_days

    def register(self, scheduler: Scheduler) -> None:
        @scheduler.cron("0 6 * * *", job_id=self.job_id)
        async def job() -> None:
            await self.run_all_tenants()

    async def run_for_tenant(self, tenant_id: str) -> None:
        alerts = (
            AlertService(tenant_id, self._call_plugin, self._events_bus)
            if self._call_plugin is not None
            else None
        )
        settings_service = StockSettingsService(self._db, tenant_id)
        settings = await settings_service.get_settings()
        warning_days = settings.expiry_warning_days or self.default_warning_days

        cutoff = date.today() + timedelta(days=warning_days)
        async with self._db.session() as session:
            batches = await BatchRepository(session).list_expiring_before(cutoff, tenant_id)
            product_repo = ProductRepository(session)

            today = date.today()
            for batch in batches:
                days_remaining = (batch.expiry_date - today).days
                await self._events.batch_expiry_alert(
                    tenant_id, batch.id, batch.product_id, batch.expiry_date, days_remaining
                )

                if alerts is None:
                    continue
                product = await product_repo.get(batch.product_id, tenant_id)
                product_label = product.name if product else batch.product_id
                recipients = await settings_service.get_alert_recipients(AlertType.BATCH_EXPIRY, ALERTS_STOCK)
                await alerts.send(
                    recipients=recipients,
                    event_type="xstock.batch.expiry_alert",
                    subject=f"Expiry alert — {product_label} (batch {batch.batch_number})",
                    text=(
                        f"Batch {batch.batch_number} of {product_label} expires on "
                        f"{batch.expiry_date.isoformat()} ({days_remaining} day(s) remaining)."
                    ),
                    create_task=True,
                    task_priority="high" if days_remaining <= 7 else "normal",
                    task_category="batch_expiry",
                    extra={
                        "product_id": batch.product_id,
                        "batch_id": batch.id,
                        "days_remaining": days_remaining,
                    },
                )
