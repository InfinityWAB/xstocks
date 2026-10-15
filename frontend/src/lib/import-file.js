// Lecture d'un fichier CSV/TSV pour l'assistant d'import : logique PURE (aucun React,
// aucun window), testée avec `node --test`.
//
// Principes :
//  - le fichier est lu en OCTETS puis décodé ici (UTF-8 avec/sans BOM, repli Windows-1252) :
//    c'est le seul moyen d'afficher correctement un export Excel français ;
//  - TOUTES les cellules restent du TEXTE : « 00123 » reste « 00123 » (le piège classique
//    d'Excel qui mange les zéros de tête). Aucun nombre n'est converti ici ;
//  - les numéros de ligne sont ceux du fichier (en-tête = ligne 1), lignes vides comprises,
//    pour que « ligne 14 » désigne la même ligne dans Excel ou le Bloc-notes.

/** Au-delà, le serveur n'a pas de traitement asynchrone : on avertit et on refuse. */
export const MAX_IMPORT_ROWS = 20000
/** Taille maximale d'un bloc accepté par le serveur (413 au-delà). */
export const BLOCK_SIZE = 500
/** Taille maximale de fichier lue (garde-fou mémoire). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024

const NBSP = / | |​/g

/** Décode des octets : { text, encoding } avec BOM retiré. */
export function decodeBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16' }
  }
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(hasBom ? bytes.subarray(3) : bytes)
    return { text, encoding: hasBom ? 'UTF-8 (BOM)' : 'UTF-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' }
  }
}

/**
 * Analyse CSV complète (RFC 4180 tolérant) : guillemets, guillemets doublés, retours ligne
 * dans une cellule. Renvoie { records: [{ line, cells }], unterminatedQuoteLine }.
 * `line` = numéro (1-based) de la ligne du fichier où commence l'enregistrement.
 * Les lignes vides sont CONSERVÉES ici (voir readImportFile pour le filtrage).
 */
export function parseCsv(text, delimiter = ';') {
  const records = []
  let cells = []
  let cur = ''
  let inQ = false
  let fieldStart = true
  let line = 1
  let recLine = 1
  let quoteLine = 0
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else { inQ = false }
      } else if (c === '\r') {
        if (text[i + 1] === '\n') i++
        cur += '\n'; line++
      } else {
        if (c === '\n') line++
        cur += c
      }
      continue
    }
    if (c === '"' && fieldStart) { inQ = true; quoteLine = line; fieldStart = false; continue }
    if (c === delimiter) { cells.push(cur); cur = ''; fieldStart = true; continue }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cells.push(cur)
      records.push({ line: recLine, cells })
      cells = []; cur = ''; fieldStart = true
      line++; recLine = line
      continue
    }
    cur += c
    if (fieldStart && c !== ' ' && c !== '\t') fieldStart = false
  }
  if (cur !== '' || cells.length || inQ) {
    cells.push(cur)
    records.push({ line: recLine, cells })
  }
  return { records, unterminatedQuoteLine: inQ ? quoteLine : 0 }
}

/** Détecte `;` `,` ou tabulation sur les premières lignes (par cohérence du nombre de colonnes). */
export function detectDelimiter(text) {
  const sample = text.length > 20000 ? text.slice(0, 20000) : text
  const sliced = sample.length < text.length
  let best = ';'
  let bestScore = -1
  for (const d of [';', '\t', ',']) {
    let { records } = parseCsv(sample, d)
    if (sliced) records = records.slice(0, -1)
    records = records.filter(r => r.cells.some(c => c.trim() !== '')).slice(0, 30)
    if (!records.length) continue
    const width = records[0].cells.length
    if (width < 2) continue
    const same = records.filter(r => r.cells.length === width).length
    const score = same * 1000 + Math.min(width, 999)
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best
}

const cleanCell = (c) => String(c ?? '').replace(NBSP, ' ').trim()

/**
 * Lit un fichier (octets) et rend :
 *  { encoding, delimiter, headers: string[], rows: [{ line, cells }], headerLine,
 *    blankLines, raggedLines, tooMany, unterminatedQuoteLine, empty }
 * `rows` exclut l'en-tête et les lignes vides ; chaque ligne est complétée à la largeur de l'en-tête.
 */
export function readImportFile(input, { delimiter } = {}) {
  const { text, encoding } = decodeBytes(input)
  let body = text
  let forced = delimiter
  // Ligne « sep=; » ajoutée par Excel : consommée, mais la numérotation reste celle du fichier.
  let lineOffsetSkip = 0
  const sep = /^sep=(.)\r?\n/i.exec(body)
  if (sep) { forced = forced ?? sep[1]; body = body.slice(sep[0].length); lineOffsetSkip = 1 }
  const delim = forced ?? detectDelimiter(body)
  const { records, unterminatedQuoteLine } = parseCsv(body, delim)
  const isBlank = (r) => r.cells.every(c => cleanCell(c) === '')
  const kept = []
  let blankLines = 0
  for (const r of records) {
    if (isBlank(r)) { blankLines++; continue }
    kept.push({ line: r.line + lineOffsetSkip, cells: r.cells.map(cleanCell) })
  }
  if (!kept.length) {
    return { encoding, delimiter: delim, headers: [], rows: [], headerLine: 0, blankLines, raggedLines: 0, tooMany: false, unterminatedQuoteLine, empty: true }
  }
  const head = kept[0]
  const headers = head.cells
  const width = headers.length
  let raggedLines = 0
  const rows = kept.slice(1).map(r => {
    if (r.cells.length !== width) raggedLines++
    const cells = r.cells.slice(0, width)
    while (cells.length < width) cells.push('')
    return { line: r.line, cells }
  })
  return {
    encoding, delimiter: delim, headers, rows, headerLine: head.line, blankLines, raggedLines,
    tooMany: rows.length > MAX_IMPORT_ROWS, unterminatedQuoteLine, empty: false,
  }
}

/** Nom lisible du séparateur, pour l'aperçu. */
export function delimiterLabel(d) {
  return d === '\t' ? 'tabulation' : d === ',' ? 'virgule' : 'point-virgule'
}

/** Extension de fichier en minuscules, sans point. */
export function fileExtension(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ''))
  return m ? m[1].toLowerCase() : ''
}

/** Les formats que l'assistant lit directement. Les classeurs Excel passent par « Enregistrer sous → CSV ». */
export function classifyFileName(name) {
  const ext = fileExtension(name)
  if (['csv', 'txt', 'tsv'].includes(ext)) return 'text'
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) return 'spreadsheet'
  return 'unknown'
}
