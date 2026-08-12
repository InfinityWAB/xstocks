from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import and_, select

from ..models.enums import BatchStatus
from ..models.movement import Batch, StockLevel, StockMove, ValuationLayer
from .base import BaseRepository


class BatchRepository(BaseRepository[Batch]):
    model = Batch

    async def get_by_number(self, product_id: str, batch_number: str, tenant_id: str) -> Optional[Batch]:
        result = await self.session.execute(
            select(Batch).where(
                Batch.tenant_id == tenant_id,
                Batch.product_id == product_id,
                Batch.batch_number == batch_number,
            )
        )
        return result.scalars().first()

    async def list_by_product(self, product_id: str, tenant_id: str) -> list[Batch]:
        result = await self.session.execute(
            select(Batch).where(Batch.tenant_id == tenant_id, Batch.product_id == product_id)
        )
        return list(result.scalars().all())

    async def list_expiring_before(self, cutoff: date, tenant_id: str) -> list[Batch]:
        result = await self.session.execute(
            select(Batch).where(
                Batch.tenant_id == tenant_id,
                Batch.status == BatchStatus.ACTIVE,
                Batch.expiry_date.is_not(None),
                Batch.expiry_date <= cutoff,
            )
        )
        return list(result.scalars().all())


class StockMoveRepository(BaseRepository[StockMove]):
    model = StockMove

    async def list_by_product(
        self,
        product_id: str,
        tenant_id: str,
        *,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
    ) -> list[StockMove]:
        conditions = [StockMove.tenant_id == tenant_id, StockMove.product_id == product_id]
        if since is not None:
            conditions.append(StockMove.move_date >= since)
        if until is not None:
            conditions.append(StockMove.move_date <= until)
        result = await self.session.execute(
            select(StockMove).where(and_(*conditions)).order_by(StockMove.move_date.asc())
        )
        return list(result.scalars().all())

    async def list_all(
        self, tenant_id: str, *, limit: int = 100, offset: int = 0
    ) -> list[StockMove]:
        """Tous les mouvements du tenant, les plus récents d'abord — flux global."""
        result = await self.session.execute(
            select(StockMove)
            .where(StockMove.tenant_id == tenant_id)
            .order_by(StockMove.move_date.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())


class StockLevelRepository(BaseRepository[StockLevel]):
    model = StockLevel

    async def get_for(
        self,
        product_id: str,
        warehouse_id: str,
        tenant_id: str,
        batch_id: Optional[str] = None,
        location_id: Optional[str] = None,
        *,
        for_update: bool = False,
    ) -> Optional[StockLevel]:
        """
        `for_update=True` verrouille la ligne (`SELECT ... FOR UPDATE`) pour
        tout appelant qui va lire puis réécrire `available_quantity`/
        `reserved_quantity` dans la même transaction — sans quoi deux écritures
        concurrentes sur le même (tenant, produit, entrepôt, lot) peuvent
        chacune lire le même solde avant que l'une ou l'autre n'écrive
        (*lost update*), faisant passer le contrôle anti-survente alors que la
        contrainte n'est plus respectée une fois les deux commits appliqués
        (audit xstock Constat 4). No-op sous SQLite dev, appliqué sous
        PostgreSQL — même limite documentée que `get_last_sequence_for_update`
        dans `repositories/pharma.py`. Doit être appelé à l'intérieur d'une
        transaction ; le verrou est relâché au commit.
        """
        query = select(StockLevel).where(
            StockLevel.tenant_id == tenant_id,
            StockLevel.product_id == product_id,
            StockLevel.warehouse_id == warehouse_id,
            StockLevel.location_id == location_id,
            StockLevel.batch_id == batch_id,
        )
        if for_update:
            query = query.with_for_update()
        result = await self.session.execute(query)
        return result.scalars().first()

    async def get_or_create(
        self,
        product_id: str,
        warehouse_id: str,
        tenant_id: str,
        batch_id: Optional[str] = None,
        location_id: Optional[str] = None,
        *,
        for_update: bool = False,
    ) -> StockLevel:
        level = await self.get_for(
            product_id, warehouse_id, tenant_id, batch_id, location_id, for_update=for_update,
        )
        if level is not None:
            return level
        level = StockLevel(
            tenant_id=tenant_id,
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            batch_id=batch_id,
            available_quantity=0,
            reserved_quantity=0,
        )
        return await self.save(level)

    async def list_by_product(self, product_id: str, tenant_id: str) -> list[StockLevel]:
        result = await self.session.execute(
            select(StockLevel).where(
                StockLevel.tenant_id == tenant_id,
                StockLevel.product_id == product_id,
            )
        )
        return list(result.scalars().all())

    async def list_by_warehouse(self, warehouse_id: str, tenant_id: str) -> list[StockLevel]:
        result = await self.session.execute(
            select(StockLevel).where(
                StockLevel.tenant_id == tenant_id,
                StockLevel.warehouse_id == warehouse_id,
            )
        )
        return list(result.scalars().all())

    async def list_by_location(self, location_id: str, tenant_id: str) -> list[StockLevel]:
        result = await self.session.execute(
            select(StockLevel).where(
                StockLevel.tenant_id == tenant_id,
                StockLevel.location_id == location_id,
            )
        )
        return list(result.scalars().all())

    async def list_all(self, tenant_id: str) -> list[StockLevel]:
        """Tous les niveaux du tenant — agrégation des totaux par produit (Inventaire, alertes)."""
        result = await self.session.execute(
            select(StockLevel).where(StockLevel.tenant_id == tenant_id)
        )
        return list(result.scalars().all())

    async def list_batches_in_warehouse(
        self, product_id: str, warehouse_id: str, tenant_id: str
    ) -> list[StockLevel]:
        """Batch-level StockLevel rows (batch_id set) for a product in a warehouse — picking candidates."""
        result = await self.session.execute(
            select(StockLevel).where(
                StockLevel.tenant_id == tenant_id,
                StockLevel.product_id == product_id,
                StockLevel.warehouse_id == warehouse_id,
                StockLevel.batch_id.is_not(None),
                StockLevel.available_quantity > 0,
            )
        )
        return list(result.scalars().all())


class ValuationLayerRepository(BaseRepository[ValuationLayer]):
    model = ValuationLayer

    async def list_open(
        self, product_id: str, warehouse_id: str, tenant_id: str, batch_id: Optional[str] = None
    ) -> list[ValuationLayer]:
        """Open (partially or fully unconsumed) layers, oldest received first."""
        conditions = [
            ValuationLayer.tenant_id == tenant_id,
            ValuationLayer.product_id == product_id,
            ValuationLayer.warehouse_id == warehouse_id,
            ValuationLayer.quantity_remaining > 0,
        ]
        if batch_id is not None:
            conditions.append(ValuationLayer.batch_id == batch_id)
        result = await self.session.execute(
            select(ValuationLayer).where(and_(*conditions)).order_by(ValuationLayer.received_at.asc())
        )
        return list(result.scalars().all())

    async def list_by_product(self, product_id: str, tenant_id: str) -> list[ValuationLayer]:
        result = await self.session.execute(
            select(ValuationLayer)
            .where(ValuationLayer.tenant_id == tenant_id, ValuationLayer.product_id == product_id)
            .order_by(ValuationLayer.received_at.asc())
        )
        return list(result.scalars().all())
