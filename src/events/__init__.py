"""
xstock event wrappers — one class per service, all inheriting from
XStockEventsBase. See individual modules for the events each service emits.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from .base import EventBus, Handler

logger = logging.getLogger("xstock.events")


class XStockEventsBase:
    """
    Common base for all xstock event wrappers.

    Fire-and-forget on emit: a broken/absent event bus must never break the
    business operation that triggered the event — every emit() is
    best-effort and logs on failure instead of raising.
    """

    source = "xstock"

    def __init__(self, bus: Optional[EventBus]) -> None:
        self._bus = bus

    async def _emit(self, name: str, data: dict[str, Any]) -> None:
        if self._bus is None:
            return
        try:
            await self._bus.emit(name, data, source=self.source)
        except Exception as exc:
            logger.warning("%s._emit(%s) failed: %s", type(self).__name__, name, exc)


from .intelligence import IntelligenceEvents  # noqa: E402

__all__ = [
    "EventBus",
    "Handler",
    "XStockEventsBase",
    "IntelligenceEvents",
]
