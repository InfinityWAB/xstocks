"""Non-régression : un mouvement de stock exige une quantité finie > 0.

Sans ce garde, `issue(quantity=-5)` appelait `-quantity` et créait du stock.
La base est volontairement None : l'erreur doit être levée avant tout accès.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.services.exceptions import InvalidQuantityError  # noqa: E402
from src.services.movement import StockMovementService  # noqa: E402

BAD = [0, -1, -0.5, float("nan"), float("inf"), float("-inf"), True, None, "5"]


def _svc() -> StockMovementService:
    return StockMovementService(None, "t1")


@pytest.mark.asyncio
@pytest.mark.parametrize("qty", BAD)
async def test_receive_refuse_quantite_invalide(qty):
    with pytest.raises(InvalidQuantityError):
        await _svc().receive(product_id="p", warehouse_id="w", quantity=qty, created_by="u")


@pytest.mark.asyncio
@pytest.mark.parametrize("qty", BAD)
async def test_issue_refuse_quantite_invalide(qty):
    with pytest.raises(InvalidQuantityError):
        await _svc().issue(product_id="p", warehouse_id="w", quantity=qty, created_by="u")


@pytest.mark.asyncio
@pytest.mark.parametrize("qty", BAD)
async def test_transfer_refuse_quantite_invalide(qty):
    with pytest.raises(InvalidQuantityError):
        await _svc().transfer(
            product_id="p", source_warehouse_id="a", destination_warehouse_id="b",
            quantity=qty, created_by="u",
        )


def test_invalid_quantity_est_une_valueerror():
    assert issubclass(InvalidQuantityError, ValueError)
