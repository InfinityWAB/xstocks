"""Minimal contract xstock's scheduled tasks require from xcore's SchedulerService."""
from __future__ import annotations

from typing import Any, Callable, Optional, Protocol, runtime_checkable

Job = Callable[[], Any]


@runtime_checkable
class Scheduler(Protocol):
    """
    Matches xcore.services.scheduler.service.SchedulerService's public
    surface, narrowed to what xstock actually uses.
    """

    def interval(self, **trigger_args: Any) -> Callable[[Job], Job]: ...

    def cron(self, expression: str, job_id: Optional[str] = None) -> Callable[[Job], Job]: ...
