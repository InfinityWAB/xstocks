from __future__ import annotations

from pydantic import BaseModel, Field

from ..models.enums import AttachmentOwnerType
from .base import CAMEL

# ---------------------------------------------------------------------------
# Attachment
# ---------------------------------------------------------------------------
# There is no AttachmentCreate: attachments are created by the service layer
# after a successful ext.storage upload (multipart file, not JSON), never
# directly from a client-supplied DB row.


class AttachmentResponse(BaseModel):
    model_config = CAMEL

    id: str
    tenant_id: str

    owner_type: AttachmentOwnerType
    owner_id: str

    file_id: str
    namespace: str
    stored_name: str

    original_name: str
    size_bytes: int
    mime_type: str

    uploaded_by: str


class AttachmentUploadRequest(BaseModel):
    """Non-file fields accompanying a multipart upload (owner_type/owner_id come from the route)."""

    model_config = CAMEL

    owner_type: AttachmentOwnerType
    owner_id: str = Field(..., min_length=1)
