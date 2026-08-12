from __future__ import annotations

from sqlalchemy import select

from ..models.inventory import InventoryCount, InventoryCountLine
from .base import BaseRepository


class InventoryCountRepository(BaseRepository[InventoryCount]):
    model = InventoryCount

    async def list_by_warehouse(self, warehouse_id: str, tenant_id: str) -> list[InventoryCount]:
        result = await self.session.execute(
            select(InventoryCount).where(
                InventoryCount.tenant_id == tenant_id,
                InventoryCount.warehouse_id == warehouse_id,
            )
        )
        return list(result.scalars().all())


class InventoryCountLineRepository(BaseRepository[InventoryCountLine]):
    model = InventoryCountLine

    async def list_by_count(self, inventory_count_id: str, tenant_id: str) -> list[InventoryCountLine]:
        result = await self.session.execute(
            select(InventoryCountLine).where(
                InventoryCountLine.tenant_id == tenant_id,
                InventoryCountLine.inventory_count_id == inventory_count_id,
            )
        )
        return list(result.scalars().all())

    async def has_uncounted_lines(self, inventory_count_id: str, tenant_id: str) -> bool:
        lines = await self.list_by_count(inventory_count_id, tenant_id)
        return any(line.counted_quantity is None for line in lines)
