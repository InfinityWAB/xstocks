from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from xcore.sdk import require_permission

from ..schemas.product import ProductCreate, ProductResponse, ProductUpdate
from ..services.exceptions import DuplicateProductCodeError, ProductNotFoundError
from .deps import movement_svc, product_svc

class _CommercialView(BaseModel):
    id: str
    code: str
    name: str
    unit: str
    purchase_price: Optional[float]
    sale_price: Optional[float]
    total_stock_quantity: float
    warehouse_count: int


_r = require_permission("xstock:products:read")
_w = require_permission("xstock:products:write")

_404 = HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")


def build_products_router(db) -> APIRouter:
    router = APIRouter(tags=["xstock-products"])

    @router.get("/", response_model=List[ProductResponse], dependencies=[Depends(_r)])
    async def list_products(
        request: Request, limit: int = 50, offset: int = 0
    ) -> List[ProductResponse]:
        return await product_svc(db, request).list_products(limit=limit, offset=offset)

    @router.get("/active", response_model=List[ProductResponse], dependencies=[Depends(_r)])
    async def list_active_products(request: Request) -> List[ProductResponse]:
        return await product_svc(db, request).list_active()

    @router.get("/lot-tracked", response_model=List[ProductResponse], dependencies=[Depends(_r)])
    async def list_lot_tracked_products(request: Request) -> List[ProductResponse]:
        return await product_svc(db, request).list_lot_tracked()

    @router.get(
        "/controlled-substances", response_model=List[ProductResponse], dependencies=[Depends(_r)]
    )
    async def list_controlled_substances(request: Request) -> List[ProductResponse]:
        return await product_svc(db, request).list_controlled_substances()

    @router.post(
        "/", response_model=ProductResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(_w)]
    )
    async def create_product(request: Request, body: ProductCreate) -> ProductResponse:
        try:
            return await product_svc(db, request).create_product(body)
        except DuplicateProductCodeError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.get("/{product_id}", response_model=ProductResponse, dependencies=[Depends(_r)])
    async def get_product(product_id: str, request: Request) -> ProductResponse:
        try:
            return await product_svc(db, request).get_product(product_id)
        except ProductNotFoundError:
            raise _404

    @router.get("/{product_id}/commercial", response_model=_CommercialView, dependencies=[Depends(_r)])
    async def get_product_commercial_view(product_id: str, request: Request) -> _CommercialView:
        try:
            product = await product_svc(db, request).get_product(product_id)
        except ProductNotFoundError:
            raise _404
        levels = await movement_svc(db, request).list_levels_for_product(product_id)
        total_qty = sum(lvl.available_quantity for lvl in levels)
        warehouse_ids = {lvl.warehouse_id for lvl in levels}
        return _CommercialView(
            id=product.id,
            code=product.code,
            name=product.name,
            unit=product.unit,
            purchase_price=product.purchase_price,
            sale_price=product.sale_price,
            total_stock_quantity=total_qty,
            warehouse_count=len(warehouse_ids),
        )

    @router.patch("/{product_id}", response_model=ProductResponse, dependencies=[Depends(_w)])
    async def update_product(
        product_id: str, request: Request, body: ProductUpdate
    ) -> ProductResponse:
        try:
            return await product_svc(db, request).update_product(product_id, body)
        except ProductNotFoundError:
            raise _404

    @router.post(
        "/{product_id}/deactivate", response_model=ProductResponse, dependencies=[Depends(_w)]
    )
    async def deactivate_product(product_id: str, request: Request) -> ProductResponse:
        try:
            return await product_svc(db, request).deactivate_product(product_id)
        except ProductNotFoundError:
            raise _404

    return router
