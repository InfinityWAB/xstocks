from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Enum as SqlEnum, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import ModelBase, TenantMixin
from .enums import BatchStatus, StockMoveType


class Batch(TenantMixin, ModelBase):
    """Lot/batch. Required for any Product with is_lot_tracked=True."""

    __tablename__ = "xstock_batches"

    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_products.id"), nullable=False, index=True
    )
    batch_number: Mapped[str] = mapped_column(String(100), nullable=False)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    initial_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[BatchStatus] = mapped_column(
        SqlEnum(BatchStatus), nullable=False, default=BatchStatus.ACTIVE
    )

    __table_args__ = (
        Index("idx_xstock_batch_tenant_product_number", "tenant_id", "product_id", "batch_number", unique=True),
        Index("idx_xstock_batch_expiry", "tenant_id", "expiry_date"),
    )

    def __repr__(self) -> str:
        return f"<Batch(id={self.id!r}, batch_number={self.batch_number!r})>"


class StockMove(TenantMixin, ModelBase):
    """
    Stock movement — source of truth, immutable once created. StockLevel is
    kept in sync eagerly, in the same DB transaction as each StockMove insert
    (StockMovementService._adjust_level) — not a separate recompute pass.
    """

    __tablename__ = "xstock_moves"

    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_products.id"), nullable=False, index=True
    )
    batch_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_batches.id"), nullable=True, index=True
    )
    type: Mapped[StockMoveType] = mapped_column(SqlEnum(StockMoveType), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)

    # The warehouse whose StockLevel this move affects. A TRANSFER is recorded
    # as two linked StockMove rows (one per warehouse, same source_reference)
    # rather than a single row spanning two warehouses — keeps StockLevel
    # bookkeeping single-warehouse-per-row and unambiguous.
    warehouse_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_warehouses.id"), nullable=False, index=True
    )
    source_location_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_locations.id"), nullable=True
    )
    destination_location_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_locations.id"), nullable=True
    )

    # Traceability to the entity that triggered the movement (e.g. PO-2026-00123)
    source_reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # required if type=adjustment

    # Clé d'idempotence d'un mouvement : "<sha256(type|produit|entrepôt|clé appelant)>:<n>"
    # (n = rang du mouvement dans l'appel, plusieurs lots => plusieurs mouvements).
    # NULL tant que l'appelant ne fournit pas d'idempotency_key (comportement
    # historique inchangé). Unique par tenant : un rejeu ne peut pas insérer deux fois.
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Costing — populated by the valuation engine (algorithms/valuation.py) on
    # IN (declared/purchase cost) and OUT (FIFO/LIFO/CMUP-consumed cost).
    # Null when no cost is known (e.g. ADJUSTMENT, or a receive without a
    # purchase price) — valuation is best-effort, never blocks a movement.
    unit_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # On-hand quantity for this product/warehouse/batch scope immediately
    # before/after this move — an irrefutable audit trail independent of the
    # mutable StockLevel row (spec: soldeAvant/soldeApres).
    balance_before: Mapped[float] = mapped_column(Float, nullable=False)
    balance_after: Mapped[float] = mapped_column(Float, nullable=False)

    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    move_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("idx_xstock_move_tenant_product_date", "tenant_id", "product_id", "move_date"),
        Index("idx_xstock_move_tenant_warehouse_date", "tenant_id", "warehouse_id", "move_date"),
        Index("idx_xstock_move_tenant_reference", "tenant_id", "source_reference"),
        Index("uq_xstock_move_tenant_idempotency", "tenant_id", "idempotency_key", unique=True),
    )

    def __repr__(self) -> str:
        return f"<StockMove(id={self.id!r}, type={self.type!r}, qty={self.quantity!r})>"


class StockLevel(TenantMixin, ModelBase):
    """
    Current stock level per product/warehouse/location (and batch if
    applicable) — kept in sync eagerly by StockMovementService on every
    StockMove, in the same DB transaction. Never recomputed on-the-fly on
    read: too costly.
    """

    __tablename__ = "xstock_levels"

    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_products.id"), nullable=False, index=True
    )
    warehouse_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_warehouses.id"), nullable=False, index=True
    )
    location_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_locations.id"), nullable=True, index=True
    )
    batch_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_batches.id"), nullable=True, index=True
    )
    available_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    # Physically on hand but already promised to a READY StockTransfer — never
    # written outside StockTransferService.mark_ready/execute/cancel. Any
    # decrement of available_quantity must keep available_quantity >= this.
    reserved_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    # Weighted-average unit cost — only meaningful for Product.valuation_method
    # == CMUP (see algorithms/valuation.py). Null for FIFO/LIFO/FEFO products,
    # which cost via ValuationLayer instead.
    average_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    __table_args__ = (
        Index(
            "idx_xstock_level_tenant_product_wh_loc_batch",
            "tenant_id", "product_id", "warehouse_id", "location_id", "batch_id",
            unique=True,
        ),
    )

    def __repr__(self) -> str:
        return f"<StockLevel(product_id={self.product_id!r}, qty={self.available_quantity!r})>"


class ValuationLayer(TenantMixin, ModelBase):
    """
    Cost layer created by a receive() — consumed (partially or fully) by
    later issue()s per algorithms/valuation.consume_layers. FIFO/LIFO order by
    received_at; CMUP consumes pro-rata across all open layers (see algorithm
    docstring for why CMUP doesn't need a separate pooled-average mechanism).
    """

    __tablename__ = "xstock_valuation_layers"

    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_products.id"), nullable=False, index=True
    )
    batch_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_batches.id"), nullable=True, index=True
    )
    warehouse_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_warehouses.id"), nullable=False, index=True
    )
    source_move_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_moves.id"), nullable=False, index=True
    )
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_remaining: Mapped[float] = mapped_column(Float, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index(
            "idx_xstock_layer_tenant_product_wh_open",
            "tenant_id", "product_id", "warehouse_id", "received_at",
        ),
    )

    def __repr__(self) -> str:
        return f"<ValuationLayer(id={self.id!r}, product_id={self.product_id!r}, remaining={self.quantity_remaining!r})>"
