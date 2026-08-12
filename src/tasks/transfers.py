from __future__ import annotations

from typing import Any, Optional

from ..events.intelligence import IntelligenceEvents
from ..services.intelligence import IntelligenceService
from . import XStockTaskBase
from .base import Scheduler


class TransferSuggestionTask(XStockTaskBase):
    """
    Spec §3.5 generate_transfer_suggestions — weekly.

    lead_time_days_by_product is empty here: real supplier lead times belong
    to the future purchasing module. Every product falls back to
    default_lead_time_days until that module exists and this task can be
    wired to read real values from it.
    """

    job_id = "xstock.generate_transfer_suggestions"

    def __init__(self, db: Any, events_bus: Optional[Any] = None, default_lead_time_days: float = 7.0) -> None:
        super().__init__(db)
        self._events = IntelligenceEvents(events_bus)
        self.default_lead_time_days = default_lead_time_days

    def register(self, scheduler: Scheduler) -> None:
        @scheduler.interval(days=7)
        async def job() -> None:
            await self.run_all_tenants()

    async def run_for_tenant(self, tenant_id: str) -> None:
        service = IntelligenceService(self._db, tenant_id)
        suggestions = await service.generate_transfer_suggestions(
            lead_time_days_by_product={}, default_lead_time_days=self.default_lead_time_days
        )
        for suggestion in suggestions:
            await self._events.transfer_suggestion_created(
                tenant_id,
                suggestion.id,
                suggestion.product_id,
                suggestion.source_site_id,
                suggestion.destination_site_id,
                suggestion.suggested_quantity,
            )
