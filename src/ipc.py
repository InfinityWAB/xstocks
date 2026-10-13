"""
IPC actions exposed by xstock to other plugins.

Same pattern as xform/xlicense: a mixin (`IPCCommands(AutoDispatchMixin)`)
mixed into the Plugin class in main.py, dispatched automatically by name.

Unlike HTTP routes, IPC calls carry no authenticated request context — every
action takes `tenant_id` explicitly in its payload (never inferred from a
JWT/header), matching xlicense's `xlicense.get_tenant_licenses` convention.

Contrôle d'accès : `side_effect` (read|write) n'est PAS déclaré tant que xcore < 2.9 est
déployé (paramètre inconnu de @action avant la 2.9.0) ; à réintroduire avec la montée de
xcore (annuler le commit « reporte side_effect »). Aucune action n'utilise `permissions=` volontairement : ces actions sont appelées en interne
(xpos, xpurchase, xassets, xfleet, xprint) via `call_plugin`, qui ne propage un
principal que si l'appel parent est passé par `supervisor._dispatch`. Les appels
issus de routes FastAPI de plugin ou de tâches de fond arrivent SANS principal
et seraient refusés (fail-closed, ActionPermissionMiddleware). Le contrôle
plugin-à-plugin relève de `allowed_callers` (plugin.yaml, IPCAuthMiddleware).

Covers the two concrete cross-module needs from the spec (§3.4/§7):
  - Achats (future xpurchase): receive stock on PO delivery, read reorder
    points/product catalog to build purchase suggestions.
  - Immobilisations/Flotte (future xassets/xfleet): issue stock for spare
    parts/fuel consumption.
  - Reporting (future): read stock levels / stockout risk without owning
    the data.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from xcore.sdk import AutoDispatchMixin, action, error, ok, schema

from .schemas.product import ProductUpdate
from .services.exceptions import (
    ControlledSubstanceRequiresLotTrackingError,
    InsufficientDemandHistoryError,
    InsufficientStockError,
    InvalidQuantityError,
    InvalidWitnessError,
    ProductNotFoundError,
    WitnessRequiredError,
)
from .services.intelligence import IntelligenceService
from .services.movement import StockMovementService
from .services.product import ProductService, WarehouseService


class IPCCommands(AutoDispatchMixin):
    # ── Product / warehouse catalog ─────────────────────────────

    @action("xstock.product.get")
    @schema(
        version="1.0",
        input={"tenant_id": (str, ...), "product_id": (str, ...)},
        output={"product": dict},
        type_response="model",
        unset=False,
    )
    async def ipc_product_get(self, payload) -> dict:
        try:
            product = await ProductService(self._db, payload.tenant_id).get_product(payload.product_id)
        except ProductNotFoundError as exc:
            return error(str(exc), code="not_found")
        return ok(result={"product": product.model_dump(mode="json")})

    @action("xstock.product.list")
    @schema(
        version="1.0",
        input={
            "tenant_id": (str, ...),
            "active_only": (bool, True),
            "limit": (int, 50),
            "offset": (int, 0),
        },
        output={"products": list},
        type_response="model",
        unset=False,
    )
    async def ipc_product_list(self, payload) -> dict:
        service = ProductService(self._db, payload.tenant_id)
        if payload.active_only:
            products = await service.list_active()
        else:
            products = await service.list_products(limit=payload.limit, offset=payload.offset)
        return ok(result={"products": [p.model_dump(mode="json") for p in products]})

    @action("xstock.product.update")
    @schema(
        version="1.0",
        input={
            "tenant_id": (str, ...),
            "product_id": (str, ...),
            "sale_price": (Optional[float], None),
            "purchase_price": (Optional[float], None),
            "name": (Optional[str], None),
            "category_id": (Optional[str], None),
            "is_active": (Optional[bool], None),
        },
        output={"product": dict},
        type_response="model",
        unset=False,
    )
    async def ipc_product_update(self, payload) -> dict:
        try:
            patch = ProductUpdate(
                sale_price=payload.sale_price,
                purchase_price=payload.purchase_price,
                name=payload.name,
                category_id=payload.category_id,
                is_active=payload.is_active,
            )
            product = await ProductService(self._db, payload.tenant_id).update_product(
                payload.product_id, patch
            )
        except ProductNotFoundError as exc:
            return error(str(exc), code="not_found")
        return ok(result={"product": product.model_dump(mode="json")})

    @action("xstock.warehouse.list")
    @schema(
        version="1.0",
        input={"tenant_id": (str, ...), "limit": (int, 50), "offset": (int, 0)},
        output={"warehouses": list},
        type_response="model",
        unset=False,
    )
    async def ipc_warehouse_list(self, payload) -> dict:
        warehouses = await WarehouseService(self._db, payload.tenant_id).list_warehouses(
            limit=payload.limit, offset=payload.offset
        )
        return ok(result={"warehouses": [w.model_dump(mode="json") for w in warehouses]})

    # ── Stock movements ──────────────────────────────────────────

    @action("xstock.stock.receive")
    @schema(
        version="1.0",
        input={
            "tenant_id": (str, ...),
            "product_id": (str, ...),
            "warehouse_id": (str, ...),
            "quantity": (float, ...),
            "created_by": (str, ...),
            "location_id": (Optional[str], None),
            "batch_number": (Optional[str], None),
            "expiry_date": (Optional[str], None),
            "unit_cost": (Optional[float], None),
            "source_reference": (Optional[str], None),
            "reason": (Optional[str], None),
            "idempotency_key": (Optional[str], None),
        },
        output={"move": dict},
        type_response="model",
        unset=False,
    )
    async def ipc_stock_receive(self, payload) -> dict:
        """Called by xpurchase on PO delivery — spec §2.3 'réception commande → mouvement d'entrée'."""
        try:
            move = await StockMovementService(self._db, payload.tenant_id).receive(
                product_id=payload.product_id,
                warehouse_id=payload.warehouse_id,
                quantity=payload.quantity,
                created_by=payload.created_by,
                location_id=payload.location_id,
                batch_number=payload.batch_number,
                expiry_date=date.fromisoformat(payload.expiry_date) if payload.expiry_date else None,
                unit_cost=payload.unit_cost,
                source_reference=payload.source_reference,
                reason=payload.reason,
                idempotency_key=payload.idempotency_key,
            )
        except ProductNotFoundError as exc:
            return error(str(exc), code="not_found")
        except ValueError as exc:
            return error(str(exc), code="invalid_request")
        return ok(result={"move": move.model_dump(mode="json")})

    @action("xstock.stock.issue")
    @schema(
        version="1.0",
        input={
            "tenant_id": (str, ...),
            "product_id": (str, ...),
            "warehouse_id": (str, ...),
            "quantity": (float, ...),
            "created_by": (str, ...),
            "witness_id": (Optional[str], None),
            "source_reference": (Optional[str], None),
            "reason": (Optional[str], None),
            "idempotency_key": (Optional[str], None),
        },
        output={"moves": list},
        type_response="model",
        unset=False,
    )
    async def ipc_stock_issue(self, payload) -> dict:
        """Called by a future assets/fleet plugin consuming spare parts/fuel from stock."""
        try:
            moves = await StockMovementService(
                self._db, payload.tenant_id, call_plugin=self._call_plugin
            ).issue(
                product_id=payload.product_id,
                warehouse_id=payload.warehouse_id,
                quantity=payload.quantity,
                created_by=payload.created_by,
                witness_id=payload.witness_id,
                source_reference=payload.source_reference,
                reason=payload.reason,
                idempotency_key=payload.idempotency_key,
            )
        except ProductNotFoundError as exc:
            return error(str(exc), code="not_found")
        except WitnessRequiredError as exc:
            return error(str(exc), code="witness_required")
        except InvalidWitnessError as exc:
            return error(str(exc), code="invalid_witness")
        except ControlledSubstanceRequiresLotTrackingError as exc:
            return error(str(exc), code="invalid_product_config")
        except InvalidQuantityError as exc:
            return error(str(exc), code="invalid_quantity")
        except InsufficientStockError as exc:
            return error(str(exc), code="insufficient_stock")
        return ok(result={"moves": [m.model_dump(mode="json") for m in moves]})

    @action("xstock.stock.levels")
    @schema(
        version="1.0",
        input={
            "tenant_id": (str, ...),
            "product_id": (Optional[str], None),
            "warehouse_id": (Optional[str], None),
        },
        output={"levels": list},
        type_response="model",
        unset=False,
    )
    async def ipc_stock_levels(self, payload) -> dict:
        if not payload.product_id and not payload.warehouse_id:
            return error("product_id or warehouse_id is required", code="invalid_request")
        service = StockMovementService(self._db, payload.tenant_id)
        if payload.product_id:
            levels = await service.list_levels_for_product(payload.product_id)
        else:
            levels = await service.list_levels_for_warehouse(payload.warehouse_id)
        return ok(result={"levels": [l.model_dump(mode="json") for l in levels]})

    # ── Intelligence (reporting) ─────────────────────────────────

    @action("xstock.reorder_point.get")
    @schema(
        version="1.0",
        input={
            "tenant_id": (str, ...),
            "product_id": (str, ...),
            "warehouse_id": (str, ...),
            "lead_time_days": (float, ...),
            "service_level": (float, 0.95),
            "history_days": (int, 90),
        },
        output={
            "product_id": str, "warehouse_id": str, "avg_daily_demand": float,
            "demand_std_dev": float, "service_level": float, "lead_time_days": float,
            "safety_stock": float, "reorder_point": float,
        },
        type_response="model",
        unset=False,
    )
    async def ipc_reorder_point_get(self, payload) -> dict:
        try:
            result = await IntelligenceService(self._db, payload.tenant_id).compute_reorder_point(
                payload.product_id, payload.warehouse_id,
                lead_time_days=payload.lead_time_days,
                service_level=payload.service_level,
                history_days=payload.history_days,
            )
        except ProductNotFoundError as exc:
            return error(str(exc), code="not_found")
        except InsufficientDemandHistoryError as exc:
            return error(str(exc), code="insufficient_history")
        return ok(result=result)

    @action("xstock.stockout_risk.list")
    @schema(
        version="1.0",
        input={
            "tenant_id": (str, ...),
            "warehouse_id": (str, ...),
            "lead_time_days_by_product": (dict, {}),
            "default_lead_time_days": (float, 7.0),
            "history_days": (int, 30),
        },
        output={"risks": list},
        type_response="model",
        unset=False,
    )
    async def ipc_stockout_risk_list(self, payload) -> dict:
        risks = await IntelligenceService(self._db, payload.tenant_id).stockout_risks(
            payload.warehouse_id,
            lead_time_days_by_product=payload.lead_time_days_by_product,
            default_lead_time_days=payload.default_lead_time_days,
            history_days=payload.history_days,
        )
        return ok(result={"risks": risks})
