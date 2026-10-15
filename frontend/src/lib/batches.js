// Lots et péremption : logique PURE (aucun React, aucun window), testée avec `node --test`.
//
// Contrat serveur (additif) : chaque ligne de niveau peut porter `sellableQuantity`,
// `batchStatus` et `expiryDate`. Un serveur plus ancien ne les envoie pas : tout se
// replie alors sur `availableQuantity` et aucun badge n'est affiché.
//
// Date de référence : jour UTC, comme le serveur (le tenant n'a pas de fuseau).
// Une péremption « aujourd'hui » reste vendable.

export const USE_EXPIRED_PERMISSION = 'xstock:batches:use_expired'
export const SETTINGS_WRITE_PERMISSION = 'xstock:settings:write'
export const DEFAULT_EXPIRY_TIERS = [90, 30, 7]
export const MAX_TIERS = 10
export const MAX_TIER_DAYS = 3650
export const EXPIRED_REASON_MAX = 200

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const nf = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 })

/* ── dates ── */

// « YYYY-MM-DD » (ou ISO complet) -> millisecondes UTC du jour, ou null.
function dayMs(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null
      : Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  }
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return ms
}

/** Jours entiers jusqu'à la date (négatif = dépassée), null si date absente/illisible. */
export function daysUntil(expiryDate, now = new Date()) {
  const target = dayMs(expiryDate)
  const today = dayMs(now)
  if (target == null || today == null) return null
  return Math.round((target - today) / 86400000)
}

/** « 2026-10-12 » -> « 12/10/2026 » ; « — » si absente. */
export function formatDay(value) {
  const ms = dayMs(value)
  if (ms == null) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/* ── état d'un lot ── */

function cleanTiers(tiers) {
  const list = (Array.isArray(tiers) ? tiers : []).filter((t) => Number.isInteger(t) && t > 0)
  return list.length ? list : DEFAULT_EXPIRY_TIERS
}

/**
 * État d'affichage d'une ligne de niveau : `{ kind, label, tone, days, detail }` ou null (rien à montrer).
 * kind : expired | quarantine | depleted | expiring | ok. `label` null = pas de badge (lot valide).
 * tone : danger | warning | neutral | null. Le texte porte toujours l'information, jamais la couleur seule.
 * Priorité : quarantaine (jamais sortable) > périmé > épuisé > bientôt périmé.
 */
export function batchState(level, { now = new Date(), tiers } = {}) {
  if (!level) return null
  const status = typeof level.batchStatus === 'string' ? level.batchStatus.toLowerCase() : null
  const hasDate = level.expiryDate != null && level.expiryDate !== ''
  if (!status && !hasDate) return null
  const days = hasDate ? daysUntil(level.expiryDate, now) : null

  if (status === 'quarantine') return { kind: 'quarantine', label: 'Quarantaine', tone: 'warning', days, detail: 'Lot bloqué : non vendable' }
  if (status === 'expired' || (days != null && days < 0)) {
    const detail = days != null && days < 0 ? `Périmé depuis ${-days} j` : 'Lot périmé : non vendable'
    return { kind: 'expired', label: 'Périmé', tone: 'danger', days, detail }
  }
  if (status === 'depleted') return { kind: 'depleted', label: 'Épuisé', tone: 'neutral', days, detail: 'Lot épuisé' }

  if (days != null) {
    const t = cleanTiers(tiers)
    if (days <= Math.max(...t)) {
      const label = days === 0 ? 'Expire aujourd’hui' : `Expire dans ${days} j`
      return { kind: 'expiring', label, tone: days <= Math.min(...t) ? 'danger' : 'warning', days, detail: `Péremption le ${formatDay(level.expiryDate)}` }
    }
  }
  return { kind: 'ok', label: null, tone: null, days, detail: hasDate ? `Péremption le ${formatDay(level.expiryDate)}` : '' }
}

/* ── vendable / total ── */

/** Vendable d'une ligne : `sellableQuantity` si fourni, sinon l'ancien `availableQuantity`. */
export function sellableOf(level) {
  if (!level) return 0
  if (isNum(level.sellableQuantity)) return level.sellableQuantity
  return isNum(level.availableQuantity) ? level.availableQuantity : 0
}

/** Map productId -> { total, sellable, gap } (gap = une partie du stock n'est pas vendable). */
export function sellableByProduct(levels) {
  const m = new Map()
  for (const l of levels ?? []) {
    const cur = m.get(l.productId) ?? { total: 0, sellable: 0, gap: false }
    cur.total += isNum(l.availableQuantity) ? l.availableQuantity : 0
    cur.sellable += sellableOf(l)
    m.set(l.productId, cur)
  }
  for (const v of m.values()) v.gap = v.sellable < v.total
  return m
}

/**
 * Colonne « Vendable » : visible seulement si le serveur fournit le champ ET qu'au moins un produit est
 * suivi par lot ou présente un écart. `shows(productId)` : la valeur n'est affichée que pour ces produits
 * (les autres gardent un tiret, pour ne pas encombrer).
 */
export function sellableColumn(products, levels) {
  const provided = (levels ?? []).some((l) => isNum(l?.sellableQuantity))
  const byProduct = sellableByProduct(levels)
  const tracked = new Set((products ?? []).filter((p) => p?.isLotTracked).map((p) => p.id))
  const needed = (id) => provided && (tracked.has(id) || byProduct.get(id)?.gap === true)
  const visible = (products ?? []).some((p) => needed(p.id))
  return { visible, shows: needed }
}

/* ── erreurs de l'API ── */

function tryJson(text) {
  if (typeof text !== 'string') return undefined
  const i = text.indexOf('{')
  if (i < 0) return undefined
  try { return JSON.parse(text.slice(i)) } catch { return undefined }
}

function fromDetail(detail) {
  if (typeof detail === 'string') return { code: null, msg: detail, details: null }
  if (Array.isArray(detail)) {
    const first = detail.find((d) => d && typeof d.msg === 'string')
    return { code: null, msg: first ? first.msg : '', details: null }
  }
  if (detail && typeof detail === 'object') {
    return {
      code: typeof detail.code === 'string' ? detail.code : null,
      msg: typeof detail.msg === 'string' ? detail.msg : (typeof detail.message === 'string' ? detail.message : ''),
      details: detail.details && typeof detail.details === 'object' ? detail.details : null,
    }
  }
  return { code: null, msg: '', details: null }
}

/**
 * Normalise une erreur d'appel en `{ status, code, msg, details }`. Le `detail` serveur peut être une
 * chaîne (historique) OU un objet `{code, msg, details}` ; il peut arriver dans le message
 * (« HTTP 409 — {json} »), dans `err.detail`, `err.body`, `err.data` ou `err.response.data`.
 */
export function parseApiError(err) {
  if (err == null) return { status: null, code: null, msg: '', details: null }
  if (typeof err === 'string') {
    const m = /^HTTP (\d{3})/.exec(err)
    const body = tryJson(err)
    const parsed = body && 'detail' in body ? fromDetail(body.detail) : { code: null, msg: m ? '' : err, details: null }
    return { status: m ? Number(m[1]) : null, ...parsed }
  }
  const mm = typeof err.message === 'string' ? /^HTTP (\d{3})/.exec(err.message) : null
  const status = Number(err.status ?? err.statusCode ?? err.response?.status ?? (mm && mm[1])) || null

  const candidates = [err.detail, err.body, err.data, err.response?.data, err.response?.body]
  for (const c of candidates) {
    if (c == null) continue
    const body = typeof c === 'string' ? (tryJson(c) ?? c) : c
    if (typeof body === 'string') return { status, ...fromDetail(body) }
    if (typeof body === 'object') {
      if ('detail' in body) return { status, ...fromDetail(body.detail) }
      if ('code' in body || 'msg' in body) return { status, ...fromDetail(body) }
    }
  }
  const body = tryJson(err.message)
  if (body && 'detail' in body) return { status, ...fromDetail(body.detail) }
  return { status, code: typeof err.code === 'string' ? err.code : null, msg: typeof err.message === 'string' ? err.message : '', details: null }
}

/** Quantités d'un refus `insufficient_stock` (objet), ou null (refus historique à chaîne). */
export function insufficientInfo(err) {
  const e = parseApiError(err)
  if (e.code !== 'insufficient_stock' || !e.details) return null
  const d = e.details
  return {
    requested: isNum(d.requested) ? d.requested : null,
    available: isNum(d.available) ? d.available : null,
    expired: isNum(d.expired_quantity) ? d.expired_quantity : 0,
    quarantine: isNum(d.quarantine_quantity) ? d.quarantine_quantity : 0,
  }
}

/** Message français clair pour une erreur de stock ; repli : détail du serveur, message brut, `fallback`. */
export function formatStockError(err, { fallback = 'Une erreur est survenue.' } = {}) {
  const e = parseApiError(err)
  const d = e.details ?? {}

  if (e.code === 'insufficient_stock' && e.details) {
    const info = insufficientInfo(err)
    const parts = []
    if (info.requested != null && info.available != null) {
      parts.push(`Stock vendable insuffisant : ${nf(info.requested)} demandé(s), ${nf(info.available)} vendable(s).`)
    } else parts.push('Stock vendable insuffisant.')
    if (info.expired > 0) parts.push(`${nf(info.expired)} en lot(s) périmé(s), non vendable(s).`)
    if (info.quarantine > 0) parts.push(`${nf(info.quarantine)} en quarantaine, non vendable(s).`)
    return parts.join(' ')
  }
  if (e.code === 'batch_expiry_mismatch') {
    const lot = d.batch_number ? `Le lot « ${d.batch_number} »` : 'Ce lot'
    const existing = d.existing_expiry_date ? `a déjà une péremption au ${formatDay(d.existing_expiry_date)}` : 'existe déjà sans date de péremption'
    const provided = d.provided_expiry_date ? `la réception indique le ${formatDay(d.provided_expiry_date)}` : 'la réception n’indique aucune date'
    return `${lot} ${existing} ; ${provided}. Corrigez la date ou utilisez un autre numéro de lot.`
  }
  if (e.code === 'expired_batch_forbidden') return 'Vous n’avez pas le droit de sortir des lots périmés.'
  if (e.code === 'expired_reason_required') return 'Indiquez le motif de la sortie d’un lot périmé.'
  return e.msg || fallback
}

/* ── paliers d'alerte ── */

export function formatTiers(tiers) {
  return (Array.isArray(tiers) ? tiers : []).join(', ')
}

/** Paliers des réglages, ou le défaut 90/30/7 si absents (ancien serveur) ou illisibles. */
export function tiersFromSettings(settings) {
  const t = settings?.expiryAlertTiers
  if (Array.isArray(t) && t.length && t.every((x) => Number.isInteger(x) && x > 0)) return [...t]
  return [...DEFAULT_EXPIRY_TIERS]
}

/** Saisie « 90, 30, 7 » (séparateurs , ; espace) -> `{ ok, tiers }` décroissants sans doublon, ou `{ ok:false, error }`. */
export function parseTiersInput(text) {
  const tokens = String(text ?? '').split(/[\s,;]+/).filter(Boolean)
  if (tokens.length === 0) return { ok: false, error: 'Indiquez au moins un palier en jours (ex. 90, 30, 7).' }
  const set = new Set()
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) return { ok: false, error: `« ${t} » n’est pas un nombre entier de jours.` }
    const n = Number(t)
    if (n < 1 || n > MAX_TIER_DAYS) return { ok: false, error: `Chaque palier doit être compris entre 1 et ${MAX_TIER_DAYS} jours (« ${t} »).` }
    set.add(n)
  }
  if (set.size > MAX_TIERS) return { ok: false, error: `Au plus ${MAX_TIERS} paliers.` }
  return { ok: true, tiers: [...set].sort((a, b) => b - a) }
}

/* ── droits ── */

/** Dérogation « lot périmé » : proposée UNIQUEMENT si `app.can` répond vrai (jamais par défaut). */
export function canUseExpired(app) {
  try { return typeof app?.can === 'function' && app.can(USE_EXPIRED_PERMISSION) === true } catch { return false }
}

/** Réglages verrouillés seulement quand `app.can` répond faux explicitement (sinon on ne présume rien). */
export function settingsLocked(app) {
  try { return typeof app?.can === 'function' && app.can(SETTINGS_WRITE_PERMISSION) === false } catch { return false }
}

/* ── dérogation (sortie d'un lot périmé) ── */

export function validateExpiredIssue({ reason, quantity }) {
  const r = String(reason ?? '').trim()
  if (!r) return 'Le motif est obligatoire pour sortir un lot périmé.'
  if (r.length > EXPIRED_REASON_MAX) return `Le motif ne doit pas dépasser ${EXPIRED_REASON_MAX} caractères.`
  if (!isNum(quantity) || !(quantity > 0)) return 'Indiquez une quantité supérieure à 0.'
  return null
}

/** Corps de POST /movements/issue avec dérogation ; les champs vides sont omis. */
export function buildExpiredIssue({ productId, warehouseId, quantity, reason, witnessId, sourceReference }) {
  const body = { productId, warehouseId, quantity, allowExpired: true, expiredReason: String(reason ?? '').trim() }
  if (witnessId) body.witnessId = witnessId
  if (sourceReference) body.sourceReference = sourceReference
  return body
}

/**
 * Répartition d'une sortie avec dérogation : le serveur prélève d'abord les lots valides, puis seulement
 * le complément dans les lots périmés (la quarantaine n'est jamais prélevée). Sert à l'annoncer avant confirmation.
 */
export function issuePlan({ sellable, expired, quantity }) {
  const q = isNum(quantity) && quantity > 0 ? quantity : 0
  const s = isNum(sellable) && sellable > 0 ? sellable : 0
  const e = isNum(expired) && expired > 0 ? expired : 0
  const fromValid = Math.min(q, s)
  const fromExpired = Math.min(q - fromValid, e)
  return { fromValid, fromExpired, short: Math.max(0, q - fromValid - fromExpired) }
}

/**
 * Garde-fou : une dérogation qui ne toucherait aucun lot périmé (les lots valides couvrent déjà la
 * quantité) ne ferait que sortir du stock valide. Retourne un message, ou null si la sortie atteint du périmé.
 */
export function expiredIssueProblem(plan, sellable) {
  if (!plan || plan.fromExpired > 0) return null
  const s = isNum(sellable) && sellable > 0 ? sellable : 0
  return s > 0
    ? `Les lots valides (${nf(s)} vendable(s)) couvrent déjà cette quantité : aucun lot périmé ne serait sorti. Saisissez plus de ${nf(s)} pour atteindre le lot périmé.`
    : 'Aucun lot périmé à sortir pour cette quantité.'
}
