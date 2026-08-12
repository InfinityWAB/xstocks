from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from xcore.sdk import require_permission

from ..schemas.intelligence import (
    ClassificationItem,
    ClassifyProductsRequest,
    ForecastResponse,
    ReorderPointResponse,
    StockoutRiskItem,
    StockoutRiskRequest,
    TransferSuggestionsRequest,
)
from ..schemas.pharma import TransferSuggestionResponse
from ..services.exceptions import (
    InsufficientDemandHistoryError,
    InvalidTransferSuggestionTransitionError,
    ProductNotFoundError,
    TransferSuggestionNotFoundError,
)
from .deps import actor_dep, intelligence_svc, transfer_suggestion_svc

_r = require_permission("xstock:intelligence:read")
_w = require_permission("xstock:intelligence:write")

_404 = HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
_404_suggestion = HTTPException(status.HTTP_404_NOT_FOUND, detail="Transfer suggestion not found")


def build_intelligence_router(db) -> APIRouter:
    router = APIRouter(tags=["xstock-intelligence"])

    @router.get("/reorder-point", response_model=ReorderPointResponse, dependencies=[Depends(_r)])
    async def reorder_point(
        request: Request,
        product_id: str = Query(alias="productId"),
        warehouse_id: str = Query(alias="warehouseId"),
        lead_time_days: float = Query(alias="leadTimeDays"),
        service_level: float = Query(default=0.95, alias="serviceLevel"),
        history_days: int = Query(default=90, alias="historyDays"),
    ) -> ReorderPointResponse:
        try:
            result = await intelligence_svc(db, request).compute_reorder_point(
                product_id, warehouse_id,
                lead_time_days=lead_time_days, service_level=service_level, history_days=history_days,
            )
        except ProductNotFoundError:
            raise _404
        except InsufficientDemandHistoryError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        return ReorderPointResponse(**result)

    @router.get("/forecast", response_model=ForecastResponse, dependencies=[Depends(_r)])
    async def forecast(
        request: Request,
        product_id: str = Query(alias="productId"),
        warehouse_id: Optional[str] = Query(default=None, alias="warehouseId"),
        periods: int = Query(default=12),
        period_days: int = Query(default=7, alias="periodDays"),
    ) -> ForecastResponse:
        try:
            result = await intelligence_svc(db, request).forecast_consumption(
                product_id, warehouse_id, periods=periods, period_days=period_days
            )
        except ProductNotFoundError:
            raise _404
        except InsufficientDemandHistoryError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
        return ForecastResponse(method=result.method, forecast=result.forecast, trend=result.trend)

    @router.post("/classify", response_model=Dict[str, ClassificationItem], dependencies=[Depends(_w)])
    async def classify_products(
        request: Request, body: ClassifyProductsRequest
    ) -> Dict[str, ClassificationItem]:
        result = await intelligence_svc(db, request).classify_products(
            history_days=body.history_days, price_by_product=body.price_by_product, persist=body.persist
        )
        return {
            product_id: ClassificationItem(
                abc=classes["abc"].abc_class.value if classes["abc"] else None,
                xyz=classes["xyz"].xyz_class.value if classes["xyz"] else None,
            )
            for product_id, classes in result.items()
        }

    @router.post("/stockout-risk", response_model=List[StockoutRiskItem], dependencies=[Depends(_r)])
    async def stockout_risk(request: Request, body: StockoutRiskRequest) -> List[StockoutRiskItem]:
        results = await intelligence_svc(db, request).stockout_risks(
            body.warehouse_id,
            lead_time_days_by_product=body.lead_time_days_by_product,
            default_lead_time_days=body.default_lead_time_days,
            history_days=body.history_days,
        )
        return [StockoutRiskItem(**r) for r in results]

    @router.post(
        "/transfer-suggestions", response_model=List[TransferSuggestionResponse], dependencies=[Depends(_w)]
    )
    async def transfer_suggestions(
        request: Request, body: TransferSuggestionsRequest
    ) -> List[TransferSuggestionResponse]:
        return await intelligence_svc(db, request).generate_transfer_suggestions(
            lead_time_days_by_product=body.lead_time_days_by_product,
            default_lead_time_days=body.default_lead_time_days,
            service_level=body.service_level,
            history_days=body.history_days,
        )

    @router.get(
        "/transfer-suggestions/pending", response_model=List[TransferSuggestionResponse],
        dependencies=[Depends(_r)],
    )
    async def list_pending_suggestions(request: Request) -> List[TransferSuggestionResponse]:
        return await transfer_suggestion_svc(db, request).list_pending()

    @router.get(
        "/transfer-suggestions/by-product/{product_id}", response_model=List[TransferSuggestionResponse],
        dependencies=[Depends(_r)],
    )
    async def list_suggestions_for_product(
        product_id: str, request: Request
    ) -> List[TransferSuggestionResponse]:
        return await transfer_suggestion_svc(db, request).list_for_product(product_id)

    @router.post(
        "/transfer-suggestions/{suggestion_id}/approve", response_model=TransferSuggestionResponse,
        dependencies=[Depends(_w)],
    )
    async def approve_suggestion(suggestion_id: str, request: Request) -> TransferSuggestionResponse:
        try:
            return await transfer_suggestion_svc(db, request).approve(suggestion_id)
        except TransferSuggestionNotFoundError:
            raise _404_suggestion
        except InvalidTransferSuggestionTransitionError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.post(
        "/transfer-suggestions/{suggestion_id}/reject", response_model=TransferSuggestionResponse,
        dependencies=[Depends(_w)],
    )
    async def reject_suggestion(suggestion_id: str, request: Request) -> TransferSuggestionResponse:
        try:
            return await transfer_suggestion_svc(db, request).reject(suggestion_id)
        except TransferSuggestionNotFoundError:
            raise _404_suggestion
        except InvalidTransferSuggestionTransitionError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    @router.post(
        "/transfer-suggestions/{suggestion_id}/execute", response_model=TransferSuggestionResponse,
        dependencies=[Depends(_w)],
    )
    async def execute_suggestion(
        suggestion_id: str, request: Request, actor: str = Depends(actor_dep)
    ) -> TransferSuggestionResponse:
        try:
            return await transfer_suggestion_svc(db, request).execute(suggestion_id, created_by=actor)
        except TransferSuggestionNotFoundError:
            raise _404_suggestion
        except InvalidTransferSuggestionTransitionError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    return router
