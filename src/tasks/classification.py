from __future__ import annotations

from typing import Any, Optional

from ..events.intelligence import IntelligenceEvents
from ..services.intelligence import IntelligenceService
from . import XStockTaskBase
from .base import Scheduler


class ClassificationTask(XStockTaskBase):
    """Spec §3.5 recompute_abc_xyz_classification — monthly. Persists Product.abc_class/xyz_class."""

    job_id = "xstock.recompute_abc_xyz_classification"

    def __init__(self, db: Any, events_bus: Optional[Any] = None) -> None:
        super().__init__(db)
        self._events = IntelligenceEvents(events_bus)

    def register(self, scheduler: Scheduler) -> None:
        @scheduler.cron("0 3 1 * *", job_id=self.job_id)  # 1st of month, 03:00
        async def job() -> None:
            await self.run_all_tenants()

    async def run_for_tenant(self, tenant_id: str) -> None:
        service = IntelligenceService(self._db, tenant_id)
        result = await service.classify_products()
        for product_id, classes in result.items():
            abc = classes["abc"].abc_class.value if classes["abc"] else None
            xyz = classes["xyz"].xyz_class.value if classes["xyz"] else None
            await self._events.classification_updated(tenant_id, product_id, abc, xyz)
