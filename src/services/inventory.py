"""
InventoryService — physical inventory count lifecycle.

Responsibilities:
  - Open a count with one line per product currently stocked in a warehouse
    (expected_quantity snapshotted from StockLevel at start time).
  - Record physical counts.
  - Validate/close: requires every line counted; a non-zero variance on a
    controlled substance blocks closure unless an explicit justified
    override is supplied (spec §3.2-h, zero-tolerance reconciliation).
    Closing generates StockMove ADJUSTMENT rows via StockMovementService so
    StockLevel reflects the physical count.

Note: validating the count (status → VALIDATED) and posting the resulting
stock adjustments are two separate transactions (this service commits the
count first, then calls StockMovementService for each variance). This
mirrors how the two aggregates are owned — StockLevel bookkeeping only ever
happens inside StockMovementService — at the cost of not being a single
atomic DB transaction across both.
"""
from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Any, Optional

from ..algorithms.controlled_substances import reconcile
from ..models.enums import AlertType, InventoryStatus, InventoryType
from ..models.inventory import InventoryCount, InventoryCountLine
from ..permissions import ALERTS_CONTROLLED_SUBSTANCE
from ..repositories.inventory import InventoryCountLineRepository, InventoryCountRepository
from ..repositories.movement import StockLevelRepository
from ..repositories.product import ProductRepository, WarehouseRepository
from ..schemas.inventory import InventoryCountLineResponse, InventoryCountResponse
from .alert import AlertService, CallPlugin
from .exceptions import (
    AmbiguousBatchAdjustmentError,
    ControlledSubstanceVarianceError,
    InventoryCountLineNotFoundError,
    InventoryCountNotDraftOrInProgressError,
    InventoryCountNotFoundError,
    SelfValidatedOverrideError,
    UncountedLinesError,
    WarehouseNotFoundError,
)
from .movement import StockMovementService
from .settings import StockSettingsService

if TYPE_CHECKING:
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService


_OPEN_STATUSES = (InventoryStatus.DRAFT, InventoryStatus.IN_PROGRESS)


class InventoryService:
    def __init__(
        self,
        db: "DatabaseService",
        tenant_id: str,
        call_plugin: Optional[CallPlugin] = None,
        events_bus: Optional[Any] = None,
    ) -> None:
        self._db = db
        self.tenant_id = tenant_id
        self._movement = StockMovementService(db, tenant_id)
        self._settings = StockSettingsService(db, tenant_id)
        self._alerts = (
            AlertService(tenant_id, call_plugin, events_bus) if call_plugin is not None else None
        )

    # ── Response enrichment ────────────────────────────────────

    async def _warehouse_name(self, session, warehouse_id: str) -> Optional[str]:
        return await WarehouseRepository(session).get_name(warehouse_id, self.tenant_id)

    async def _count_response(self, session, count: InventoryCount) -> InventoryCountResponse:
        resp = InventoryCountResponse.model_validate(count)
        resp.warehouse_name = await self._warehouse_name(session, count.warehouse_id)
        return resp

    async def _line_responses(
        self, session, lines: list[InventoryCountLine]
    ) -> list[InventoryCountLineResponse]:
        product_ids = list({l.product_id for l in lines})
        products = await ProductRepository(session).list_by_ids(product_ids, self.tenant_id)
        names = {p.id: p.name for p in products}
        responses = []
        for line in lines:
            resp = InventoryCountLineResponse.model_validate(line)
            resp.product_name = names.get(line.product_id)
            responses.append(resp)
        return responses

    # ── Lifecycle ────────────────────────────────────────────

    async def start_count(
        self,
        *,
        warehouse_id: str,
        type: InventoryType,
        count_date: date,
        product_ids: Optional[list[str]] = None,
    ) -> InventoryCountResponse:
        """
        Open a count. If product_ids is omitted, every product currently
        stocked (any batch) in the warehouse gets a line — a full count.
        Passing product_ids scopes it to a cycle count.
        """
        async with self._db.session() as session:
            async with session.begin():
                level_repo = StockLevelRepository(session)
                levels = await level_repo.list_by_warehouse(warehouse_id, self.tenant_id)
                if not levels and product_ids is None:
                    raise WarehouseNotFoundError(warehouse_id)

                totals: dict[str, float] = {}
                for level in levels:
                    if product_ids is not None and level.product_id not in product_ids:
                        continue
                    totals[level.product_id] = totals.get(level.product_id, 0.0) + level.available_quantity
                if product_ids is not None:
                    for pid in product_ids:
                        totals.setdefault(pid, 0.0)

                count = await InventoryCountRepository(session).save(
                    InventoryCount(
                        tenant_id=self.tenant_id,
                        warehouse_id=warehouse_id,
                        type=type,
                        status=InventoryStatus.IN_PROGRESS,
                        count_date=count_date,
                    )
                )

                line_repo = InventoryCountLineRepository(session)
                for product_id, expected_quantity in totals.items():
                    await line_repo.save(
                        InventoryCountLine(
                            tenant_id=self.tenant_id,
                            inventory_count_id=count.id,
                            product_id=product_id,
                            expected_quantity=expected_quantity,
                        )
                    )
            return await self._count_response(session, count)

    async def record_count(
        self, inventory_count_id: str, product_id: str, counted_quantity: float, *, counted_by: str,
    ) -> InventoryCountLineResponse:
        async with self._db.session() as session:
            async with session.begin():
                count = await InventoryCountRepository(session).get(inventory_count_id, self.tenant_id)
                if count is None:
                    raise InventoryCountNotFoundError(inventory_count_id)
                if count.status not in _OPEN_STATUSES:
                    raise InventoryCountNotDraftOrInProgressError(inventory_count_id, count.status.value)

                line_repo = InventoryCountLineRepository(session)
                lines = await line_repo.list_by_count(inventory_count_id, self.tenant_id)
                line = next((l for l in lines if l.product_id == product_id), None)
                if line is None:
                    raise InventoryCountLineNotFoundError(inventory_count_id, product_id)

                variance = counted_quantity - line.expected_quantity
                line = await line_repo.update(
                    line, counted_quantity=counted_quantity, variance=variance, counted_by=counted_by,
                )
            resp = InventoryCountLineResponse.model_validate(line)
            product = await ProductRepository(session).get(product_id, self.tenant_id)
            resp.product_name = product.name if product else None
            return resp

    async def validate_count(
        self,
        inventory_count_id: str,
        *,
        validated_by: str,
        override_reason: Optional[str] = None,
    ) -> InventoryCountResponse:
        async with self._db.session() as session:
            async with session.begin():
                count_repo = InventoryCountRepository(session)
                count = await count_repo.get(inventory_count_id, self.tenant_id)
                if count is None:
                    raise InventoryCountNotFoundError(inventory_count_id)
                if count.status not in _OPEN_STATUSES:
                    raise InventoryCountNotDraftOrInProgressError(inventory_count_id, count.status.value)

                line_repo = InventoryCountLineRepository(session)
                if await line_repo.has_uncounted_lines(inventory_count_id, self.tenant_id):
                    raise UncountedLinesError(inventory_count_id)

                lines = await line_repo.list_by_count(inventory_count_id, self.tenant_id)
                product_repo = ProductRepository(session)
                level_repo = StockLevelRepository(session)

                # (product_id, batch_id, variance) — batch_id is None for
                # non-lot-tracked products, resolved from StockLevel otherwise.
                variances: list[tuple[str, Optional[str], float]] = []
                overridden_controlled_substances: list[tuple[Any, float]] = []
                for line in lines:
                    if not line.variance:
                        continue
                    product = await product_repo.get(line.product_id, self.tenant_id)
                    if product is not None and product.is_controlled_substance:
                        result = reconcile(line.expected_quantity, line.counted_quantity)
                        if not result.is_balanced and not override_reason:
                            raise ControlledSubstanceVarianceError(product.id, result.variance)
                        if not result.is_balanced:
                            # Second-look : celui qui a physiquement compté
                            # cette ligne ne peut pas être aussi celui qui
                            # auto-justifie l'écart (audit xstock Constat 1).
                            if line.counted_by is not None and line.counted_by == validated_by:
                                raise SelfValidatedOverrideError(product.id, validated_by)
                            overridden_controlled_substances.append((product, result.variance))

                    batch_id = None
                    if product is not None and product.is_lot_tracked:
                        batches = await level_repo.list_batches_in_warehouse(
                            line.product_id, count.warehouse_id, self.tenant_id
                        )
                        if len(batches) != 1:
                            raise AmbiguousBatchAdjustmentError(line.product_id, len(batches))
                        batch_id = batches[0].batch_id

                    variances.append((line.product_id, batch_id, line.variance))

                count = await count_repo.update(count, status=InventoryStatus.VALIDATED)
                warehouse_id = count.warehouse_id

            # Second transaction (owned by StockMovementService): post the
            # physical corrections as ADJUSTMENT moves now that the count
            # itself is durably closed.
            for product_id, batch_id, variance in variances:
                reason = f"inventory count {inventory_count_id}"
                if override_reason:
                    reason += f" (override: {override_reason})"
                await self._movement.adjust(
                    product_id=product_id,
                    warehouse_id=warehouse_id,
                    batch_id=batch_id,
                    delta=variance,
                    created_by=validated_by,
                    reason=reason,
                )

            if self._alerts is not None and overridden_controlled_substances:
                recipients = await self._settings.get_alert_recipients(
                    AlertType.CONTROLLED_SUBSTANCE_VARIANCE, ALERTS_CONTROLLED_SUBSTANCE
                )
                for product, variance in overridden_controlled_substances:
                    await self._alerts.send(
                        recipients=recipients,
                        event_type="xstock.inventory_count.variance_override",
                        subject=f"Controlled substance variance override — {product.name}",
                        text=(
                            f"Inventory count {inventory_count_id} closed with a variance of "
                            f"{variance} on {product.name} (controlled substance), overridden by "
                            f"{validated_by}: {override_reason}"
                        ),
                        create_task=True,
                        task_priority="critical",
                        task_category="controlled_substance_variance",
                        extra={
                            "product_id": product.id,
                            "variance": variance,
                            "override_reason": override_reason,
                            "validated_by": validated_by,
                            "inventory_count_id": inventory_count_id,
                        },
                    )

            return await self._count_response(session, count)

    async def cancel_count(self, inventory_count_id: str) -> InventoryCountResponse:
        async with self._db.session() as session:
            async with session.begin():
                count_repo = InventoryCountRepository(session)
                count = await count_repo.get(inventory_count_id, self.tenant_id)
                if count is None:
                    raise InventoryCountNotFoundError(inventory_count_id)
                if count.status not in _OPEN_STATUSES:
                    raise InventoryCountNotDraftOrInProgressError(inventory_count_id, count.status.value)
                count = await count_repo.update(count, status=InventoryStatus.CANCELLED)
            return await self._count_response(session, count)

    # ── Read ─────────────────────────────────────────────────

    async def get_count(self, inventory_count_id: str) -> InventoryCountResponse:
        async with self._db.session() as session:
            count = await InventoryCountRepository(session).get(inventory_count_id, self.tenant_id)
            if count is None:
                raise InventoryCountNotFoundError(inventory_count_id)
            return await self._count_response(session, count)

    async def list_by_warehouse(self, warehouse_id: str) -> list[InventoryCountResponse]:
        async with self._db.session() as session:
            counts = await InventoryCountRepository(session).list_by_warehouse(warehouse_id, self.tenant_id)
            warehouse_name = await self._warehouse_name(session, warehouse_id)
            responses = []
            for c in counts:
                resp = InventoryCountResponse.model_validate(c)
                resp.warehouse_name = warehouse_name
                responses.append(resp)
            return responses

    async def list_lines(self, inventory_count_id: str) -> list[InventoryCountLineResponse]:
        async with self._db.session() as session:
            lines = await InventoryCountLineRepository(session).list_by_count(
                inventory_count_id, self.tenant_id
            )
            return await self._line_responses(session, lines)
