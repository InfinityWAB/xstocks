// Logique PURE des widgets génériques du tableau de bord (contrat du shell :
// indicateur, « À traiter », tendance). Aucun React, aucun réseau.
//
// Règle de fond : une seule définition du « stock bas » (lib/stockMetrics.js).
// Aucun widget ne divulgue de valeur de stock ni de coût : la permission
// `costs:read` n'est pas encore exigée côté modules.
import { isLowStock, quantityByProduct } from './stockMetrics.js'

/** Seul écran existant du module (les onglets sont internes à la page). */
export const STOCK_ROUTE = '/stock'
export const MAX_TODO_ROWS = 12
export const TREND_DAYS = 14

const PRIORITY_RUPTURE = 10
const PRIORITY_LOW = 20
const fmt = (n) => Number(n).toLocaleString('fr-FR')
const byName = (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })

// Produits actifs strictement sous seuil, avec quantité et gravité.
function lowProducts(products, levels) {
  const qty = quantityByProduct(levels)
  const out = []
  for (const p of products ?? []) {
    const q = qty.get(p.id) ?? 0
    if (!isLowStock(p, q)) continue
    out.push({ product: p, quantity: q, rupture: q <= 0 })
  }
  return out
}

export function lowStockSummary(products, levels) {
  const low = lowProducts(products, levels)
  const count = low.length
  const ruptures = low.filter(l => l.rupture).length
  const state = ruptures > 0 ? 'bad' : count > 0 ? 'watch' : 'good'
  const hint = count === 0
    ? 'Tous les produits actifs sont au-dessus de leur seuil'
    : ruptures === 0 ? 'Aucun produit en rupture' : `dont ${ruptures} en rupture`
  return { count, ruptures, state, value: fmt(count), unit: count > 1 ? 'produits' : 'produit', hint }
}

export function lowStockTodoRows(products, levels, { max = MAX_TODO_ROWS } = {}) {
  return lowProducts(products, levels)
    .map(({ product: p, quantity, rupture }) => ({
      id: `stock-low:${p.id}`,
      title: p.name || p.code || String(p.id),
      detail: `${fmt(Math.max(0, quantity))} ${p.unit || 'u'} en stock · seuil ${fmt(p.minThreshold)}`,
      due: rupture ? { text: 'Rupture', urgent: true } : { text: 'Sous le seuil', urgent: false },
      priority: rupture ? PRIORITY_RUPTURE : PRIORITY_LOW,
      actions: [{ label: 'Voir le stock', style: 'secondary', route: STOCK_ROUTE }],
      detailRoute: STOCK_ROUTE,
    }))
    .sort((a, b) => a.priority - b.priority || byName(a, b))
    .slice(0, Math.max(0, max))
}

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Mouvements par jour sur 14 jours (+ 14 jours précédents). `truncated` : la
// liste est incomplète, aucune courbe n'est fabriquée.
export function movementsTrend(moves, now = new Date(), { truncated = false } = {}) {
  const title = 'Mouvements de stock (14 jours)'
  const empty = { title, series: { current: [] } }
  if (truncated) return empty
  const current = new Array(TREND_DAYS).fill(0)
  const previous = new Array(TREND_DAYS).fill(0)
  const today = midnight(now)
  for (const m of moves ?? []) {
    const d = new Date(m?.moveDate)
    if (!m?.moveDate || Number.isNaN(d.getTime())) continue
    const diff = Math.round((today - midnight(d)) / 86400000)
    if (diff < 0 || diff >= 2 * TREND_DAYS) continue
    if (diff < TREND_DAYS) current[TREND_DAYS - 1 - diff] += 1
    else previous[2 * TREND_DAYS - 1 - diff] += 1
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0)
  const total = sum(current), prevTotal = sum(previous)
  if (total === 0 && prevTotal === 0) return empty
  const gap = total - prevTotal
  const direction = gap > 0 ? 'up' : gap < 0 ? 'down' : 'flat'
  const text = gap === 0 ? 'Stable vs 14 jours précédents' : `${gap > 0 ? '+' : '-'}${fmt(Math.abs(gap))} vs 14 jours précédents`
  return { title, value: fmt(total), unit: 'mouvements', delta: { text, direction }, state: 'none', series: { current, previous }, detailRoute: STOCK_ROUTE }
}
