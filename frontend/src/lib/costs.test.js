import test from 'node:test'
import assert from 'node:assert/strict'
import { formatMaybeCost, sumOrNull, anyCost, hasCost, costsDenied, costActionMessage, COST_ACTION_DENIED } from './costs.js'

test('formatMaybeCost : masqué -> tiret, jamais NaN/undefined/0', () => {
  for (const v of [null, undefined, NaN, Infinity, 'abc', {}]) {
    assert.equal(formatMaybeCost(v), '—')
    assert.equal(formatMaybeCost(v, { currency: 'FCFA' }), '—')
  }
})
test('formatMaybeCost : vrai zéro, négatif, devise absente, grand nombre', () => {
  assert.equal(formatMaybeCost(0), '0')
  assert.equal(formatMaybeCost(0, { currency: 'FCFA' }), '0 FCFA')
  assert.match(formatMaybeCost(-1500), /^[-−]1\s500$/u)
  assert.equal(formatMaybeCost(12), '12')
  assert.match(formatMaybeCost(1234567890123), /^1\s234\s567\s890\s123$/u)
  assert.match(formatMaybeCost(1500, { currency: 'FCFA' }), /^1\s500 FCFA$/u)
  assert.equal(formatMaybeCost(12.3456, { maximumFractionDigits: 0 }), '12')
})
test('sumOrNull : null si un seul terme est masqué', () => {
  assert.equal(sumOrNull([1, 2, 3]), 6)
  assert.equal(sumOrNull([1, null, 3]), null)
  assert.equal(sumOrNull([undefined]), null)
  assert.equal(sumOrNull([NaN, 1]), null)
  assert.equal(sumOrNull([]), 0)
  assert.equal(sumOrNull(null), 0)
  assert.equal(sumOrNull([0, 0]), 0)
  assert.equal(sumOrNull([5, -5]), 0)
  assert.equal(sumOrNull([1e15, 1e15]), 2e15)
})
test('anyCost / hasCost', () => {
  assert.equal(anyCost([null, undefined]), false)
  assert.equal(anyCost([]), false)
  assert.equal(anyCost([null, 0]), true)
  assert.equal(hasCost(0), true)
  assert.equal(hasCost(null), false)
})
test('costsDenied : seulement si app.can répond false', () => {
  assert.equal(costsDenied({ can: () => false }), true)
  assert.equal(costsDenied({ can: (p) => p === 'costs:read' }), false)
  assert.equal(costsDenied({}), false)
  assert.equal(costsDenied(undefined), false)
  assert.equal(costsDenied({ can: () => { throw new Error('x') } }), false)
  assert.equal(costsDenied({ can: () => undefined }), false)
})
test('costActionMessage : 403 -> message lisible, 500/réseau -> null', () => {
  assert.equal(costActionMessage({ status: 403 }), COST_ACTION_DENIED)
  assert.equal(costActionMessage({ code: 'permission_denied' }), COST_ACTION_DENIED)
  assert.equal(costActionMessage({ status: 500 }), null)
  assert.equal(costActionMessage(new Error('Failed to fetch')), null)
  assert.equal(costActionMessage(null), null)
})
test('costActionMessage : 403 alors que le droit est présent -> pas de faux message', () => {
  assert.equal(costActionMessage({ status: 403 }, { can: () => true }), null)
  assert.equal(costActionMessage({ status: 403 }, { can: () => false }), COST_ACTION_DENIED)
  assert.equal(costActionMessage({ status: 403 }, { can: () => { throw new Error('x') } }), COST_ACTION_DENIED)
})
