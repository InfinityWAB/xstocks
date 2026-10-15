import test from 'node:test'
import assert from 'node:assert/strict'
import { readImportFile } from './import-file.js'
import {
  normalizeHeader, autoMap, setColumnField, missingRequired, ignoredColumns, buildRows, chunk, blockBody, newImportId,
  detectDuplicates, mergeReports, addReport, emptyReport, withLocalErrors, summaryDryRun, summaryFinal, validCount,
  describeImportError, errorsCsv, templateCsv, normalizeDate, normalizeQuantity, canImport, availableKinds, warningText,
  KIND_PRODUCTS as P, KIND_OPENING as O,
} from './import-mapping.js'

const enc = (s) => new TextEncoder().encode(s)

test('normalizeHeader : accents, casse, ponctuation', () => {
  assert.equal(normalizeHeader('  Prix d’achat (FCFA) '), 'prix d achat fcfa')
  assert.equal(normalizeHeader('Désignation'), 'designation')
  assert.equal(normalizeHeader('CODE-BARRES'), 'code barres')
  assert.equal(normalizeHeader('Péremption'), 'peremption')
})

const keys = (headers, kind, o) => autoMap(headers, kind, o).join(',')
test('autoMap produits : synonymes fr/en', () => {
  assert.equal(keys(['Référence', 'Libellé', 'EAN', 'PV', 'PA', 'Famille', 'Unité', 'Seuil'], P),
    'code,name,barcode,salePrice,purchasePrice,category,unit,minThreshold')
  assert.equal(keys(['SKU', 'Product', 'GTIN', 'Prix', 'Coût', 'Category'], P), 'code,name,barcode,salePrice,purchasePrice,category')
  assert.equal(keys(['Code', 'Code-barres', 'Désignation', 'Prix de vente TTC (FCFA)', 'Stock minimum', 'Suivi par lot'], P),
    'code,barcode,name,salePrice,minThreshold,isLotTracked')
})
test('autoMap : colonne inconnue ignorée, un champ -> une seule colonne', () => {
  const m = autoMap(['Code', 'Nom', 'Code', 'Commentaire'], P)
  assert.deepEqual(m, ['code', 'name', '', ''])
  assert.deepEqual(ignoredColumns(['Code', 'Nom', 'Code', 'Commentaire'], m).map(x => x.header), ['Code', 'Commentaire'])
})
test('autoMap stock de départ : lot, péremption, DLC, entrepôt', () => {
  assert.equal(keys(['Réf', 'Dépôt', 'Quantité', 'N° de lot', 'DLC'], O), 'code,warehouse,quantity,batchNumber,expiryDate')
  assert.equal(keys(['Code produit', 'Entrepôt', 'Stock', 'Date d\'expiration', 'Coût unitaire'], O), 'code,warehouse,quantity,expiryDate,unitCost')
})
test('colonnes pharmacie : reconnues seulement si secteur pharmacie', () => {
  const h = ['Code', 'Désignation', 'DCI', 'Forme', 'Dosage', 'Stupéfiant']
  assert.equal(keys(h, P), 'code,name,,,,')
  assert.equal(keys(h, P, { pharmacy: true }), 'code,name,inn,dosageForm,dosage,isControlledSubstance')
})
test('modèle téléchargeable : se reconnaît lui-même, 2 exemples', () => {
  for (const kind of [P, O]) {
    const csv = templateCsv(kind, { pharmacy: true })
    const r = readImportFile(enc(csv))
    assert.equal(r.delimiter, ';')
    assert.equal(r.rows.length, 2)
    const m = autoMap(r.headers, kind, { pharmacy: true })
    assert.ok(m.every(Boolean), `${kind}: ${r.headers.filter((_, i) => !m[i])}`)
    assert.deepEqual(missingRequired(m, kind, { pharmacy: true }), [])
  }
  assert.ok(templateCsv(P).startsWith('﻿'))
  assert.ok(!templateCsv(P).includes('DCI'))
})
test('champs obligatoires signalés, mapping modifiable', () => {
  let m = autoMap(['Nom', 'Prix'], P)
  assert.deepEqual(missingRequired(m, P).map(x => x.key), ['code'])
  m = setColumnField(m, 1, 'code')
  assert.deepEqual(m, ['name', 'code'])
  assert.deepEqual(missingRequired(m, P), [])
  m = setColumnField(m, 0, 'code')
  assert.deepEqual(m, ['code', ''])
  assert.deepEqual(setColumnField(m, 0, ''), ['', ''])
})

test('buildRows : zéros de tête, vides omis, ligne réelle, texte brut', () => {
  const f = readImportFile(enc('Code;Désignation;EAN;PV;Stock min\n00123;Clou;0061234500012;1 234,50;\n\n00124;Vis;;;5\n;;;;'))
  const m = autoMap(f.headers, P)
  const rows = buildRows(f.rows, m, P)
  assert.deepEqual(rows, [
    { line: 2, code: '00123', name: 'Clou', barcode: '0061234500012', salePrice: '1 234,50' },
    { line: 4, code: '00124', name: 'Vis', minThreshold: '5' },
  ])
})
test('buildRows : coûts omis sans droit, pharmacie omise hors pharmacie', () => {
  const f = readImportFile(enc('Code;Nom;PA;DCI\n1;A;9;para'))
  const m = autoMap(f.headers, P, { pharmacy: true })
  assert.deepEqual(buildRows(f.rows, m, P, { pharmacy: true }), [{ line: 2, code: '1', name: 'A', purchasePrice: '9', inn: 'para' }])
  assert.deepEqual(buildRows(f.rows, m, P, { pharmacy: true, skipCosts: true }), [{ line: 2, code: '1', name: 'A', inn: 'para' }])
  assert.deepEqual(buildRows(f.rows, m, P, { pharmacy: false }), [{ line: 2, code: '1', name: 'A', purchasePrice: '9' }])
})
test('buildRows stock : quantité numérique, date jj/mm/aaaa -> ISO', () => {
  const f = readImportFile(enc('Code;Dépôt;Qté;Lot;DLC\nPP;W1;1 200;L1;30/06/2030\nQQ;W1;2,5;;2030-06-30'))
  const rows = buildRows(f.rows, autoMap(f.headers, O), O)
  assert.deepEqual(rows[0], { line: 2, code: 'PP', warehouse: 'W1', quantity: 1200, batchNumber: 'L1', expiryDate: '2030-06-30' })
  assert.deepEqual(rows[1], { line: 3, code: 'QQ', warehouse: 'W1', quantity: 2.5, expiryDate: '2030-06-30' })
  assert.equal(normalizeQuantity('abc'), 'abc')
  assert.equal(normalizeDate('demain'), 'demain')
  assert.equal(normalizeDate('5.1.2030'), '2030-01-05')
})

test('chunk : blocs de 500, dernier bloc partiel, vide', () => {
  const rows = Array.from({ length: 1200 }, (_, i) => ({ line: i + 2 }))
  const b = chunk(rows)
  assert.deepEqual(b.map(x => x.length), [500, 500, 200])
  assert.equal(b[1][0].line, 502)
  assert.deepEqual(chunk(rows.slice(0, 500)).map(x => x.length), [500])
  assert.deepEqual(chunk(rows.slice(0, 501)).map(x => x.length), [500, 1])
  assert.deepEqual(chunk([]), [])
})
test('blockBody / newImportId', () => {
  assert.deepEqual(blockBody('x', [{ line: 2 }], { dryRun: 1 }), { importId: 'x', dryRun: true, atomic: false, rows: [{ line: 2 }] })
  assert.notEqual(newImportId(), newImportId())
  assert.match(newImportId(), /^[0-9a-f-]{20,}$/)
})

test('doublons produits sur tout le fichier : code et code-barres, première ligne gardée', () => {
  const rows = [
    { line: 2, code: 'A', barcode: '111' }, { line: 3, code: 'B' }, { line: 700, code: 'A' },
    { line: 701, code: 'C', barcode: '111' }, { line: 702, code: 'D', barcode: '222' },
  ]
  const r = detectDuplicates(rows, P)
  assert.deepEqual(r.rows.map(x => x.line), [2, 3, 702])
  assert.deepEqual(r.localErrors.map(e => [e.line, e.field, e.code]), [[700, 'code', 'duplicate_in_file'], [701, 'barcode', 'duplicate_in_file']])
  assert.match(r.localErrors[0].message, /ligne 2/)
  assert.deepEqual(detectDuplicates([{ line: 2, code: 'A' }, { line: 3, code: 'a' }], P).localErrors, [])
})
test('stock de départ : même produit/entrepôt/lot répété = avertissement d\'addition', () => {
  const rows = [
    { line: 2, code: 'PP', warehouse: 'W1', batchNumber: 'L1', quantity: 1 },
    { line: 3, code: 'PP', warehouse: 'W2', batchNumber: 'L1', quantity: 1 },
    { line: 9, code: 'PP', warehouse: 'W1', batchNumber: 'L1', quantity: 1 },
  ]
  const r = detectDuplicates(rows, O)
  assert.equal(r.rows.length, 3)
  assert.deepEqual(r.warnings.map(w => [w.code, w.lines]), [['additive_opening', [2, 9]]])
  assert.equal(detectDuplicates(rows.slice(0, 2), O).warnings.length, 0)
})

const rep = (o) => ({ applied: true, total: 0, created: 0, updated: 0, unchanged: 0, rejected: 0, skipped: 0, errors: [], warnings: [], ...o })
test('mergeReports : somme, erreurs conservées, avertissements fusionnés', () => {
  const m = mergeReports([
    rep({ total: 500, created: 490, rejected: 10, errors: [{ line: 5, field: 'code', code: 'x', message: 'm' }], warnings: [{ code: 'cost_ignored', field: 'purchasePrice', message: 'M', count: 500, lines: [2, 3] }] }),
    rep({ total: 200, updated: 150, unchanged: 50, replayed: true, warnings: [{ code: 'cost_ignored', field: 'purchasePrice', message: 'M', count: 200, lines: [502] }] }),
    rep({ applied: false, total: 3, skipped: 3, errorsTruncated: true }),
  ], { importId: 'i', dryRun: false, atomic: true })
  assert.equal(m.total, 703); assert.equal(m.created, 490); assert.equal(m.updated, 150); assert.equal(m.unchanged, 50)
  assert.equal(m.rejected, 10); assert.equal(m.skipped, 3)
  assert.equal(m.blocks, 3); assert.equal(m.appliedBlocks, 2)
  assert.equal(m.errors.length, 1); assert.equal(m.errorsTruncated, true); assert.equal(m.replayed, true)
  assert.equal(m.warnings.length, 1)
  assert.deepEqual([m.warnings[0].count, m.warnings[0].lines], [700, [2, 3, 502]])
  assert.equal(m.importId, 'i'); assert.equal(m.atomic, true)
})
test('addReport ne modifie pas l\'ancien cumul ; valeurs absentes tolérées', () => {
  const a = emptyReport('i')
  const b = addReport(a, { total: 2, created: 2 })
  assert.equal(a.total, 0); assert.equal(b.total, 2); assert.equal(b.rejected, 0)
})
test('withLocalErrors : comptées comme refusées', () => {
  const r = withLocalErrors(mergeReports([rep({ total: 3, created: 3 })]), [{ line: 9, field: 'code', code: 'duplicate_in_file', message: 'd' }])
  assert.equal(r.rejected, 1); assert.equal(r.total, 4); assert.equal(r.errors[0].line, 9)
})
test('résumés en français', () => {
  const r = mergeReports([rep({ total: 1000, created: 120, updated: 8, unchanged: 30, rejected: 3 })])
  assert.equal(summaryDryRun(r), '120 à créer, 8 à mettre à jour, 30 inchangés, 3 erreurs')
  assert.equal(summaryDryRun(mergeReports([rep({ created: 1, unchanged: 1, rejected: 1 })])), '1 à créer, 0 à mettre à jour, 1 inchangé, 1 erreur')
  assert.equal(summaryFinal(r), '120 produits créés, 8 mis à jour, 30 inchangés, 3 lignes refusées')
  assert.equal(validCount(r), 158)
  assert.equal(validCount(emptyReport()), 0)
  assert.match(summaryFinal(mergeReports([rep({ created: 5 })]), O), /^5 stocks enregistrés/)
})
test('erreurs HTTP : 403, module_disabled, 413, 422, réseau', () => {
  assert.equal(describeImportError({ status: 403, message: 'HTTP 403 — {"detail":{"code":"module_disabled"}}' }).kind, 'module_disabled')
  assert.equal(describeImportError({ status: 403, detail: { code: 'module_disabled' } }).kind, 'module_disabled')
  assert.equal(describeImportError({ status: 403 }).kind, 'forbidden')
  assert.match(describeImportError({ status: 413 }).message, /500 lignes/)
  assert.equal(describeImportError({ status: 422, message: 'HTTP 422 — {"detail":"importId manquant"}' }).kind, 'invalid')
  assert.match(describeImportError({ status: 422, message: 'HTTP 422 — {"detail":"importId manquant"}' }).message, /importId manquant/)
  assert.equal(describeImportError(new Error('Failed to fetch')).retryable, true)
  assert.equal(describeImportError({ status: 503 }).retryable, true)
  assert.equal(describeImportError({ status: 401 }).kind, 'auth')
})
test('droits : produits = import ; stock de départ = + movements:write', () => {
  const app = (...ok) => ({ can: (p) => ok.includes(p) })
  assert.equal(canImport(app('xstock:products:import'), P), true)
  assert.equal(canImport(app('xstock:products:import'), O), false)
  assert.deepEqual(availableKinds(app('xstock:products:import', 'xstock:movements:write')), [P, O])
  assert.deepEqual(availableKinds(app()), [])
  assert.deepEqual(availableKinds({}), [P, O])
})
test('CSV des erreurs : BOM, point-virgule, guillemets doublés, tri par ligne', () => {
  const csv = errorsCsv([
    { line: 9, field: 'salePrice', code: 'bad_number', message: 'Prix "illisible"; vérifier' },
    { line: 3, field: 'code', code: 'missing', message: 'Code manquant' },
  ])
  assert.ok(csv.startsWith('﻿"ligne";"champ";"code";"message"'))
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[1], '"3";"Code";"missing";"Code manquant"')
  assert.equal(lines[2], '"9";"Prix de vente";"bad_number";"Prix ""illisible""; vérifier"')
  const back = readImportFile(enc(csv))
  assert.equal(back.delimiter, ';'); assert.equal(back.rows[1].cells[3], 'Prix "illisible"; vérifier')
})
test('warningText : cost_ignored en clair', () => {
  assert.match(warningText({ code: 'cost_ignored', count: 3 }), /Prix d'achat ignoré.*3 lignes/)
  assert.equal(warningText({ code: 'z', message: 'Hop' }), 'Hop')
})
