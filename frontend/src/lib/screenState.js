// Vérité des écrans : décide ce qu'un écran de liste doit afficher.
// Logique pure (aucun React, aucun window) pour être testée avec `node --test`.
//
// Règle de fond : « aucune donnée » (liste réellement vide) n'est JAMAIS
// confondu avec « impossible de charger » (erreur, hors-ligne, accès refusé).

export function screenKind({ loading = false, error = null, offline = false, data = null, forbidden = false } = {}) {
  if (forbidden) return 'forbidden'
  const hasData = Array.isArray(data) ? data.length > 0 : data != null
  // Données déjà affichées + échec d'un rafraîchissement : on garde l'écran.
  if (hasData) return 'ready'
  if (loading) return 'loading'
  if (error) return offline ? 'offline' : 'error'
  if (offline) return 'offline'
  if (data == null) return 'loading'
  return 'empty'
}

// Classe une exception d'appel API : { error, offline, forbidden } à passer à screenKind.
export function classifyError(e, online = (typeof navigator === 'undefined' ? true : navigator.onLine !== false)) {
  if (!e) return { error: null, offline: false, forbidden: false }
  const status = e.status ?? e.statusCode ?? e.response?.status
  const msg = String(e.message ?? e)
  const forbidden = status === 403 || /\b403\b|forbidden|permission/i.test(msg)
  const network = !online || /failed to fetch|networkerror|network request|load failed|ERR_NETWORK|ECONN/i.test(msg)
  return { error: msg || 'Erreur inconnue', offline: network && !forbidden, forbidden }
}

export const SCREEN_MESSAGES = {
  loading: { title: 'Chargement…', message: '' },
  error: { title: 'Impossible de charger les données', message: 'Le chargement a échoué. Ce n’est pas une liste vide.' },
  offline: { title: 'Hors ligne', message: 'Connexion indisponible : les données affichées ne peuvent pas être chargées.' },
  forbidden: { title: 'Accès refusé', message: 'Vous n’avez pas la permission de voir cet écran.' },
  empty: { title: 'Aucune donnée', message: '' },
}
