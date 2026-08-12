# xstock — frontend

Plugin FasoOrchestra ERP : gestion de stock multi-entrepôts.
Pendant client du plugin backend xcore qui occupe la racine de ce dépôt.

## Build

```bash
npm install
npm run build      # produit dist/main.js
npm run dev        # rebuild en continu
```

---

## ⚠ Deux implémentations coexistent — décision à prendre

Le dossier `src/` contient **deux versions du même module**, dont une seule est
livrée.

| | Volume | Statut |
|---|---|---|
| `src/main.jsx` | 3 140 l. | **C'est ce que le build produit** (`lib.entry`) |
| `src/plugin.ts` + `pages/` + `types.ts` + `widgets/` + `components/` | 1 610 l. | **Jamais compilé, jamais livré** |

`src/index.ts` exporte proprement la seconde, mais rien ne la construit.

Ce n'est pas « du code pas encore branché » : la branche TypeScript est
**structurellement incompatible** avec le shell.

- Elle appelle `fetch()` directement (`pages/products.tsx`), ce que la CSP du
  shell interdit (`connect-src 'self' ipc:`) et qui contournerait l'injection
  du JWT côté Rust.
- Elle vise `/api/xstock` quand `main.jsx` vise `/app/xstock`.
- Elle importe `lucide-react` et `@tanstack/react-query`, absents des
  dépendances déclarées — elle ne compilerait pas.
- Elle déclare 6 routes `/stock/*` quand `main.jsx` en déclare 1 (`/stock`).

Les deux ne décrivent pas le même produit. **Il faut trancher** : soit
supprimer la branche TypeScript, soit la porter réellement sur l'AppAPI et
abandonner `main.jsx`. Tout est conservé ici en attendant la décision.

---

## Anomalies connues

À traiter avant toute mise en service. Détail dans l'audit du shell
(`audite.md`, dépôt erp-Orchestra).

**Permissions de manifest invalides.** `plugin.ts` déclare
`permissions: ['stock:read', 'stock:write']`. Ce ne sont pas des *capacités* :
le kernel n'en connaît que six (`api:read`, `api:write`, `files`, `clipboard`,
`notifications`, `shell:open`). Le filtre renvoie un ensemble vide et, le mode
strict étant actif, **tout appel API lève une `CapabilityError`**. Il faut
`['api:read', 'api:write', 'files']` — `files` étant requis par les pièces
jointes.

**Signature de `upload()` décalée.** `main.jsx` appelle
`app.upload(path, filePath, 'file', { ownerType, ownerId })` alors que le SDK
déclare `upload(path, field?, extraFields?)` — trois paramètres. Le quatrième
argument est ignoré : `ownerType` et `ownerId` ne partent jamais.

**`createPortal` indisponible.** Le shell expose `window.__ERP_RUNTIME__` sans
`ReactDOM` : les modales retombent sur un rendu en place, ce qui casse
l'empilement et le verrouillage du scroll.

**Versions divergentes.** `package.json` annonce `0.2.0`, le manifest `0.1.0`,
et un log en dur `v0.2.0`. L'identifiant hésite entre `stock` (manifest) et
`xstock` (routes et registre).

---

## SDK

Le module déclare `@infintywab/plugin-sdk` ([`InfinityWAB/ersdk`](https://github.com/InfinityWAB/ersdk)),
qui porte le contrat entre le shell et les plugins : types de l'`AppAPI`, du
`Manifest`, constantes (`EVENTS`, `STORE_KEYS`) et helpers.

`definePlugin` en provient désormais, au lieu d'être réimplémenté localement.
Le SDK n'a aucune dépendance à l'exécution, il est donc simplement inclus dans
le bundle — la taille de sortie est inchangée.

Toute évolution du contrat passe par une version du SDK : le modifier depuis
son dépôt, publier (`npm version minor && git push --follow-tags`), puis relever
la plage ici. Un type absent du paquet signale un trou dans la surface publique
du SDK — à corriger en amont, jamais en atteignant ses sources par un chemin
relatif.

## Runtime

React n'est pas embarqué : il est fourni par le shell via
`window.__ERP_RUNTIME__`. Un plugin Vite maison retire les imports React et
préfixe le chunk des hooks utilisés.

Ce préfixe ne déclare que `useState`, `useEffect`, `useMemo`, `useCallback`,
`useRef` et `Fragment`. **Tout autre hook provoque un `ReferenceError` à
l'exécution** — l'ajouter au préfixe dans `vite.config.js` avant de l'utiliser.

`rollupOptions.external` est vide alors que le contrat du shell demande
d'externaliser `react`, `react-dom` et `@faso-erp/plugin-sdk` ; le préfixe
maison en tient lieu. À reprendre le jour où le module consommera le SDK.
