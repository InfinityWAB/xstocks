from __future__ import annotations

from typing import Any, Generic, Optional, Type, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.base import ModelBase

ModelT = TypeVar("ModelT", bound=ModelBase)


class BaseRepository(Generic[ModelT]):
    """
    Tenant-scoped CRUD base. Every xstock model carries a tenant_id column
    (TenantMixin) — all lookups here take tenant_id explicitly and never trust
    a caller-supplied id alone, to avoid cross-tenant leaks.
    """

    model: Type[ModelT]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, id: str, tenant_id: str) -> Optional[ModelT]:
        result = await self.session.execute(
            select(self.model).where(
                self.model.id == id, self.model.tenant_id == tenant_id
            )
        )
        return result.scalars().first()

    async def list(
        self, tenant_id: str, *, limit: int = 50, offset: int = 0
    ) -> list[ModelT]:
        result = await self.session.execute(
            select(self.model)
            .where(self.model.tenant_id == tenant_id)
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def list_by_ids(self, ids: list[str], tenant_id: str) -> list[ModelT]:
        """Batch lookup — used to build id→name maps when enriching a list
        response instead of issuing one query per row."""
        if not ids:
            return []
        result = await self.session.execute(
            select(self.model).where(self.model.id.in_(ids), self.model.tenant_id == tenant_id)
        )
        return list(result.scalars().all())

    async def save(self, obj: ModelT) -> ModelT:
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update(self, obj: ModelT, **kwargs: Any) -> ModelT:
        for key, value in kwargs.items():
            setattr(obj, key, value)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def delete(self, obj: ModelT) -> None:
        await self.session.delete(obj)
        await self.session.flush()
