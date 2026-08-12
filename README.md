# xstock

Plugin xcore — gestion de stock multi-entrepôts avec intelligence (le dépôt distant s'appelle `xstocks`, le plugin lui-même `xstock`).

FEFO/FIFO/LIFO, points de commande, prévisions, classification ABC/XYZ, détection d'anomalies, registre stupéfiants.

## Dépendances

```yaml
requires:
  - name: auth
    version: ">=1.0.0"
```

`auth` doit être chargé en premier (déclaration RBAC via `rbac.declare`). Plusieurs autres plugins (`xpos`, `xpurchase`, `xassets`, `xfleet`, `xsales`) consomment `xstock.stock.issue`/`xstock.stock.receive` en IPC pour leurs mouvements de stock.

## Ce que fait le plugin

- **Mouvements de stock** — entrée/sortie avec verrouillage `StockLevel` (évite les lost updates entre plugins consommateurs concurrents).
- **Méthodes de valorisation** — FEFO/FIFO/LIFO selon configuration.
- **Points de commande & prévisions** — seuils de réapprovisionnement, projection de consommation.
- **Classification ABC/XYZ** — segmentation des références par valeur/variabilité.
- **Détection d'anomalies** — écarts de consommation ou de mouvement inhabituels.
- **Registre stupéfiants** — double signature avec vérification d'identité (witness_id) sur les mouvements sensibles.

## Structure

```
src/
├── main.py            point d'entrée xcore (Plugin)
├── ipc.py               actions IPC exposées (stock.issue, stock.receive…)
├── permissions.py         définitions RBAC du plugin
├── algorithms/            FEFO/FIFO/LIFO, prévisions, classification ABC/XYZ
├── events/                 événements domaine
├── models/                 StockLevel, Movement, Warehouse…
├── repositories/            accès données
├── routes/                   API HTTP
├── schemas/                   contrats Pydantic
├── services/                   logique métier
└── tasks/                      tâches planifiées (alertes, prévisions)
```
