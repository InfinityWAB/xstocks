from __future__ import annotations

from typing import Optional

from sqlalchemy import select

from ..models.product import Product, StockLocation, Warehouse
from .base import BaseRepository


class ProductRepository(BaseRepository[Product]):
    model = Product

    async def get_by_code(self, code: str, tenant_id: str) -> Optional[Product]:
        result = await self.session.execute(
            select(Product).where(Product.tenant_id == tenant_id, Product.code == code)
        )
        return result.scalars().first()

    async def list_active(self, tenant_id: str) -> list[Product]:
        result = await self.session.execute(
            select(Product).where(Product.tenant_id == tenant_id, Product.is_active.is_(True))
        )
        return list(result.scalars().all())

    async def list_lot_tracked(self, tenant_id: str) -> list[Product]:
        result = await self.session.execute(
            select(Product).where(
                Product.tenant_id == tenant_id,
                Product.is_lot_tracked.is_(True),
                Product.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def list_controlled_substances(self, tenant_id: str) -> list[Product]:
        result = await self.session.execute(
            select(Product).where(
                Product.tenant_id == tenant_id,
                Product.is_controlled_substance.is_(True),
            )
        )
        return list(result.scalars().all())


class WarehouseRepository(BaseRepository[Warehouse]):
    model = Warehouse

    async def get_name(self, warehouse_id: Optional[str], tenant_id: str) -> Optional[str]:
        """Shared by every service that enriches a response with a
        warehouse's display name (movement, inventory, stock transfer)."""
        if warehouse_id is None:
            return None
        warehouse = await self.get(warehouse_id, tenant_id)
        return warehouse.name if warehouse else None

    async def get_by_code(self, code: str, tenant_id: str) -> Optional[Warehouse]:
        result = await self.session.execute(
            select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.code == code)
        )
        return result.scalars().first()

    async def list_by_site(self, site_id: str, tenant_id: str) -> list[Warehouse]:
        result = await self.session.execute(
            select(Warehouse).where(
                Warehouse.tenant_id == tenant_id,
                Warehouse.site_id == site_id,
                Warehouse.is_active.is_(True),
            )
        )
        return list(result.scalars().all())


class StockLocationRepository(BaseRepository[StockLocation]):
    model = StockLocation

    async def list_by_warehouse(self, warehouse_id: str, tenant_id: str) -> list[StockLocation]:
        result = await self.session.execute(
            select(StockLocation).where(
                StockLocation.tenant_id == tenant_id,
                StockLocation.warehouse_id == warehouse_id,
            )
        )
        return list(result.scalars().all())

    async def get_by_code(self, warehouse_id: str, code: str, tenant_id: str) -> Optional[StockLocation]:
        result = await self.session.execute(
            select(StockLocation).where(
                StockLocation.tenant_id == tenant_id,
                StockLocation.warehouse_id == warehouse_id,
                StockLocation.code == code,
            )
        )
        return result.scalars().first()
