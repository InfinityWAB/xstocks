from __future__ import annotations

import math

# Common service-level targets, expressed as a z-score of the standard normal
# distribution. 0.99 is the floor for vital/controlled products where a
# near-100% service level is required.
SERVICE_LEVEL_Z_SCORES = {
    0.90: 1.28,
    0.95: 1.65,
    0.98: 2.05,
    0.99: 2.33,
}


def safety_stock(z_score: float, demand_std_dev: float, lead_time_days: float) -> float:
    """
    Safety stock for a given service level (z_score), demand variability and
    supplier lead time. Spec §3.2-a.
    """
    if demand_std_dev < 0 or lead_time_days < 0:
        raise ValueError("demand_std_dev and lead_time_days must be non-negative")
    return z_score * demand_std_dev * math.sqrt(lead_time_days)


def reorder_point(avg_daily_demand: float, lead_time_days: float, safety_stock_qty: float) -> float:
    """Reorder point = demand consumed during lead time + safety stock. Spec §3.2-a."""
    if avg_daily_demand < 0 or lead_time_days < 0:
        raise ValueError("avg_daily_demand and lead_time_days must be non-negative")
    return avg_daily_demand * lead_time_days + safety_stock_qty


def z_score_for_service_level(service_level: float) -> float:
    """Look up the nearest known z-score for a target service level (0-1)."""
    if service_level in SERVICE_LEVEL_Z_SCORES:
        return SERVICE_LEVEL_Z_SCORES[service_level]
    closest = min(SERVICE_LEVEL_Z_SCORES, key=lambda level: abs(level - service_level))
    return SERVICE_LEVEL_Z_SCORES[closest]
