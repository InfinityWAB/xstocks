from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import Sequence

from ..models.enums import ABCClass, XYZClass


@dataclass(frozen=True)
class ABCClassResult:
    abc_class: ABCClass
    cumulative_value_share: float


@dataclass(frozen=True)
class XYZClassResult:
    xyz_class: XYZClass
    coefficient_of_variation: float


def classify_abc(items: dict[str, float]) -> dict[str, ABCClassResult]:
    """
    Pareto (value) classification. items: {product_id: consumed_value}.
    A = top items cumulating 80% of value, B = next 15%, C = remaining 5%.
    Spec §3.2-c.
    """
    if not items:
        return {}

    total_value = sum(items.values())
    if total_value <= 0:
        return {product_id: ABCClassResult(ABCClass.C, 0.0) for product_id in items}

    ranked = sorted(items.items(), key=lambda pair: pair[1], reverse=True)

    results: dict[str, ABCClassResult] = {}
    cumulative = 0.0
    for product_id, value in ranked:
        cumulative += value
        share = cumulative / total_value
        if share <= 0.80:
            abc_class = ABCClass.A
        elif share <= 0.95:
            abc_class = ABCClass.B
        else:
            abc_class = ABCClass.C
        results[product_id] = ABCClassResult(abc_class, share)
    return results


def classify_xyz(history: Sequence[float]) -> XYZClassResult:
    """
    Demand regularity classification via coefficient of variation (CV = stdev/mean).
    X: CV < 0.5 (stable) — Y: 0.5 <= CV < 1 — Z: CV >= 1 (erratic). Spec §3.2-c.
    """
    if len(history) < 2:
        raise ValueError("history must contain at least 2 points")

    mean = statistics.mean(history)
    if mean == 0:
        return XYZClassResult(XYZClass.Z, float("inf"))

    stdev = statistics.stdev(history)
    cv = stdev / mean

    if cv < 0.5:
        xyz_class = XYZClass.X
    elif cv < 1.0:
        xyz_class = XYZClass.Y
    else:
        xyz_class = XYZClass.Z
    return XYZClassResult(xyz_class, cv)
