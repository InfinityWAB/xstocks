from __future__ import annotations

from pydantic import ConfigDict
from pydantic.alias_generators import to_camel

CAMEL = ConfigDict(
    from_attributes=True,
    alias_generator=to_camel,
    populate_by_name=True,
)
