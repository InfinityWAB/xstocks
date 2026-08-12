from __future__ import annotations

from sqlalchemy import select

from ..models.enums import StockTransferStatus
from ..models.transfer_doc import StockTransfer, StockTransferLine
from .base import BaseRepository


class StockTransferRepository(BaseRepository[StockTransfer]):
    model = StockTransfer

    async def list_by_status(self, status: StockTransferStatus, tenant_id: str) -> list[StockTransfer]:
        result = await self.session.execute(
            select(StockTransfer).where(
                StockTransfer.tenant_id == tenant_id,
                StockTransfer.status == status,
            )
        )
        return list(result.scalars().all())


class StockTransferLineRepository(BaseRepository[StockTransferLine]):
    model = StockTransferLine

    async def list_by_transfer(self, transfer_id: str, tenant_id: str) -> list[StockTransferLine]:
        result = await self.session.execute(
            select(StockTransferLine).where(
                StockTransferLine.tenant_id == tenant_id,
                StockTransferLine.transfer_id == transfer_id,
            )
        )
        return list(result.scalars().all())
