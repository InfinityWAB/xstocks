"""
FastAPI dependencies for the xstock plugin.

Same pattern as xcompany/tasks: db (and here, call_plugin/events_bus/storage)
are captured by closure in build_*_router(db, ...), handlers create the
service via svc_factory(db, request, ...). These are passed explicitly by
main.py when building the router tree — NOT pulled from request.app.state,
which the xcore kernel never populates for arbitrary plugin-defined keys
(collect_app_state() is for ASGI middleware state, a different mechanism).
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Depends, HTTPException, Request, status
from xcore.kernel.api import AuthPayload, get_current_user

from ..services.attachment import AttachmentService
from ..services.intelligence import IntelligenceService
from ..services.inventory import InventoryService
from ..services.movement import StockMovementService
from ..services.product import ProductService, StockLocationService, WarehouseService
from ..services.settings import StockSettingsService
from ..services.stock_transfer import StockTransferService
from ..services.transfer import TransferSuggestionService

# ── Tenant resolution ────────────────────────────────────────


def _extract_tenant_id(request: Request) -> str | None:
    """
    Ne fait confiance qu'à `request.state.user`, posé par `XAuthBackend` après
    vérification de signature (RS256). Header `X-Tenant-Id` brut et décodage
    JWT sans vérification (`get_unverified_claims`) retirés : les deux
    permettaient à un appelant non authentifié de se faire passer pour
    n'importe quel tenant et d'accéder aux données de stock d'un tiers (audit
    xstock Constat 3, même pattern que XLicense Constat 2). Dans le câblage
    actuel chaque route est déjà gardée par une dépendance RBAC qui peuple
    request.state.user avant que ce helper ne s'exécute — mais ce n'est une
    garantie que du câblage des routes, pas du helper lui-même ; d'où le
    retrait plutôt qu'une confiance conditionnelle.
    """
    if hasattr(request.state, "user") and request.state.user:
        user = request.state.user
        tid = user.get("tenant_id") or user.get("user", {}).get("tenant_id")
        if tid:
            return tid
    return None


def require_tenant(request: Request) -> str:
    tid = _extract_tenant_id(request)
    if not tid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="tenant_id not found in request"
        )
    return tid


def actor_dep(current_user: AuthPayload = Depends(get_current_user)) -> str:
    uid = current_user.get("sub") or ""
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_id missing from token")
    return uid


# ── Service factories ────────────────────────────────────────
# call_plugin/events_bus/storage are optional: routes work (minus
# alert-dispatch / file-storage features) even if a router is built without
# them, e.g. in isolated tests.


def product_svc(db, request: Request) -> ProductService:
    return ProductService(db, require_tenant(request))


def warehouse_svc(db, request: Request) -> WarehouseService:
    return WarehouseService(db, require_tenant(request))


def stock_location_svc(db, request: Request) -> StockLocationService:
    return StockLocationService(db, require_tenant(request))


def movement_svc(db, request: Request, call_plugin: Optional[Any] = None) -> StockMovementService:
    return StockMovementService(db, require_tenant(request), call_plugin=call_plugin)


def inventory_svc(
    db, request: Request, call_plugin: Optional[Any] = None, events_bus: Optional[Any] = None
) -> InventoryService:
    return InventoryService(db, require_tenant(request), call_plugin=call_plugin, events_bus=events_bus)


def intelligence_svc(db, request: Request) -> IntelligenceService:
    return IntelligenceService(db, require_tenant(request))


def attachment_svc(db, request: Request, storage: Optional[Any] = None) -> AttachmentService:
    return AttachmentService(db, require_tenant(request), storage)


def settings_svc(db, request: Request) -> StockSettingsService:
    return StockSettingsService(db, require_tenant(request))


def transfer_suggestion_svc(db, request: Request) -> TransferSuggestionService:
    return TransferSuggestionService(db, require_tenant(request))


def stock_transfer_svc(db, request: Request) -> StockTransferService:
    return StockTransferService(db, require_tenant(request))
