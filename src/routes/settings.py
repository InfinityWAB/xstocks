from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Request, status
from xcore.sdk import require_permission

from ..models.enums import AlertType
from ..schemas.settings import (
    AlertSubscriptionResponse,
    AlertSubscriptionUpsert,
    StockSettingsResponse,
    StockSettingsUpdate,
)
from .deps import settings_svc

_r = require_permission("xstock:settings:read")
_w = require_permission("xstock:settings:write")


def build_settings_router(db) -> APIRouter:
    router = APIRouter(tags=["xstock-settings"])

    @router.get("/", response_model=StockSettingsResponse, dependencies=[Depends(_r)])
    async def get_settings(request: Request) -> StockSettingsResponse:
        return await settings_svc(db, request).get_settings()

    @router.patch("/", response_model=StockSettingsResponse, dependencies=[Depends(_w)])
    async def update_settings(request: Request, body: StockSettingsUpdate) -> StockSettingsResponse:
        return await settings_svc(db, request).update_settings(body)

    @router.get(
        "/alert-subscriptions", response_model=List[AlertSubscriptionResponse], dependencies=[Depends(_r)]
    )
    async def list_alert_subscriptions(request: Request) -> List[AlertSubscriptionResponse]:
        return await settings_svc(db, request).list_alert_subscriptions()

    @router.put(
        "/alert-subscriptions", response_model=AlertSubscriptionResponse, dependencies=[Depends(_w)]
    )
    async def upsert_alert_subscription(
        request: Request, body: AlertSubscriptionUpsert
    ) -> AlertSubscriptionResponse:
        return await settings_svc(db, request).upsert_alert_subscription(body)

    @router.delete(
        "/alert-subscriptions/{alert_type}", status_code=status.HTTP_200_OK, dependencies=[Depends(_w)]
    )
    async def delete_alert_subscription(alert_type: AlertType, request: Request) -> dict:
        await settings_svc(db, request).delete_alert_subscription(alert_type)
        return {"status": "ok", "reverted_to_default": alert_type.value}

    return router
