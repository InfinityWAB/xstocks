from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func
from sqlalchemy.types import JSON

# JSONB on PostgreSQL, generic JSON on SQLite (dev) — same pattern as xcompany.
JSON_VARIANT = JSONB().with_variant(JSON(), "sqlite")


class ModelBase(DeclarativeBase):
    """Common base: UUID String(36) PK + tz-aware timestamps."""

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TenantMixin:
    """
    Denormalized tenant_id column on every table to avoid joins.
    Always supplied by the request context (tenant middleware), never
    from the client payload. tenant_id references xauth_tenants.id — no FK
    declared here since the table lives in a separate DB/schema (Orchauth).
    """

    tenant_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        index=True,
    )
