// Le backend xstock renvoie des listes brutes (pas de total ni has_more) avec
// `limit`/`offset` (défaut 50, mouvements 100, aucun plafond serveur).
// On pagine donc « jusqu'à page incomplète », avec une borne de sécurité.
//
// fetchPage({ limit, offset }) -> Promise<Array>
// Retourne { items, truncated, pages } ; truncated=true si la borne maxPages
// est atteinte alors qu'il y avait peut-être encore des données.
// Une erreur en cours de route est propagée (jamais de liste partielle muette).

// `key` (optionnel) : fonction d'identité pour dédoublonner (le backend liste
// sans ORDER BY stable : une page peut répéter une ligne d'une autre page).
export async function fetchAllPages(fetchPage, { pageSize = 200, maxPages = 25, key = null } = {}) {
  const items = []
  const seen = key ? new Set() : null
  let pages = 0
  while (pages < maxPages) {
    const batch = (await fetchPage({ limit: pageSize, offset: pages * pageSize })) ?? []
    pages += 1
    for (const it of batch) {
      if (seen) { const k = key(it); if (seen.has(k)) continue; seen.add(k) }
      items.push(it)
    }
    if (batch.length < pageSize) return { items, truncated: false, pages }
  }
  return { items, truncated: true, pages }
}

export function truncationNotice(count, truncated, noun = 'éléments') {
  return truncated ? `Affichage limité aux ${count} premiers ${noun}. Affinez la recherche pour voir la suite.` : null
}
