"""
StockTransferService — planable transfer document (DRAFT -> READY -> DONE /
CANCELLED), distinct from StockMovementService's already-final StockMove.

Only OUT and TRANSFER transfers reserve stock (mark_ready increments
StockLevel.reserved_quantity at the source) — an IN transfer has no source
stock to promise, so it skips straight past the reservation step. execute()
delegates the actual stock write to StockMovementService (receive/issue/
transfer, each in their own atomic transaction, same pattern already used by
TransferSuggestionService.execute()), then releases the reservation and
marks the document DONE in a final transaction.

Named differently from services/transfer.py (TransferSuggestionService, an
algorithmic inter-site rebalancing workflow) to avoid confusing the two.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from ..models.enums import StockMoveType, StockTransferStatus
from ..models.transfer_doc import StockTransfer, StockTransferLine
from ..repositories.movement import BatchRepository, StockLevelRepository
from ..repositories.product import ProductRepository, WarehouseRepository
from ..repositories.transfer_doc import StockTransferLineRepository, StockTransferRepository
from ..schemas.transfer_doc import (
    ExecuteStockTransferRequest,
    StockTransferCreate,
    StockTransferLineResponse,
    StockTransferResponse,
)
from .exceptions import InsufficientStockError, InvalidStockTransferTransitionError, StockTransferNotFoundError
from .movement import StockMovementService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService

_ALLOWED_TRANSITIONS = {
    StockTransferStatus.DRAFT: {StockTransferStatus.READY, StockTransferStatus.CANCELLED},
    StockTransferStatus.READY: {StockTransferStatus.DONE, StockTransferStatus.CANCELLED},
}

# Transfer types that hold reserved stock at a source while READY.
_RESERVING_TYPES = {StockMoveType.OUT, StockMoveType.TRANSFER}


class StockTransferService:
    def __init__(self, db: "DatabaseService", tenant_id: str) -> None:
        self._db = db
        self.tenant_id = tenant_id
        self._movement = StockMovementService(db, tenant_id)

    # ── Response enrichment ────────────────────────────────────

    async def _warehouse_name(self, session: "AsyncSession", warehouse_id: Optional[str]) -> Optional[str]:
        return await WarehouseRepository(session).get_name(warehouse_id, self.tenant_id)

    async def _transfer_response(
        self, session: "AsyncSession", transfer: StockTransfer
    ) -> StockTransferResponse:
        resp = StockTransferResponse.model_validate(transfer)
        resp.source_warehouse_name = await self._warehouse_name(session, transfer.source_warehouse_id)
        resp.destination_warehouse_name = await self._warehouse_name(
            session, transfer.destination_warehouse_id
        )
        return resp

    async def _line_responses(
        self, session: "AsyncSession", lines: list[StockTransferLine]
    ) -> list[StockTransferLineResponse]:
        product_ids = list({l.product_id for l in lines})
        products = await ProductRepository(session).list_by_ids(product_ids, self.tenant_id)
        names = {p.id: p.name for p in products}
        responses = []
        for line in lines:
            resp = StockTransferLineResponse.model_validate(line)
            resp.product_name = names.get(line.product_id)
            responses.append(resp)
        return responses

    # ── Create / Read ────────────────────────────────────────

    async def create_transfer(
        self, data: StockTransferCreate, *, created_by: str
    ) -> StockTransferResponse:
        async with self._db.session() as session:
            async with session.begin():
                transfer = await StockTransferRepository(session).save(
                    StockTransfer(
                        tenant_id=self.tenant_id,
                        type=data.type,
                        status=StockTransferStatus.DRAFT,
                        source_warehouse_id=data.source_warehouse_id,
                        destination_warehouse_id=data.destination_warehouse_id,
                        source_location_id=data.source_location_id,
                        destination_location_id=data.destination_location_id,
                        scheduled_date=data.scheduled_date,
                        source_reference=data.source_reference,
                        created_by=created_by,
                    )
                )
                line_repo = StockTransferLineRepository(session)
                for line in data.lines:
                    await line_repo.save(
                        StockTransferLine(
                            tenant_id=self.tenant_id,
                            transfer_id=transfer.id,
                            product_id=line.product_id,
                            batch_id=line.batch_id,
                            requested_quantity=line.requested_quantity,
                        )
                    )
            return await self._transfer_response(session, transfer)

    async def get_transfer(self, transfer_id: str) -> StockTransferResponse:
        async with self._db.session() as session:
            transfer = await StockTransferRepository(session).get(transfer_id, self.tenant_id)
            if transfer is None:
                raise StockTransferNotFoundError(transfer_id)
            return await self._transfer_response(session, transfer)

    async def list_transfers(self, *, limit: int = 50, offset: int = 0) -> list[StockTransferResponse]:
        async with self._db.session() as session:
            transfers = await StockTransferRepository(session).list(self.tenant_id, limit=limit, offset=offset)
            return [await self._transfer_response(session, t) for t in transfers]

    async def list_lines(self, transfer_id: str) -> list[StockTransferLineResponse]:
        async with self._db.session() as session:
            lines = await StockTransferLineRepository(session).list_by_transfer(transfer_id, self.tenant_id)
            return await self._line_responses(session, lines)

    # ── Workflow ─────────────────────────────────────────────

    async def mark_ready(self, transfer_id: str) -> StockTransferResponse:
        async with self._db.session() as session:
            async with session.begin():
                transfer = await self._get_for_transition(session, transfer_id, StockTransferStatus.READY)

                if transfer.type in _RESERVING_TYPES:
                    location_id = await self._resolve_location(
                        session, transfer.source_warehouse_id, transfer.source_location_id
                    )
                    lines = await StockTransferLineRepository(session).list_by_transfer(
                        transfer_id, self.tenant_id
                    )
                    level_repo = StockLevelRepository(session)
                    for line in lines:
                        level = await level_repo.get_or_create(
                            line.product_id, transfer.source_warehouse_id, self.tenant_id,
                            line.batch_id, location_id, for_update=True,
                        )
                        free = level.available_quantity - level.reserved_quantity
                        if free < line.requested_quantity:
                            raise InsufficientStockError(
                                line.product_id, requested=line.requested_quantity, available=free
                            )
                        await level_repo.update(
                            level, reserved_quantity=level.reserved_quantity + line.requested_quantity
                        )

                transfer = await StockTransferRepository(session).update(
                    transfer, status=StockTransferStatus.READY
                )
            return await self._transfer_response(session, transfer)

    async def execute(
        self, transfer_id: str, data: Optional[ExecuteStockTransferRequest] = None, *, created_by: str
    ) -> StockTransferResponse:
        overrides = {o.line_id: o.done_quantity for o in (data.lines if data and data.lines else [])}

        # Snapshot everything into plain values before the session closes —
        # StockMovementService opens its own sessions per call below, so the
        # ORM rows read here must not be touched after this block exits
        # (same reasoning as TransferSuggestionService.execute()).
        #
        # The reservation is released *here*, before any actual movement —
        # not after. _adjust_level's invariant (available >= reserved) would
        # otherwise block the very debit that fulfills the reservation: e.g.
        # available=20/reserved=20, debiting 20 for this transfer leaves 0,
        # which is < the *still-20* reserved_quantity if released afterwards.
        async with self._db.session() as session:
            async with session.begin():
                transfer = await self._get_for_transition(session, transfer_id, StockTransferStatus.DONE)
                transfer_type = transfer.type
                source_warehouse_id = transfer.source_warehouse_id
                destination_warehouse_id = transfer.destination_warehouse_id
                source_location_id = transfer.source_location_id
                destination_location_id = transfer.destination_location_id
                ref = transfer.source_reference or f"stock-transfer:{transfer.id}"

                line_rows = await StockTransferLineRepository(session).list_by_transfer(
                    transfer_id, self.tenant_id
                )
                batch_numbers = await self._resolve_batch_numbers(session, line_rows)
                lines = [
                    {
                        "id": l.id,
                        "product_id": l.product_id,
                        "batch_id": l.batch_id,
                        "requested_quantity": l.requested_quantity,
                    }
                    for l in line_rows
                ]

                if transfer_type in _RESERVING_TYPES:
                    location_id = await self._resolve_location(session, source_warehouse_id, source_location_id)
                    level_repo = StockLevelRepository(session)
                    for line in lines:
                        level = await level_repo.get_for(
                            line["product_id"], source_warehouse_id, self.tenant_id,
                            line["batch_id"], location_id, for_update=True,
                        )
                        if level is not None:
                            await level_repo.update(
                                level,
                                reserved_quantity=max(0.0, level.reserved_quantity - line["requested_quantity"]),
                            )

        done_quantities: dict[str, float] = {}

        for line in lines:
            quantity = overrides.get(line["id"], line["requested_quantity"])
            if transfer_type == StockMoveType.IN:
                batch_number, expiry_date = batch_numbers.get(line["batch_id"], (None, None))
                await self._movement.receive(
                    product_id=line["product_id"],
                    warehouse_id=destination_warehouse_id,
                    location_id=destination_location_id,
                    quantity=quantity,
                    created_by=created_by,
                    batch_number=batch_number,
                    expiry_date=expiry_date,
                    source_reference=ref,
                )
            elif transfer_type == StockMoveType.OUT:
                await self._movement.issue(
                    product_id=line["product_id"],
                    warehouse_id=source_warehouse_id,
                    location_id=source_location_id,
                    quantity=quantity,
                    created_by=created_by,
                    source_reference=ref,
                )
            else:  # TRANSFER
                await self._movement.transfer(
                    product_id=line["product_id"],
                    source_warehouse_id=source_warehouse_id,
                    destination_warehouse_id=destination_warehouse_id,
                    source_location_id=source_location_id,
                    destination_location_id=destination_location_id,
                    batch_id=line["batch_id"],
                    quantity=quantity,
                    created_by=created_by,
                    source_reference=ref,
                )
            done_quantities[line["id"]] = quantity

        async with self._db.session() as session:
            async with session.begin():
                line_repo = StockTransferLineRepository(session)
                for line in lines:
                    line_row = await line_repo.get(line["id"], self.tenant_id)
                    await line_repo.update(line_row, done_quantity=done_quantities[line["id"]])

                transfer_row = await StockTransferRepository(session).get(transfer_id, self.tenant_id)
                transfer_row = await StockTransferRepository(session).update(
                    transfer_row,
                    status=StockTransferStatus.DONE,
                    effective_date=datetime.now(timezone.utc),
                )
            return await self._transfer_response(session, transfer_row)

    async def cancel(self, transfer_id: str) -> StockTransferResponse:
        async with self._db.session() as session:
            async with session.begin():
                transfer = await self._get_for_transition(session, transfer_id, StockTransferStatus.CANCELLED)

                if transfer.status == StockTransferStatus.READY and transfer.type in _RESERVING_TYPES:
                    location_id = await self._resolve_location(
                        session, transfer.source_warehouse_id, transfer.source_location_id
                    )
                    lines = await StockTransferLineRepository(session).list_by_transfer(
                        transfer_id, self.tenant_id
                    )
                    level_repo = StockLevelRepository(session)
                    for line in lines:
                        level = await level_repo.get_for(
                            line.product_id, transfer.source_warehouse_id, self.tenant_id,
                            line.batch_id, location_id, for_update=True,
                        )
                        if level is not None:
                            await level_repo.update(
                                level,
                                reserved_quantity=max(0.0, level.reserved_quantity - line.requested_quantity),
                            )

                transfer = await StockTransferRepository(session).update(
                    transfer, status=StockTransferStatus.CANCELLED
                )
            return await self._transfer_response(session, transfer)

    # ── Internals ────────────────────────────────────────────

    async def _get_for_transition(
        self, session: "AsyncSession", transfer_id: str, to_status: StockTransferStatus
    ) -> StockTransfer:
        transfer = await StockTransferRepository(session).get(transfer_id, self.tenant_id)
        if transfer is None:
            raise StockTransferNotFoundError(transfer_id)
        if to_status not in _ALLOWED_TRANSITIONS.get(transfer.status, set()):
            raise InvalidStockTransferTransitionError(transfer_id, transfer.status.value, to_status.value)
        return transfer

    async def _resolve_location(
        self, session: "AsyncSession", warehouse_id: Optional[str], location_id: Optional[str]
    ) -> Optional[str]:
        if location_id is not None or warehouse_id is None:
            return location_id
        warehouse = await WarehouseRepository(session).get(warehouse_id, self.tenant_id)
        return warehouse.default_stock_location_id if warehouse else None

    async def _resolve_batch_numbers(
        self, session: "AsyncSession", lines: list[StockTransferLine]
    ) -> dict[Optional[str], tuple[Optional[str], Optional[object]]]:
        """batch_id -> (batch_number, expiry_date), for IN lines that reference
        an already-known batch (e.g. restocking a lot created by an earlier
        receive) — StockMovementService.receive() upserts by batch_number,
        not batch_id, so this bridges the two."""
        batch_repo = BatchRepository(session)
        result: dict[Optional[str], tuple[Optional[str], Optional[object]]] = {None: (None, None)}
        for line in lines:
            if line.batch_id and line.batch_id not in result:
                batch = await batch_repo.get(line.batch_id, self.tenant_id)
                if batch is not None:
                    result[line.batch_id] = (batch.batch_number, batch.expiry_date)
        return result
