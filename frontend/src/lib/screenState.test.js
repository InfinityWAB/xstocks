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
  assert.equal(r.offline, false); assert.ok(r.error)
})
test('classifyError : « permission » dans le message n’implique pas 403', () => {
  const r = classifyError({ status: 400, message: 'Permission inconnue ou inactive' }, true)
  assert.equal(r.forbidden, false)
  assert.equal(classifyError(new Error('forbidden resource name'), true).forbidden, false)
  assert.equal(classifyError(new Error('code 403 dans le texte'), true).forbidden, false)
})
test('classifyError : 403 explicite (statut ou code) reste « accès refusé »', () => {
  assert.equal(classifyError({ status: 403, message: 'x' }, true).forbidden, true)
  assert.equal(classifyError({ response: { status: 403 }, message: 'x' }, true).forbidden, true)
  assert.equal(classifyError({ code: 'FORBIDDEN', message: 'x' }, true).forbidden, true)
})
test('classifyError : le message affiché est lisible, jamais le brut (trace, SQL)', () => {
  const raw = 'psycopg2.errors.UndefinedTable: relation "x" does not exist\n  File "/app/a.py", line 3\nSELECT * FROM x'
  const r = classifyError({ status: 500, message: raw }, true)
  assert.ok(r.error)
  assert.ok(!r.error.includes('psycopg2') && !r.error.includes('SELECT') && !r.error.includes('File "'))
  assert.match(r.error, /500/)
  assert.ok(!classifyError(new Error(raw), true).error.includes('SELECT'))
})
