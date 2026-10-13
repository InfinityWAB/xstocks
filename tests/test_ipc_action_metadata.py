"""Chaque action IPC xstock déclare `side_effect`; aucune ne bloque l'IPC interne.

`permissions` est volontairement absent : les appels internes (xpos, xpurchase,
xassets, xfleet) n'ont pas de principal garanti et seraient refusés (fail-closed).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.ipc import IPCCommands  # noqa: E402

EXPECTED = {
    "ipc_product_get": "read",
    "ipc_product_list": "read",
    "ipc_product_update": "write",
    "ipc_warehouse_list": "read",
    "ipc_stock_receive": "write",
    "ipc_stock_issue": "write",
    "ipc_stock_levels": "read",
    "ipc_reorder_point_get": "read",
    "ipc_stockout_risk_list": "read",
}




def test_toutes_les_actions_sont_couvertes():
    declared = {n for n, f in vars(IPCCommands).items() if n.startswith("ipc_")}
    assert declared == set(EXPECTED)


@pytest.mark.parametrize("name,side_effect", EXPECTED.items())
def test_side_effect_declare(name, side_effect):
    assert getattr(IPCCommands, name)._xcore_action_side_effect == side_effect


@pytest.mark.parametrize("name", EXPECTED)
def test_pas_de_permissions_bloquant_l_ipc_interne(name):
    fn = getattr(IPCCommands, name)
    assert not getattr(fn, "_xcore_action_permissions", None)
    assert not getattr(fn, "_xcore_action_permission_groups", None)
