-- xstock : idempotence des mouvements (receive/issue avec idempotency_key).
-- PostgreSQL et SQLite. Rejouable : sous PostgreSQL IF NOT EXISTS partout;
-- sous SQLite ADD COLUMN n'a pas IF NOT EXISTS (ne l'exécuter qu'une fois, ou
-- laisser src/schema_upgrade.py le faire au chargement du plugin).
-- Les lignes existantes gardent NULL : aucun doublon possible.

-- PostgreSQL
ALTER TABLE xstock_moves ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);
ALTER TABLE xstock_moves ADD COLUMN IF NOT EXISTS idempotency_rank INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS uq_xstock_move_tenant_idempotency
    ON xstock_moves (tenant_id, idempotency_key, idempotency_rank);

-- SQLite (remplacer les 2 ALTER ci-dessus)
-- ALTER TABLE xstock_moves ADD COLUMN idempotency_key VARCHAR(64);
-- ALTER TABLE xstock_moves ADD COLUMN idempotency_rank INTEGER;
