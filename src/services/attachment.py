"""
AttachmentService — uploads/downloads files through the shared ext.storage
extension and tracks their metadata in the xstock `Attachment` table.

The storage backend itself is blob-only (no ORM) — see extensions/xstorage.
This service is the xstock-side owner of "which file belongs to which
xstock entity" (batch label, cold-chain incident photo, inventory sheet...).

Namespace convention: "xstock/{owner_type}/{owner_id}" — scopes files per
plugin and per owning entity so nothing collides with xform's or another
plugin's files sharing the same backend.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from ..models.attachment import Attachment
from ..models.enums import AttachmentOwnerType
from ..repositories.attachment import AttachmentRepository
from ..schemas.attachment import AttachmentResponse
from .exceptions import AttachmentContentMissingError, AttachmentNotFoundError

if TYPE_CHECKING:
    from extensions.xstorage.main import StorageService
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService


def _namespace(owner_type: AttachmentOwnerType, owner_id: str) -> str:
    return f"xstock/{owner_type.value}/{owner_id}"


class AttachmentService:
    def __init__(self, db: "DatabaseService", tenant_id: str, storage: "StorageService") -> None:
        self._db = db
        self.tenant_id = tenant_id
        self._storage = storage

    # ── Upload / download / delete ──────────────────────────

    async def upload(
        self,
        *,
        owner_type: AttachmentOwnerType,
        owner_id: str,
        content: bytes,
        filename: str,
        uploaded_by: str,
    ) -> AttachmentResponse:
        """
        Raises FileTooLargeError / FileTypeNotAllowedError / FileStorageError
        (extensions.xstorage.uploader) on validation failure — propagated
        as-is, they're already the right level of detail for callers.
        """
        namespace = _namespace(owner_type, owner_id)
        uploaded = await self._storage.save(content, filename, namespace)

        async with self._db.session() as session:
            attachment = await AttachmentRepository(session).save(
                Attachment(
                    tenant_id=self.tenant_id,
                    owner_type=owner_type,
                    owner_id=owner_id,
                    file_id=uploaded.file_id,
                    namespace=namespace,
                    stored_name=uploaded.stored_name,
                    original_name=uploaded.original_name,
                    size_bytes=uploaded.size_bytes,
                    mime_type=uploaded.mime_type,
                    uploaded_by=uploaded_by,
                )
            )
            await session.commit()
        return AttachmentResponse.model_validate(attachment)

    async def download(self, attachment_id: str) -> tuple[bytes, AttachmentResponse]:
        async with self._db.session() as session:
            attachment = await AttachmentRepository(session).get(attachment_id, self.tenant_id)
            if attachment is None:
                raise AttachmentNotFoundError(attachment_id)
            response = AttachmentResponse.model_validate(attachment)

        content = await self._storage.read(response.file_id, response.namespace, response.stored_name)
        if content is None:
            raise AttachmentContentMissingError(attachment_id)
        return content, response

    async def delete(self, attachment_id: str) -> None:
        async with self._db.session() as session:
            repo = AttachmentRepository(session)
            attachment = await repo.get(attachment_id, self.tenant_id)
            if attachment is None:
                raise AttachmentNotFoundError(attachment_id)

            await self._storage.delete(attachment.file_id, attachment.namespace, attachment.stored_name)
            await repo.delete(attachment)
            await session.commit()

    # ── Read ─────────────────────────────────────────────────

    async def list_for_owner(
        self, owner_type: AttachmentOwnerType, owner_id: str
    ) -> list[AttachmentResponse]:
        async with self._db.session() as session:
            attachments = await AttachmentRepository(session).list_for_owner(
                owner_type, owner_id, self.tenant_id
            )
            return [AttachmentResponse.model_validate(a) for a in attachments]

    async def get(self, attachment_id: str) -> AttachmentResponse:
        async with self._db.session() as session:
            attachment = await AttachmentRepository(session).get(attachment_id, self.tenant_id)
            if attachment is None:
                raise AttachmentNotFoundError(attachment_id)
            return AttachmentResponse.model_validate(attachment)
