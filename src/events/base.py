"""Minimal contract xstock's event wrappers require from the xcore event bus."""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol, runtime_checkable

Handler = Callable[..., Awaitable[None]]


@runtime_checkable
class EventBus(Protocol):
    """
    Matches xcore.kernel.events.EventBus's public surface, narrowed to what
    xstock actually uses: emit a domain event, subscribe a handler to one.
    """

    async def emit(self, name: str, data: dict[str, Any], *, source: str = "") -> None: ...

    def on(self, name: str) -> Callable[[Handler], Handler]: ...
