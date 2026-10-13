"""Mise à niveau défensive du schéma xstock (le plugin n'a pas d'Alembic).

create_all() ne modifie jamais une table existante : sur une base antérieure à
l'idempotence des mouvements, xstock_moves n'a pas les colonnes
idempotency_key / idempotency_rank et toute requête ORM sur StockMove échouerait.
Idempotent : ne fait rien si le schéma est déjà à jour. Équivalent versionné :
migrations/2026-10-xstock-moves-idempotency.sql.
"""
from __future__ import annotations

from sqlalchemy import inspect, text
from xcore.sdk import get_logger

logger = get_logger("xstock.schema_upgrade")

_TABLE = "xstock_moves"
_INDEX = "uq_xstock_move_tenant_idempotency"
_COLUMNS = {"idempotency_key": "VARCHAR(64)", "idempotency_rank": "INTEGER"}


def _upgrade(sync_conn) -> list[str]:
    insp = inspect(sync_conn)
    if not insp.has_table(_TABLE):
        return []
    done: list[str] = []
    existing = {c["name"] for c in insp.get_columns(_TABLE)}
    for name, ddl in _COLUMNS.items():
        if name not in existing:
            sync_conn.execute(text(f"ALTER TABLE {_TABLE} ADD COLUMN {name} {ddl}"))
            done.append(f"column:{name}")
    if _INDEX not in {i["name"] for i in insp.get_indexes(_TABLE)}:
        sync_conn.execute(text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS {_INDEX} "
            f"ON {_TABLE} (tenant_id, idempotency_key, idempotency_rank)"
        ))
        done.append(f"index:{_INDEX}")
    return done


async def ensure_move_idempotency_schema(engine) -> list[str]:
    """À appeler après create_all. Retourne la liste des changements appliqués."""
    async with engine.begin() as conn:
        done = await conn.run_sync(_upgrade)
    if done:
        logger.warning("xstock schema upgraded", table=_TABLE, applied=done)
    else:
        logger.info("xstock schema already up to date", table=_TABLE)
    return done
