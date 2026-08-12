"""
xstock scheduled tasks — one class per background job (spec §3.5). All
inherit XStockTaskBase.

Not implemented here (see docstrings for why):
  - recompute_stock_levels: event-driven, already done inline by
    StockMovementService on every StockMove — no scheduled job needed.
  - recompute_forecast: forecasts are computed on demand
    (IntelligenceService.forecast_consumption) and never persisted, so
    there is nothing for a scheduled recompute to write — add this task
    once/if a forecast cache table exists.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import select

from ..models.product import Product
from .base import Scheduler

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService

logger = logging.getLogger("xstock.tasks")


class XStockTaskBase:
    """
    Common base for xstock's scheduled tasks.

    xcore's scheduler runs one job for the whole kernel, not one per tenant
    — every task discovers which tenants actually have xstock data and
    loops over them, isolating failures per tenant so one broken tenant
    doesn't block the rest.
    """

    job_id: str = "xstock.task"

    def __init__(self, db: "DatabaseService") -> None:
        self._db = db

    async def _tenant_ids(self, session: "AsyncSession") -> list[str]:
        result = await session.execute(select(Product.tenant_id).distinct())
        return [row[0] for row in result.all()]

    async def run_all_tenants(self) -> None:
        async with self._db.session() as session:
            tenant_ids = await self._tenant_ids(session)
        for tenant_id in tenant_ids:
            try:
                await self.run_for_tenant(tenant_id)
            except Exception as exc:
                logger.error("%s failed for tenant %s: %s", type(self).__name__, tenant_id, exc)

    async def run_for_tenant(self, tenant_id: str) -> None:
        raise NotImplementedError

    def register(self, scheduler: Scheduler) -> None:
        raise NotImplementedError


from .classification import ClassificationTask  # noqa: E402
from .expiry import BatchExpiryTask  # noqa: E402
from .thresholds import StockThresholdTask  # noqa: E402
from .transfers import TransferSuggestionTask  # noqa: E402

__all__ = [
    "Scheduler",
    "XStockTaskBase",
    "StockThresholdTask",
    "BatchExpiryTask",
    "ClassificationTask",
    "TransferSuggestionTask",
]
