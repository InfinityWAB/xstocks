import test from 'node:test'
import assert from 'node:assert/strict'
import {
  USE_EXPIRED_PERMISSION, SETTINGS_WRITE_PERMISSION, DEFAULT_EXPIRY_TIERS,
  daysUntil, batchState, sellableOf, sellableByProduct, sellableColumn,
  parseApiError, formatStockError, insufficientInfo,
  parseTiersInput, formatTiers, tiersFromSettings,
  canUseExpired, settingsLocked, issuePlan, expiredIssueProblem, validateExpiredIssue, buildExpiredIssue, formatDay,
} from './batches.js'

const NOW = new Date('2026-10-15T10:30:00Z')
const lvl = (o) => ({ productId: 'p', warehouseId: 'w', availableQuantity: 5, ...o })

/* ── daysUntil ── */
test('daysUntil : entier de jours en date UTC, pas d’heure', () => {
  assert.equal(daysUntil('2026-10-15', NOW), 0)
  assert.equal(daysUntil('2026-10-16', NOW), 1)
  assert.equal(daysUntil('2026-10-14', NOW), -1)
  assert.equal(daysUntil('2026-11-14', NOW), 30)
  assert.equal(daysUntil('2026-10-16T23:00:00', NOW), 1)
  assert.equal(daysUntil(new Date('2026-10-15T23:59:59Z'), new Date('2026-10-15T00:00:01Z')), 0)
})
test('daysUntil : valeur absente ou illisible = null', () => {
  for (const v of [null, undefined, '', 'demain', '2026-13-45', 42]) assert.equal(daysUntil(v, NOW), null)
})

/* ── batchState ── */
test('batchState : sans champ de lot (ancien serveur) = aucun badge', () => {
  assert.equal(batchState(lvl({}), { now: NOW }), null)
  assert.equal(batchState(null, { now: NOW }), null)
})
test('batchState : périmé par statut ou par date, texte + ton danger', () => {
  const a = batchState(lvl({ batchStatus: 'expired', expiryDate: '2026-12-01' }), { now: NOW })
  assert.equal(a.kind, 'expired'); assert.equal(a.label, 'Périmé'); assert.equal(a.tone, 'danger')
  const b = batchState(lvl({ batchStatus: 'active', expiryDate: '2026-10-14' }), { now: NOW })
  assert.equal(b.kind, 'expired'); assert.match(b.detail, /depuis 1 j/)
})
test('batchState : quarantaine', () => {
  const s = batchState(lvl({ batchStatus: 'quarantine', expiryDate: '2027-01-01' }), { now: NOW })
  assert.equal(s.kind, 'quarantine'); assert.equal(s.label, 'Quarantaine'); assert.equal(s.tone, 'warning')
})
test('batchState : quarantaine prime sur périmé (non sortable dans tous les cas)', () => {
  assert.equal(batchState(lvl({ batchStatus: 'quarantine', expiryDate: '2020-01-01' }), { now: NOW }).kind, 'quarantine')
})
test('batchState : « Expire dans N j » selon les paliers (défaut 90/30/7)', () => {
  const at = (d) => batchState(lvl({ batchStatus: 'active', expiryDate: d }), { now: NOW })
  const s = at('2026-10-27')
  assert.equal(s.kind, 'expiring'); assert.equal(s.label, 'Expire dans 12 j'); assert.equal(s.days, 12); assert.equal(s.tone, 'warning')
  assert.equal(at('2026-10-22').tone, 'danger') // 7 j = dernier palier
  assert.equal(at('2026-10-16').label, 'Expire dans 1 j')
  assert.equal(at('2026-10-15').label, 'Expire aujourd’hui')
  assert.equal(at('2026-10-15').kind, 'expiring') // échéance du jour encore vendable
  assert.equal(at('2027-01-13').kind, 'expiring') // 90 j pile
  assert.equal(at('2027-01-14').kind, 'ok') // 91 j : hors palier
  assert.equal(at('2027-01-14').label, null)
})
test('batchState : paliers personnalisés', () => {
  const s = batchState(lvl({ batchStatus: 'active', expiryDate: '2026-11-10' }), { now: NOW, tiers: [15, 5] })
  assert.equal(s.kind, 'ok') // 26 j > 15
  const t = batchState(lvl({ batchStatus: 'active', expiryDate: '2026-10-25' }), { now: NOW, tiers: [15, 5] })
  assert.equal(t.kind, 'expiring'); assert.equal(t.tone, 'warning')
  assert.equal(batchState(lvl({ batchStatus: 'active', expiryDate: '2026-10-18' }), { now: NOW, tiers: [15, 5] }).tone, 'danger')
})
test('batchState : paliers invalides = défaut', () => {
  const s = batchState(lvl({ batchStatus: 'active', expiryDate: '2026-10-27' }), { now: NOW, tiers: [] })
  assert.equal(s.kind, 'expiring')
})
test('batchState : lot actif sans date, ou épuisé', () => {
  assert.equal(batchState(lvl({ batchStatus: 'active', expiryDate: null }), { now: NOW }).kind, 'ok')
  const d = batchState(lvl({ batchStatus: 'depleted' }), { now: NOW })
  assert.equal(d.kind, 'depleted'); assert.equal(d.label, 'Épuisé')
})
test('batchState : statut inconnu ou casse différente tolérés', () => {
  assert.equal(batchState(lvl({ batchStatus: 'EXPIRED' }), { now: NOW }).kind, 'expired')
  assert.equal(batchState(lvl({ batchStatus: 'weird', expiryDate: null }), { now: NOW }).kind, 'ok')
})

/* ── vendable / total ── */
test('sellableOf : vendable fourni, sinon repli sur available', () => {
  assert.equal(sellableOf(lvl({ sellableQuantity: 2 })), 2)
  assert.equal(sellableOf(lvl({ sellableQuantity: 0 })), 0)
  assert.equal(sellableOf(lvl({})), 5)
  assert.equal(sellableOf(lvl({ sellableQuantity: null })), 5)
  assert.equal(sellableOf(null), 0)
})
test('sellableByProduct : totaux par produit, repli par ligne', () => {
  const m = sellableByProduct([
    lvl({ productId: 'a', availableQuantity: 5, sellableQuantity: 0 }),
    lvl({ productId: 'a', availableQuantity: 3, sellableQuantity: 3 }),
    lvl({ productId: 'b', availableQuantity: 4 }),
  ])
  assert.deepEqual(m.get('a'), { total: 8, sellable: 3, gap: true })
  assert.deepEqual(m.get('b'), { total: 4, sellable: 4, gap: false })
})
test('sellableColumn : masquée sans lot ni écart, masquée si le serveur ne fournit rien', () => {
  const plain = [{ id: 'a', isLotTracked: false }]
  const levels = [lvl({ productId: 'a', sellableQuantity: 5 })]
  assert.equal(sellableColumn(plain, levels).visible, false) // produit sans lot, vendable = total
  assert.equal(sellableColumn([{ id: 'a', isLotTracked: true }], [lvl({ productId: 'a' })]).visible, false) // ancien backend
  assert.equal(sellableColumn([{ id: 'a', isLotTracked: true }], levels).visible, true)
  const gap = [lvl({ productId: 'a', availableQuantity: 5, sellableQuantity: 1 })]
  assert.equal(sellableColumn(plain, gap).visible, true) // écart même sans lot
})
test('sellableColumn : quels produits affichent une valeur', () => {
  const products = [{ id: 'a', isLotTracked: true }, { id: 'b', isLotTracked: false }, { id: 'c', isLotTracked: false }]
  const levels = [
    lvl({ productId: 'a', sellableQuantity: 5 }), lvl({ productId: 'b', sellableQuantity: 5 }),
    lvl({ productId: 'c', availableQuantity: 5, sellableQuantity: 2 }),
  ]
  const col = sellableColumn(products, levels)
  assert.equal(col.shows('a'), true); assert.equal(col.shows('b'), false); assert.equal(col.shows('c'), true)
})

/* ── erreurs ── */
test('parseApiError : message « HTTP 409 — {json} » avec detail chaîne', () => {
  const e = parseApiError(new Error('HTTP 409 — {"detail":"insufficient stock for product x"}'))
  assert.equal(e.status, 409); assert.equal(e.code, null); assert.equal(e.msg, 'insufficient stock for product x')
})
test('parseApiError : detail objet {code,msg,details}', () => {
  const e = parseApiError(new Error('HTTP 409 — {"detail":{"code":"insufficient_stock","msg":"m","details":{"available":2}}}'))
  assert.equal(e.code, 'insufficient_stock'); assert.equal(e.msg, 'm'); assert.deepEqual(e.details, { available: 2 })
})
test('parseApiError : objet d’erreur du SDK (status + body/detail/data)', () => {
  assert.equal(parseApiError({ status: 422, detail: { code: 'batch_expiry_mismatch', details: { a: 1 } } }).code, 'batch_expiry_mismatch')
  assert.equal(parseApiError({ response: { status: 409, data: { detail: 'x' } } }).msg, 'x')
  assert.equal(parseApiError({ status: 409, body: '{"detail":{"code":"insufficient_stock"}}' }).code, 'insufficient_stock')
  assert.equal(parseApiError({ status: 409, body: { detail: 'y' } }).msg, 'y')
})
test('parseApiError : tableau pydantic, texte brut, vide', () => {
  assert.equal(parseApiError(new Error('HTTP 422 — {"detail":[{"msg":"bad"}]}')).msg, 'bad')
  const t = parseApiError('network down'); assert.equal(t.status, null); assert.equal(t.msg, 'network down')
  assert.deepEqual(parseApiError(undefined), { status: null, code: null, msg: '', details: null })
  assert.equal(parseApiError(new Error('HTTP 500 — {pas du json')).status, 500)
})

test('formatStockError : insufficient_stock avec périmé', () => {
  const err = new Error('HTTP 409 — ' + JSON.stringify({ detail: { code: 'insufficient_stock', msg: 'EN',
    details: { product_id: 'p', requested: 4, available: 2, expired_quantity: 5, quarantine_quantity: 0 } } }))
  const m = formatStockError(err)
  assert.match(m, /4 demandé/); assert.match(m, /2 vendable/); assert.match(m, /5 en lot\(s\) périmé\(s\)/)
  assert.doesNotMatch(m, /quarantaine/)
  assert.doesNotMatch(m, /EN/) // pas de message anglais
})
test('formatStockError : périmé + quarantaine, décimales fr', () => {
  const m = formatStockError({ status: 409, detail: { code: 'insufficient_stock', details: { requested: 4.5, available: 0, expired_quantity: 1.5, quarantine_quantity: 3 } } })
  assert.match(m, /4,5 demandé/); assert.match(m, /1,5 en lot\(s\) périmé\(s\)/); assert.match(m, /3 en quarantaine/)
})
test('formatStockError : detail chaîne (ancien serveur) = texte du serveur', () => {
  assert.equal(formatStockError(new Error('HTTP 409 — {"detail":"Stock insuffisant pour p"}')), 'Stock insuffisant pour p')
})
test('formatStockError : batch_expiry_mismatch avec deux dates et consigne', () => {
  const m = formatStockError(new Error('HTTP 422 — ' + JSON.stringify({ detail: { code: 'batch_expiry_mismatch', msg: 'EN',
    details: { product_id: 'p', batch_number: 'L-42', existing_expiry_date: '2026-10-12', provided_expiry_date: '2026-11-30' } } })))
  assert.match(m, /L-42/); assert.match(m, /12\/10\/2026/); assert.match(m, /30\/11\/2026/)
  assert.match(m, /autre numéro de lot|corrigez la date/i)
})
test('formatStockError : mismatch sans date existante (lot sans péremption)', () => {
  const m = formatStockError({ status: 422, detail: { code: 'batch_expiry_mismatch', details: { batch_number: 'L1', existing_expiry_date: null, provided_expiry_date: '2026-11-30' } } })
  assert.match(m, /sans date de péremption/); assert.match(m, /30\/11\/2026/)
})
test('formatStockError : dérogation refusée / motif manquant', () => {
  assert.match(formatStockError({ status: 403, detail: { code: 'expired_batch_forbidden', msg: 'x' } }), /droit|autoris/i)
  assert.match(formatStockError({ status: 422, detail: { code: 'expired_reason_required' } }), /motif/i)
})
test('formatStockError : repli sur message brut puis sur le texte par défaut', () => {
  assert.equal(formatStockError(new Error('boom')), 'boom')
  assert.equal(formatStockError(undefined, { fallback: 'Erreur' }), 'Erreur')
})
test('insufficientInfo : quantités périmées et en quarantaine pour l’UI', () => {
  const e = { status: 409, detail: { code: 'insufficient_stock', details: { expired_quantity: 5, quarantine_quantity: 0, available: 1, requested: 3 } } }
  assert.deepEqual(insufficientInfo(e), { requested: 3, available: 1, expired: 5, quarantine: 0 })
  assert.equal(insufficientInfo(new Error('HTTP 409 — {"detail":"plain"}')), null)
})

/* ── paliers ── */
test('parseTiersInput : liste de jours, décroissante, sans doublon', () => {
  assert.deepEqual(parseTiersInput('7, 90 30;30'), { ok: true, tiers: [90, 30, 7] })
  assert.deepEqual(parseTiersInput('45'), { ok: true, tiers: [45] })
})
test('parseTiersInput : validation avec messages français', () => {
  for (const bad of ['', '  ', 'abc', '0', '-5', '3.5', '3651', '1,2,3,4,5,6,7,8,9,10,11']) {
    const r = parseTiersInput(bad); assert.equal(r.ok, false, bad); assert.ok(r.error.length > 5)
  }
  assert.match(parseTiersInput('12 abc').error, /abc/)
})
test('formatTiers / tiersFromSettings', () => {
  assert.equal(formatTiers([90, 30, 7]), '90, 30, 7')
  assert.deepEqual(tiersFromSettings({ expiryAlertTiers: [60, 10] }), [60, 10])
  assert.deepEqual(tiersFromSettings({}), DEFAULT_EXPIRY_TIERS)
  assert.deepEqual(tiersFromSettings({ expiryAlertTiers: 'x' }), DEFAULT_EXPIRY_TIERS)
  assert.deepEqual(tiersFromSettings(null), DEFAULT_EXPIRY_TIERS)
})

/* ── droits ── */
test('permissions : noms exacts', () => {
  assert.equal(USE_EXPIRED_PERMISSION, 'xstock:batches:use_expired')
  assert.equal(SETTINGS_WRITE_PERMISSION, 'xstock:settings:write')
})
test('canUseExpired : uniquement si app.can répond vrai (jamais par défaut)', () => {
  assert.equal(canUseExpired({ can: (p) => p === 'xstock:batches:use_expired' }), true)
  assert.equal(canUseExpired({ can: () => false }), false)
  assert.equal(canUseExpired({ can: () => undefined }), false)
  assert.equal(canUseExpired({}), false)
  assert.equal(canUseExpired(null), false)
  assert.equal(canUseExpired({ can: () => { throw new Error('x') } }), false)
})
test('settingsLocked : verrouillé seulement si app.can répond faux explicitement', () => {
  assert.equal(settingsLocked({ can: () => false }), true)
  assert.equal(settingsLocked({ can: () => true }), false)
  assert.equal(settingsLocked({}), false)
  assert.equal(settingsLocked(null), false)
})

/* ── dérogation ── */
test('validateExpiredIssue : motif obligatoire (≤ 200), quantité > 0', () => {
  assert.match(validateExpiredIssue({ reason: '', quantity: 1 }), /motif/i)
  assert.match(validateExpiredIssue({ reason: '   ', quantity: 1 }), /motif/i)
  assert.match(validateExpiredIssue({ reason: 'a'.repeat(201), quantity: 1 }), /200/)
  assert.match(validateExpiredIssue({ reason: 'ok', quantity: 0 }), /quantité/i)
  assert.equal(validateExpiredIssue({ reason: 'Destruction constatée', quantity: 2 }), null)
})
test('buildExpiredIssue : allowExpired + motif nettoyé, champs vides omis', () => {
  const b = buildExpiredIssue({ productId: 'p', warehouseId: 'w', quantity: 2, reason: '  Destruction  ', witnessId: '', sourceReference: 'BL1', note: '' })
  assert.deepEqual(b, { productId: 'p', warehouseId: 'w', quantity: 2, allowExpired: true, expiredReason: 'Destruction', sourceReference: 'BL1' })
})

test('formatDay : ISO vers jj/mm/aaaa', () => {
  assert.equal(formatDay('2026-10-12'), '12/10/2026')
  assert.equal(formatDay('2026-10-12T00:00:00'), '12/10/2026')
  assert.equal(formatDay(null), '—')
  assert.equal(formatDay('zzz'), '—')
})

test('issuePlan : valides d’abord, complément périmé, reste manquant', () => {
  assert.deepEqual(issuePlan({ sellable: 0, expired: 5, quantity: 3 }), { fromValid: 0, fromExpired: 3, short: 0 })
  assert.deepEqual(issuePlan({ sellable: 4, expired: 5, quantity: 7 }), { fromValid: 4, fromExpired: 3, short: 0 })
  assert.deepEqual(issuePlan({ sellable: 4, expired: 5, quantity: 20 }), { fromValid: 4, fromExpired: 5, short: 11 })
  assert.deepEqual(issuePlan({ sellable: 10, expired: 5, quantity: 2 }), { fromValid: 2, fromExpired: 0, short: 0 })
  assert.deepEqual(issuePlan({ quantity: 'x' }), { fromValid: 0, fromExpired: 0, short: 0 })
})

test('expiredIssueProblem : refuse une dérogation qui ne toucherait aucun lot périmé', () => {
  assert.equal(expiredIssueProblem(issuePlan({ sellable: 0, expired: 5, quantity: 3 }), 0), null)
  assert.equal(expiredIssueProblem(issuePlan({ sellable: 4, expired: 5, quantity: 7 }), 4), null)
  assert.match(expiredIssueProblem(issuePlan({ sellable: 50, expired: 5, quantity: 5 }), 50), /50 vendable.*plus de 50/)
  assert.match(expiredIssueProblem(issuePlan({ sellable: 0, expired: 0, quantity: 1 }), 0), /Aucun lot périmé/)
})
