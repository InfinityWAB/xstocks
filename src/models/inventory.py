from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import Date, Enum as SqlEnum, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import ModelBase, TenantMixin
from .enums import InventoryStatus, InventoryType


class InventoryCount(TenantMixin, ModelBase):
    __tablename__ = "xstock_inventory_counts"

    warehouse_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_warehouses.id"), nullable=False, index=True
    )
    type: Mapped[InventoryType] = mapped_column(SqlEnum(InventoryType), nullable=False)
    status: Mapped[InventoryStatus] = mapped_column(
        SqlEnum(InventoryStatus), nullable=False, default=InventoryStatus.DRAFT
    )
    count_date: Mapped[date] = mapped_column(Date, nullable=False)

    __table_args__ = (
        Index("idx_xstock_inv_tenant_warehouse", "tenant_id", "warehouse_id"),
    )

    def __repr__(self) -> str:
        return f"<InventoryCount(id={self.id!r}, status={self.status!r})>"


class InventoryCountLine(TenantMixin, ModelBase):
    __tablename__ = "xstock_inventory_count_lines"

    inventory_count_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_inventory_counts.id"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_products.id"), nullable=False, index=True
    )
    expected_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    counted_quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    variance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Qui a physiquement compté cette ligne — permet à validate_count() de
    # refuser qu'un seul acteur constate l'écart ET l'auto-justifie sur un
    # stupéfiant (audit xstock Constat 1, second-look/séparation des tâches).
    counted_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    __table_args__ = (
        Index(
            "idx_xstock_inv_line_tenant_count_product",
            "tenant_id", "inventory_count_id", "product_id",
            unique=True,
        ),
    )

    def __repr__(self) -> str:
        return f"<InventoryCountLine(id={self.id!r}, variance={self.variance!r})>"
