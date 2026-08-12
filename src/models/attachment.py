from __future__ import annotations

from sqlalchemy import Enum as SqlEnum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Index

from .base import ModelBase, TenantMixin
from .enums import AttachmentOwnerType


class Attachment(TenantMixin, ModelBase):
    """
    Metadata for a file stored through the shared ext.storage extension
    (see extensions/xstorage). This table only tracks *which* file belongs
    to *which* xstock entity — the actual bytes live in the storage backend
    (local/S3/R2/Supabase), keyed by `namespace`/`stored_name`.

    Typical uses: batch label PDFs, cold-chain incident photos, inventory
    count sheets, controlled-substance register exports, product datasheets.
    """

    __tablename__ = "xstock_attachments"

    owner_type: Mapped[AttachmentOwnerType] = mapped_column(SqlEnum(AttachmentOwnerType), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # ext.storage identifiers — namespace convention: "xstock/{owner_type}/{owner_id}"
    file_id: Mapped[str] = mapped_column(String(64), nullable=False)
    namespace: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(512), nullable=False)

    original_name: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)

    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False)

    __table_args__ = (
        Index("idx_xstock_attachment_tenant_owner", "tenant_id", "owner_type", "owner_id"),
        Index("idx_xstock_attachment_tenant_file", "tenant_id", "file_id", unique=True),
    )

    def __repr__(self) -> str:
        return f"<Attachment(id={self.id!r}, owner_type={self.owner_type!r}, owner_id={self.owner_id!r})>"
