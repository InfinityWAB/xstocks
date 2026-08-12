from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Sequence

from ..models.enums import ValuationMethod


@dataclass(frozen=True)
class LayerCandidate:
    layer_id: str
    quantity_remaining: float
    unit_cost: float
    received_at: datetime


@dataclass(frozen=True)
class LayerConsumption:
    layer_id: str
    quantity: float
    unit_cost: float


def consume_layers(
    candidates: Sequence[LayerCandidate], quantity: float, method: ValuationMethod
) -> list[LayerConsumption]:
    """
    Deterministic cost-layer consumption for a given valuation method.

    FIFO and FEFO — oldest received layer first (FEFO already governs *which
    batch* gets picked in algorithms/picking.py; once a batch is chosen, its
    own layer(s) are consumed oldest-first, same rule as FIFO).
    LIFO — most recently received layer first.
    CMUP — no ordering: consumes pro-rata across every open layer, weighted
    by quantity_remaining. This reproduces a weighted-average cost for the
    consumed portion without maintaining a separate running-average field,
    and keeps a single consumption mechanism for all 3 methods.

    Raises ValueError if the open layers don't cover `quantity` — callers
    should treat that as a data-integrity gap (StockLevel says stock is
    available but no cost layer accounts for it), not as insufficient stock.
    """
    if quantity <= 0:
        raise ValueError("quantity must be positive")

    open_candidates = [c for c in candidates if c.quantity_remaining > 0]

    if method == ValuationMethod.CMUP:
        return _consume_pro_rata(open_candidates, quantity)

    if method in (ValuationMethod.FIFO, ValuationMethod.FEFO):
        ordered = sorted(open_candidates, key=lambda c: c.received_at)
    elif method == ValuationMethod.LIFO:
        ordered = sorted(open_candidates, key=lambda c: c.received_at, reverse=True)
    else:
        raise ValueError(f"unsupported valuation method: {method}")

    remaining = quantity
    consumptions: list[LayerConsumption] = []
    for candidate in ordered:
        if remaining <= 0:
            break
        take = min(candidate.quantity_remaining, remaining)
        consumptions.append(LayerConsumption(candidate.layer_id, take, candidate.unit_cost))
        remaining -= take

    if remaining > 0:
        raise ValueError(
            f"insufficient valuation layers: requested {quantity}, covered {quantity - remaining}"
        )
    return consumptions


def _consume_pro_rata(
    candidates: Sequence[LayerCandidate], quantity: float
) -> list[LayerConsumption]:
    total_remaining = sum(c.quantity_remaining for c in candidates)
    if total_remaining < quantity:
        raise ValueError(
            f"insufficient valuation layers: requested {quantity}, covered {total_remaining}"
        )

    consumptions: list[LayerConsumption] = []
    remaining = quantity
    for i, candidate in enumerate(candidates):
        is_last = i == len(candidates) - 1
        take = remaining if is_last else min(
            quantity * (candidate.quantity_remaining / total_remaining),
            candidate.quantity_remaining,
            remaining,
        )
        if take <= 0:
            continue
        consumptions.append(LayerConsumption(candidate.layer_id, take, candidate.unit_cost))
        remaining -= take
    return consumptions


def weighted_unit_cost(consumptions: Sequence[LayerConsumption]) -> float:
    total_qty = sum(c.quantity for c in consumptions)
    if total_qty <= 0:
        return 0.0
    total_value = sum(c.quantity * c.unit_cost for c in consumptions)
    return total_value / total_qty
