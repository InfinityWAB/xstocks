from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, Enum as SqlEnum, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import JSON_VARIANT, ModelBase, TenantMixin
from .enums import ABCClass, LocationType, ValuationMethod, XYZClass


class Product(TenantMixin, ModelBase):
    """
    Product catalog. Pharma-specific fields (inn, dosage_form...) are optional —
    left unset outside a pharmacy / medical warehouse context.
    """

    __tablename__ = "xstock_products"

    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="unit")

    purchase_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sale_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    valuation_method: Mapped[ValuationMethod] = mapped_column(
        SqlEnum(ValuationMethod), nullable=False, default=ValuationMethod.FEFO
    )
    is_lot_tracked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    min_threshold: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_threshold: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # ── Classification (recomputed periodically by the ABC/XYZ engine) ────────
    abc_class: Mapped[Optional[ABCClass]] = mapped_column(SqlEnum(ABCClass), nullable=True)
    xyz_class: Mapped[Optional[XYZClass]] = mapped_column(SqlEnum(XYZClass), nullable=True)

    # ── Pharma fields (nullable, generalizable outside pharma) ─────────────────
    inn: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # International Nonproprietary Name
    dosage_form: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    dosage: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    therapeutic_class: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_controlled_substance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # ── Cold chain (2-8°C storage requirement) ──────────────────────────────
    requires_cold_chain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    min_temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    extra: Mapped[Optional[dict]] = mapped_column(JSON_VARIANT, nullable=True)

    __table_args__ = (
        Index("idx_xstock_product_tenant_code", "tenant_id", "code", unique=True),
        Index("idx_xstock_product_tenant_name", "tenant_id", "name"),
    )

    def __repr__(self) -> str:
        return f"<Product(id={self.id!r}, code={self.code!r}, tenant={self.tenant_id!r})>"


class Warehouse(TenantMixin, ModelBase):
    __tablename__ = "xstock_warehouses"

    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    site_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Set right after the warehouse's default StockLocation is created
    # (WarehouseService.create_warehouse) — every receive/issue/adjust/transfer
    # call that doesn't specify a location falls back to this one.
    default_stock_location_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True
    )

    __table_args__ = (
        Index("idx_xstock_warehouse_tenant_code", "tenant_id", "code", unique=True),
    )

    def __repr__(self) -> str:
        return f"<Warehouse(id={self.id!r}, code={self.code!r})>"


class StockLocation(TenantMixin, ModelBase):
    __tablename__ = "xstock_locations"

    warehouse_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("xstock_warehouses.id"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    location_type: Mapped[LocationType] = mapped_column(
        SqlEnum(LocationType), nullable=False, default=LocationType.STOCK_INTERNAL
    )
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("xstock_locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (
        Index("idx_xstock_location_tenant_warehouse_code", "tenant_id", "warehouse_id", "code", unique=True),
    )

    def __repr__(self) -> str:
        return f"<StockLocation(id={self.id!r}, code={self.code!r})>"
