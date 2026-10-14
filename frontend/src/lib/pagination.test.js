import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllPages, truncationNotice } from './pagination.js'

const source = (n) => async ({ limit, offset }) =>
  Array.from({ length: Math.max(0, Math.min(limit, n - offset)) }, (_, i) => offset + i)

test('3 pages', async () => {
  const r = await fetchAllPages(source(25), { pageSize: 10, maxPages: 10 })
  assert.equal(r.items.length, 25); assert.equal(r.pages, 3); assert.equal(r.truncated, false)
})
test('page exacte : une page vide finale lève l’ambiguïté', async () => {
  const r = await fetchAllPages(source(20), { pageSize: 10, maxPages: 10 })
  assert.equal(r.items.length, 20); assert.equal(r.pages, 3); assert.equal(r.truncated, false)
})
test('vide', async () => {
  const r = await fetchAllPages(source(0), { pageSize: 10 })
  assert.deepEqual(r, { items: [], truncated: false, pages: 1 })
})
test('null du serveur = vide', async () => {
  const r = await fetchAllPages(async () => null, { pageSize: 10 })
  assert.equal(r.items.length, 0)
})
test('erreur en cours de route : propagée', async () => {
  let n = 0
  await assert.rejects(fetchAllPages(async (p) => { if (++n === 2) throw new Error('500'); return source(100)(p) }, { pageSize: 10 }), /500/)
})
test('borne atteinte : truncated', async () => {
  const r = await fetchAllPages(source(1000), { pageSize: 10, maxPages: 3 })
  assert.equal(r.items.length, 30); assert.equal(r.truncated, true)
  assert.match(truncationNotice(r.items.length, r.truncated, 'produits'), /limité aux 30 premiers produits/)
  assert.equal(truncationNotice(5, false), null)
})
test('dédoublonnage par clé, la fin de liste reste basée sur la page brute', async () => {
  const pages = [[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], [{ id: 4 }]]
  let i = 0
  const r = await fetchAllPages(async () => pages[i++], { pageSize: 2, key: x => x.id })
  assert.deepEqual(r.items.map(x => x.id), [1, 2, 3, 4]); assert.equal(r.truncated, false)
})
