import test from 'node:test'
import assert from 'node:assert/strict'
import { isLowStock, lowStockProducts, stockValue, quantityByProduct, warehouseStats, resolveCostsHidden } from './stockMetrics.js'

const P = (o) => ({ id: 'p', isActive: true, minThreshold: 10, purchasePrice: 2, ...o })

test('sous le seuil = bas', () => assert.equal(isLowStock(P(), 9), true))
test('au seuil exact = pas bas (aligné serveur)', () => assert.equal(isLowStock(P(), 10), false))
test('sans seuil / seuil 0 = jamais bas', () => {
  assert.equal(isLowStock(P({ minThreshold: null }), 0), false)
  assert.equal(isLowStock(P({ minThreshold: 0 }), 0), false)
})
test('produit inactif = jamais bas', () => assert.equal(isLowStock(P({ isActive: false }), 0), false))
test('produit sans niveau = quantité 0 donc bas si seuil', () => {
  assert.equal(lowStockProducts([P()], []).length, 1)
})
test('KPI : compte les produits sous le seuil, pas ceux qui ont un seuil', () => {
  const products = [P({ id: 'a' }), P({ id: 'b' }), P({ id: 'c', minThreshold: null })]
  const levels = [{ productId: 'a', availableQuantity: 50 }, { productId: 'b', availableQuantity: 3 }]
  assert.deepEqual(lowStockProducts(products, levels).map(p => p.id), ['b'])
})
test('réservé inclus dans la quantité physique (pas soustrait)', () => {
  const levels = [{ productId: 'p', availableQuantity: 12, reservedQuantity: 8 }]
  assert.equal(quantityByProduct(levels).get('p'), 12)
  assert.equal(lowStockProducts([P()], levels).length, 0)
})
test('somme multi-entrepôts', () => {
  const levels = [{ productId: 'p', availableQuantity: 6 }, { productId: 'p', availableQuantity: 6 }]
  assert.equal(lowStockProducts([P()], levels).length, 0)
})
test('valeur : CMUP prioritaire, repli prix d’achat, inactif inclus, sans coût compté', () => {
  const products = [P({ id: 'a' }), P({ id: 'b', purchasePrice: null }), P({ id: 'c', isActive: false, purchasePrice: 5 })]
  const levels = [
    { productId: 'a', availableQuantity: 10, averageCost: 3 },
    { productId: 'a', availableQuantity: 10 },
    { productId: 'b', availableQuantity: 4 },
    { productId: 'c', availableQuantity: 2 },
    { productId: 'a', availableQuantity: -5 },
  ]
  assert.deepEqual(stockValue(levels, products), { value: 30 + 20 + 10, unpriced: 1 })
})
test('par entrepôt : cumul des lots, alerte par entrepôt, valeur', () => {
  const products = [P({ id: 'a', minThreshold: 10 })]
  const levels = [
    { warehouseId: 'w1', productId: 'a', availableQuantity: 4 },
    { warehouseId: 'w1', productId: 'a', availableQuantity: 4, averageCost: 5 },
    { warehouseId: 'w2', productId: 'a', availableQuantity: 50 },
    { warehouseId: 'w3', productId: 'a', availableQuantity: 0 },
  ]
  const m = warehouseStats(levels, products)
  assert.equal(m.get('w1').units, 8); assert.equal(m.get('w1').value, 4 * 2 + 4 * 5)
  assert.deepEqual([...m.get('w1').alerts], ['a'])   // 8 < 10 : bas dans w1
  assert.equal(m.get('w2').alerts.size, 0)
  assert.deepEqual([...m.get('w3').alerts], ['a'])   // niveau à 0 = bas, comme le serveur
  assert.equal(m.get('w3').skus.size, 0)
})

// ── Coûts masqués (sans costs:read : coûts à null) ───────────────────────────
const LV = (productId, q, o = {}) => ({ productId, warehouseId: 'w1', availableQuantity: q, averageCost: null, ...o })

test('stockValue : coûts masqués -> null, jamais 0 ni somme partielle', () => {
  const r = stockValue([LV('a', 5)], [P({ id: 'a', purchasePrice: null })], { costsHidden: true })
  assert.equal(r.value, null)
  assert.equal(r.hidden, true)
  assert.equal(r.unpriced, 0)
})
test('stockValue : comportement inchangé quand les coûts sont visibles', () => {
  const r = stockValue([LV('a', 5), LV('b', 2)], [P({ id: 'a' }), P({ id: 'b', purchasePrice: null })])
  assert.deepEqual(r, { value: 10, unpriced: 1 })
})
test('warehouseStats : valeur null si masqué, quantités intactes', () => {
  const m = warehouseStats([LV('a', 5)], [P({ id: 'a', purchasePrice: null })], { costsHidden: true })
  const st = m.get('w1')
  assert.equal(st.value, null)
  assert.equal(st.units, 5)
  assert.equal(st.skus.size, 1)
})
test('warehouseStats : valeur numérique sans option', () => {
  assert.equal(warehouseStats([LV('a', 5)], [P({ id: 'a' })]).get('w1').value, 10)
})
test('resolveCostsHidden : app.can fait foi, sinon déduit des null du contrat', () => {
  const masked = [P({ id: 'a', purchasePrice: null })]
  assert.equal(resolveCostsHidden({ can: () => false }, [P()], []), true)
  assert.equal(resolveCostsHidden({ can: () => true }, masked, [LV('a', 1)]), false)
  assert.equal(resolveCostsHidden({}, masked, [LV('a', 1)]), true)
  assert.equal(resolveCostsHidden({}, [P()], []), false)
  assert.equal(resolveCostsHidden({}, [], []), false)
  assert.equal(resolveCostsHidden({}, [P({ id: 'a', purchasePrice: undefined })], []), false)
  assert.equal(resolveCostsHidden({}, masked, [LV('a', 1, { averageCost: 3 })]), false)
})
