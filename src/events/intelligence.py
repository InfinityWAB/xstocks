from __future__ import annotations

from datetime import date
from typing import Optional

from . import XStockEventsBase

PRODUCT_CLASSIFICATION_UPDATED = "xstock.product.classification_updated"
STOCK_THRESHOLD_ALERT = "xstock.stock.threshold_alert"
TRANSFER_SUGGESTION_CREATED = "xstock.transfer_suggestion.created"
BATCH_EXPIRY_ALERT = "xstock.batch.expiry_alert"


class IntelligenceEvents(XStockEventsBase):
    async def classification_updated(
        self, tenant_id: str, product_id: str, abc_class: Optional[str], xyz_class: Optional[str]
    ) -> None:
        await self._emit(
            PRODUCT_CLASSIFICATION_UPDATED,
            {"tenant_id": tenant_id, "product_id": product_id, "abc_class": abc_class, "xyz_class": xyz_class},
        )

    async def stock_threshold_alert(
        self, tenant_id: str, product_id: str, warehouse_id: str, current: float, threshold: float, direction: str
    ) -> None:
        """direction: 'below_min' | 'above_max'."""
        await self._emit(
            STOCK_THRESHOLD_ALERT,
            {
                "tenant_id": tenant_id,
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "current": current,
                "threshold": threshold,
                "direction": direction,
            },
        )

    async def transfer_suggestion_created(
        self,
        tenant_id: str,
        suggestion_id: str,
        product_id: str,
        source_site_id: str,
        destination_site_id: str,
        quantity: float,
    ) -> None:
        await self._emit(
            TRANSFER_SUGGESTION_CREATED,
            {
                "tenant_id": tenant_id,
                "suggestion_id": suggestion_id,
                "product_id": product_id,
                "source_site_id": source_site_id,
                "destination_site_id": destination_site_id,
                "quantity": quantity,
            },
        )

    async def batch_expiry_alert(
        self, tenant_id: str, batch_id: str, product_id: str, expiry_date: date, days_remaining: int
    ) -> None:
        await self._emit(
            BATCH_EXPIRY_ALERT,
            {
                "tenant_id": tenant_id,
                "batch_id": batch_id,
                "product_id": product_id,
                "expiry_date": expiry_date.isoformat(),
                "days_remaining": days_remaining,
            },
        )
