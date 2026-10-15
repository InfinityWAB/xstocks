// Assistant d'import : correspondance des colonnes, blocs, doublons, cumul des rapports.
// Logique PURE (aucun React, aucun window), testée avec `node --test`.
// Le serveur valide et décide ; ici on prépare, on signale et on additionne.

import { BLOCK_SIZE } from './import-file.js'

export const KIND_PRODUCTS = 'products'
export const KIND_OPENING = 'opening'

export const ENDPOINTS = {
  [KIND_PRODUCTS]: '/products/import',
  [KIND_OPENING]: '/movements/import-opening',
}

/** Droits nécessaires : produits = import ; stock de départ = import + écriture de mouvements. */
export function requiredRights(kind) {
  return kind === KIND_OPENING ? ['xstock:products:import', 'xstock:movements:write'] : ['xstock:products:import']
}
/** Ce que l'utilisateur peut importer ; sans `app.can` (hôte ancien) on ne présume rien : le serveur tranchera. */
export function canImport(app, kind) {
  try {
    if (typeof app?.can !== 'function') return true
    return requiredRights(kind).every(r => app.can(r) !== false)
  } catch { return true }
}
export function availableKinds(app) {
  return [KIND_PRODUCTS, KIND_OPENING].filter(k => canImport(app, k))
}

/* ─── Champs reconnus ──────────────────────────────────────────────────── */

// `syn` : synonymes (déjà sous forme normalisée : sans accents, minuscules, sans ponctuation).
export const FIELDS = {
  [KIND_PRODUCTS]: [
    { key: 'code', label: 'Code', required: true, example: ['00123', '00124'],
      syn: ['code', 'code produit', 'code article', 'reference', 'ref', 'sku', 'code interne'] },
    { key: 'name', label: 'Désignation', required: true, example: ['Clou 50 mm (boîte)', 'Peinture blanche 5 L'],
      syn: ['designation', 'libelle', 'nom', 'nom produit', 'nom article', 'produit', 'name', 'description', 'intitule', 'label', 'product'] },
    { key: 'barcode', label: 'Code-barres', example: ['0061234500012', ''],
      syn: ['code barres', 'code barre', 'codebarre', 'codebarres', 'ean', 'ean13', 'ean 13', 'gtin', 'upc', 'barcode', 'bar code', 'code ean'] },
    { key: 'category', label: 'Catégorie', example: ['Quincaillerie', 'Peinture'],
      syn: ['categorie', 'famille', 'rayon', 'groupe', 'category', 'sous famille', 'classe'] },
    { key: 'unit', label: 'Unité', example: ['boîte', 'pot'],
      syn: ['unite', 'unite de mesure', 'um', 'conditionnement', 'unit', 'uom'] },
    { key: 'salePrice', label: 'Prix de vente', example: ['2 500', '12 000,50'],
      syn: ['prix de vente', 'prix vente', 'pv', 'prix', 'prix ttc', 'prix de vente ttc', 'prix public', 'tarif', 'sale price', 'price', 'pu', 'prix unitaire', 'pvttc'] },
    { key: 'purchasePrice', label: "Prix d'achat", cost: true, example: ['1 800', '9 500'],
      syn: ['prix d achat', 'prix achat', 'pa', 'cout', 'cout d achat', 'cout achat', 'purchase price', 'cost', 'cout unitaire', 'prix de revient', 'pr', 'paht', 'prix achat ht'] },
    { key: 'minThreshold', label: 'Stock minimum', example: ['10', '5'],
      syn: ['stock minimum', 'stock mini', 'stock min', 'minimum', 'seuil', 'seuil d alerte', 'seuil alerte', 'seuil minimum', 'min', 'min threshold', 'stock securite', 'seuil de reapprovisionnement'] },
    { key: 'isLotTracked', label: 'Suivi par lot', example: ['non', 'non'],
      syn: ['suivi par lot', 'suivi lot', 'gestion par lot', 'gestion des lots', 'lot', 'lots', 'avec lot', 'lot tracked', 'tracabilite lot', 'suivi des lots'] },
    { key: 'inn', label: 'DCI', pharmacy: true, example: ['', ''],
      syn: ['dci', 'denomination commune internationale', 'principe actif', 'molecule', 'inn'] },
    { key: 'dosageForm', label: 'Forme', pharmacy: true, example: ['', ''],
      syn: ['forme', 'forme galenique', 'forme pharmaceutique', 'presentation', 'dosage form'] },
    { key: 'dosage', label: 'Dosage', pharmacy: true, example: ['', ''],
      syn: ['dosage', 'concentration', 'teneur', 'strength'] },
    { key: 'isControlledSubstance', label: 'Stupéfiant', pharmacy: true, example: ['', ''],
      syn: ['stupefiant', 'stupefiants', 'substance controlee', 'produit stupefiant', 'controle', 'controlled substance'] },
  ],
  [KIND_OPENING]: [
    { key: 'code', label: 'Code produit', required: true, example: ['00123', '00124'],
      syn: ['code', 'code produit', 'code article', 'reference', 'ref', 'sku', 'article', 'produit', 'code interne'] },
    { key: 'warehouse', label: 'Entrepôt', required: true, example: ['W1', 'W1'],
      syn: ['entrepot', 'depot', 'magasin', 'site', 'warehouse', 'code entrepot', 'code depot', 'lieu', 'emplacement', 'point de vente', 'boutique'] },
    { key: 'quantity', label: 'Quantité', required: true, example: ['120', '40'],
      syn: ['quantite', 'qte', 'qty', 'stock', 'stock initial', 'stock de depart', 'stock actuel', 'quantity', 'quantite en stock', 'qte stock', 'stock reel', 'nombre'] },
    { key: 'batchNumber', label: 'Lot', example: ['', 'L2026-01'],
      syn: ['lot', 'numero de lot', 'n lot', 'no lot', 'num lot', 'batch', 'batch number', 'numero lot', 'lot n', 'n de lot'] },
    { key: 'expiryDate', label: 'Péremption', example: ['', '30/06/2028'],
      syn: ['peremption', 'date de peremption', 'date peremption', 'dlc', 'dluo', 'date d expiration', 'date expiration', 'expiration', 'expiry', 'expiry date', 'ddp', 'exp', 'date limite', 'dlv'] },
    { key: 'unitCost', label: 'Coût unitaire', cost: true, example: ['1 800', '9 500'],
      syn: ['cout unitaire', 'cout', 'prix d achat', 'prix achat', 'pa', 'unit cost', 'cost', 'prix de revient', 'valeur unitaire'] },
  ],
}

const STOPWORDS = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'en', 'au', 'a', 'of', 'the'])

/** Normalise un en-tête : accents, casse, ponctuation, espaces. « Prix d’achat (FCFA) » -> « prix d achat fcfa ». */
export function normalizeHeader(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
const tokens = (s) => normalizeHeader(s).split(' ').filter(t => t && !STOPWORDS.has(t))

/** Champs proposés pour un type d'import (colonnes pharmacie seulement si secteur pharmacie). */
export function fieldsFor(kind, { pharmacy = false } = {}) {
  return (FIELDS[kind] ?? []).filter(f => !f.pharmacy || pharmacy)
}

function matchScore(header, field) {
  const h = normalizeHeader(header)
  if (!h) return 0
  const hTokens = new Set(tokens(h))
  let best = 0
  for (const syn of field.syn) {
    if (h === syn) return 100 + syn.length
    const st = tokens(syn)
    // Jeton unique : exact seulement (« prix » seul ne doit pas capter « prix d'achat »).
    if (st.length >= 2 && st.every(t => hTokens.has(t))) best = Math.max(best, 50 + st.length)
  }
  // « Prix de vente TTC (FCFA) » : le meilleur synonyme est contenu ; sinon rien.
  return best
}

/**
 * Reconnaissance automatique : renvoie un tableau (un élément par colonne) de clés de champ ou '' (ignorée).
 * Affectation gloutonne par meilleur score : une colonne -> au plus un champ, un champ -> au plus une colonne.
 */
export function autoMap(headers, kind, opts = {}) {
  const fields = fieldsFor(kind, opts)
  const cands = []
  headers.forEach((h, col) => {
    for (const f of fields) {
      const s = matchScore(h, f)
      if (s > 0) cands.push({ col, key: f.key, s })
    }
  })
  cands.sort((a, b) => b.s - a.s || a.col - b.col)
  const mapping = headers.map(() => '')
  const used = new Set()
  for (const c of cands) {
    if (mapping[c.col] || used.has(c.key)) continue
    mapping[c.col] = c.key
    used.add(c.key)
  }
  return mapping
}

/** Affecte (ou retire, key='') un champ à une colonne ; un champ n'appartient qu'à une seule colonne. */
export function setColumnField(mapping, col, key) {
  const next = mapping.map((k, i) => (key && k === key && i !== col ? '' : k))
  next[col] = key
  return next
}

/** Champs obligatoires sans colonne : [{ key, label }]. */
export function missingRequired(mapping, kind, opts = {}) {
  const set = new Set(mapping)
  return fieldsFor(kind, opts).filter(f => f.required && !set.has(f.key)).map(f => ({ key: f.key, label: f.label }))
}

/** Colonnes ignorées, explicitement : [{ col, header }]. */
export function ignoredColumns(headers, mapping) {
  return headers.map((header, col) => ({ col, header })).filter(x => !mapping[x.col])
}

/* ─── Construction des lignes ──────────────────────────────────────────── */

/** dd/mm/yyyy (ou - .) -> yyyy-mm-dd ; ISO inchangé ; autre texte renvoyé tel quel (le serveur tranche). */
export function normalizeDate(v) {
  const s = String(v ?? '').trim()
  let m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return s
}

/** Quantité propre (« 10 », « 1 200 », « 2,5 ») -> nombre ; sinon texte tel quel (refusé côté serveur avec un message). */
export function normalizeQuantity(v) {
  const s = String(v ?? '').trim()
  const compact = s.replace(/\s/g, '')
  return /^-?\d+(?:[.,]\d+)?$/.test(compact) ? Number(compact.replace(',', '.')) : s
}

/**
 * Lignes à envoyer : [{ line, code, name, … }] avec seulement les champs NON vides
 * (un champ vide n'efface jamais l'existant). Les lignes sans aucune valeur mappée sont écartées.
 * `skipCosts` : le droit coûts manque, on n'envoie pas les colonnes de coût (le serveur les ignorerait aussi).
 */
export function buildRows(fileRows, mapping, kind, { pharmacy = false, skipCosts = false } = {}) {
  const allowed = new Map(fieldsFor(kind, { pharmacy }).map(f => [f.key, f]))
  const out = []
  for (const r of fileRows) {
    const row = { line: r.line }
    let any = false
    mapping.forEach((key, col) => {
      const f = key && allowed.get(key)
      if (!f || (skipCosts && f.cost)) return
      let v = r.cells[col] ?? ''
      if (v === '') return
      any = true
      if (key === 'expiryDate') v = normalizeDate(v)
      else if (key === 'quantity') v = normalizeQuantity(v)
      row[key] = v
    })
    if (any) out.push(row)
  }
  return out
}

/** Découpe en blocs de BLOCK_SIZE lignes (500 max côté serveur). */
export function chunk(rows, size = BLOCK_SIZE) {
  const out = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/** Corps de requête d'un bloc. */
export function blockBody(importId, rows, { dryRun, atomic }) {
  return { importId, dryRun: !!dryRun, atomic: !!atomic, rows }
}

export function newImportId() {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${h()}${h()}-${h()}-${h()}-${h()}-${h()}${h()}${h()}`
}

/* ─── Doublons dans TOUT le fichier ────────────────────────────────────── */

/**
 * Le serveur ne voit pas les doublons ENTRE blocs : on les détecte ici sur tout le fichier.
 * Produits : même code, ou même code-barres. On garde la PREMIÈRE ligne ; les suivantes sont
 * écartées de l'envoi et listées comme erreurs locales (code `duplicate_in_file`).
 * Stock de départ : même (produit, entrepôt, lot) répété = les quantités s'ADDITIONNENT :
 * simple avertissement (`additive_opening`), rien n'est écarté.
 * Renvoie { rows (à envoyer), localErrors: [{line, field, code, message}], warnings: [{code, field, message, count, lines}] }.
 */
export function detectDuplicates(rows, kind) {
  const localErrors = []
  const warnings = []
  if (kind === KIND_OPENING) {
    const seen = new Map()
    const dupLines = []
    for (const r of rows) {
      const k = [r.code, r.warehouse, r.batchNumber ?? ''].map(x => String(x ?? '').trim()).join('\u0001')
      if (seen.has(k)) { dupLines.push(r.line); const f = seen.get(k); if (!dupLines.includes(f)) dupLines.push(f) } else seen.set(k, r.line)
    }
    if (dupLines.length) {
      dupLines.sort((a, b) => a - b)
      warnings.push({
        code: 'additive_opening', field: 'code', count: dupLines.length, lines: dupLines,
        message: 'Même produit, même entrepôt et même lot sur plusieurs lignes : les quantités seront ADDITIONNÉES.',
      })
    }
    return { rows, localErrors, warnings }
  }
  const byCode = new Map()
  const byBarcode = new Map()
  const kept = []
  for (const r of rows) {
    const code = String(r.code ?? '').trim()
    const bc = String(r.barcode ?? '').trim()
    if (code && byCode.has(code)) {
      localErrors.push({ line: r.line, field: 'code', code: 'duplicate_in_file', message: `Code « ${code} » déjà présent à la ligne ${byCode.get(code)} : ligne ignorée.` })
      continue
    }
    if (bc && byBarcode.has(bc)) {
      localErrors.push({ line: r.line, field: 'barcode', code: 'duplicate_in_file', message: `Code-barres « ${bc} » déjà utilisé à la ligne ${byBarcode.get(bc)} : ligne ignorée.` })
      continue
    }
    if (code) byCode.set(code, r.line)
    if (bc) byBarcode.set(bc, r.line)
    kept.push(r)
  }
  return { rows: kept, localErrors, warnings }
}

/* ─── Cumul des rapports par bloc ──────────────────────────────────────── */

const LINES_CAP = 50
const ERRORS_CAP = 5000

export function emptyReport(importId = '', dryRun = true, atomic = false) {
  return {
    importId, dryRun, atomic, blocks: 0, appliedBlocks: 0, total: 0, created: 0, updated: 0, unchanged: 0,
    rejected: 0, skipped: 0, errors: [], errorsTruncated: false, warnings: [], replayed: false,
  }
}

/** Ajoute le rapport d'un bloc au cumul (nouvel objet). */
export function addReport(acc, r) {
  const next = { ...acc, errors: acc.errors.slice(), warnings: acc.warnings.map(w => ({ ...w, lines: w.lines.slice() })) }
  const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  next.blocks += 1
  if (r.applied) next.appliedBlocks += 1
  for (const k of ['total', 'created', 'updated', 'unchanged', 'rejected', 'skipped']) next[k] += n(r[k])
  for (const e of r.errors ?? []) {
    if (next.errors.length < ERRORS_CAP) next.errors.push({ line: e.line, field: e.field ?? '', code: e.code ?? '', message: e.message ?? '' })
    else next.errorsTruncated = true
  }
  if (r.errorsTruncated) next.errorsTruncated = true
  for (const w of r.warnings ?? []) {
    const key = `${w.code}|${w.field ?? ''}`
    const ex = next.warnings.find(x => `${x.code}|${x.field ?? ''}` === key)
    if (ex) {
      ex.count = n(ex.count) + n(w.count ?? (w.lines?.length ?? 1))
      ex.lines = ex.lines.concat(w.lines ?? []).slice(0, LINES_CAP)
    } else {
      next.warnings.push({ code: w.code, field: w.field ?? '', message: w.message ?? '', count: n(w.count ?? (w.lines?.length ?? 1)), lines: (w.lines ?? []).slice(0, LINES_CAP) })
    }
  }
  if (r.replayed) next.replayed = true
  return next
}

/** Cumule une liste de rapports de blocs. */
export function mergeReports(list, meta = {}) {
  let acc = emptyReport(meta.importId, meta.dryRun, meta.atomic)
  for (const r of list) acc = addReport(acc, r)
  return acc
}

/** Ajoute les erreurs locales (doublons) au cumul : elles comptent comme lignes refusées. */
export function withLocalErrors(report, localErrors) {
  if (!localErrors?.length) return report
  return {
    ...report,
    errors: localErrors.concat(report.errors),
    rejected: report.rejected + localErrors.length,
    total: report.total + localErrors.length,
  }
}

/** Erreurs triées par ligne (affichage et CSV). */
export function sortedErrors(errors) {
  return errors.slice().sort((a, b) => (a.line - b.line) || String(a.field).localeCompare(String(b.field)))
}

/* ─── Textes en français ───────────────────────────────────────────────── */

const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

/** Résumé de l'essai à blanc : « 120 à créer, 8 à mettre à jour, 30 inchangés, 3 erreurs ». */
export function summaryDryRun(r, kind = KIND_PRODUCTS) {
  const parts = kind === KIND_OPENING
    ? [`${r.created.toLocaleString('fr-FR')} à enregistrer`, `${r.unchanged.toLocaleString('fr-FR')} déjà enregistrés`]
    : [`${r.created.toLocaleString('fr-FR')} à créer`, `${r.updated.toLocaleString('fr-FR')} à mettre à jour`, `${r.unchanged.toLocaleString('fr-FR')} ${r.unchanged > 1 ? 'inchangés' : 'inchangé'}`]
  parts.push(plural(r.rejected, 'erreur', 'erreurs'))
  return parts.join(', ')
}

/** Résumé final, une phrase. */
export function summaryFinal(r, kind = KIND_PRODUCTS) {
  const f = (n) => n.toLocaleString('fr-FR')
  if (kind === KIND_OPENING) {
    const parts = [`${plural(r.created, 'stock enregistré', 'stocks enregistrés')}`]
    if (r.unchanged) parts.push(`${f(r.unchanged)} déjà ${r.unchanged > 1 ? 'enregistrés' : 'enregistré'}`)
    if (r.rejected) parts.push(plural(r.rejected, 'ligne refusée', 'lignes refusées'))
    if (r.skipped) parts.push(plural(r.skipped, 'ligne non traitée', 'lignes non traitées'))
    return parts.join(', ')
  }
  const parts = [`${plural(r.created, 'produit créé', 'produits créés')}`, `${plural(r.updated, 'mis à jour', 'mis à jour')}`, `${f(r.unchanged)} ${r.unchanged > 1 ? 'inchangés' : 'inchangé'}`]
  if (r.rejected) parts.push(plural(r.rejected, 'ligne refusée', 'lignes refusées'))
  if (r.skipped) parts.push(plural(r.skipped, 'ligne non traitée', 'lignes non traitées'))
  return parts.join(', ')
}

/** Lignes valides = ce qui serait appliqué (créé + mis à jour + inchangé). 0 -> bouton Importer désactivé. */
export function validCount(r) {
  return r.created + r.updated + r.unchanged
}

/** Libellé lisible des champs techniques. */
export function fieldLabel(key, kind) {
  const f = (FIELDS[kind] ?? []).find(x => x.key === key) ?? Object.values(FIELDS).flat().find(x => x.key === key)
  return f ? f.label : (key || '')
}

/** Message lisible pour les avertissements serveur connus ; sinon le message du serveur. */
export function warningText(w) {
  const n = w.count ? ` (${w.count} ligne${w.count > 1 ? 's' : ''})` : ''
  if (w.code === 'cost_ignored') return `Prix d'achat ignoré : votre rôle n'a pas le droit coûts et marges${n}.`
  return `${w.message || w.code}${n}`
}

/* ─── Erreurs HTTP ─────────────────────────────────────────────────────── */

function detailOf(e) {
  const d = e?.detail ?? e?.body?.detail ?? e?.data?.detail ?? e?.response?.data?.detail
  if (d != null) return d
  const m = /\{.*\}\s*$/s.exec(String(e?.message ?? ''))
  if (m) { try { const j = JSON.parse(m[0]); return j.detail ?? j } catch { /* texte brut */ } }
  return null
}

/** Message clair pour 403 (dont module_disabled), 413, 422, réseau, etc. { message, kind, retryable }. */
export function describeImportError(e) {
  const status = Number(e?.status ?? e?.statusCode ?? e?.response?.status) || undefined
  const d = detailOf(e)
  const code = String((d && typeof d === 'object' ? (d.code ?? d.error) : '') || e?.code || '').toLowerCase()
  const raw = JSON.stringify(d ?? '') + String(e?.message ?? '')
  if (status === 403 && (code === 'module_disabled' || /module_disabled/i.test(raw))) {
    return { kind: 'module_disabled', retryable: false, message: "Le module Stock est désactivé pour cette entreprise. Demandez au propriétaire de le réactiver, puis recommencez." }
  }
  if (status === 403 || code === 'forbidden' || code === 'permission_denied') {
    return { kind: 'forbidden', retryable: false, message: "Vous n'avez pas le droit d'importer. Demandez-le au propriétaire ou au gérant." }
  }
  if (status === 401) return { kind: 'auth', retryable: false, message: 'Session expirée : reconnectez-vous, puis reprenez l\'import (rien n\'est doublé).' }
  if (status === 413) return { kind: 'too_big', retryable: false, message: `Bloc trop gros : le serveur accepte ${BLOCK_SIZE} lignes au plus à la fois.` }
  if (status === 422) {
    const msg = d && typeof d === 'object' ? (d.msg ?? d.message) : (typeof d === 'string' ? d : '')
    return { kind: 'invalid', retryable: false, message: `Fichier refusé par le serveur (422)${msg ? ` : ${msg}` : '. Vérifiez qu\'il contient au moins une ligne et que l\'import est bien identifié.'}` }
  }
  const network = !status && /failed to fetch|network|load failed|ECONN|timeout|abort/i.test(String(e?.message ?? e))
  if (network || (status && status >= 500)) {
    return { kind: 'network', retryable: true, message: network ? 'Connexion interrompue. Vos données déjà importées sont conservées : reprenez, rien ne sera doublé.' : `Le serveur a rencontré un problème (${status}). Reprenez dans un instant : rien ne sera doublé.` }
  }
  return { kind: 'other', retryable: true, message: status ? `Requête refusée par le serveur (${status}).` : 'Une erreur inattendue est survenue.' }
}

/* ─── CSV (modèle et erreurs) ──────────────────────────────────────────── */

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const BOM = '﻿'

/** CSV Excel-FR : BOM, séparateur « ; », toutes cellules entre guillemets. */
export function toCsv(headers, rows) {
  return BOM + [headers, ...rows].map(r => r.map(cell).join(';')).join('\r\n') + '\r\n'
}

/** Colonnes : ligne;champ;code;message. */
export function errorsCsv(errors, kind = KIND_PRODUCTS) {
  return toCsv(['ligne', 'champ', 'code', 'message'], sortedErrors(errors).map(e => [e.line, fieldLabel(e.field, kind), e.code, e.message]))
}

/** Modèle téléchargeable : colonnes recommandées + 2 exemples. */
export function templateCsv(kind, { pharmacy = false } = {}) {
  const fields = fieldsFor(kind, { pharmacy })
  return toCsv(fields.map(f => f.label), [0, 1].map(i => fields.map(f => f.example[i] ?? '')))
}
export function templateFilename(kind) {
  return kind === KIND_OPENING ? 'modele_stock_de_depart.csv' : 'modele_produits.csv'
}
