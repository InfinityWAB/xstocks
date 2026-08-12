from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class SiteStockPosition:
    site_id: str
    available_quantity: float
    reorder_point: float
    max_threshold: float | None = None


@dataclass(frozen=True)
class TransferProposal:
    source_site_id: str
    destination_site_id: str
    quantity: float
    reason: str


def suggest_transfers(positions: Sequence[SiteStockPosition]) -> list[TransferProposal]:
    """
    Matches sites in surplus (stock above max_threshold, or comfortably above
    reorder point) against sites at risk of stockout (below reorder point).
    Spec §3.2-j. Purely proposes matches sorted by most-urgent-need first;
    execution/arbitration is manual, per spec.
    """
    at_risk = sorted(
        (p for p in positions if p.available_quantity < p.reorder_point),
        key=lambda p: p.available_quantity - p.reorder_point,
    )
    surplus = sorted(
        (p for p in positions if _has_surplus(p)),
        key=lambda p: p.available_quantity - (p.max_threshold or p.reorder_point),
        reverse=True,
    )

    proposals: list[TransferProposal] = []
    surplus_remaining = {p.site_id: _surplus_quantity(p) for p in surplus}

    for need in at_risk:
        shortfall = need.reorder_point - need.available_quantity
        for source in surplus:
            if source.site_id == need.site_id:
                continue
            available_to_give = surplus_remaining[source.site_id]
            if available_to_give <= 0:
                continue
            transfer_qty = min(shortfall, available_to_give)
            if transfer_qty <= 0:
                continue
            proposals.append(
                TransferProposal(
                    source_site_id=source.site_id,
                    destination_site_id=need.site_id,
                    quantity=transfer_qty,
                    reason=(
                        f"{need.site_id} below reorder point "
                        f"({need.available_quantity}/{need.reorder_point}); "
                        f"{source.site_id} in surplus"
                    ),
                )
            )
            surplus_remaining[source.site_id] -= transfer_qty
            shortfall -= transfer_qty
            if shortfall <= 0:
                break

    return proposals


def _has_surplus(position: SiteStockPosition) -> bool:
    return _surplus_quantity(position) > 0


def _surplus_quantity(position: SiteStockPosition) -> float:
    if position.max_threshold is not None:
        return position.available_quantity - position.max_threshold
    return position.available_quantity - position.reorder_point
