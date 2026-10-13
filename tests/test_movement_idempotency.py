"""Idempotence de receive()/issue() via idempotency_key (vraie base SQLite async).

source_reference seul ne sert PAS de clé : xsales (SO:<n>), xpurchase (GRN:<n>),
xfleet (Vehicle:<id>) le réutilisent pour des opérations légitimement répétées.
"""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.models import Product, StockLevel, StockMove, Warehouse  # noqa: E402
from src.models.base import ModelBase  # noqa: E402
from src.models.movement import ValuationLayer  # noqa: E402
from src.services.exceptions import InsufficientStockError  # noqa: E402
from src.services.movement import StockMovementService  # noqa: E402

T = "t1"


class Db:
    def __init__(self, maker):
        self._maker = maker

    @asynccontextmanager
    async def session(self):
        async with self._maker() as s:
            yield s


@pytest_asyncio.fixture
async def env():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(ModelBase.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s, s.begin():
        s.add_all([
            Product(id="p1", tenant_id=T, code="P1", name="P1", purchase_price=2.0),
            Product(id="p2", tenant_id=T, code="P2", name="P2", purchase_price=3.0),
            Product(id="plot", tenant_id=T, code="PL", name="Lot", is_lot_tracked=True),
            Warehouse(id="w1", tenant_id=T, code="W1", name="W1"),
        ])
    yield StockMovementService(Db(maker), T), maker
    await engine.dispose()


async def _count(maker, **filters):
    async with maker() as s:
        q = select(func.count()).select_from(StockMove).where(StockMove.tenant_id == T)
        for k, v in filters.items():
            q = q.where(getattr(StockMove, k) == v)
        return (await s.execute(q)).scalar_one()


async def _qty(maker, product_id, batch_id=None):
    async with maker() as s:
        rows = (await s.execute(select(StockLevel).where(StockLevel.product_id == product_id))).scalars().all()
        return sum(l.available_quantity for l in rows if batch_id is None or l.batch_id == batch_id)


R = dict(warehouse_id="w1", created_by="u1", source_reference="GRN:1")


@pytest.mark.asyncio
async def test_double_receive_meme_cle_un_seul_mouvement(env):
    svc, maker = env
    a = await svc.receive(product_id="p1", quantity=10, idempotency_key="k1", **R)
    b = await svc.receive(product_id="p1", quantity=10, idempotency_key="k1", **R)
    assert a.id == b.id
    assert await _count(maker) == 1
    assert await _qty(maker, "p1") == 10
    async with maker() as s:
        assert (await s.execute(select(func.count()).select_from(ValuationLayer))).scalar_one() == 1


@pytest.mark.asyncio
async def test_double_issue_meme_cle(env):
    svc, maker = env
    await svc.receive(product_id="p1", quantity=10, **R)
    a = await svc.issue(product_id="p1", warehouse_id="w1", quantity=4, created_by="u", idempotency_key="s1")
    b = await svc.issue(product_id="p1", warehouse_id="w1", quantity=4, created_by="u", idempotency_key="s1")
    assert [m.id for m in a] == [m.id for m in b]
    assert await _count(maker) == 2
    assert await _qty(maker, "p1") == 6


@pytest.mark.asyncio
async def test_issue_multi_lots_rejoue_renvoie_tous_les_mouvements(env):
    svc, maker = env
    await svc.receive(product_id="plot", quantity=3, batch_number="A", **R)
    await svc.receive(product_id="plot", quantity=3, batch_number="B", **R)
    a = await svc.issue(product_id="plot", warehouse_id="w1", quantity=5, created_by="u", idempotency_key="s1")
    assert len(a) == 2
    b = await svc.issue(product_id="plot", warehouse_id="w1", quantity=5, created_by="u", idempotency_key="s1")
    assert [m.id for m in a] == [m.id for m in b]
    assert await _count(maker) == 4
    assert await _qty(maker, "plot") == 1


@pytest.mark.asyncio
async def test_meme_source_reference_produits_differents_deux_mouvements(env):
    svc, maker = env
    await svc.receive(product_id="p1", quantity=5, idempotency_key="k", **R)
    await svc.receive(product_id="p2", quantity=5, idempotency_key="k", **R)
    assert await _count(maker) == 2
    assert await _qty(maker, "p1") == 5 and await _qty(maker, "p2") == 5


@pytest.mark.asyncio
async def test_meme_source_reference_sans_cle_reste_non_dedoublonne(env):
    """Expéditions partielles successives (SO:<n>) ou pleins (Vehicle:<id>) : inchangé."""
    svc, maker = env
    await svc.receive(product_id="p1", quantity=10, **R)
    for _ in range(2):
        await svc.issue(product_id="p1", warehouse_id="w1", quantity=3, created_by="u", source_reference="SO:1")
    await svc.receive(product_id="p1", quantity=2, **R)
    assert await _count(maker) == 4
    assert await _qty(maker, "p1") == 6


@pytest.mark.asyncio
async def test_cles_differentes_deux_effets(env):
    svc, maker = env
    await svc.receive(product_id="p1", quantity=5, idempotency_key="k1", **R)
    await svc.receive(product_id="p1", quantity=5, idempotency_key="k2", **R)
    assert await _qty(maker, "p1") == 10


@pytest.mark.asyncio
async def test_course_insertion_concurrente_un_seul_effet(env):
    """Deux appels passent le contrôle de rejeu avant que l'autre ne commit :
    la contrainte unique + SAVEPOINT annule le 2e effet (niveau compris)."""
    svc, maker = env
    first = await svc.receive(product_id="p1", quantity=10, idempotency_key="k1", **R)

    real = svc._replay
    calls = {"n": 0}

    async def blind_first(session, key):
        calls["n"] += 1
        return [] if calls["n"] == 1 else await real(session, key)

    svc._replay = blind_first  # le 2e appel « ne voit pas » le mouvement du 1er
    second = await svc.receive(product_id="p1", quantity=10, idempotency_key="k1", **R)
    assert second.id == first.id
    assert await _count(maker) == 1
    assert await _qty(maker, "p1") == 10


@pytest.mark.asyncio
async def test_course_issue_ne_double_pas_la_sortie(env):
    svc, maker = env
    await svc.receive(product_id="p1", quantity=10, **R)
    first = await svc.issue(product_id="p1", warehouse_id="w1", quantity=4, created_by="u", idempotency_key="s")
    real = svc._replay
    calls = {"n": 0}

    async def blind_first(session, key):
        calls["n"] += 1
        return [] if calls["n"] == 1 else await real(session, key)

    svc._replay = blind_first
    second = await svc.issue(product_id="p1", warehouse_id="w1", quantity=4, created_by="u", idempotency_key="s")
    assert [m.id for m in second] == [m.id for m in first]
    assert await _qty(maker, "p1") == 6


@pytest.mark.asyncio
async def test_rejeu_apres_succes_ne_releve_pas_stock_insuffisant(env):
    svc, maker = env
    await svc.receive(product_id="p1", quantity=4, **R)
    await svc.issue(product_id="p1", warehouse_id="w1", quantity=4, created_by="u", idempotency_key="s")
    # Stock à 0 : sans idempotence le rejeu lèverait InsufficientStockError.
    again = await svc.issue(product_id="p1", warehouse_id="w1", quantity=4, created_by="u", idempotency_key="s")
    assert len(again) == 1
    with pytest.raises(InsufficientStockError):
        await svc.issue(product_id="p1", warehouse_id="w1", quantity=4, created_by="u", idempotency_key="autre")
