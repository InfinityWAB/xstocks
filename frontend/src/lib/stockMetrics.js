// Règles UNIQUES des indicateurs de stock (calcul client en attendant un
// résumé serveur). Alignées sur le backend (xstock/tasks/thresholds.py).
//
// Définitions :
//  - Quantité d'un produit = Σ levels.availableQuantity (stock PHYSIQUE, tous
//    entrepôts/lots ; le backend garantit availableQuantity >= reservedQuantity,
//    donc le réservé est inclus dans cette quantité, jamais soustrait ni ajouté).
//  - Quantité libre = quantité - Σ reservedQuantity (information, pas une règle d'alerte).
//  - STOCK BAS : produit ACTIF, avec seuil `minThreshold` renseigné (> 0), et
//    quantité STRICTEMENT inférieure au seuil (pile au seuil = pas bas, comme
//    l'alerte quotidienne serveur). Sans seuil (null/0) : jamais bas.
//    La même fonction sert à l'échelle produit (tous entrepôts) ou entrepôt :
//    on lui passe la quantité de la portée voulue.
//  - VALEUR DU STOCK : Σ max(0, quantité) x coût unitaire, où coût unitaire =
//    level.averageCost si présent (CMUP), sinon product.purchasePrice, sinon 0.
//    Produits inactifs INCLUS (le stock physique existe encore) ; les lignes
//    sans coût connu sont comptées dans `unpriced` pour ne pas mentir en silence.
//    COÛTS MASQUÉS (pas de droit `costs:read`) : coût = null côté serveur. La valeur
//    n'est alors PAS calculée (null, jamais 0 ni somme partielle) : `costsHidden: true`.

import { costsDenied } from './costs.js'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function isLowStock(product, quantity) {
  if (!product || product.isActive === false) return false
  const t = product.minThreshold
  if (typeof t !== 'number' || !(t > 0)) return false
  return num(quantity) < t
}

export function quantityByProduct(levels) {
  const m = new Map()
  for (const l of levels ?? []) m.set(l.productId, (m.get(l.productId) ?? 0) + num(l.availableQuantity))
  return m
}

export function reservedByProduct(levels) {
  const m = new Map()
  for (const l of levels ?? []) m.set(l.productId, (m.get(l.productId) ?? 0) + num(l.reservedQuantity))
  return m
}

export function lowStockProducts(products, levels) {
  const qty = quantityByProduct(levels)
  return (products ?? []).filter(p => isLowStock(p, qty.get(p.id) ?? 0))
}

export function unitCost(level, product) {
  if (typeof level?.averageCost === 'number' && level.averageCost >= 0) return level.averageCost
  return num(product?.purchasePrice)
}

/**
 * Les coûts sont-ils masqués pour cet utilisateur ? `app.can('costs:read') === false`
 * fait foi. Sans API de droits, on déduit du contrat serveur (clé présente, valeur null)
 * quand AUCUN produit n'a de prix d'achat lisible et aucun niveau de coût moyen.
 */
export function resolveCostsHidden(app, products, levels) {
  if (costsDenied(app)) return true
  if (typeof app?.can === 'function') return false
  const ps = products ?? []
  if (ps.length === 0) return false
  return ps.every(p => p?.purchasePrice === null) && (levels ?? []).every(l => (l?.averageCost ?? null) === null)
}

export function stockValue(levels, products, { costsHidden = false } = {}) {
  if (costsHidden) return { value: null, unpriced: 0, hidden: true }
  const byId = new Map((products ?? []).map(p => [p.id, p]))
  let value = 0, unpriced = 0
  for (const l of levels ?? []) {
    const q = Math.max(0, num(l.availableQuantity))
    if (q === 0) continue
    const product = byId.get(l.productId)
    const cost = unitCost(l, product)
    if (cost === 0) unpriced += 1
    value += q * cost
  }
  return { value, unpriced }
}

// Statistiques par entrepôt : Map(warehouseId -> { skus:Set, units, value, alerts:Set }).
//  - skus/units : uniquement les quantités > 0.
//  - value : même règle que stockValue (coût CMUP, sinon prix d'achat).
//  - alerts : produits en stock bas DANS cet entrepôt (quantité cumulée de tous
//    ses lots/emplacements < seuil), comme l'alerte quotidienne du serveur, qui
//    raisonne par entrepôt sur tout niveau existant (même à 0).
export function warehouseStats(levels, products, { costsHidden = false } = {}) {
  const byId = new Map((products ?? []).map(p => [p.id, p]))
  const perWh = new Map()
  const qtyKey = new Map()
  for (const l of levels ?? []) {
    const stats = perWh.get(l.warehouseId) ?? { skus: new Set(), units: 0, value: costsHidden ? null : 0, alerts: new Set() }
    perWh.set(l.warehouseId, stats)
    const q = num(l.availableQuantity)
    const k = l.warehouseId + '\u0000' + l.productId
    qtyKey.set(k, (qtyKey.get(k) ?? 0) + q)
    if (q > 0) {
      stats.skus.add(l.productId)
      stats.units += q
      if (!costsHidden) stats.value += q * unitCost(l, byId.get(l.productId))
    }
  }
  for (const [k, q] of qtyKey) {
    const [wid, pid] = k.split('\u0000')
    if (isLowStock(byId.get(pid), q)) perWh.get(wid).alerts.add(pid)
  }
  return perWh
}
