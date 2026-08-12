from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from xcore.sdk import require_permission

from ..models.enums import AttachmentOwnerType
from ..schemas.attachment import AttachmentResponse
from ..services.exceptions import AttachmentContentMissingError, AttachmentNotFoundError
from extensions.xstorage.uploader import FileStorageError, FileTooLargeError, FileTypeNotAllowedError
from .deps import actor_dep, attachment_svc

_r = require_permission("xstock:attachments:read")
_w = require_permission("xstock:attachments:write")

_404 = HTTPException(status.HTTP_404_NOT_FOUND, detail="Attachment not found")


def build_attachments_router(db, storage=None) -> APIRouter:
    router = APIRouter(tags=["xstock-attachments"])

    @router.post(
        "/", response_model=AttachmentResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(_w)]
    )
    async def upload(
        request: Request,
        owner_type: AttachmentOwnerType = Form(..., alias="ownerType"),
        owner_id: str = Form(..., alias="ownerId"),
        file: UploadFile = File(...),
        actor: str = Depends(actor_dep),
    ) -> AttachmentResponse:
        content = await file.read()
        if not content:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty file.")
        try:
            return await attachment_svc(db, request, storage).upload(
                owner_type=owner_type,
                owner_id=owner_id,
                content=content,
                filename=file.filename or "upload",
                uploaded_by=actor,
            )
        except FileTooLargeError as exc:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail=str(exc))
        except FileTypeNotAllowedError as exc:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc))
        except FileStorageError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    @router.get(
        "/by-owner/{owner_type}/{owner_id}", response_model=List[AttachmentResponse],
        dependencies=[Depends(_r)],
    )
    async def list_for_owner(
        owner_type: AttachmentOwnerType, owner_id: str, request: Request
    ) -> List[AttachmentResponse]:
        return await attachment_svc(db, request, storage).list_for_owner(owner_type, owner_id)

    @router.get("/{attachment_id}", response_model=AttachmentResponse, dependencies=[Depends(_r)])
    async def get_attachment(attachment_id: str, request: Request) -> AttachmentResponse:
        try:
            return await attachment_svc(db, request, storage).get(attachment_id)
        except AttachmentNotFoundError:
            raise _404

    @router.get("/{attachment_id}/download", dependencies=[Depends(_r)])
    async def download(attachment_id: str, request: Request) -> Response:
        try:
            content, meta = await attachment_svc(db, request, storage).download(attachment_id)
        except AttachmentNotFoundError:
            raise _404
        except AttachmentContentMissingError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
        return Response(
            content=content,
            media_type=meta.mime_type,
            headers={"Content-Disposition": f'attachment; filename="{meta.original_name}"'},
        )

    @router.delete("/{attachment_id}", dependencies=[Depends(_w)])
    async def delete_attachment(attachment_id: str, request: Request) -> dict:
        try:
            await attachment_svc(db, request, storage).delete(attachment_id)
        except AttachmentNotFoundError:
            raise _404
        return {"status": "ok", "deleted": attachment_id}

    return router
