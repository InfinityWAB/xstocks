import test from 'node:test'
import assert from 'node:assert/strict'
import { isLowStock, lowStockProducts, stockValue, quantityByProduct, warehouseStats } from './stockMetrics.js'

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
