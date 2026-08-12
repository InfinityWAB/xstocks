from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from xcore.sdk import require_permission

from ..schemas.movement import (
    AdjustRequest,
    BatchResponse,
    IssueRequest,
    ReceiveRequest,
    StockLevelResponse,
    StockMoveResponse,
    TransferRequest,
    ValuationLayerResponse,
)
from ..schemas.pharma import ControlledSubstanceRegisterResponse
from ..services.exceptions import (
    ControlledSubstanceRequiresLotTrackingError,
    InsufficientStockError,
    InvalidWitnessError,
    ProductNotFoundError,
    WitnessRequiredError,
)
from .deps import actor_dep, movement_svc

_r = require_permission("xstock:movements:read")
_w = require_permission("xstock:movements:write")
_adjust = require_permission("xstock:movements:adjust")


async def _broadcast(ws: Optional[Any], tenant_id: str, event: str, data: dict) -> None:
    """Diffusion best-effort sur le canal 'xstock' — jamais bloquant pour la requête."""
    if ws is None:
        return
    try:
        await ws.broadcast(channel="xstock", event=event, data={"tenant_id": tenant_id, **data})
    except Exception:
        pass


def build_movements_router(db, ws: Optional[Any] = None, call_plugin: Optional[Any] = None) -> APIRouter:
    router = APIRouter(tags=["xstock-movements"])

    @router.post(
        "/receive", response_model=StockMoveResponse, status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_w)],
    )
    async def receive(
        request: Request, body: ReceiveRequest, actor: str = Depends(actor_dep)
    ) -> StockMoveResponse:
        svc = movement_svc(db, request)
        try:
            move = await svc.receive(created_by=actor, **body.model_dump())
        except ProductNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        await _broadcast(ws, svc.tenant_id, "MOVEMENT_RECEIVED", {"productId": body.product_id, "warehouseId": body.warehouse_id})
        return move

    @router.post(
        "/issue", response_model=List[StockMoveResponse], status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_w)],
    )
    async def issue(
        request: Request, body: IssueRequest, actor: str = Depends(actor_dep)
    ) -> List[StockMoveResponse]:
        svc = movement_svc(db, request, call_plugin=call_plugin)
        try:
            moves = await svc.issue(created_by=actor, **body.model_dump())
        except ProductNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
        except WitnessRequiredError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        except InvalidWitnessError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        except ControlledSubstanceRequiresLotTrackingError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        except InsufficientStockError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))
        await _broadcast(ws, svc.tenant_id, "MOVEMENT_ISSUED", {"productId": body.product_id, "warehouseId": body.warehouse_id})
        return moves

    @router.post(
        "/adjust", response_model=StockMoveResponse, status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_adjust)],
    )
    async def adjust(
        request: Request, body: AdjustRequest, actor: str = Depends(actor_dep)
    ) -> StockMoveResponse:
        svc = movement_svc(db, request)
        try:
            move = await svc.adjust(created_by=actor, **body.model_dump())
        except ProductNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
        except InsufficientStockError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        await _broadcast(ws, svc.tenant_id, "MOVEMENT_ADJUSTED", {"productId": body.product_id, "warehouseId": body.warehouse_id})
        return move

    @router.post(
        "/transfer", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_w)],
    )
    async def transfer(
        request: Request, body: TransferRequest, actor: str = Depends(actor_dep)
    ) -> dict:
        svc = movement_svc(db, request)
        try:
            out_move, in_move = await svc.transfer(created_by=actor, **body.model_dump())
        except ProductNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
        except InsufficientStockError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        await _broadcast(ws, svc.tenant_id, "MOVEMENT_TRANSFERRED", {
            "productId": body.product_id,
            "sourceWarehouseId": body.source_warehouse_id,
            "destinationWarehouseId": body.destination_warehouse_id,
        })
        return {"out": out_move, "in": in_move}

    @router.get("/", response_model=List[StockMoveResponse], dependencies=[Depends(_r)])
    async def list_all(request: Request, limit: int = 100, offset: int = 0) -> List[StockMoveResponse]:
        return await movement_svc(db, request).list_all_moves(limit=limit, offset=offset)

    @router.get("/levels/", response_model=List[StockLevelResponse], dependencies=[Depends(_r)])
    async def levels_all(request: Request) -> List[StockLevelResponse]:
        return await movement_svc(db, request).list_all_levels()

    @router.get(
        "/levels/by-product/{product_id}", response_model=List[StockLevelResponse], dependencies=[Depends(_r)]
    )
    async def levels_by_product(product_id: str, request: Request) -> List[StockLevelResponse]:
        return await movement_svc(db, request).list_levels_for_product(product_id)

    @router.get(
        "/levels/by-warehouse/{warehouse_id}", response_model=List[StockLevelResponse],
        dependencies=[Depends(_r)],
    )
    async def levels_by_warehouse(warehouse_id: str, request: Request) -> List[StockLevelResponse]:
        return await movement_svc(db, request).list_levels_for_warehouse(warehouse_id)

    @router.get(
        "/levels/by-location/{location_id}", response_model=List[StockLevelResponse],
        dependencies=[Depends(_r)],
    )
    async def levels_by_location(location_id: str, request: Request) -> List[StockLevelResponse]:
        return await movement_svc(db, request).list_levels_for_location(location_id)

    @router.get(
        "/by-product/{product_id}", response_model=List[StockMoveResponse], dependencies=[Depends(_r)]
    )
    async def moves_by_product(product_id: str, request: Request) -> List[StockMoveResponse]:
        return await movement_svc(db, request).list_moves_for_product(product_id)

    @router.get(
        "/valuation-layers/by-product/{product_id}", response_model=List[ValuationLayerResponse],
        dependencies=[Depends(_r)],
    )
    async def valuation_layers_by_product(product_id: str, request: Request) -> List[ValuationLayerResponse]:
        return await movement_svc(db, request).list_valuation_layers_for_product(product_id)

    @router.get("/batches/expiring", response_model=List[BatchResponse], dependencies=[Depends(_r)])
    async def batches_expiring(request: Request, within_days: Optional[int] = None) -> List[BatchResponse]:
        return await movement_svc(db, request).list_expiring_batches(within_days)

    @router.get(
        "/controlled-substance-register/by-product/{product_id}",
        response_model=List[ControlledSubstanceRegisterResponse], dependencies=[Depends(_r)],
    )
    async def controlled_substance_register_by_product(
        product_id: str, request: Request
    ) -> List[ControlledSubstanceRegisterResponse]:
        return await movement_svc(db, request).list_controlled_substance_register(product_id)

    return router
