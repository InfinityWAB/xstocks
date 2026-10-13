"""Non-régression : la cible `call_plugin` doit être le `name` du manifest du
plugin d'authentification ("auth"), pas "xauth" (espace de noms des actions).

Le loader indexe les handlers par `manifest.name` et le superviseur renvoie
`not_found` pour toute autre cible : aucun alias "xauth" n'existe.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.services.alert import AlertRecipients, AlertService  # noqa: E402
from src.services.movement import StockMovementService  # noqa: E402

AUTH_TARGET = "auth"


class Recorder:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, plugin, action, payload=None):
        self.calls.append((plugin, action))
        if action == "xauth.tenant_access":
            return {"has_access": True}
        if action == "xauth.get_user":
            return {"user": {"email": "u@x.io", "is_active": True}}
        if action == "xauth.users.list.tenant":
            return {"users": [{"id": "u1", "email": "u1@x.io"}]}
        if action == "xauth.has_permission":
            return {"has_permission": True}
        return {}


@pytest.mark.asyncio
async def test_alert_user_ids_cible_auth():
    rec = Recorder()
    svc = AlertService("t1", rec)
    await svc._resolve_recipients(AlertRecipients(user_ids=["u1"]))
    assert rec.calls
    assert {p for p, _ in rec.calls} == {AUTH_TARGET}


@pytest.mark.asyncio
async def test_alert_membres_utilise_action_existante():
    rec = Recorder()
    svc = AlertService("t1", rec)
    out = await svc._resolve_recipients(AlertRecipients(permission="stock:read"))
    assert {p for p, _ in rec.calls} == {AUTH_TARGET}
    assert ("auth", "xauth.users.list.tenant") in rec.calls
    assert all(a != "xauth.get_tenant_members" for _, a in rec.calls)
    assert out == [{"user_id": "u1", "email": "u1@x.io"}]


@pytest.mark.asyncio
async def test_movement_temoin_cible_auth():
    rec = Recorder()
    svc = StockMovementService(None, "t1", call_plugin=rec)
    await svc._validate_witness("w", "actor")
    assert rec.calls == [(AUTH_TARGET, "xauth.tenant_access")]
