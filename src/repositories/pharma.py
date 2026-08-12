from __future__ import annotations

from typing import Optional

from sqlalchemy import select

from ..models.enums import TransferSuggestionStatus
from ..models.pharma import ControlledSubstanceRegister, TransferSuggestion
from .base import BaseRepository


class ControlledSubstanceRegisterRepository(BaseRepository[ControlledSubstanceRegister]):
    model = ControlledSubstanceRegister

    async def get_last_sequence_for_update(
        self, product_id: str, tenant_id: str
    ) -> Optional[ControlledSubstanceRegister]:
        """
        Locks the last register row for (tenant_id, product_id) so the caller
        can append the next sequence_number = max(previous) + 1 without a race.
        Must be called inside a transaction; the lock is released on commit.

        Note: FOR UPDATE is a no-op on SQLite (dev) — only enforced on PostgreSQL
        (prod). Do not rely on this method alone for correctness in dev/tests.
        """
        result = await self.session.execute(
            select(ControlledSubstanceRegister)
            .where(
                ControlledSubstanceRegister.tenant_id == tenant_id,
                ControlledSubstanceRegister.product_id == product_id,
            )
            .order_by(ControlledSubstanceRegister.sequence_number.desc())
            .limit(1)
            .with_for_update()
        )
        return result.scalars().first()

    async def list_by_product(self, product_id: str, tenant_id: str) -> list[ControlledSubstanceRegister]:
        result = await self.session.execute(
            select(ControlledSubstanceRegister)
            .where(
                ControlledSubstanceRegister.tenant_id == tenant_id,
                ControlledSubstanceRegister.product_id == product_id,
            )
            .order_by(ControlledSubstanceRegister.sequence_number.asc())
        )
        return list(result.scalars().all())


class TransferSuggestionRepository(BaseRepository[TransferSuggestion]):
    model = TransferSuggestion

    async def list_pending(self, tenant_id: str) -> list[TransferSuggestion]:
        result = await self.session.execute(
            select(TransferSuggestion).where(
                TransferSuggestion.tenant_id == tenant_id,
                TransferSuggestion.status == TransferSuggestionStatus.SUGGESTED,
            )
        )
        return list(result.scalars().all())

    async def list_by_product(self, product_id: str, tenant_id: str) -> list[TransferSuggestion]:
        result = await self.session.execute(
            select(TransferSuggestion).where(
                TransferSuggestion.tenant_id == tenant_id,
                TransferSuggestion.product_id == product_id,
            )
        )
        return list(result.scalars().all())
