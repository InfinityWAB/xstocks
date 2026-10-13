"""Le filtre `role_id` des alertes résout les destinataires via l'action
existante `xauth.member.list_roles` ({tenant_id, user_id} -> {role_ids}),
puisque `xauth.users.list.tenant` ne renvoie pas de rôle."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.services.alert import AlertRecipients, AlertService  # noqa: E402

ROLES = {"u1": ["r1", "r9"], "u2": ["r2"], "u3": []}


class FakeAuth:
    def __init__(self, fail_for=()):
        self.calls = []
        self.fail_for = set(fail_for)

    async def __call__(self, plugin, action, payload=None):
        self.calls.append((plugin, action, dict(payload or {})))
        if action == "xauth.users.list.tenant":
            return {"users": [{"id": u, "email": f"{u}@x.io"} for u in ROLES]}
        if action == "xauth.member.list_roles":
            if payload["user_id"] in self.fail_for:
                raise RuntimeError("boom")
            return {"role_ids": ROLES[payload["user_id"]]}
        return {}


@pytest.mark.asyncio
async def test_filtre_role_id_retourne_les_membres_du_role():
    fake = FakeAuth()
    out = await AlertService("t1", fake)._resolve_recipients(AlertRecipients(role_id="r1"))
    assert out == [{"user_id": "u1", "email": "u1@x.io"}]


@pytest.mark.asyncio
async def test_filtre_role_id_scope_tenant_et_cible_auth():
    fake = FakeAuth()
    await AlertService("t1", fake)._resolve_recipients(AlertRecipients(role_id="r2"))
    role_calls = [c for c in fake.calls if c[1] == "xauth.member.list_roles"]
    assert len(role_calls) == len(ROLES)
    assert all(p == "auth" and pl["tenant_id"] == "t1" for p, _, pl in role_calls)


@pytest.mark.asyncio
async def test_filtre_role_id_ignore_un_membre_en_erreur():
    fake = FakeAuth(fail_for={"u1"})
    out = await AlertService("t1", fake)._resolve_recipients(AlertRecipients(role_id="r2"))
    assert [m["user_id"] for m in out] == ["u2"]


@pytest.mark.asyncio
async def test_filtre_role_id_inconnu_donne_liste_vide():
    out = await AlertService("t1", FakeAuth())._resolve_recipients(AlertRecipients(role_id="zz"))
    assert out == []
