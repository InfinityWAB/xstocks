import test from 'node:test'
import assert from 'node:assert/strict'
import { screenKind, classifyError } from './screenState.js'

test('screenKind : les 6 états', () => {
  assert.equal(screenKind({ forbidden: true, data: [1] }), 'forbidden')
  assert.equal(screenKind({ loading: true, data: [] }), 'loading')
  assert.equal(screenKind({ data: null }), 'loading')
  assert.equal(screenKind({ error: 'boom', data: [] }), 'error')
  assert.equal(screenKind({ error: 'boom', offline: true, data: [] }), 'offline')
  assert.equal(screenKind({ data: [] }), 'empty')
  assert.equal(screenKind({ data: [{ id: 1 }] }), 'ready')
})
test('erreur sans donnée n’est jamais « empty »', () => {
  assert.notEqual(screenKind({ error: 'x', data: [] }), 'empty')
})
test('rafraîchissement en échec avec données déjà là : on garde l’écran', () => {
  assert.equal(screenKind({ error: 'x', data: [1] }), 'ready')
})
test('classifyError', () => {
  assert.deepEqual(classifyError(null), { error: null, offline: false, forbidden: false })
  assert.equal(classifyError({ status: 403, message: 'x' }).forbidden, true)
  assert.equal(classifyError(new Error('Failed to fetch'), true).offline, true)
  assert.equal(classifyError(new Error('boom'), false).offline, true)
  const r = classifyError(new Error('Erreur 500'), true)
  assert.equal(r.offline, false); assert.equal(r.error, 'Erreur 500')
})
