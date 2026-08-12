from __future__ import annotations

from dataclasses import dataclass


def days_of_stock_remaining(current_stock: float, forecast_daily_demand: float) -> float:
    """Spec §3.2-f."""
    if current_stock < 0:
        raise ValueError("current_stock must be non-negative")
    if forecast_daily_demand <= 0:
        return float("inf")
    return current_stock / forecast_daily_demand


@dataclass(frozen=True)
class StockoutRisk:
    days_remaining: float
    lead_time_days: float
    will_stock_out_before_delivery: bool
    criticality: str  # "low" | "medium" | "high" | "critical"


def stockout_risk(
    current_stock: float, forecast_daily_demand: float, lead_time_days: float
) -> StockoutRisk:
    """
    Combines days-of-stock-remaining with the real supplier lead time to flag
    products likely to run out before the next delivery. Spec §3.2-f.
    Criticality bands are deliberately simple (ratio of remaining days to lead
    time) — callers needing finer control should build on days_of_stock_remaining
    directly.
    """
    if lead_time_days < 0:
        raise ValueError("lead_time_days must be non-negative")

    remaining = days_of_stock_remaining(current_stock, forecast_daily_demand)
    will_stock_out = remaining < lead_time_days

    if remaining == float("inf"):
        criticality = "low"
    else:
        ratio = remaining / lead_time_days if lead_time_days > 0 else float("inf")
        if ratio < 0.5:
            criticality = "critical"
        elif ratio < 1.0:
            criticality = "high"
        elif ratio < 1.5:
            criticality = "medium"
        else:
            criticality = "low"

    return StockoutRisk(
        days_remaining=remaining,
        lead_time_days=lead_time_days,
        will_stock_out_before_delivery=will_stock_out,
        criticality=criticality,
    )
