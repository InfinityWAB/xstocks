from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from xcore.sdk import require_permission

from ..schemas.inventory import (
    InventoryCountCreate,
    InventoryCountLineResponse,
    InventoryCountLineUpdate,
    InventoryCountResponse,
    InventoryCountValidateRequest,
)
from ..services.exceptions import (
    AmbiguousBatchAdjustmentError,
    ControlledSubstanceVarianceError,
    InventoryCountLineNotFoundError,
    InventoryCountNotDraftOrInProgressError,
    InventoryCountNotFoundError,
    SelfValidatedOverrideError,
    UncountedLinesError,
    WarehouseNotFoundError,
)
from .deps import actor_dep, inventory_svc

_r = require_permission("xstock:inventory:read")
_w = require_permission("xstock:inventory:write")
_validate = require_permission("xstock:inventory:validate")

_404 = HTTPException(status.HTTP_404_NOT_FOUND, detail="Inventory count not found")


async def _broadcast(ws: Optional[Any], tenant_id: str, event: str, data: dict) -> None:
    """Diffusion best-effort sur le canal 'xstock' — jamais bloquant pour la requête."""
    if ws is None:
        return
    try:
        await ws.broadcast(channel="xstock", event=event, data={"tenant_id": tenant_id, **data})
    except Exception:
        pass


def build_inventory_router(db, call_plugin=None, events_bus=None, ws: Optional[Any] = None) -> APIRouter:
    router = APIRouter(tags=["xstock-inventory"])

    @router.post(
        "/", response_model=InventoryCountResponse, status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_w)],
    )
    async def start_count(request: Request, body: InventoryCountCreate) -> InventoryCountResponse:
        try:
            return await inventory_svc(db, request, call_plugin, events_bus).start_count(**body.model_dump())
        except WarehouseNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))

    @router.get("/by-warehouse/{warehouse_id}", response_model=List[InventoryCountResponse], dependencies=[Depends(_r)])
    async def list_by_warehouse(warehouse_id: str, request: Request) -> List[InventoryCountResponse]:
        return await inventory_svc(db, request, call_plugin, events_bus).list_by_warehouse(warehouse_id)

    @router.get("/{inventory_count_id}", response_model=InventoryCountResponse, dependencies=[Depends(_r)])
    async def get_count(inventory_count_id: str, request: Request) -> InventoryCountResponse:
        try:
            return await inventory_svc(db, request, call_plugin, events_bus).get_count(inventory_count_id)
        except InventoryCountNotFoundError:
            raise _404

    @router.get(
        "/{inventory_count_id}/lines", response_model=List[InventoryCountLineResponse],
        dependencies=[Depends(_r)],
    )
    async def list_lines(inventory_count_id: str, request: Request) -> List[InventoryCountLineResponse]:
        return await inventory_svc(db, request, call_plugin, events_bus).list_lines(inventory_count_id)

    @router.patch(
        "/{inventory_count_id}/lines/{product_id}", response_model=InventoryCountLineResponse,
        dependencies=[Depends(_w)],
    )
    async def record_count(
        inventory_count_id: str, product_id: str, request: Request, body: InventoryCountLineUpdate,
        actor: str = Depends(actor_dep),
    ) -> InventoryCountLineResponse:
        try:
            return await inventory_svc(db, request, call_plugin, events_bus).record_count(
                inventory_count_id, product_id, body.counted_quantity, counted_by=actor,
            )
        except InventoryCountNotFoundError:
            raise _404
        except InventoryCountLineNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
        except InventoryCountNotDraftOrInProgressError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.post(
        "/{inventory_count_id}/validate", response_model=InventoryCountResponse,
        dependencies=[Depends(_validate)],
    )
    async def validate_count(
        inventory_count_id: str,
        request: Request,
        body: InventoryCountValidateRequest,
        actor: str = Depends(actor_dep),
    ) -> InventoryCountResponse:
        svc = inventory_svc(db, request, call_plugin, events_bus)
        try:
            result = await svc.validate_count(
                inventory_count_id, validated_by=actor, override_reason=body.override_reason
            )
        except InventoryCountNotFoundError:
            raise _404
        except InventoryCountNotDraftOrInProgressError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))
        except UncountedLinesError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        except ControlledSubstanceVarianceError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        except SelfValidatedOverrideError as exc:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=str(exc))
        except AmbiguousBatchAdjustmentError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        await _broadcast(ws, svc.tenant_id, "INVENTORY_VALIDATED", {"inventoryCountId": inventory_count_id})
        return result

    @router.post(
        "/{inventory_count_id}/cancel", response_model=InventoryCountResponse, dependencies=[Depends(_w)]
    )
    async def cancel_count(inventory_count_id: str, request: Request) -> InventoryCountResponse:
        try:
            return await inventory_svc(db, request, call_plugin, events_bus).cancel_count(inventory_count_id)
        except InventoryCountNotFoundError:
            raise _404
        except InventoryCountNotDraftOrInProgressError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    return router
