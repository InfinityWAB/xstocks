// Coûts masqués : logique PURE (aucun React, aucun window), testée avec `node --test`.
//
// Contrat serveur : sans le droit `costs:read`, les champs de coût restent présents
// mais valent `null` (jamais 0). Un coût absent est donc « masqué », pas « gratuit » :
// on n'affiche jamais 0, NaN ni undefined à sa place, et on ne calcule jamais une
// somme partielle qui passerait pour le vrai total.

export const COST_MASKED_TEXT = '—'
export const COST_MASKED_HINT = 'Réservé aux rôles autorisés (droit coûts et marges)'
export const COST_ACTION_DENIED = 'Cette action demande le droit coûts et marges'
export const COST_PERMISSION = 'costs:read'

const isAmount = (v) => typeof v === 'number' && Number.isFinite(v)

/** true si la valeur est un vrai montant (0 inclus), false si masquée/absente. */
export function hasCost(value) {
  return isAmount(value)
}

/**
 * Formate un coût ou rend « — » s'il est masqué. 0 reste « 0 » (vrai zéro).
 * `currency` : suffixe optionnel (« FCFA ») ; absent = nombre seul.
 */
export function formatMaybeCost(value, { currency, maximumFractionDigits } = {}) {
  if (!isAmount(value)) return COST_MASKED_TEXT
  const opts = maximumFractionDigits == null ? undefined : { maximumFractionDigits }
  const n = value.toLocaleString('fr-FR', opts)
  return currency ? `${n} ${currency}` : n
}

/** Somme, ou null dès qu'UN SEUL terme est masqué/absent (jamais de somme partielle). */
export function sumOrNull(values) {
  let total = 0
  for (const v of values ?? []) {
    if (!isAmount(v)) return null
    total += v
  }
  return total
}

/** true si au moins une valeur est un montant : sert à masquer une colonne toute à null. */
export function anyCost(values) {
  for (const v of values ?? []) if (isAmount(v)) return true
  return false
}

/**
 * Le droit coûts manque-t-il ? `app.can` (shell) fait foi quand il répond false ;
 * sinon (API absente, erreur, réponse floue) on ne présume rien : on ne cache pas à l'avance.
 */
export function costsDenied(app) {
  try {
    if (typeof app?.can !== 'function') return false
    return app.can(COST_PERMISSION) === false
  } catch {
    return false
  }
}

/** Erreur 403 renvoyée par une action dont l'objet est le coût. */
export function costActionMessage(e) {
  const status = Number(e?.status ?? e?.statusCode ?? e?.response?.status) || undefined
  const code = String(e?.code ?? '').toUpperCase()
  if (status === 403 || code === 'FORBIDDEN' || code === 'PERMISSION_DENIED') return COST_ACTION_DENIED
  return null
}
