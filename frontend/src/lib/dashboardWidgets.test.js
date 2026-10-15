import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TODO_ROWS, lowStockSummary, lowStockTodoRows, movementsTrend, STOCK_ROUTE,
} from './dashboardWidgets.js'

const P = (id, name, minThreshold, extra = {}) => ({ id, name, minThreshold, isActive: true, unit: 'u', ...extra })
const L = (productId, q, extra = {}) => ({ productId, warehouseId: 'w1', availableQuantity: q, reservedQuantity: 0, ...extra })

// ── Indicateur « Stock bas » ──────────────────────────────────────────────────

test('produit sans seuil : jamais bas, même à 0', () => {
  const s = lowStockSummary([P('a', 'A', undefined), P('b', 'B', 0), P('c', 'C', null)], [L('a', 0)])
  assert.equal(s.count, 0)
  assert.equal(s.state, 'good')
})

test('quantité = seuil : pas bas ; juste dessous : bas', () => {
  assert.equal(lowStockSummary([P('a', 'A', 5)], [L('a', 5)]).count, 0)
  assert.equal(lowStockSummary([P('a', 'A', 5)], [L('a', 4)]).count, 1)
})

test('produit inactif exclu', () => {
  assert.equal(lowStockSummary([P('a', 'A', 5, { isActive: false })], [L('a', 0)]).count, 0)
})

test('quantités cumulées sur tous les entrepôts et lots', () => {
  const s = lowStockSummary([P('a', 'A', 10)], [L('a', 6), L('a', 5, { warehouseId: 'w2' })])
  assert.equal(s.count, 0)
})

test('rupture : état « bad », détail « dont N en rupture »', () => {
  const s = lowStockSummary([P('a', 'A', 5), P('b', 'B', 5), P('c', 'C', 5)], [L('a', 0), L('b', 2), L('c', 9)])
  assert.equal(s.count, 2)
  assert.equal(s.ruptures, 1)
  assert.equal(s.state, 'bad')
  assert.equal(s.hint, 'dont 1 en rupture')
})

test('sous seuil sans rupture : état « watch »', () => {
  const s = lowStockSummary([P('a', 'A', 5)], [L('a', 2)])
  assert.equal(s.state, 'watch')
  assert.equal(s.ruptures, 0)
  assert.equal(s.hint, 'Aucun produit en rupture')
})

test('produit à seuil sans aucun niveau = rupture', () => {
  const s = lowStockSummary([P('a', 'A', 5)], [])
  assert.equal(s.count, 1)
  assert.equal(s.ruptures, 1)
})

test('aucun produit à surveiller : état « good », valeur 0', () => {
  const s = lowStockSummary([P('a', 'A', 5)], [L('a', 50)])
  assert.deepEqual([s.count, s.state, s.value], [0, 'good', '0'])
})

test('données vides ou absentes : 0, sans erreur', () => {
  assert.equal(lowStockSummary([], []).count, 0)
  assert.equal(lowStockSummary(null, undefined).count, 0)
})

test('aucune valeur ni coût dans le résumé', () => {
  const s = lowStockSummary([P('a', 'A', 5, { purchasePrice: 999 })], [L('a', 1, { averageCost: 777 })])
  const txt = JSON.stringify(s)
  assert.ok(!/999|777|FCFA|valeur|coût/i.test(txt))
})

// ── Lignes « À traiter » ──────────────────────────────────────────────────────

test('tri : ruptures d’abord, puis sous seuil, puis par nom', () => {
  const products = [P('1', 'Zinc', 5), P('2', 'Aspirine', 5), P('3', 'Paracétamol', 5), P('4', 'Bêta', 5)]
  const levels = [L('1', 0), L('2', 1), L('3', 0), L('4', 2)]
  const rows = lowStockTodoRows(products, levels)
  assert.deepEqual(rows.map(r => r.title), ['Paracétamol', 'Zinc', 'Aspirine', 'Bêta'])
})

test('ligne : urgence, détail, action de navigation, sans coût', () => {
  const [r] = lowStockTodoRows([P('1', 'Gants', 10, { unit: 'boîte', purchasePrice: 1234 })], [L('1', 0)])
  assert.equal(r.id, 'stock-low:1')
  assert.equal(r.due.urgent, true)
  assert.equal(r.due.text, 'Rupture')
  assert.match(r.detail, /0 boîte/)
  assert.match(r.detail, /seuil 10/)
  assert.deepEqual(r.actions.map(a => a.route), [STOCK_ROUTE])
  assert.equal(r.actions[0].run, undefined)
  assert.ok(!JSON.stringify(r).includes('1234'))
})

test('sous seuil : non urgent, priorité moins forte que la rupture', () => {
  const rows = lowStockTodoRows([P('1', 'A', 10), P('2', 'B', 10)], [L('1', 3), L('2', 0)])
  const byId = Object.fromEntries(rows.map(r => [r.id, r]))
  assert.equal(byId['stock-low:1'].due.urgent, false)
  assert.ok(byId['stock-low:2'].priority < byId['stock-low:1'].priority)
})

test('plafond de lignes', () => {
  const products = Array.from({ length: 40 }, (_, i) => P(String(i), `P${String(i).padStart(2, '0')}`, 5))
  assert.equal(lowStockTodoRows(products, []).length, MAX_TODO_ROWS)
  assert.equal(lowStockTodoRows(products, [], { max: 3 }).length, 3)
})

test('le plafond garde les plus graves', () => {
  const products = [P('a', 'Aaa', 5), P('z', 'Zzz', 5)]
  const rows = lowStockTodoRows(products, [L('a', 2), L('z', 0)], { max: 1 })
  assert.equal(rows[0].title, 'Zzz')
})

test('rien à traiter ou données vides : liste vide', () => {
  assert.deepEqual(lowStockTodoRows([], []), [])
  assert.deepEqual(lowStockTodoRows(undefined, undefined), [])
  assert.deepEqual(lowStockTodoRows([P('a', 'A', 5, { isActive: false })], []), [])
})

test('nom manquant : repli sur le code puis sur l’identifiant', () => {
  const rows = lowStockTodoRows([{ id: 'x', code: 'C-1', minThreshold: 5, isActive: true }, { id: 'y', minThreshold: 5, isActive: true }], [])
  assert.deepEqual(rows.map(r => r.title).sort(), ['C-1', 'y'])
})

// ── Tendance des mouvements ───────────────────────────────────────────────────

const NOW = new Date(2026, 9, 14, 15, 0, 0) // 14 oct. 2026, heure locale
const day = (offset, h = 10) => new Date(2026, 9, 14 - offset, h, 0, 0).toISOString()
const M = (offset, id = Math.random()) => ({ id: String(id) + offset, moveDate: day(offset), type: 'out', quantity: 1 })

test('14 points, le dernier = aujourd’hui', () => {
  const t = movementsTrend([M(0, 'a'), M(0, 'b'), M(13, 'c'), M(14, 'd')], NOW)
  assert.equal(t.series.current.length, 14)
  assert.equal(t.series.current[13], 2)
  assert.equal(t.series.current[0], 1)
  assert.equal(t.series.previous.length, 14)
  assert.equal(t.series.previous[13], 1) // jour -14
  assert.equal(t.value, '3')
})

test('période précédente : 14 jours avant, comparaison en texte', () => {
  const cur = [M(1, 'a'), M(2, 'b'), M(3, 'c')]
  const prev = [M(15, 'd')]
  const t = movementsTrend([...cur, ...prev], NOW)
  assert.equal(t.delta.direction, 'up')
  assert.match(t.delta.text, /\+2/)
})

test('baisse et stabilité', () => {
  assert.equal(movementsTrend([M(1, 'a'), M(15, 'b'), M(16, 'c')], NOW).delta.direction, 'down')
  assert.equal(movementsTrend([M(1, 'a'), M(15, 'b')], NOW).delta.direction, 'flat')
})

test('mouvements hors fenêtre ou sans date valide ignorés', () => {
  const t = movementsTrend([M(1, 'a'), { id: 'x', moveDate: 'pas une date' }, { id: 'y' }, M(40, 'z'), { id: 'f', moveDate: day(-3) }], NOW)
  assert.equal(t.value, '1')
})

test('aucun mouvement sur 28 jours : série vide, rien d’inventé', () => {
  const t = movementsTrend([], NOW)
  assert.deepEqual(t.series.current, [])
  assert.equal(t.series.previous, undefined)
  assert.equal(t.value, undefined)
  assert.equal(movementsTrend(null, NOW).series.current.length, 0)
})

test('historique tronqué : on ne fabrique pas de courbe', () => {
  const t = movementsTrend([M(1, 'a'), M(2, 'b')], NOW, { truncated: true })
  assert.deepEqual(t.series.current, [])
  assert.equal(t.value, undefined)
})

test('pas de tendance sans mouvement dans les 14 jours même si la période précédente en a', () => {
  const t = movementsTrend([M(20, 'a')], NOW)
  assert.equal(t.series.previous.length, 14)
  assert.equal(t.series.current.reduce((s, v) => s + v, 0), 0)
  assert.equal(t.value, '0')
})

test('le titre ne mentionne ni valeur ni coût', () => {
  assert.ok(!/valeur|coût|FCFA/i.test(movementsTrend([M(1, 'a')], NOW).title))
})

// ── Aucun coût divulgué, même quand les champs de coût existent ──────────────
test('widgets : aucune valeur de coût dans les sorties (coûts renseignés ou null)', () => {
  const costs = { purchasePrice: 123456, averageCost: 987654 }
  const products = [P('a', 'A', 5, costs), P('b', 'B', 5, { purchasePrice: null })]
  const levels = [L('a', 1, { averageCost: 987654 }), L('b', 0, { averageCost: null })]
  const out = JSON.stringify([lowStockSummary(products, levels), lowStockTodoRows(products, levels)])
  assert.doesNotMatch(out, /123|456|987|654|NaN|undefined|null/)
})
