from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional, Sequence

from ..models.enums import ValuationMethod


@dataclass(frozen=True)
class BatchCandidate:
    batch_id: str
    available_quantity: float
    received_at: datetime
    expiry_date: Optional[date] = None


@dataclass(frozen=True)
class Allocation:
    batch_id: str
    quantity: float


def select_batches(
    candidates: Sequence[BatchCandidate], requested_quantity: float, method: ValuationMethod
) -> list[Allocation]:
    """
    Deterministic batch picking order for a given valuation method. Spec §3.2-e.

    FEFO (default when expiry tracked, mandatory in pharma) — oldest expiry first.
    FIFO — oldest received first. LIFO — most recently received first.
    CMUP does not pick specific batches (weighted-average cost, no physical
    lot ordering) — raises, callers should not route CMUP products here.
    """
    if requested_quantity <= 0:
        raise ValueError("requested_quantity must be positive")
    if method == ValuationMethod.CMUP:
        raise ValueError("CMUP has no batch picking order; it values stock as a pooled average")

    if method == ValuationMethod.FEFO:
        ordered = sorted(
            candidates,
            key=lambda c: (c.expiry_date is None, c.expiry_date or date.max),
        )
    elif method == ValuationMethod.FIFO:
        ordered = sorted(candidates, key=lambda c: c.received_at)
    elif method == ValuationMethod.LIFO:
        ordered = sorted(candidates, key=lambda c: c.received_at, reverse=True)
    else:
        raise ValueError(f"unsupported valuation method: {method}")

    remaining = requested_quantity
    allocations: list[Allocation] = []
    for candidate in ordered:
        if remaining <= 0:
            break
        if candidate.available_quantity <= 0:
            continue
        take = min(candidate.available_quantity, remaining)
        allocations.append(Allocation(batch_id=candidate.batch_id, quantity=take))
        remaining -= take

    if remaining > 0:
        raise ValueError(
            f"insufficient stock: requested {requested_quantity}, "
            f"available {requested_quantity - remaining}"
        )
    return allocations
