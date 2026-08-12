from __future__ import annotations

from sqlalchemy import select

from ..models.attachment import Attachment
from ..models.enums import AttachmentOwnerType
from .base import BaseRepository


class AttachmentRepository(BaseRepository[Attachment]):
    model = Attachment

    async def list_for_owner(
        self, owner_type: AttachmentOwnerType, owner_id: str, tenant_id: str
    ) -> list[Attachment]:
        result = await self.session.execute(
            select(Attachment).where(
                Attachment.tenant_id == tenant_id,
                Attachment.owner_type == owner_type,
                Attachment.owner_id == owner_id,
            )
        )
        return list(result.scalars().all())
