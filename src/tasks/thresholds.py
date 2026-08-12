from __future__ import annotations

from typing import Any, Optional

from ..events.intelligence import IntelligenceEvents
from ..models.enums import AlertType
from ..permissions import ALERTS_STOCK
from ..repositories.movement import StockLevelRepository
from ..repositories.product import ProductRepository
from ..services.alert import AlertService, CallPlugin
from ..services.settings import StockSettingsService
from . import XStockTaskBase
from .base import Scheduler


class StockThresholdTask(XStockTaskBase):
    """Spec §3.5 check_stock_thresholds — daily. Flags per-warehouse breaches of Product.min/max_threshold."""

    job_id = "xstock.check_stock_thresholds"

    def __init__(
        self, db: Any, events_bus: Optional[Any] = None, call_plugin: Optional[CallPlugin] = None
    ) -> None:
        super().__init__(db)
        self._events = IntelligenceEvents(events_bus)
        self._events_bus = events_bus
        self._call_plugin = call_plugin

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
        settings = StockSettingsService(self._db, tenant_id) if alerts is not None else None

        async with self._db.session() as session:
            products = await ProductRepository(session).list_active(tenant_id)
            level_repo = StockLevelRepository(session)

            for product in products:
                if product.min_threshold is None and product.max_threshold is None:
                    continue

                levels = await level_repo.list_by_product(product.id, tenant_id)
                by_warehouse: dict[str, float] = {}
                for level in levels:
                    by_warehouse[level.warehouse_id] = (
                        by_warehouse.get(level.warehouse_id, 0.0) + level.available_quantity
                    )

                for warehouse_id, quantity in by_warehouse.items():
                    if product.min_threshold is not None and quantity < product.min_threshold:
                        await self._raise(
                            alerts, settings, tenant_id, product, warehouse_id, quantity,
                            product.min_threshold, "below_min",
                        )
                    if product.max_threshold is not None and quantity > product.max_threshold:
                        await self._raise(
                            alerts, settings, tenant_id, product, warehouse_id, quantity,
                            product.max_threshold, "above_max",
                        )

    async def _raise(
        self,
        alerts: Optional[AlertService],
        settings: Optional[StockSettingsService],
        tenant_id: str,
        product: Any,
        warehouse_id: str,
        quantity: float,
        threshold: float,
        direction: str,
    ) -> None:
        await self._events.stock_threshold_alert(tenant_id, product.id, warehouse_id, quantity, threshold, direction)

        if alerts is None or settings is None:
            return
        recipients = await settings.get_alert_recipients(AlertType.STOCK_THRESHOLD, ALERTS_STOCK)
        label = "below minimum" if direction == "below_min" else "above maximum"
        await alerts.send(
            recipients=recipients,
            event_type="xstock.stock.threshold_alert",
            subject=f"Stock alert — {product.name} {label}",
            text=(
                f"{product.name} ({product.code}) is {label} in warehouse {warehouse_id}: "
                f"{quantity} vs threshold {threshold}."
            ),
            create_task=True,
            task_priority="high",
            task_category="stock_threshold",
            extra={"product_id": product.id, "warehouse_id": warehouse_id, "direction": direction},
        )
