from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .classification import XYZClassResult


@dataclass(frozen=True)
class ForecastResult:
    method: str  # "simple_exponential_smoothing" | "double_exponential_smoothing"
    forecast: float
    trend: float | None = None


def simple_exponential_smoothing(history: Sequence[float], alpha: float = 0.3) -> ForecastResult:
    """
    Single exponential smoothing — for low-variability (X-class) products.
    forecast_t = alpha * demand_t-1 + (1 - alpha) * forecast_t-1
    Spec §3.2-b.
    """
    if not history:
        raise ValueError("history must not be empty")
    if not 0 < alpha <= 1:
        raise ValueError("alpha must be in (0, 1]")

    level = history[0]
    for observed in history[1:]:
        level = alpha * observed + (1 - alpha) * level
    return ForecastResult(method="simple_exponential_smoothing", forecast=level)


def double_exponential_smoothing(
    history: Sequence[float], alpha: float = 0.3, beta: float = 0.1
) -> ForecastResult:
    """
    Holt's double exponential smoothing — captures trend, for higher-variability
    or trending products (Y/Z-class). Spec §3.2-b.
    """
    if len(history) < 2:
        raise ValueError("history must contain at least 2 points")
    if not 0 < alpha <= 1 or not 0 < beta <= 1:
        raise ValueError("alpha and beta must be in (0, 1]")

    level = history[0]
    trend = history[1] - history[0]

    for observed in history[1:]:
        prev_level = level
        level = alpha * observed + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend

    return ForecastResult(method="double_exponential_smoothing", forecast=level + trend, trend=trend)


def forecast_for_class(history: Sequence[float], xyz_class: XYZClassResult) -> ForecastResult:
    """
    Method selection driven by XYZ classification (spec §3.2-b):
    X (stable demand) → simple smoothing; Y/Z (trending/erratic) → Holt.
    """
    if xyz_class.xyz_class.value == "X":
        return simple_exponential_smoothing(history)
    return double_exponential_smoothing(history)
