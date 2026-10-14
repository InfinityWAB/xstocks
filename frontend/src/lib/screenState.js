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

// Message lisible pour l'utilisateur : jamais le texte brut de l'exception
// (il peut contenir trace, SQL, chemins serveur).
function readableMessage(status, network) {
  if (network) return 'Connexion indisponible.'
  if (status === 404) return 'Ressource introuvable (404).'
  if (status === 401) return 'Session expirée, reconnectez-vous (401).'
  if (status >= 500) return `Erreur du serveur (${status}). Réessayez dans un instant.`
  if (status >= 400) return `Requête refusée par le serveur (${status}).`
  return 'Une erreur inattendue est survenue.'
}

// Classe une exception d'appel API : { error, offline, forbidden } à passer à screenKind.
// « Accès refusé » uniquement sur statut 403 ou code explicite, jamais sur le texte du message.
export function classifyError(e, online = (typeof navigator === 'undefined' ? true : navigator.onLine !== false)) {
  if (!e) return { error: null, offline: false, forbidden: false }
  const status = Number(e.status ?? e.statusCode ?? e.response?.status) || undefined
  const code = String(e.code ?? '').toUpperCase()
  const msg = String(e.message ?? e)
  const forbidden = status === 403 || code === 'FORBIDDEN' || code === 'PERMISSION_DENIED'
  const network = !online || /failed to fetch|networkerror|network request|load failed|ERR_NETWORK|ECONN/i.test(msg)
  const offline = network && !forbidden
  return { error: readableMessage(status, offline), offline, forbidden }
}

export const SCREEN_MESSAGES = {
  loading: { title: 'Chargement…', message: '' },
  error: { title: 'Impossible de charger les données', message: 'Le chargement a échoué. Ce n’est pas une liste vide.' },
  offline: { title: 'Hors ligne', message: 'Connexion indisponible : les données affichées ne peuvent pas être chargées.' },
  forbidden: { title: 'Accès refusé', message: 'Vous n’avez pas la permission de voir cet écran.' },
  empty: { title: 'Aucune donnée', message: '' },
}
