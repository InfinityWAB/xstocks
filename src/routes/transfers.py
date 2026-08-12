from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from xcore.sdk import require_permission

from ..schemas.transfer_doc import (
    ExecuteStockTransferRequest,
    StockTransferCreate,
    StockTransferLineResponse,
    StockTransferResponse,
)
from ..services.exceptions import (
    InsufficientStockError,
    InvalidStockTransferTransitionError,
    ProductNotFoundError,
    StockTransferNotFoundError,
)
from .deps import actor_dep, stock_transfer_svc

_r = require_permission("xstock:transfers:read")
_w = require_permission("xstock:transfers:write")

_404 = HTTPException(status.HTTP_404_NOT_FOUND, detail="Stock transfer not found")


def build_transfers_router(db) -> APIRouter:
    router = APIRouter(tags=["xstock-transfers"])

    @router.post(
        "/", response_model=StockTransferResponse, status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_w)],
    )
    async def create_transfer(
        request: Request, body: StockTransferCreate, actor: str = Depends(actor_dep)
    ) -> StockTransferResponse:
        return await stock_transfer_svc(db, request).create_transfer(body, created_by=actor)

    @router.get("/", response_model=List[StockTransferResponse], dependencies=[Depends(_r)])
    async def list_transfers(
        request: Request, limit: int = 50, offset: int = 0
    ) -> List[StockTransferResponse]:
        return await stock_transfer_svc(db, request).list_transfers(limit=limit, offset=offset)

    @router.get("/{transfer_id}", response_model=StockTransferResponse, dependencies=[Depends(_r)])
    async def get_transfer(transfer_id: str, request: Request) -> StockTransferResponse:
        try:
            return await stock_transfer_svc(db, request).get_transfer(transfer_id)
        except StockTransferNotFoundError:
            raise _404

    @router.get(
        "/{transfer_id}/lines", response_model=List[StockTransferLineResponse], dependencies=[Depends(_r)]
    )
    async def list_lines(transfer_id: str, request: Request) -> List[StockTransferLineResponse]:
        return await stock_transfer_svc(db, request).list_lines(transfer_id)

    @router.post(
        "/{transfer_id}/ready", response_model=StockTransferResponse, dependencies=[Depends(_w)]
    )
    async def mark_ready(transfer_id: str, request: Request) -> StockTransferResponse:
        try:
            return await stock_transfer_svc(db, request).mark_ready(transfer_id)
        except StockTransferNotFoundError:
            raise _404
        except InvalidStockTransferTransitionError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))
        except InsufficientStockError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.post(
        "/{transfer_id}/execute", response_model=StockTransferResponse, dependencies=[Depends(_w)]
    )
    async def execute_transfer(
        transfer_id: str,
        request: Request,
        body: ExecuteStockTransferRequest = ExecuteStockTransferRequest(),
        actor: str = Depends(actor_dep),
    ) -> StockTransferResponse:
        try:
            return await stock_transfer_svc(db, request).execute(transfer_id, body, created_by=actor)
        except StockTransferNotFoundError:
            raise _404
        except InvalidStockTransferTransitionError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))
        except ProductNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
        except InsufficientStockError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.post(
        "/{transfer_id}/cancel", response_model=StockTransferResponse, dependencies=[Depends(_w)]
    )
    async def cancel_transfer(transfer_id: str, request: Request) -> StockTransferResponse:
        try:
            return await stock_transfer_svc(db, request).cancel(transfer_id)
        except StockTransferNotFoundError:
            raise _404
        except InvalidStockTransferTransitionError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    return router
