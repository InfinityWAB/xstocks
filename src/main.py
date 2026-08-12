"""
Plugin xcore — gestion de stock multi-entrepôts (xstock).

Cycle de vie :
  on_load  → DB, tables, router, déclaration RBAC, tâches planifiées
  on_unload → log (ext.storage/scheduler/db sont des services partagés,
              leur cycle de vie est géré par le kernel, pas par ce plugin)

Routes montées (préfixe /app/xstock/ appliqué par le kernel) :
  /products, /warehouses, /movements, /inventory, /intelligence,
  /attachments, /settings, /transfers

IPC : voir src/ipc.py (xstock.product.*, xstock.stock.*, xstock.reorder_point.*,
xstock.stockout_risk.*) — dispatché automatiquement par IPCCommands.
"""
from __future__ import annotations

from fastapi import APIRouter
from xcore.sdk import TrustedBase, get_logger

from .ipc import IPCCommands
from .models import ModelBase
from .routes import (
    build_attachments_router,
    build_intelligence_router,
    build_inventory_router,
    build_movements_router,
    build_products_router,
    build_settings_router,
    build_transfers_router,
    build_warehouses_router,
)
from .tasks import (
    BatchExpiryTask,
    ClassificationTask,
    StockThresholdTask,
    TransferSuggestionTask,
)

logger = get_logger("xstock.plugin")


class Plugin(IPCCommands, TrustedBase):
    async def on_load(self) -> None:
        self._db = self.get_service("db")

        try:
            self._storage = self.get_service("ext.storage")
        except KeyError:
            self._storage = None
            logger.warning("[xstock] ext.storage indisponible — pièces jointes désactivées")

        # Service WebSocket temps réel (optionnel — canal "xstock" déclaré dans
        # integration.yaml, même convention que xflow/tasks).
        self._ws = self.get_service("ext.websocket")
        if self._ws is None:
            logger.info("[xstock] Service WebSocket absent — diffusion temps réel désactivée.")

        # Bound method / event bus, passés par closure aux routes et tâches
        # (jamais via request.app.state — le kernel ne le peuple pas pour des
        # clés arbitraires, voir routes/deps.py).
        self._call_plugin = self.call_plugin
        self._events_bus = self.ctx.events

        await self._initialize_tables()
        await self._declare_rbac()
        self._router = self._build_router()
        self._register_scheduled_tasks()

        logger.info("[xstock] Plugin chargé")

    async def on_unload(self) -> None:
        logger.info("[xstock] Plugin déchargé")

    # ── Router ──────────────────────────────────────────────────

    def get_router(self) -> APIRouter:
        return self._router

    def _build_router(self) -> APIRouter:
        router = APIRouter()

        router.include_router(build_products_router(self._db), prefix="/products")
        router.include_router(build_warehouses_router(self._db), prefix="/warehouses")
        router.include_router(
            build_movements_router(self._db, self._ws, self._call_plugin), prefix="/movements"
        )
        router.include_router(
            build_inventory_router(self._db, self._call_plugin, self._events_bus, self._ws),
            prefix="/inventory",
        )
        router.include_router(build_intelligence_router(self._db), prefix="/intelligence")
        router.include_router(build_attachments_router(self._db, self._storage), prefix="/attachments")
        router.include_router(build_settings_router(self._db), prefix="/settings")
        router.include_router(build_transfers_router(self._db), prefix="/transfers")

        return router

    # ── DB ──────────────────────────────────────────────────────

    async def _initialize_tables(self) -> None:
        async with self._db.engine.begin() as conn:
            await conn.run_sync(ModelBase.metadata.create_all)
        logger.info("[xstock] Tables initialisées")

    # ── RBAC ────────────────────────────────────────────────────

    async def _declare_rbac(self) -> None:
        rbac = (self.ctx.config or {}).get("rbac") or {}
        grants = rbac.get("grants") or []
        if not grants:
            return
        try:
            await self.ctx.events.emit(
                "rbac.declare", {"plugin": "xstock", "grants": grants}, source="xstock"
            )
            logger.info("[xstock] rbac.declare émis (%d grant(s))", len(grants))
        except Exception as exc:
            logger.warning("[xstock] rbac.declare ignoré : %s", exc)

    # ── Tâches planifiées (spec §3.5) ─────────────────────────────

    def _register_scheduled_tasks(self) -> None:
        try:
            scheduler = self.get_service("scheduler")
        except KeyError:
            scheduler = None
        if not scheduler:
            logger.warning("[xstock] scheduler indisponible — tâches planifiées désactivées")
            return

        tasks = [
            StockThresholdTask(self._db, self._events_bus, self._call_plugin),
            BatchExpiryTask(self._db, self._events_bus, self._call_plugin),
            ClassificationTask(self._db, self._events_bus),
            TransferSuggestionTask(self._db, self._events_bus),
        ]
        for task in tasks:
            task.register(scheduler)
        logger.info("[xstock] %d tâche(s) planifiée(s) enregistrée(s)", len(tasks))
