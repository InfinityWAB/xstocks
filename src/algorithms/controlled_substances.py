from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


def next_sequence_number(last_sequence_number: Optional[int]) -> int:
    """
    Gap-free sequence rule for the controlled-substance register: next = max(previous) + 1.
    Spec §3.2-h. Pure rule only — the caller is responsible for holding a
    row lock (see ControlledSubstanceRegisterRepository.get_last_sequence_for_update)
    so this check can't race under concurrent writes.
    """
    return 1 if last_sequence_number is None else last_sequence_number + 1


@dataclass(frozen=True)
class ReconciliationResult:
    theoretical_quantity: float
    physical_quantity: float
    variance: float
    is_balanced: bool


def reconcile(theoretical_quantity: float, physical_quantity: float) -> ReconciliationResult:
    """
    Zero-tolerance theoretical-vs-physical reconciliation for controlled
    substances, required at every inventory count touching these products.
    Spec §3.2-h. Any non-zero variance must block closure and require a
    justified declaration + hierarchical approval — enforced by the caller,
    not here.
    """
    variance = physical_quantity - theoretical_quantity
    return ReconciliationResult(
        theoretical_quantity=theoretical_quantity,
        physical_quantity=physical_quantity,
        variance=variance,
        is_balanced=variance == 0,
    )
