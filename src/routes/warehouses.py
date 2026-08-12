from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from xcore.sdk import require_permission

from ..schemas.product import (
    StockLocationCreate,
    StockLocationResponse,
    StockLocationUpdate,
    WarehouseCreate,
    WarehouseResponse,
    WarehouseUpdate,
)
from ..services.exceptions import (
    DuplicateStockLocationCodeError,
    DuplicateWarehouseCodeError,
    StockLocationNotFoundError,
    WarehouseNotFoundError,
)
from .deps import stock_location_svc, warehouse_svc

_r = require_permission("xstock:warehouses:read")
_w = require_permission("xstock:warehouses:write")

_404 = HTTPException(status.HTTP_404_NOT_FOUND, detail="Warehouse not found")
_404_location = HTTPException(status.HTTP_404_NOT_FOUND, detail="Stock location not found")


def build_warehouses_router(db) -> APIRouter:
    router = APIRouter(tags=["xstock-warehouses"])

    # ── Warehouse ────────────────────────────────────────────

    @router.get("/", response_model=List[WarehouseResponse], dependencies=[Depends(_r)])
    async def list_warehouses(
        request: Request, limit: int = 50, offset: int = 0
    ) -> List[WarehouseResponse]:
        return await warehouse_svc(db, request).list_warehouses(limit=limit, offset=offset)

    @router.get("/by-site/{site_id}", response_model=List[WarehouseResponse], dependencies=[Depends(_r)])
    async def list_warehouses_by_site(site_id: str, request: Request) -> List[WarehouseResponse]:
        return await warehouse_svc(db, request).list_by_site(site_id)

    @router.post(
        "/", response_model=WarehouseResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(_w)]
    )
    async def create_warehouse(request: Request, body: WarehouseCreate) -> WarehouseResponse:
        try:
            return await warehouse_svc(db, request).create_warehouse(body)
        except DuplicateWarehouseCodeError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.get("/{warehouse_id}", response_model=WarehouseResponse, dependencies=[Depends(_r)])
    async def get_warehouse(warehouse_id: str, request: Request) -> WarehouseResponse:
        try:
            return await warehouse_svc(db, request).get_warehouse(warehouse_id)
        except WarehouseNotFoundError:
            raise _404

    @router.patch("/{warehouse_id}", response_model=WarehouseResponse, dependencies=[Depends(_w)])
    async def update_warehouse(
        warehouse_id: str, request: Request, body: WarehouseUpdate
    ) -> WarehouseResponse:
        try:
            return await warehouse_svc(db, request).update_warehouse(warehouse_id, body)
        except WarehouseNotFoundError:
            raise _404

    @router.post(
        "/{warehouse_id}/deactivate", response_model=WarehouseResponse, dependencies=[Depends(_w)]
    )
    async def deactivate_warehouse(warehouse_id: str, request: Request) -> WarehouseResponse:
        try:
            return await warehouse_svc(db, request).deactivate_warehouse(warehouse_id)
        except WarehouseNotFoundError:
            raise _404

    # ── StockLocation (nested under warehouse) ───────────────

    @router.get(
        "/{warehouse_id}/locations",
        response_model=List[StockLocationResponse],
        dependencies=[Depends(_r)],
    )
    async def list_locations(warehouse_id: str, request: Request) -> List[StockLocationResponse]:
        return await stock_location_svc(db, request).list_by_warehouse(warehouse_id)

    @router.post(
        "/{warehouse_id}/locations",
        response_model=StockLocationResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_w)],
    )
    async def create_location(
        warehouse_id: str, request: Request, body: StockLocationCreate
    ) -> StockLocationResponse:
        # Path is the source of truth for warehouse_id, regardless of the body.
        data = body.model_copy(update={"warehouse_id": warehouse_id})
        try:
            return await stock_location_svc(db, request).create_location(data)
        except DuplicateStockLocationCodeError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.get(
        "/{warehouse_id}/locations/{location_id}",
        response_model=StockLocationResponse,
        dependencies=[Depends(_r)],
    )
    async def get_location(
        warehouse_id: str, location_id: str, request: Request
    ) -> StockLocationResponse:
        try:
            location = await stock_location_svc(db, request).get_location(location_id)
        except StockLocationNotFoundError:
            raise _404_location
        if location.warehouse_id != warehouse_id:
            raise _404_location
        return location

    @router.patch(
        "/{warehouse_id}/locations/{location_id}",
        response_model=StockLocationResponse,
        dependencies=[Depends(_w)],
    )
    async def update_location(
        warehouse_id: str, location_id: str, request: Request, body: StockLocationUpdate
    ) -> StockLocationResponse:
        try:
            location = await stock_location_svc(db, request).get_location(location_id)
        except StockLocationNotFoundError:
            raise _404_location
        if location.warehouse_id != warehouse_id:
            raise _404_location
        return await stock_location_svc(db, request).update_location(location_id, body)

    return router
