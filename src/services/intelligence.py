"""
IntelligenceService — orchestrates the pure algorithms in algorithms/ against
real repository data: reorder points, consumption forecast, ABC/XYZ
classification, stockout risk, consumption anomalies, inter-site transfer
suggestions.

This service only reads StockMove/StockLevel history and
writes back derived fields (Product.abc_class/xyz_class, TransferSuggestion
rows) — it never touches StockLevel itself (that stays StockMovementService's
job).

Demand source: StockMove rows of type OUT (true consumption/dispensation).
TRANSFER moves are excluded — they redistribute existing stock, they aren't
new demand. Lead times and unit prices belong to the future purchasing
module (not built yet) and are accepted as caller-supplied parameters here
rather than invented fields on Product.
"""
from __future__ import annotations

import statistics
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Optional

from ..algorithms.classification import XYZClassResult, classify_abc, classify_xyz
from ..algorithms.forecast import ForecastResult, forecast_for_class
from ..algorithms.reorder import reorder_point, safety_stock, z_score_for_service_level
from ..algorithms.stockout import stockout_risk
from ..algorithms.transfer import SiteStockPosition, suggest_transfers
from ..models.enums import StockMoveType, TransferSuggestionStatus
from ..models.pharma import TransferSuggestion
from ..repositories.movement import StockLevelRepository, StockMoveRepository
from ..repositories.pharma import TransferSuggestionRepository
from ..repositories.product import ProductRepository, WarehouseRepository
from ..schemas.pharma import TransferSuggestionResponse
from .exceptions import InsufficientDemandHistoryError, ProductNotFoundError

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from xcore.services.database.adapters.async_sql import AsyncSQLAdapter as DatabaseService


def _as_utc(dt: datetime) -> datetime:
    """SQLite (dev) drops tzinfo on read-back; assume naive datetimes are UTC."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class IntelligenceService:
    def __init__(self, db: "DatabaseService", tenant_id: str) -> None:
        self._db = db
        self.tenant_id = tenant_id

    # ── Demand history ───────────────────────────────────────

    async def _bucketed_demand(
        self,
        session: "AsyncSession",
        product_id: str,
        warehouse_id: Optional[str],
        *,
        bucket_days: int,
        num_buckets: int,
        end: Optional[datetime] = None,
    ) -> list[float]:
        """
        OUT-move quantities grouped into `num_buckets` consecutive windows of
        `bucket_days` days each, oldest first, zero-filled for silent periods.
        """
        end = end or datetime.now(timezone.utc)
        start = end - timedelta(days=bucket_days * num_buckets)

        # SQLite (dev) drops tzinfo on read-back — filter in Python against
        # tz-normalized datetimes rather than pushing since/until to the DB,
        # to avoid comparing aware vs. naive values there.
        moves = await StockMoveRepository(session).list_by_product(product_id, self.tenant_id)
        moves = [m for m in moves if m.type == StockMoveType.OUT]
        if warehouse_id is not None:
            moves = [m for m in moves if m.warehouse_id == warehouse_id]

        buckets = [0.0] * num_buckets
        for move in moves:
            move_date = _as_utc(move.move_date)
            if not (start <= move_date <= end):
                continue
            offset_days = (move_date - start).total_seconds() / 86400
            bucket_index = int(offset_days // bucket_days)
            if 0 <= bucket_index < num_buckets:
                buckets[bucket_index] += move.quantity
        return buckets

    # ── Reorder point / safety stock (spec §3.2-a) ──────────────

    async def compute_reorder_point(
        self,
        product_id: str,
        warehouse_id: str,
        *,
        lead_time_days: float,
        service_level: float = 0.95,
        history_days: int = 90,
    ) -> dict:
        async with self._db.session() as session:
            product = await ProductRepository(session).get(product_id, self.tenant_id)
            if product is None:
                raise ProductNotFoundError(product_id)

            daily = await self._bucketed_demand(
                session, product_id, warehouse_id, bucket_days=1, num_buckets=history_days
            )
            if sum(1 for d in daily if d > 0) < 2:
                raise InsufficientDemandHistoryError(product_id, sum(1 for d in daily if d > 0), 2)

            avg_daily_demand = statistics.mean(daily)
            demand_std_dev = statistics.stdev(daily)
            z = z_score_for_service_level(service_level)
            ss = safety_stock(z, demand_std_dev, lead_time_days)
            rp = reorder_point(avg_daily_demand, lead_time_days, ss)

            return {
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "avg_daily_demand": avg_daily_demand,
                "demand_std_dev": demand_std_dev,
                "service_level": service_level,
                "lead_time_days": lead_time_days,
                "safety_stock": ss,
                "reorder_point": rp,
            }

    # ── Consumption forecast (spec §3.2-b) ──────────────────────

    async def forecast_consumption(
        self,
        product_id: str,
        warehouse_id: Optional[str] = None,
        *,
        periods: int = 12,
        period_days: int = 7,
    ) -> ForecastResult:
        async with self._db.session() as session:
            product = await ProductRepository(session).get(product_id, self.tenant_id)
            if product is None:
                raise ProductNotFoundError(product_id)

            history = await self._bucketed_demand(
                session, product_id, warehouse_id, bucket_days=period_days, num_buckets=periods
            )
            if len(history) < 2 or all(v == 0 for v in history):
                raise InsufficientDemandHistoryError(product_id, sum(1 for v in history if v > 0), 2)

            xyz = classify_xyz(history)
            return forecast_for_class(history, xyz)

    # ── ABC/XYZ classification (spec §3.2-c) ────────────────────

    async def classify_products(
        self,
        *,
        history_days: int = 90,
        price_by_product: Optional[dict[str, float]] = None,
        persist: bool = True,
    ) -> dict[str, dict]:
        """
        Classifies every active product. ABC is value-based: uses
        price_by_product[product_id] * consumed_quantity when a price map is
        supplied (unit prices live in the future purchasing module), falling
        back to consumed quantity as the value proxy otherwise — documented,
        not a silent approximation.
        """
        async with self._db.session() as session:
            product_repo = ProductRepository(session)
            products = await product_repo.list_active(self.tenant_id)

            consumed_value: dict[str, float] = {}
            xyz_by_product: dict[str, XYZClassResult] = {}

            for product in products:
                daily = await self._bucketed_demand(
                    session, product.id, None, bucket_days=1, num_buckets=history_days
                )
                total_qty = sum(daily)
                if total_qty <= 0:
                    continue
                price = (price_by_product or {}).get(product.id, 1.0)
                consumed_value[product.id] = total_qty * price
                if sum(1 for d in daily if d > 0) >= 2:
                    xyz_by_product[product.id] = classify_xyz(daily)

            abc_by_product = classify_abc(consumed_value)

            if persist:
                for product in products:
                    abc = abc_by_product.get(product.id)
                    xyz = xyz_by_product.get(product.id)
                    if abc is None and xyz is None:
                        continue
                    patch = {}
                    if abc is not None:
                        patch["abc_class"] = abc.abc_class
                    if xyz is not None:
                        patch["xyz_class"] = xyz.xyz_class
                    await product_repo.update(product, **patch)
                await session.commit()

            return {
                product_id: {
                    "abc": abc_by_product.get(product_id),
                    "xyz": xyz_by_product.get(product_id),
                }
                for product_id in set(abc_by_product) | set(xyz_by_product)
            }

    # ── Stockout risk (spec §3.2-f) ──────────────────────────────

    async def stockout_risks(
        self,
        warehouse_id: str,
        *,
        lead_time_days_by_product: dict[str, float],
        default_lead_time_days: float = 7.0,
        history_days: int = 30,
    ) -> list[dict]:
        async with self._db.session() as session:
            level_repo = StockLevelRepository(session)
            levels = await level_repo.list_by_warehouse(warehouse_id, self.tenant_id)

            totals: dict[str, float] = {}
            for level in levels:
                totals[level.product_id] = totals.get(level.product_id, 0.0) + level.available_quantity

            results: list[dict] = []
            for product_id, current_stock in totals.items():
                daily = await self._bucketed_demand(
                    session, product_id, warehouse_id, bucket_days=1, num_buckets=history_days
                )
                forecast_daily_demand = statistics.mean(daily) if daily else 0.0
                lead_time = lead_time_days_by_product.get(product_id, default_lead_time_days)
                risk = stockout_risk(current_stock, forecast_daily_demand, lead_time)
                results.append({"product_id": product_id, "current_stock": current_stock, **risk.__dict__})

            criticality_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
            results.sort(key=lambda r: criticality_rank.get(r["criticality"], 99))
            return results

    # ── Inter-site transfer suggestions (spec §3.2-j) ────────────

    async def generate_transfer_suggestions(
        self,
        *,
        lead_time_days_by_product: dict[str, float],
        default_lead_time_days: float = 7.0,
        service_level: float = 0.95,
        history_days: int = 90,
    ) -> list[TransferSuggestionResponse]:
        async with self._db.session() as session:
            product_repo = ProductRepository(session)
            warehouse_repo = WarehouseRepository(session)
            level_repo = StockLevelRepository(session)

            products = await product_repo.list_active(self.tenant_id)
            warehouses = await warehouse_repo.list(self.tenant_id, limit=1000)

            created: list[TransferSuggestionResponse] = []

            for product in products:
                lead_time = lead_time_days_by_product.get(product.id, default_lead_time_days)
                positions: list[SiteStockPosition] = []

                for warehouse in warehouses:
                    levels = await level_repo.list_by_product(product.id, self.tenant_id)
                    stock = sum(
                        lv.available_quantity for lv in levels if lv.warehouse_id == warehouse.id
                    )

                    daily = await self._bucketed_demand(
                        session, product.id, warehouse.id, bucket_days=1, num_buckets=history_days
                    )
                    if sum(1 for d in daily if d > 0) < 2:
                        continue
                    avg = statistics.mean(daily)
                    std = statistics.stdev(daily)
                    z = z_score_for_service_level(service_level)
                    rp = reorder_point(avg, lead_time, safety_stock(z, std, lead_time))

                    positions.append(
                        SiteStockPosition(
                            site_id=warehouse.id, available_quantity=stock, reorder_point=rp,
                            max_threshold=product.max_threshold,
                        )
                    )

                if len(positions) < 2:
                    continue

                for proposal in suggest_transfers(positions):
                    suggestion = await TransferSuggestionRepository(session).save(
                        TransferSuggestion(
                            tenant_id=self.tenant_id,
                            product_id=product.id,
                            source_site_id=proposal.source_site_id,
                            destination_site_id=proposal.destination_site_id,
                            suggested_quantity=proposal.quantity,
                            reason=proposal.reason,
                            status=TransferSuggestionStatus.SUGGESTED,
                        )
                    )
                    created.append(TransferSuggestionResponse.model_validate(suggestion))

            await session.commit()
            return created
