from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum as SqlEnum, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import ModelBase, TenantMixin
from .enums import StockMoveType, StockTransferStatus


class StockTransfer(TenantMixin, ModelBase):
    """
    Planable transfer document (Odoo picking-style) — DRAFT -> READY -> DONE
    / CANCELLED. Separate from StockMove, which is the immutable execution
    record created by StockTransferService.execute() once this reaches DONE.
    Reuses StockMoveType (IN=reception, OUT=delivery, TRANSFER=internal) to
    avoid a second near-identical direction enum.
    """

    __tablename__ = "xstock_transfers"

    type: Mapped[StockMoveType] = mapped_column(SqlEnum(StockMoveType), nullable=False)
    status: Mapped[StockTransferStatus] = mapped_column(
        SqlEnum(StockTransferStatus), nullable=False, default=StockTransferStatus.DRAFT
    )

    source_warehouse_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_warehouses.id"), nullable=True
    )
    destination_warehouse_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_warehouses.id"), nullable=True
    )
    source_location_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_locations.id"), nullable=True
    )
    destination_location_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_locations.id"), nullable=True
    )

    scheduled_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Propagated to the resulting StockMove(s) on execute() — falls back to
    # f"stock-transfer:{id}" if not supplied, so a move is always traceable
    # back to the document that created it.
    source_reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)

    __table_args__ = (
        Index("idx_xstock_transfer_tenant_status", "tenant_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<StockTransfer(id={self.id!r}, type={self.type!r}, status={self.status!r})>"


class StockTransferLine(TenantMixin, ModelBase):
    __tablename__ = "xstock_transfer_lines"

    transfer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_transfers.id"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_products.id"), nullable=False, index=True
    )
    batch_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_batches.id"), nullable=True, index=True
    )
    requested_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    done_quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    def __repr__(self) -> str:
        return f"<StockTransferLine(id={self.id!r}, transfer_id={self.transfer_id!r})>"
