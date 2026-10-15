// Assistant d'import en trois gestes : Choisir le fichier, Vérifier (essai à blanc), Importer.
// Interface seulement : le serveur valide et décide. La logique est dans lib/import-file.js
// et lib/import-mapping.js (testées). `ui` apporte ModalShell, ModalHeader, S et Icon du plugin.
import { readImportFile, classifyFileName, delimiterLabel, MAX_IMPORT_ROWS, MAX_FILE_BYTES, BLOCK_SIZE } from './lib/import-file.js'
import {
  KIND_PRODUCTS, KIND_OPENING, fieldsFor, autoMap, setColumnField, missingRequired, ignoredColumns, buildRows, chunk,
  blockBody, newImportId, detectDuplicates, mergeReports, withLocalErrors, sortedErrors, summaryDryRun, summaryFinal,
  validCount, describeImportError, errorsCsv, templateCsv, templateFilename, fieldLabel, warningText, availableKinds,
} from './lib/import-mapping.js'
import { costsDenied } from './lib/costs.js'

const h = React.createElement
const SHOW = 100

function download(name, text) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' })), download: name,
  })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const KIND_LABEL = { [KIND_PRODUCTS]: 'Produits', [KIND_OPENING]: 'Stock de départ' }
const KIND_HINT = {
  [KIND_PRODUCTS]: 'Créer ou mettre à jour votre catalogue.',
  [KIND_OPENING]: 'Enregistrer les quantités déjà en rayon (produits déjà créés).',
}

export function ImportAssistant({ app, ui, post, readSector, onClose, onDone }) {
  const { ModalShell, ModalHeader, S, Icon } = ui
  const kinds = useMemo(() => availableKinds(app), [app])
  const [kind, setKind] = useState(kinds[0] ?? KIND_PRODUCTS)
  const [pharmacy, setPharmacy] = useState(false)
  const [file, setFile] = useState(null)      // { name, parsed }
  const [fileError, setFileError] = useState('')
  const [help, setHelp] = useState('')
  const [mapping, setMapping] = useState([])
  const [drag, setDrag] = useState(false)
  const [atomic, setAtomic] = useState(false)
  const [check, setCheck] = useState(null)    // { running, done, total, report, local, warnings, error }
  const [run, setRun] = useState(null)        // import réel : { running, done, total, report, error, finished }
  const [showAll, setShowAll] = useState(false)
  const importId = useRef(newImportId())
  const token = useRef(0)
  const blocksDone = useRef({})
  const inputRef = useRef(null)
  const skipCosts = costsDenied(app)
  const opts = { pharmacy }
  const step = run ? 'done' : file ? 'check' : 'file'

  useEffect(() => {
    let live = true
    Promise.resolve().then(() => readSector?.()).then(s => { if (live) setPharmacy(String(s ?? '').toLowerCase() === 'pharmacie') }).catch(() => {})
    return () => { live = false }
  }, [])
  useEffect(() => () => { token.current++ }, [])

  const missing = file ? missingRequired(mapping, kind, opts) : []
  const prepared = useMemo(() => {
    if (!file) return null
    const rows = buildRows(file.parsed.rows, mapping, kind, { ...opts, skipCosts })
    return { ...detectDuplicates(rows, kind), count: rows.length }
  }, [file, mapping, kind, pharmacy, skipCosts])

  function pick(f) {
    setFileError(''); setHelp('')
    if (!f) return
    const type = classifyFileName(f.name)
    if (type === 'spreadsheet') { setHelp(f.name); return }
    if (type === 'unknown') { setFileError('Format non reconnu. Choisissez un fichier .csv (ou enregistrez votre tableur en CSV).'); return }
    if (f.size > MAX_FILE_BYTES) { setFileError('Fichier trop volumineux (25 Mo maximum).'); return }
    f.arrayBuffer().then(buf => {
      const parsed = readImportFile(new Uint8Array(buf))
      if (parsed.empty) { setFileError('Ce fichier est vide.'); return }
      if (!parsed.rows.length) { setFileError('Le fichier ne contient que l’en-tête : ajoutez au moins une ligne.'); return }
      if (parsed.tooMany) { setFileError(`Fichier trop long : ${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} lignes au plus par import. Découpez-le en plusieurs fichiers.`); return }
      if (parsed.unterminatedQuoteLine) { setFileError(`Un guillemet n’est jamais refermé (ligne ${parsed.unterminatedQuoteLine}). Corrigez le fichier puis recommencez.`); return }
      importId.current = newImportId(); blocksDone.current = {}
      setMapping(autoMap(parsed.headers, kind, opts))
      setCheck(null); setShowAll(false)
      setFile({ name: f.name, parsed })
    }).catch(() => setFileError('Impossible de lire ce fichier.'))
  }

  function changeKind(k) {
    setKind(k)
    if (file) setMapping(autoMap(file.parsed.headers, k, opts))
  }

  // Essai à blanc automatique, bloc par bloc, dès que le mapping est complet.
  useEffect(() => {
    if (step !== 'check' || !prepared) return
    const my = ++token.current
    if (missing.length || !prepared.rows.length) {
      setCheck(prepared.localErrors.length ? { running: false, done: 0, total: 0, report: withLocalErrors(mergeReports([]), prepared.localErrors), local: prepared.warnings } : null)
      return
    }
    const blocks = chunk(prepared.rows)
    const t = setTimeout(async () => {
      const list = []
      setCheck({ running: true, done: 0, total: blocks.length, report: null, local: prepared.warnings })
      for (let i = 0; i < blocks.length; i++) {
        try { list.push(await post(kind, blockBody(importId.current, blocks[i], { dryRun: true, atomic: false }))) }
        catch (e) { if (token.current === my) setCheck({ running: false, done: i, total: blocks.length, report: null, error: describeImportError(e), local: prepared.warnings }); return }
        if (token.current !== my) return
        setCheck({ running: i + 1 < blocks.length, done: i + 1, total: blocks.length, report: null, local: prepared.warnings })
      }
      if (token.current !== my) return
      const report = withLocalErrors(mergeReports(list, { importId: importId.current, dryRun: true }), prepared.localErrors)
      setCheck({ running: false, done: blocks.length, total: blocks.length, report, local: prepared.warnings })
    }, 350)
    return () => clearTimeout(t)
  }, [prepared, step])

  async function startImport() {
    const rows = prepared.rows
    const blocks = chunk(rows)
    const my = ++token.current
    const state = { running: true, done: Object.keys(blocksDone.current).length, total: blocks.length, report: null, error: null, finished: false }
    setRun(state)
    for (let i = 0; i < blocks.length; i++) {
      if (blocksDone.current[i]) continue
      try { blocksDone.current[i] = await post(kind, blockBody(importId.current, blocks[i], { dryRun: false, atomic })) }
      catch (e) {
        if (token.current === my) setRun({ running: false, done: Object.keys(blocksDone.current).length, total: blocks.length, report: null, error: describeImportError(e), finished: false })
        return
      }
      if (token.current !== my) return
      setRun({ ...state, done: Object.keys(blocksDone.current).length })
    }
    const list = blocks.map((_, i) => blocksDone.current[i])
    const report = withLocalErrors(mergeReports(list, { importId: importId.current, dryRun: false, atomic }), prepared.localErrors)
    setRun({ running: false, done: blocks.length, total: blocks.length, report, error: null, finished: true })
    onDone?.(report)
  }

  function requestClose() {
    if (run?.running) return
    onClose()
  }
  function restart() {
    token.current++; blocksDone.current = {}; importId.current = newImportId()
    setRun(null); setFile(null); setCheck(null); setMapping([]); setFileError(''); setHelp('')
  }

  /* ─── Rendu ─── */
  const muted = { fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.45 }
  const box = (tone) => ({ padding: '10px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.45,
    background: `var(--color-${tone}-muted)`, color: `var(--color-${tone}-text)` })
  const scroller = { overflow: 'auto', maxWidth: '100%', border: '1px solid var(--color-border)', borderRadius: 10 }
  const bar = (done, total) => h('div', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done,
    style: { height: 8, borderRadius: 99, background: 'var(--color-surface-subtle)', overflow: 'hidden' } },
    h('div', { style: { height: '100%', width: `${total ? Math.round(done / total * 100) : 0}%`, background: 'var(--color-primary)', transition: 'width .2s' } }))

  const steps = h('ol', { style: { display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }, 'aria-label': 'Étapes' },
    ['Fichier', 'Vérifier', 'Importer'].map((l, i) => {
      const cur = ['file', 'check', 'done'].indexOf(step) === i
      return h('li', { key: l, 'aria-current': cur ? 'step' : undefined, style: { ...S.badge(cur ? 'var(--color-primary-muted)' : 'var(--color-surface-subtle)', cur ? 'var(--color-primary-text)' : 'var(--color-text-tertiary)') } }, `${i + 1}. ${l}`)
    }))

  let body
  if (step === 'file') {
    body = [
      kinds.length > 1 && h('fieldset', { key: 'k', style: { border: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
        h('legend', { style: { ...S.label, padding: 0 } }, 'Que voulez-vous importer ?'),
        kinds.map(k => h('label', { key: k, style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 12, cursor: 'pointer',
          border: `1px solid ${kind === k ? 'var(--color-primary)' : 'var(--color-border)'}`, background: kind === k ? 'var(--color-primary-muted)' : 'var(--color-surface)' } },
          h('input', { type: 'radio', name: 'xs-imp-kind', checked: kind === k, onChange: () => changeKind(k) }),
          h('span', null, h('strong', { style: { fontSize: 13, color: 'var(--color-text-primary)' } }, KIND_LABEL[k]), h('div', { style: muted }, KIND_HINT[k]))))),
      h('div', { key: 'd', onDragOver: (e) => { e.preventDefault(); setDrag(true) }, onDragLeave: () => setDrag(false),
        onDrop: (e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer?.files?.[0]) },
        style: { border: `2px dashed ${drag ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 14, padding: '28px 16px', textAlign: 'center',
          background: drag ? 'var(--color-primary-muted)' : 'var(--color-surface-subtle)', display: 'grid', gap: 10, justifyItems: 'center' } },
        h('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' } }, 'Glissez votre fichier ici'),
        h('div', { style: muted }, 'ou'),
        h('button', { type: 'button', id: 'xs-imp-pick', style: S.btnPrimary, onClick: () => inputRef.current?.click() }, 'Choisir un fichier'),
        h('input', { ref: inputRef, type: 'file', accept: '.csv,.tsv,.txt,.xlsx,.xls,.ods', hidden: true, onChange: (e) => { pick(e.target.files?.[0]); e.target.value = '' } }),
        h('div', { style: muted }, 'Fichier CSV (séparateur point-virgule, virgule ou tabulation). La première ligne contient les titres des colonnes.')),
      fileError && h('div', { key: 'e', role: 'alert', style: box('danger') }, fileError),
      help && h('div', { key: 'x', role: 'status', style: box('warning') },
        h('strong', null, `« ${help} » est un classeur Excel. `),
        'Dans Excel : Fichier → Enregistrer sous → « CSV (séparateur : point-virgule) », puis choisissez ce nouveau fichier ici.'),
      h('div', { key: 't', style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
        h('button', { type: 'button', style: S.btnSecondary, onClick: () => download(templateFilename(kind), templateCsv(kind, opts)) },
          h(Icon.download, { size: 14 }), ' Télécharger le modèle'),
        h('span', { style: muted }, 'Colonnes recommandées et 2 exemples, à ouvrir dans Excel.')),
      !pharmacy && h('div', { key: 'p', style: muted }, 'Les colonnes propres à la pharmacie (DCI, forme, dosage, stupéfiant) ne sont proposées que si le secteur de l’entreprise est « Pharmacie ».'),
    ]
  } else if (step === 'check') {
    const p = file.parsed
    const fields = fieldsFor(kind, opts)
    const ign = ignoredColumns(p.headers, mapping)
    const r = check?.report
    const errs = r ? sortedErrors(r.errors) : []
    const shown = showAll ? errs : errs.slice(0, SHOW)
    const warns = [...(prepared?.warnings ?? []), ...(r?.warnings ?? [])]
    body = [
      h('div', { key: 'f', style: { ...muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
        h('strong', { style: { color: 'var(--color-text-primary)', wordBreak: 'break-all' } }, file.name),
        `· ${p.rows.length.toLocaleString('fr-FR')} ligne${p.rows.length > 1 ? 's' : ''} · ${p.encoding} · séparateur ${delimiterLabel(p.delimiter)}`,
        h('button', { type: 'button', style: { ...S.btnIcon, width: 'auto', padding: '0 8px', fontSize: 12 }, onClick: restart }, 'Changer de fichier')),
      p.blankLines > 0 && h('div', { key: 'bl', style: muted }, `${p.blankLines} ligne${p.blankLines > 1 ? 's' : ''} vide${p.blankLines > 1 ? 's' : ''} ignorée${p.blankLines > 1 ? 's' : ''}.`),
      h('div', { key: 'pv' },
        h('div', { style: S.label }, 'Aperçu des 5 premières lignes'),
        h('div', { style: scroller, tabIndex: 0, role: 'region', 'aria-label': 'Aperçu du fichier' },
          h('table', { style: S.table },
            h('thead', null, h('tr', null, h('th', { style: S.th }, 'Ligne'), p.headers.map((c, i) => h('th', { key: i, style: S.th }, c || `(colonne ${i + 1})`)))),
            h('tbody', null, p.rows.slice(0, 5).map(row => h('tr', { key: row.line },
              h('td', { style: { ...S.td, color: 'var(--color-text-tertiary)' } }, row.line),
              row.cells.map((c, i) => h('td', { key: i, style: { ...S.td, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' } }, c))))))) ),
      h('div', { key: 'mp' },
        h('div', { style: S.label }, 'Colonnes reconnues (modifiables)'),
        h('div', { role: 'group', 'aria-label': 'Correspondance des colonnes', style: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))' } },
          p.headers.map((c, i) => h('label', { key: i, style: { display: 'grid', gap: 4, minWidth: 0 } },
            h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: c }, c || `(colonne ${i + 1})`),
            h('select', { value: mapping[i] || '', style: { ...S.input, borderColor: mapping[i] ? 'var(--color-input-border)' : 'var(--color-border)', color: mapping[i] ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' },
              onChange: (e) => setMapping(m => setColumnField(m, i, e.target.value)) },
              h('option', { value: '' }, 'Ignorer cette colonne'),
              fields.map(f => h('option', { key: f.key, value: f.key }, f.label + (f.required ? ' *' : '')))))),
        ),
        ign.length > 0 && h('div', { style: { ...muted, marginTop: 6 } }, `Ignorée${ign.length > 1 ? 's' : ''} : ${ign.map(x => `« ${x.header || `colonne ${x.col + 1}`} »`).join(', ')}.`)),
      missing.length > 0 && h('div', { key: 'ms', role: 'alert', style: box('danger') }, `Il manque : ${missing.map(m => m.label).join(', ')}. Choisissez la colonne correspondante ci-dessus.`),
      skipCosts && h('div', { key: 'sc', style: box('info') }, 'Votre rôle n’a pas le droit coûts et marges : les prix d’achat ne seront pas importés.'),
      h('div', { key: 'dr', 'aria-live': 'polite' },
        h('div', { style: S.label }, 'Essai à blanc (rien n’est enregistré)'),
        check?.error && h('div', { role: 'alert', style: box('danger') }, check.error.message),
        check?.running && h('div', { style: { display: 'grid', gap: 6 } }, bar(check.done, check.total), h('div', { style: muted }, `Vérification du bloc ${Math.min(check.done + 1, check.total)} sur ${check.total}…`)),
        r && h('div', { style: { ...S.kpi, gap: 6 } },
          h('div', { style: { fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)' } }, summaryDryRun(r, kind)),
          r.errorsTruncated && h('div', { style: muted }, 'La liste d’erreurs est tronquée par le serveur ; corrigez celles-ci puis revérifiez.')),
        !check && !missing.length && !prepared?.rows.length && h('div', { style: muted }, 'Aucune ligne exploitable avec ce mapping.')),
      warns.length > 0 && h('div', { key: 'w', style: { display: 'grid', gap: 6 } },
        warns.map((w, i) => h('div', { key: i, style: box('warning') }, warningText(w), w.lines?.length ? ` Lignes : ${w.lines.slice(0, 8).join(', ')}${w.lines.length > 8 ? '…' : ''}.` : ''))),
      errs.length > 0 && h('div', { key: 'er' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
          h('div', { style: S.label }, `Erreurs (${errs.length.toLocaleString('fr-FR')})`),
          h('button', { type: 'button', style: S.btnSecondary, onClick: () => download('erreurs_import.csv', errorsCsv(errs, kind)) }, h(Icon.download, { size: 14 }), ' Télécharger les erreurs (CSV)')),
        h('div', { style: { ...scroller, maxHeight: 240 }, tabIndex: 0, role: 'region', 'aria-label': 'Liste des erreurs' },
          h('table', { style: S.table },
            h('thead', null, h('tr', null, ['Ligne', 'Champ', 'Message'].map(t => h('th', { key: t, style: S.th }, t)))),
            h('tbody', null, shown.map((e, i) => h('tr', { key: i },
              h('td', { style: S.td }, e.line), h('td', { style: { ...S.td, whiteSpace: 'nowrap' } }, fieldLabel(e.field, kind)), h('td', { style: S.td }, e.message)))))),
        errs.length > SHOW && !showAll && h('button', { type: 'button', style: { ...S.btnSecondary, marginTop: 8 }, onClick: () => setShowAll(true) }, `Voir les ${errs.length.toLocaleString('fr-FR')} erreurs`)),
      h('label', { key: 'at', style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--color-text-primary)' } },
        h('input', { type: 'checkbox', checked: atomic, onChange: (e) => setAtomic(e.target.checked) }), 'Tout annuler si une ligne est refusée'),
    ]
  } else {
    const rr = run
    body = [
      rr.running && h('div', { key: 'pr', 'aria-live': 'polite', style: { display: 'grid', gap: 8 } }, bar(rr.done, rr.total),
        h('div', { style: muted }, `Import du bloc ${Math.min(rr.done + 1, rr.total)} sur ${rr.total}… Ne fermez pas cette fenêtre.`)),
      rr.error && h('div', { key: 'er', role: 'alert', style: { display: 'grid', gap: 8 } },
        h('div', { style: box('danger') }, rr.error.message, ` (${rr.done} bloc${rr.done > 1 ? 's' : ''} sur ${rr.total} déjà importé${rr.done > 1 ? 's' : ''}.)`),
        rr.error.retryable && h('div', null, h('button', { type: 'button', style: S.btnPrimary, onClick: startImport }, 'Reprendre l’import'))),
      rr.finished && h('div', { key: 'ok', role: 'status', style: { display: 'grid', gap: 10 } },
        h('div', { style: { ...box(rr.report.rejected || rr.report.skipped ? 'warning' : 'success'), fontSize: 14, fontWeight: 600 } },
          rr.report.rejected || rr.report.skipped ? 'Import terminé avec des lignes refusées. ' : 'Import terminé. ', summaryFinal(rr.report, kind), '.'),
        rr.report.errors.length > 0 && h('div', null, h('button', { type: 'button', style: S.btnSecondary, onClick: () => download('erreurs_import.csv', errorsCsv(rr.report.errors, kind)) }, h(Icon.download, { size: 14 }), ' Télécharger les erreurs (CSV)')),
        rr.report.warnings.map((w, i) => h('div', { key: i, style: box('warning') }, warningText(w))),
        rr.report.replayed && h('div', { style: muted }, 'Une partie de l’import avait déjà été enregistrée : rien n’a été doublé.')),
    ]
  }

  const canRun = step === 'check' && !missing.length && check?.report && !check.running && validCount(check.report) > 0
  const footer = h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', padding: '14px 24px', borderTop: '1px solid var(--color-border)', position: 'sticky', bottom: 0, background: 'var(--color-popover, var(--color-card))' } },
    step === 'done' && run.finished && h('button', { type: 'button', style: S.btnSecondary, onClick: restart }, 'Importer un autre fichier'),
    h('button', { type: 'button', style: S.btnSecondary, disabled: !!run?.running, onClick: requestClose }, step === 'done' && run.finished ? 'Fermer' : 'Annuler'),
    step === 'check' && h('button', { type: 'button', id: 'xs-imp-go', style: { ...S.btnPrimary, opacity: canRun ? 1 : .5, cursor: canRun ? 'pointer' : 'not-allowed' }, disabled: !canRun, onClick: startImport },
      `Importer${check?.report ? ` (${validCount(check.report).toLocaleString('fr-FR')} ligne${validCount(check.report) > 1 ? 's' : ''})` : ''}`))

  return h(ModalShell, { wide: true, onClose: requestClose },
    h(ModalHeader, { title: `Importer — ${KIND_LABEL[kind]}`, subtitle: 'Assistant d’import', onClose: requestClose }),
    h('div', { style: { padding: '16px 24px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, minWidth: 0 } }, steps, body),
    footer)
}
