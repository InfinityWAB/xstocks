"""
Product / Warehouse / StockLocation services.

Responsibilities:
  - CRUD orchestration
  - Duplicate-code validation (per tenant)
  - ORM → Pydantic mapping

Services don't know about FastAPI. They receive Pydantic schemas, open their
own DB sessions, and return Pydantic schemas — same pattern as xcompany's
OrganizationService.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from ..models.enums import LocationType
from ..models.product import Product, StockLocation, Warehouse
from ..repositories.product import ProductRepository, StockLocationRepository, WarehouseRepository
from ..schemas.product import (
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    StockLocationCreate,
    StockLocationResponse,
    StockLocationUpdate,
    WarehouseCreate,
    WarehouseResponse,
    WarehouseUpdate,
)
from .exceptions import (
    DuplicateProductCodeError,
    DuplicateStockLocationCodeError,
    DuplicateWarehouseCodeError,
    ProductNotFoundError,
    StockLocationNotFoundError,
    WarehouseNotFoundError,
)

if TYPE_CHECKING:
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService


class ProductService:
    def __init__(self, db: "DatabaseService", tenant_id: str) -> None:
        self._db = db
        self.tenant_id = tenant_id

    @staticmethod
    def _to_response(product: Product) -> ProductResponse:
        return ProductResponse.model_validate(product)

    # ── Read ─────────────────────────────────────────────────

    async def list_products(self, *, limit: int = 50, offset: int = 0) -> list[ProductResponse]:
        async with self._db.session() as session:
            repo = ProductRepository(session)
            products = await repo.list(self.tenant_id, limit=limit, offset=offset)
            return [self._to_response(p) for p in products]

    async def get_product(self, product_id: str) -> ProductResponse:
        async with self._db.session() as session:
            repo = ProductRepository(session)
            product = await repo.get(product_id, self.tenant_id)
            if product is None:
                raise ProductNotFoundError(product_id)
            return self._to_response(product)

    async def list_active(self) -> list[ProductResponse]:
        async with self._db.session() as session:
            repo = ProductRepository(session)
            products = await repo.list_active(self.tenant_id)
            return [self._to_response(p) for p in products]

    async def list_lot_tracked(self) -> list[ProductResponse]:
        async with self._db.session() as session:
            repo = ProductRepository(session)
            products = await repo.list_lot_tracked(self.tenant_id)
            return [self._to_response(p) for p in products]

    async def list_controlled_substances(self) -> list[ProductResponse]:
        async with self._db.session() as session:
            repo = ProductRepository(session)
            products = await repo.list_controlled_substances(self.tenant_id)
            return [self._to_response(p) for p in products]

    # ── Write ────────────────────────────────────────────────

    async def create_product(self, data: ProductCreate) -> ProductResponse:
        async with self._db.session() as session:
            async with session.begin():
                repo = ProductRepository(session)
                existing = await repo.get_by_code(data.code, self.tenant_id)
                if existing:
                    raise DuplicateProductCodeError(data.code)

                product = Product(tenant_id=self.tenant_id, **data.model_dump())
                product = await repo.save(product)
            return self._to_response(product)

    async def update_product(self, product_id: str, data: ProductUpdate) -> ProductResponse:
        async with self._db.session() as session:
            async with session.begin():
                repo = ProductRepository(session)
                product = await repo.get(product_id, self.tenant_id)
                if product is None:
                    raise ProductNotFoundError(product_id)

                patch = data.model_dump(exclude_unset=True)
                if patch:
                    product = await repo.update(product, **patch)
            return self._to_response(product)

    async def deactivate_product(self, product_id: str) -> ProductResponse:
        """Soft delete — products are never hard-deleted (referenced by moves/batches)."""
        return await self.update_product(product_id, ProductUpdate(is_active=False))


class WarehouseService:
    def __init__(self, db: "DatabaseService", tenant_id: str) -> None:
        self._db = db
        self.tenant_id = tenant_id

    @staticmethod
    def _to_response(warehouse: Warehouse) -> WarehouseResponse:
        return WarehouseResponse.model_validate(warehouse)

    async def list_warehouses(self, *, limit: int = 50, offset: int = 0) -> list[WarehouseResponse]:
        async with self._db.session() as session:
            repo = WarehouseRepository(session)
            warehouses = await repo.list(self.tenant_id, limit=limit, offset=offset)
            return [self._to_response(w) for w in warehouses]

    async def get_warehouse(self, warehouse_id: str) -> WarehouseResponse:
        async with self._db.session() as session:
            repo = WarehouseRepository(session)
            warehouse = await repo.get(warehouse_id, self.tenant_id)
            if warehouse is None:
                raise WarehouseNotFoundError(warehouse_id)
            return self._to_response(warehouse)

    async def list_by_site(self, site_id: str) -> list[WarehouseResponse]:
        async with self._db.session() as session:
            repo = WarehouseRepository(session)
            warehouses = await repo.list_by_site(site_id, self.tenant_id)
            return [self._to_response(w) for w in warehouses]

    async def create_warehouse(self, data: WarehouseCreate) -> WarehouseResponse:
        async with self._db.session() as session:
            async with session.begin():
                repo = WarehouseRepository(session)
                existing = await repo.get_by_code(data.code, self.tenant_id)
                if existing:
                    raise DuplicateWarehouseCodeError(data.code)

                warehouse = Warehouse(tenant_id=self.tenant_id, **data.model_dump())
                warehouse = await repo.save(warehouse)

                # Every warehouse gets a default internal stock location so
                # receive/issue/adjust/transfer callers that don't specify a
                # location (the vast majority — IPC callers in particular)
                # still get location-level StockLevel bookkeeping for free.
                location_repo = StockLocationRepository(session)
                default_location = await location_repo.save(
                    StockLocation(
                        tenant_id=self.tenant_id,
                        warehouse_id=warehouse.id,
                        code="STOCK",
                        location_type=LocationType.STOCK_INTERNAL,
                    )
                )
                warehouse = await repo.update(warehouse, default_stock_location_id=default_location.id)
            return self._to_response(warehouse)

    async def update_warehouse(self, warehouse_id: str, data: WarehouseUpdate) -> WarehouseResponse:
        async with self._db.session() as session:
            async with session.begin():
                repo = WarehouseRepository(session)
                warehouse = await repo.get(warehouse_id, self.tenant_id)
                if warehouse is None:
                    raise WarehouseNotFoundError(warehouse_id)

                patch = data.model_dump(exclude_unset=True)
                if patch:
                    warehouse = await repo.update(warehouse, **patch)
            return self._to_response(warehouse)

    async def deactivate_warehouse(self, warehouse_id: str) -> WarehouseResponse:
        return await self.update_warehouse(warehouse_id, WarehouseUpdate(is_active=False))


class StockLocationService:
    def __init__(self, db: "DatabaseService", tenant_id: str) -> None:
        self._db = db
        self.tenant_id = tenant_id

    @staticmethod
    def _to_response(location: StockLocation) -> StockLocationResponse:
        return StockLocationResponse.model_validate(location)

    async def list_by_warehouse(self, warehouse_id: str) -> list[StockLocationResponse]:
        async with self._db.session() as session:
            repo = StockLocationRepository(session)
            locations = await repo.list_by_warehouse(warehouse_id, self.tenant_id)
            return [self._to_response(loc) for loc in locations]

    async def get_location(self, location_id: str) -> StockLocationResponse:
        async with self._db.session() as session:
            repo = StockLocationRepository(session)
            location = await repo.get(location_id, self.tenant_id)
            if location is None:
                raise StockLocationNotFoundError(location_id)
            return self._to_response(location)

    async def create_location(self, data: StockLocationCreate) -> StockLocationResponse:
        async with self._db.session() as session:
            async with session.begin():
                repo = StockLocationRepository(session)
                existing = await repo.list_by_warehouse(data.warehouse_id, self.tenant_id)
                if any(loc.code == data.code for loc in existing):
                    raise DuplicateStockLocationCodeError(data.warehouse_id, data.code)

                location = StockLocation(tenant_id=self.tenant_id, **data.model_dump())
                location = await repo.save(location)
            return self._to_response(location)

    async def update_location(self, location_id: str, data: StockLocationUpdate) -> StockLocationResponse:
        async with self._db.session() as session:
            async with session.begin():
                repo = StockLocationRepository(session)
                location = await repo.get(location_id, self.tenant_id)
                if location is None:
                    raise StockLocationNotFoundError(location_id)

                patch = data.model_dump(exclude_unset=True)
                if patch:
                    location = await repo.update(location, **patch)
            return self._to_response(location)

    async def deactivate_location(self, location_id: str) -> StockLocationResponse:
        return await self.update_location(location_id, StockLocationUpdate(is_active=False))
