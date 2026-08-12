"""
StockMovementService — the core stock engine.

Responsibilities:
  - Record StockMove rows (source of truth) and keep StockLevel in sync
    (StockLevel is never written outside this service).
  - Apply FIFO/LIFO/FEFO batch picking (algorithms.picking) on issue.
  - Apply FIFO/LIFO/CMUP cost-layer consumption (algorithms.valuation) on
    issue, and open a new layer on receive — StockMove.unit_cost/total_value
    are best-effort: a receive without a known cost still succeeds, just
    without creating a layer (see _open_layer).
  - Enforce the controlled-substance double-signature + gap-free sequence
    rule on every OUT movement of a controlled substance (spec §3.2-h).
  - Resolve a StockLevel's location_id: an explicit location_id always wins,
    otherwise falls back to the warehouse's default_stock_location_id.
  - Respect StockLevel.reserved_quantity: any decrement (allow_negative=False)
    must leave available_quantity >= reserved_quantity, so stock promised to
    a READY StockTransfer (services/stock_transfer.py) can't be sold twice.

There is deliberately no generic `record_move(StockMoveCreate)` entry point:
IN/OUT/ADJUSTMENT/TRANSFER have different business rules (batch resolution,
picking, witness requirement) that don't collapse cleanly into one call —
each gets its own method instead.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from ..algorithms.controlled_substances import next_sequence_number
from ..algorithms.picking import Allocation, BatchCandidate, select_batches
from ..algorithms.valuation import LayerCandidate, consume_layers, weighted_unit_cost
from ..models.enums import StockMoveType, ValuationMethod
from ..models.movement import Batch, StockMove, ValuationLayer
from ..models.pharma import ControlledSubstanceRegister
from ..repositories.movement import (
    BatchRepository,
    StockLevelRepository,
    StockMoveRepository,
    ValuationLayerRepository,
)
from ..repositories.pharma import ControlledSubstanceRegisterRepository
from ..repositories.product import ProductRepository, WarehouseRepository
from ..schemas.movement import BatchResponse, StockLevelResponse, StockMoveResponse, ValuationLayerResponse
from ..schemas.pharma import ControlledSubstanceRegisterResponse
from .exceptions import (
    ControlledSubstanceRequiresLotTrackingError,
    InsufficientStockError,
    InvalidWitnessError,
    ProductNotFoundError,
    WitnessRequiredError,
)
from .settings import StockSettingsService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService


class StockMovementService:
    def __init__(
        self, db: "DatabaseService", tenant_id: str, call_plugin: Optional[Any] = None,
    ) -> None:
        self._db = db
        self.tenant_id = tenant_id
        self._call_plugin = call_plugin

    async def _validate_witness(self, witness_id: str, created_by: str) -> None:
        """Fait vivre la « double signature » : le témoin doit être une
        personne réelle, différente de l'acteur, membre du tenant courant —
        pas seulement une chaîne non vide (audit xstock Constat 1)."""
        if witness_id == created_by:
            raise InvalidWitnessError(witness_id, "witness_id must differ from created_by")
        if self._call_plugin is None:
            return
        try:
            access = await self._call_plugin(
                "xauth", "xauth.tenant_access",
                {"user_id": witness_id, "tenant_id": self.tenant_id},
            )
        except Exception as exc:
            raise InvalidWitnessError(witness_id, f"xauth.tenant_access failed: {exc}") from exc
        if not (access or {}).get("has_access", False):
            raise InvalidWitnessError(witness_id, "not a member of the current tenant")

    # ── Receive (IN) ─────────────────────────────────────────

    async def receive(
        self,
        *,
        product_id: str,
        warehouse_id: str,
        quantity: float,
        created_by: str,
        location_id: Optional[str] = None,
        batch_number: Optional[str] = None,
        expiry_date: Optional[date] = None,
        unit_cost: Optional[float] = None,
        source_reference: Optional[str] = None,
        reason: Optional[str] = None,
        move_date: Optional[datetime] = None,
    ) -> StockMoveResponse:
        async with self._db.session() as session:
            async with session.begin():
                product = await ProductRepository(session).get(product_id, self.tenant_id)
                if product is None:
                    raise ProductNotFoundError(product_id)

                location_id = await self._resolve_location(session, warehouse_id, location_id)

                batch_id = None
                if product.is_lot_tracked:
                    if not batch_number:
                        raise ValueError("batch_number is required for lot-tracked products")
                    batch_repo = BatchRepository(session)
                    batch = await batch_repo.get_by_number(product_id, batch_number, self.tenant_id)
                    if batch is None:
                        batch = await batch_repo.save(
                            Batch(
                                tenant_id=self.tenant_id,
                                product_id=product_id,
                                batch_number=batch_number,
                                expiry_date=expiry_date,
                                initial_quantity=quantity,
                            )
                        )
                    batch_id = batch.id

                balance_before, balance_after = await self._adjust_level(
                    session, product_id, warehouse_id, location_id, batch_id, quantity
                )

                effective_cost = unit_cost if unit_cost is not None else product.purchase_price
                move = await self._create_move(
                    session,
                    product_id=product_id,
                    batch_id=batch_id,
                    warehouse_id=warehouse_id,
                    move_type=StockMoveType.IN,
                    quantity=quantity,
                    created_by=created_by,
                    destination_location_id=location_id,
                    unit_cost=effective_cost,
                    total_value=effective_cost * quantity if effective_cost is not None else None,
                    balance_before=balance_before,
                    balance_after=balance_after,
                    source_reference=source_reference,
                    reason=reason,
                    move_date=move_date,
                )

                if effective_cost is not None:
                    await self._open_layer(
                        session,
                        product_id=product_id,
                        batch_id=batch_id,
                        warehouse_id=warehouse_id,
                        source_move_id=move.id,
                        unit_cost=effective_cost,
                        quantity=quantity,
                        received_at=move.move_date,
                    )
                warehouse_name = await self._warehouse_name(session, warehouse_id)
            return self._move_response(move, product.name, warehouse_name)

    # ── Issue (OUT) ──────────────────────────────────────────

    async def issue(
        self,
        *,
        product_id: str,
        warehouse_id: str,
        quantity: float,
        created_by: str,
        location_id: Optional[str] = None,
        witness_id: Optional[str] = None,
        source_reference: Optional[str] = None,
        reason: Optional[str] = None,
        move_date: Optional[datetime] = None,
    ) -> list[StockMoveResponse]:
        async with self._db.session() as session:
            async with session.begin():
                product = await ProductRepository(session).get(product_id, self.tenant_id)
                if product is None:
                    raise ProductNotFoundError(product_id)
                if product.is_controlled_substance and not witness_id:
                    raise WitnessRequiredError(product_id)
                if product.is_controlled_substance and witness_id:
                    # Vérifié hors transaction-critique n'est pas possible ici
                    # (il faut product.is_controlled_substance, déjà lu) — l'appel
                    # IPC reste bref (un aller-retour) et xauth.tenant_access
                    # ne fait qu'une lecture.
                    await self._validate_witness(witness_id, created_by)

                location_id = await self._resolve_location(session, warehouse_id, location_id)

                moves: list[StockMove] = []

                if not product.is_lot_tracked:
                    if product.is_controlled_substance:
                        raise ControlledSubstanceRequiresLotTrackingError(product_id)

                    balance_before, balance_after = await self._adjust_level(
                        session, product_id, warehouse_id, location_id, None, -quantity, allow_negative=False
                    )
                    unit_cost, total_value = await self._consume_cost(
                        session,
                        product_id=product_id,
                        batch_id=None,
                        warehouse_id=warehouse_id,
                        quantity=quantity,
                        method=product.valuation_method,
                    )
                    move = await self._create_move(
                        session,
                        product_id=product_id,
                        batch_id=None,
                        warehouse_id=warehouse_id,
                        move_type=StockMoveType.OUT,
                        quantity=quantity,
                        created_by=created_by,
                        source_location_id=location_id,
                        unit_cost=unit_cost,
                        total_value=total_value,
                        balance_before=balance_before,
                        balance_after=balance_after,
                        source_reference=source_reference,
                        reason=reason,
                        move_date=move_date,
                    )
                    moves.append(move)
                else:
                    allocations = await self._pick_batches(session, product, warehouse_id, quantity)
                    for allocation in allocations:
                        balance_before, balance_after = await self._adjust_level(
                            session, product_id, warehouse_id, location_id, allocation.batch_id,
                            -allocation.quantity, allow_negative=False,
                        )
                        unit_cost, total_value = await self._consume_cost(
                            session,
                            product_id=product_id,
                            batch_id=allocation.batch_id,
                            warehouse_id=warehouse_id,
                            quantity=allocation.quantity,
                            method=product.valuation_method,
                        )
                        move = await self._create_move(
                            session,
                            product_id=product_id,
                            batch_id=allocation.batch_id,
                            warehouse_id=warehouse_id,
                            move_type=StockMoveType.OUT,
                            quantity=allocation.quantity,
                            created_by=created_by,
                            source_location_id=location_id,
                            unit_cost=unit_cost,
                            total_value=total_value,
                            balance_before=balance_before,
                            balance_after=balance_after,
                            source_reference=source_reference,
                            reason=reason,
                            move_date=move_date,
                        )
                        moves.append(move)
                        if product.is_controlled_substance:
                            await self._register_controlled_substance(
                                session,
                                product_id=product_id,
                                batch_id=allocation.batch_id,
                                move_id=move.id,
                                signatory_id=created_by,
                                witness_id=witness_id,
                            )

                warehouse_name = await self._warehouse_name(session, warehouse_id)
            return [self._move_response(m, product.name, warehouse_name) for m in moves]

    # ── Adjustment ───────────────────────────────────────────

    async def adjust(
        self,
        *,
        product_id: str,
        warehouse_id: str,
        delta: float,
        created_by: str,
        reason: str,
        batch_id: Optional[str] = None,
        location_id: Optional[str] = None,
        move_date: Optional[datetime] = None,
    ) -> StockMoveResponse:
        if delta == 0:
            raise ValueError("delta must be non-zero")
        if not reason:
            raise ValueError("reason is required for adjustment moves")

        async with self._db.session() as session:
            async with session.begin():
                product = await ProductRepository(session).get(product_id, self.tenant_id)
                if product is None:
                    raise ProductNotFoundError(product_id)

                location_id = await self._resolve_location(session, warehouse_id, location_id)

                balance_before, balance_after = await self._adjust_level(
                    session, product_id, warehouse_id, location_id, batch_id, delta, allow_negative=False
                )
                move = await self._create_move(
                    session,
                    product_id=product_id,
                    batch_id=batch_id,
                    warehouse_id=warehouse_id,
                    move_type=StockMoveType.ADJUSTMENT,
                    quantity=abs(delta),
                    created_by=created_by,
                    balance_before=balance_before,
                    balance_after=balance_after,
                    reason=reason,
                    move_date=move_date,
                )
                warehouse_name = await self._warehouse_name(session, warehouse_id)
            return self._move_response(move, product.name, warehouse_name)

    # ── Transfer ─────────────────────────────────────────────

    async def transfer(
        self,
        *,
        product_id: str,
        source_warehouse_id: str,
        destination_warehouse_id: str,
        quantity: float,
        created_by: str,
        source_location_id: Optional[str] = None,
        destination_location_id: Optional[str] = None,
        batch_id: Optional[str] = None,
        reason: Optional[str] = None,
        source_reference: Optional[str] = None,
        move_date: Optional[datetime] = None,
    ) -> tuple[StockMoveResponse, StockMoveResponse]:
        if source_warehouse_id == destination_warehouse_id:
            raise ValueError("source and destination warehouses must differ")

        ref = source_reference or f"transfer:{uuid4().hex}"

        async with self._db.session() as session:
            async with session.begin():
                product = await ProductRepository(session).get(product_id, self.tenant_id)
                if product is None:
                    raise ProductNotFoundError(product_id)

                source_location_id = await self._resolve_location(
                    session, source_warehouse_id, source_location_id
                )
                destination_location_id = await self._resolve_location(
                    session, destination_warehouse_id, destination_location_id
                )

                out_before, out_after = await self._adjust_level(
                    session, product_id, source_warehouse_id, source_location_id, batch_id, -quantity,
                    allow_negative=False,
                )
                unit_cost, total_value = await self._consume_cost(
                    session,
                    product_id=product_id,
                    batch_id=batch_id,
                    warehouse_id=source_warehouse_id,
                    quantity=quantity,
                    method=product.valuation_method,
                )
                out_move = await self._create_move(
                    session,
                    product_id=product_id,
                    batch_id=batch_id,
                    warehouse_id=source_warehouse_id,
                    move_type=StockMoveType.TRANSFER,
                    quantity=quantity,
                    created_by=created_by,
                    source_location_id=source_location_id,
                    unit_cost=unit_cost,
                    total_value=total_value,
                    balance_before=out_before,
                    balance_after=out_after,
                    source_reference=ref,
                    reason=reason,
                    move_date=move_date,
                )

                in_before, in_after = await self._adjust_level(
                    session, product_id, destination_warehouse_id, destination_location_id, batch_id, quantity
                )
                in_move = await self._create_move(
                    session,
                    product_id=product_id,
                    batch_id=batch_id,
                    warehouse_id=destination_warehouse_id,
                    move_type=StockMoveType.TRANSFER,
                    quantity=quantity,
                    created_by=created_by,
                    destination_location_id=destination_location_id,
                    unit_cost=unit_cost,
                    total_value=total_value,
                    balance_before=in_before,
                    balance_after=in_after,
                    source_reference=ref,
                    reason=reason,
                    move_date=move_date,
                )
                if unit_cost is not None:
                    await self._open_layer(
                        session,
                        product_id=product_id,
                        batch_id=batch_id,
                        warehouse_id=destination_warehouse_id,
                        source_move_id=in_move.id,
                        unit_cost=unit_cost,
                        quantity=quantity,
                        received_at=in_move.move_date,
                    )
                source_warehouse_name = await self._warehouse_name(session, source_warehouse_id)
                destination_warehouse_name = await self._warehouse_name(session, destination_warehouse_id)
            return (
                self._move_response(out_move, product.name, source_warehouse_name),
                self._move_response(in_move, product.name, destination_warehouse_name),
            )

    # ── Read ─────────────────────────────────────────────────

    async def list_levels_for_product(self, product_id: str) -> list[StockLevelResponse]:
        async with self._db.session() as session:
            levels = await StockLevelRepository(session).list_by_product(product_id, self.tenant_id)
            return await self._level_responses(session, levels)

    async def list_levels_for_warehouse(self, warehouse_id: str) -> list[StockLevelResponse]:
        async with self._db.session() as session:
            levels = await StockLevelRepository(session).list_by_warehouse(warehouse_id, self.tenant_id)
            return await self._level_responses(session, levels)

    async def list_levels_for_location(self, location_id: str) -> list[StockLevelResponse]:
        async with self._db.session() as session:
            levels = await StockLevelRepository(session).list_by_location(location_id, self.tenant_id)
            return await self._level_responses(session, levels)

    async def list_moves_for_product(
        self, product_id: str, *, since: Optional[datetime] = None, until: Optional[datetime] = None
    ) -> list[StockMoveResponse]:
        async with self._db.session() as session:
            moves = await StockMoveRepository(session).list_by_product(
                product_id, self.tenant_id, since=since, until=until
            )
            return await self._move_responses(session, moves)

    async def list_all_moves(self, *, limit: int = 100, offset: int = 0) -> list[StockMoveResponse]:
        async with self._db.session() as session:
            moves = await StockMoveRepository(session).list_all(self.tenant_id, limit=limit, offset=offset)
            return await self._move_responses(session, moves)

    async def list_all_levels(self) -> list[StockLevelResponse]:
        async with self._db.session() as session:
            levels = await StockLevelRepository(session).list_all(self.tenant_id)
            return await self._level_responses(session, levels)

    async def list_valuation_layers_for_product(self, product_id: str) -> list[ValuationLayerResponse]:
        async with self._db.session() as session:
            layers = await ValuationLayerRepository(session).list_by_product(product_id, self.tenant_id)
            return [ValuationLayerResponse.model_validate(l) for l in layers]

    async def list_expiring_batches(self, within_days: Optional[int] = None) -> list[BatchResponse]:
        """Lots expirant dans `within_days` jours (défaut : StockSettings.expiry_warning_days,
        même fallback que BatchExpiryTask — spec §3.5)."""
        if within_days is None:
            settings = await StockSettingsService(self._db, self.tenant_id).get_settings()
            within_days = settings.expiry_warning_days
        cutoff = date.today() + timedelta(days=within_days)
        async with self._db.session() as session:
            batches = await BatchRepository(session).list_expiring_before(cutoff, self.tenant_id)
            return [BatchResponse.model_validate(b) for b in batches]

    async def list_controlled_substance_register(self, product_id: str) -> list[ControlledSubstanceRegisterResponse]:
        async with self._db.session() as session:
            rows = await ControlledSubstanceRegisterRepository(session).list_by_product(product_id, self.tenant_id)
            return [ControlledSubstanceRegisterResponse.model_validate(r) for r in rows]

    # ── Response enrichment ────────────────────────────────────
    # product_name/warehouse_name are convenience fields so callers (the
    # frontend) don't have to fetch the whole product/warehouse catalog and
    # join client-side just to display a move/level row.

    async def _warehouse_name(self, session: "AsyncSession", warehouse_id: str) -> Optional[str]:
        return await WarehouseRepository(session).get_name(warehouse_id, self.tenant_id)

    async def _name_maps(
        self, session: "AsyncSession", *, product_ids: set[str], warehouse_ids: set[str]
    ) -> tuple[dict[str, str], dict[str, str]]:
        products = await ProductRepository(session).list_by_ids(list(product_ids), self.tenant_id)
        warehouses = await WarehouseRepository(session).list_by_ids(list(warehouse_ids), self.tenant_id)
        return {p.id: p.name for p in products}, {w.id: w.name for w in warehouses}

    def _move_response(
        self, move: StockMove, product_name: Optional[str], warehouse_name: Optional[str]
    ) -> StockMoveResponse:
        resp = StockMoveResponse.model_validate(move)
        resp.product_name = product_name
        resp.warehouse_name = warehouse_name
        return resp

    async def _move_responses(
        self, session: "AsyncSession", moves: list[StockMove]
    ) -> list[StockMoveResponse]:
        product_names, warehouse_names = await self._name_maps(
            session,
            product_ids={m.product_id for m in moves},
            warehouse_ids={m.warehouse_id for m in moves},
        )
        return [
            self._move_response(m, product_names.get(m.product_id), warehouse_names.get(m.warehouse_id))
            for m in moves
        ]

    async def _level_responses(self, session: "AsyncSession", levels: list) -> list[StockLevelResponse]:
        product_names, warehouse_names = await self._name_maps(
            session,
            product_ids={l.product_id for l in levels},
            warehouse_ids={l.warehouse_id for l in levels},
        )
        responses = []
        for level in levels:
            resp = StockLevelResponse.model_validate(level)
            resp.product_name = product_names.get(level.product_id)
            resp.warehouse_name = warehouse_names.get(level.warehouse_id)
            responses.append(resp)
        return responses

    # ── Internals ────────────────────────────────────────────

    async def _resolve_location(
        self, session: "AsyncSession", warehouse_id: str, location_id: Optional[str]
    ) -> Optional[str]:
        """An explicit location_id always wins; otherwise fall back to the
        warehouse's default_stock_location_id (None for legacy warehouses
        created before this existed — StockLevel.location_id stays nullable)."""
        if location_id is not None:
            return location_id
        warehouse = await WarehouseRepository(session).get(warehouse_id, self.tenant_id)
        return warehouse.default_stock_location_id if warehouse else None

    async def _pick_batches(
        self, session: "AsyncSession", product, warehouse_id: str, quantity: float
    ) -> list[Allocation]:
        level_repo = StockLevelRepository(session)
        batch_repo = BatchRepository(session)

        level_rows = await level_repo.list_batches_in_warehouse(product.id, warehouse_id, self.tenant_id)
        candidates: list[BatchCandidate] = []
        for level in level_rows:
            batch = await batch_repo.get(level.batch_id, self.tenant_id)
            if batch is None:
                continue
            candidates.append(
                BatchCandidate(
                    batch_id=batch.id,
                    available_quantity=level.available_quantity,
                    received_at=batch.created_at,
                    expiry_date=batch.expiry_date,
                )
            )

        available = sum(c.available_quantity for c in candidates)
        try:
            return select_batches(candidates, quantity, product.valuation_method)
        except ValueError as exc:
            raise InsufficientStockError(product.id, requested=quantity, available=available) from exc

    async def _consume_cost(
        self,
        session: "AsyncSession",
        *,
        product_id: str,
        batch_id: Optional[str],
        warehouse_id: str,
        quantity: float,
        method: ValuationMethod,
    ) -> tuple[Optional[float], Optional[float]]:
        """Consume open ValuationLayer rows for this OUT quantity. Best-effort:
        if no layers cover the quantity (e.g. stock predates cost tracking, or
        receives never carried a cost), the move simply gets no cost — it
        never blocks the movement itself."""
        layer_repo = ValuationLayerRepository(session)
        layers = await layer_repo.list_open(product_id, warehouse_id, self.tenant_id, batch_id)
        if not layers:
            return None, None

        candidates = [
            LayerCandidate(l.id, l.quantity_remaining, l.unit_cost, l.received_at) for l in layers
        ]
        try:
            consumptions = consume_layers(candidates, quantity, method)
        except ValueError:
            return None, None

        by_id = {l.id: l for l in layers}
        for consumption in consumptions:
            layer = by_id[consumption.layer_id]
            await layer_repo.update(
                layer, quantity_remaining=layer.quantity_remaining - consumption.quantity
            )

        unit_cost = weighted_unit_cost(consumptions)
        return unit_cost, unit_cost * quantity

    async def _open_layer(
        self,
        session: "AsyncSession",
        *,
        product_id: str,
        batch_id: Optional[str],
        warehouse_id: str,
        source_move_id: str,
        unit_cost: float,
        quantity: float,
        received_at: datetime,
    ) -> ValuationLayer:
        layer = ValuationLayer(
            tenant_id=self.tenant_id,
            product_id=product_id,
            batch_id=batch_id,
            warehouse_id=warehouse_id,
            source_move_id=source_move_id,
            unit_cost=unit_cost,
            quantity_remaining=quantity,
            received_at=received_at,
        )
        return await ValuationLayerRepository(session).save(layer)

    async def _create_move(
        self,
        session: "AsyncSession",
        *,
        product_id: str,
        batch_id: Optional[str],
        warehouse_id: str,
        move_type: str,
        quantity: float,
        created_by: str,
        balance_before: float,
        balance_after: float,
        source_location_id: Optional[str] = None,
        destination_location_id: Optional[str] = None,
        unit_cost: Optional[float] = None,
        total_value: Optional[float] = None,
        source_reference: Optional[str] = None,
        reason: Optional[str] = None,
        move_date: Optional[datetime] = None,
    ) -> StockMove:
        move = StockMove(
            tenant_id=self.tenant_id,
            product_id=product_id,
            batch_id=batch_id,
            warehouse_id=warehouse_id,
            type=move_type,
            quantity=quantity,
            source_location_id=source_location_id,
            destination_location_id=destination_location_id,
            unit_cost=unit_cost,
            total_value=total_value,
            balance_before=balance_before,
            balance_after=balance_after,
            source_reference=source_reference,
            reason=reason,
            created_by=created_by,
            move_date=move_date or datetime.now(timezone.utc),
        )
        return await StockMoveRepository(session).save(move)

    async def _adjust_level(
        self,
        session: "AsyncSession",
        product_id: str,
        warehouse_id: str,
        location_id: Optional[str],
        batch_id: Optional[str],
        delta: float,
        *,
        allow_negative: bool = True,
    ) -> tuple[float, float]:
        level_repo = StockLevelRepository(session)
        level = await level_repo.get_or_create(
            product_id, warehouse_id, self.tenant_id, batch_id, location_id, for_update=True,
        )
        balance_before = level.available_quantity
        new_quantity = balance_before + delta
        # Generalizes the old "never go negative" guard: with no reservation
        # (reserved_quantity == 0, the common case) this is identical to
        # `new_quantity < 0`. With a reservation in place, it also blocks
        # spending stock already promised to a READY StockTransfer.
        if not allow_negative and new_quantity < level.reserved_quantity:
            raise InsufficientStockError(product_id, requested=-delta, available=balance_before)
        await level_repo.update(level, available_quantity=new_quantity)
        return balance_before, new_quantity

    async def _register_controlled_substance(
        self,
        session: "AsyncSession",
        *,
        product_id: str,
        batch_id: str,
        move_id: str,
        signatory_id: str,
        witness_id: str,
    ) -> ControlledSubstanceRegister:
        csr_repo = ControlledSubstanceRegisterRepository(session)
        last = await csr_repo.get_last_sequence_for_update(product_id, self.tenant_id)
        sequence_number = next_sequence_number(last.sequence_number if last else None)

        level_repo = StockLevelRepository(session)
        levels = await level_repo.list_by_product(product_id, self.tenant_id)
        balance = sum(lv.available_quantity for lv in levels if lv.batch_id == batch_id)

        register = ControlledSubstanceRegister(
            tenant_id=self.tenant_id,
            product_id=product_id,
            batch_id=batch_id,
            move_id=move_id,
            sequence_number=sequence_number,
            signatory_id=signatory_id,
            witness_id=witness_id,
            theoretical_balance_after=balance,
        )
        return await csr_repo.save(register)
