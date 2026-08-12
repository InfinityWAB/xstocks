"""
TransferSuggestionService — approval workflow for suggestions produced by
IntelligenceService.generate_transfer_suggestions().

Transitions: SUGGESTED -> {APPROVED, REJECTED} -> (APPROVED) -> EXECUTED.
Executing actually moves the stock (delegates to StockMovementService.transfer)
— spec §3.2-j is explicit that execution is manual/arbitrated, never automatic,
which is why generate_transfer_suggestions() only ever creates SUGGESTED rows.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from ..models.enums import TransferSuggestionStatus
from ..repositories.pharma import TransferSuggestionRepository
from ..schemas.pharma import TransferSuggestionResponse
from .exceptions import InvalidTransferSuggestionTransitionError, TransferSuggestionNotFoundError
from .movement import StockMovementService

if TYPE_CHECKING:
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService

_ALLOWED_TRANSITIONS = {
    TransferSuggestionStatus.SUGGESTED: {TransferSuggestionStatus.APPROVED, TransferSuggestionStatus.REJECTED},
    TransferSuggestionStatus.APPROVED: {TransferSuggestionStatus.EXECUTED},
}


class TransferSuggestionService:
    def __init__(self, db: "DatabaseService", tenant_id: str) -> None:
        self._db = db
        self.tenant_id = tenant_id
        self._movement = StockMovementService(db, tenant_id)

    async def list_pending(self) -> list[TransferSuggestionResponse]:
        async with self._db.session() as session:
            suggestions = await TransferSuggestionRepository(session).list_pending(self.tenant_id)
            return [TransferSuggestionResponse.model_validate(s) for s in suggestions]

    async def list_for_product(self, product_id: str) -> list[TransferSuggestionResponse]:
        async with self._db.session() as session:
            suggestions = await TransferSuggestionRepository(session).list_by_product(
                product_id, self.tenant_id
            )
            return [TransferSuggestionResponse.model_validate(s) for s in suggestions]

    async def approve(self, suggestion_id: str) -> TransferSuggestionResponse:
        return await self._transition(suggestion_id, TransferSuggestionStatus.APPROVED)

    async def reject(self, suggestion_id: str) -> TransferSuggestionResponse:
        return await self._transition(suggestion_id, TransferSuggestionStatus.REJECTED)

    async def execute(self, suggestion_id: str, *, created_by: str) -> TransferSuggestionResponse:
        async with self._db.session() as session:
            repo = TransferSuggestionRepository(session)
            suggestion = await repo.get(suggestion_id, self.tenant_id)
            if suggestion is None:
                raise TransferSuggestionNotFoundError(suggestion_id)
            if TransferSuggestionStatus.EXECUTED not in _ALLOWED_TRANSITIONS.get(suggestion.status, set()):
                raise InvalidTransferSuggestionTransitionError(
                    suggestion_id, suggestion.status.value, TransferSuggestionStatus.EXECUTED.value
                )
            product_id = suggestion.product_id
            source_site_id = suggestion.source_site_id
            destination_site_id = suggestion.destination_site_id
            quantity = suggestion.suggested_quantity

        # Separate transaction: StockMovementService owns StockLevel writes.
        await self._movement.transfer(
            product_id=product_id,
            source_warehouse_id=source_site_id,
            destination_warehouse_id=destination_site_id,
            quantity=quantity,
            created_by=created_by,
            reason=f"transfer suggestion {suggestion_id}",
            source_reference=f"transfer-suggestion:{suggestion_id}",
        )

        async with self._db.session() as session:
            async with session.begin():
                repo = TransferSuggestionRepository(session)
                suggestion = await repo.get(suggestion_id, self.tenant_id)
                suggestion = await repo.update(suggestion, status=TransferSuggestionStatus.EXECUTED)
            return TransferSuggestionResponse.model_validate(suggestion)

    async def _transition(
        self, suggestion_id: str, to_status: TransferSuggestionStatus
    ) -> TransferSuggestionResponse:
        async with self._db.session() as session:
            async with session.begin():
                repo = TransferSuggestionRepository(session)
                suggestion = await repo.get(suggestion_id, self.tenant_id)
                if suggestion is None:
                    raise TransferSuggestionNotFoundError(suggestion_id)
                if to_status not in _ALLOWED_TRANSITIONS.get(suggestion.status, set()):
                    raise InvalidTransferSuggestionTransitionError(
                        suggestion_id, suggestion.status.value, to_status.value
                    )
                suggestion = await repo.update(suggestion, status=to_status)
            return TransferSuggestionResponse.model_validate(suggestion)
