import { definePlugin } from '@infintywab/plugin-sdk'

const BASE = '/app/xstock'
const modalRoot = document.getElementById('modal-root') || document.body
const rt = window.__ERP_RUNTIME__ ?? {}
const { createPortal } = rt.ReactDOM ?? window.ReactDOM ?? {}

function qs(params = {}) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== void 0 && v !== null && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

function api(app) {
  return {
    products: {
      list:     (p) => app.apiGet(`${BASE}/products/${qs(p)}`),
      get:      (id) => app.apiGet(`${BASE}/products/${id}`),
      create:   (b) => app.apiPost(`${BASE}/products/`, b),
      update:   (id, b) => app.apiPatch(`${BASE}/products/${id}`, b),
      deactivate: (id) => app.apiPost(`${BASE}/products/${id}/deactivate`, {}),
    },
    warehouses: {
      list:     (p) => app.apiGet(`${BASE}/warehouses/${qs(p)}`),
      get:      (id) => app.apiGet(`${BASE}/warehouses/${id}`),
      create:   (b) => app.apiPost(`${BASE}/warehouses/`, b),
      update:   (id, b) => app.apiPatch(`${BASE}/warehouses/${id}`, b),
      locations: (id) => app.apiGet(`${BASE}/warehouses/${id}/locations`),
      createLocation: (wid, b) => app.apiPost(`${BASE}/warehouses/${wid}/locations`, b),
    },
    movements: {
      list:     (p) => app.apiGet(`${BASE}/movements/${qs(p)}`),
      byProduct: (id) => app.apiGet(`${BASE}/movements/by-product/${id}`),
      receive:  (b) => app.apiPost(`${BASE}/movements/receive`, b),
      issue:    (b) => app.apiPost(`${BASE}/movements/issue`, b),
      transfer: (b) => app.apiPost(`${BASE}/movements/transfer`, b),
      adjust:   (b) => app.apiPost(`${BASE}/movements/adjust`, b),
      levels:   () => app.apiGet(`${BASE}/movements/levels/`),
      levelsByProduct: (id) => app.apiGet(`${BASE}/movements/levels/by-product/${id}`),
    },
    inventory: {
      create:   (b) => app.apiPost(`${BASE}/inventory/`, b),
      byWarehouse: (id) => app.apiGet(`${BASE}/inventory/by-warehouse/${id}`),
      lines:    (id) => app.apiGet(`${BASE}/inventory/${id}/lines`),
      setLine:  (id, pid, qty) => app.apiPatch(`${BASE}/inventory/${id}/lines/${pid}`, { countedQuantity: qty }),
      validate: (id, reason) => app.apiPost(`${BASE}/inventory/${id}/validate`, { overrideReason: reason ?? null }),
      cancel:   (id) => app.apiPost(`${BASE}/inventory/${id}/cancel`, {}),
    },
    transfers: {
      create:   (b) => app.apiPost(`${BASE}/transfers/`, b),
      list:     () => app.apiGet(`${BASE}/transfers/`),
      lines:    (id) => app.apiGet(`${BASE}/transfers/${id}/lines`),
      ready:    (id) => app.apiPost(`${BASE}/transfers/${id}/ready`, {}),
      execute:  (id) => app.apiPost(`${BASE}/transfers/${id}/execute`, {}),
      cancel:   (id) => app.apiPost(`${BASE}/transfers/${id}/cancel`, {}),
    },
    settings: {
      get:      () => app.apiGet(`${BASE}/settings/`),
      update:   (b) => app.apiPatch(`${BASE}/settings/`, b),
      alerts:   () => app.apiGet(`${BASE}/settings/alert-subscriptions`),
      upsertAlert: (b) => app.apiPut(`${BASE}/settings/alert-subscriptions`, b),
      resetAlert: (alertType) => app.apiDelete(`${BASE}/settings/alert-subscriptions/${alertType}`),
      // Liste des membres du tenant courant, pour le sélecteur d'utilisateurs
      // du ciblage d'alertes — endpoint xauth (pas xstock), même app-tunnel.
      members: () => {
        const tenantId = app.getTenant?.()?.id
        if (!tenantId) return Promise.resolve([])
        return app.apiGet(`/app/auth/tenants/${tenantId}/members`)
      },
    },
    intelligence: {
      reorderPoint: (p) => app.apiGet(`${BASE}/intelligence/reorder-point${qs(p)}`),
      forecast:     (p) => app.apiGet(`${BASE}/intelligence/forecast${qs(p)}`),
      classify:     (b) => app.apiPost(`${BASE}/intelligence/classify`, b),
      stockoutRisk: (b) => app.apiPost(`${BASE}/intelligence/stockout-risk`, b),
      generateTransferSuggestions: (b) => app.apiPost(`${BASE}/intelligence/transfer-suggestions`, b),
      pendingSuggestions: () => app.apiGet(`${BASE}/intelligence/transfer-suggestions/pending`),
      approveSuggestion:  (id) => app.apiPost(`${BASE}/intelligence/transfer-suggestions/${id}/approve`, {}),
      rejectSuggestion:   (id) => app.apiPost(`${BASE}/intelligence/transfer-suggestions/${id}/reject`, {}),
      executeSuggestion:  (id) => app.apiPost(`${BASE}/intelligence/transfer-suggestions/${id}/execute`, {}),
    },
    attachments: {
      listForOwner: (ownerType, ownerId) => app.apiGet(`${BASE}/attachments/by-owner/${ownerType}/${ownerId}`),
      upload:       (ownerType, ownerId, filePath) => app.upload(`${BASE}/attachments/`, filePath, 'file', { ownerType, ownerId }),
      download:     (id, suggestedName) => app.download(`${BASE}/attachments/${id}/download`, suggestedName),
      remove:       (id) => app.apiDelete(`${BASE}/attachments/${id}`),
    },
  }
}

/* ─── CSV export ───────────────────────────────────────────────────────── */

function exportCSV(filename, headers, rows) {
  const bom = '﻿'
  const csv = bom + [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  })
  a.click()
  URL.revokeObjectURL(a.href)
}

/* ─── Responsive breakpoint hook ──────────────────────────────────────── */

function useMediaQuery(breakpoint) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < breakpoint)
  useEffect(() => {
    const handler = () => setNarrow(window.innerWidth < breakpoint)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])
  return narrow
}

/* ─── Icons ────────────────────────────────────────────────────────────── */

const Svg = (children) => (props) =>
  React.createElement('svg', {
    width: props?.size ?? 16, height: props?.size ?? 16,
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: props?.strokeWidth ?? 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    style: props?.style, className: props?.className,
  }, children)

const Icon = {
  package: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'M16.5 9.4 7.55 4.24' }),
    React.createElement('path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }),
    React.createElement('path', { d: 'M3.29 7 12 12l8.71-5' }),
    React.createElement('path', { d: 'M12 22V12' }),
  )),
  warehouse: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'M2 21V9l10-6 10 6v12' }),
    React.createElement('path', { d: 'M2 9h20' }),
    React.createElement('path', { d: 'M9 21V13h6v8' }),
  )),
  arrows: Svg(React.createElement(Fragment, null,
    React.createElement('polyline', { points: '17 1 21 5 17 9' }),
    React.createElement('path', { d: 'M3 11V9a4 4 0 0 1 4-4h14' }),
    React.createElement('polyline', { points: '7 23 3 19 7 15' }),
    React.createElement('path', { d: 'M21 13v2a4 4 0 0 1-4 4H3' }),
  )),
  plus: Svg(React.createElement(Fragment, null,
    React.createElement('line', { x1: '12', y1: '5', x2: '12', y2: '19' }),
    React.createElement('line', { x1: '5', y1: '12', x2: '19', y2: '12' }),
  )),
  search: Svg(React.createElement(Fragment, null,
    React.createElement('circle', { cx: '11', cy: '11', r: '8' }),
    React.createElement('path', { d: 'm21 21-4.35-4.35' }),
  )),
  edit: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
    React.createElement('path', { d: 'M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z' }),
  )),
  trash: Svg(React.createElement(Fragment, null,
    React.createElement('polyline', { points: '3 6 5 6 21 6' }),
    React.createElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
  )),
  x: Svg(React.createElement(Fragment, null,
    React.createElement('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
    React.createElement('line', { x1: '6', y1: '6', x2: '18', y2: '18' }),
  )),
  clipboard: Svg(React.createElement(Fragment, null,
    React.createElement('rect', { x: '8', y: '2', width: '8', height: '4', rx: '1' }),
    React.createElement('path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }),
    React.createElement('path', { d: 'M9 12h6M9 16h6' }),
  )),
  alertTri: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }),
    React.createElement('line', { x1: '12', y1: '9', x2: '12', y2: '13' }),
    React.createElement('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }),
  )),
  settings: Svg(React.createElement(Fragment, null,
    React.createElement('circle', { cx: '12', cy: '12', r: '3' }),
    React.createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }),
  )),
  trending: Svg(React.createElement(Fragment, null,
    React.createElement('polyline', { points: '22 7 13.5 15.5 8.5 10.5 2 17' }),
    React.createElement('polyline', { points: '16 7 22 7 22 13' }),
  )),
  paperclip: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' }),
  )),
  download: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    React.createElement('polyline', { points: '7 10 12 15 17 10' }),
    React.createElement('line', { x1: '12', y1: '15', x2: '12', y2: '3' }),
  )),
  upload: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    React.createElement('polyline', { points: '17 8 12 3 7 8' }),
    React.createElement('line', { x1: '12', y1: '3', x2: '12', y2: '15' }),
  )),
  more: Svg(React.createElement(Fragment, null,
    React.createElement('circle', { cx: '5', cy: '12', r: '1.6', fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { cx: '12', cy: '12', r: '1.6', fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { cx: '19', cy: '12', r: '1.6', fill: 'currentColor', stroke: 'none' }),
  )),
  users: Svg(React.createElement(Fragment, null,
    React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
    React.createElement('circle', { cx: '9', cy: '7', r: '4' }),
    React.createElement('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
    React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
  )),
  chevronRight: Svg(React.createElement('polyline', { points: '9 18 15 12 9 6' })),
  chevronDown: Svg(React.createElement('polyline', { points: '6 9 12 15 18 9' })),
  arrowUpRight: Svg(React.createElement(Fragment, null,
    React.createElement('line', { x1: '7', y1: '17', x2: '17', y2: '7' }),
    React.createElement('polyline', { points: '7 7 17 7 17 17' }),
  )),
}

/* ─── Styles ───────────────────────────────────────────────────────────── */

const S = {
  iconBox: { width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center',
    background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' },
  title: { fontFamily: '"IBM Plex Sans Variable", sans-serif', fontSize: 19, fontWeight: 800,
    textTransform: 'uppercase', letterSpacing: '-0.01em', color: 'var(--color-text-primary)' },
  subtitle: { fontSize: 12, fontWeight: 500, color: 'var(--color-text-tertiary)', marginTop: 2 },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tab: (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
    background: active ? 'var(--color-text-primary)' : 'transparent',
    color: active ? 'var(--color-bg)' : 'var(--color-text-tertiary)',
    boxShadow: active ? 'var(--shadow-sm)' : 'none',
    transition: 'all .12s',
  }),
  // Onglets de navigation principale (casse normale, plus lisible qu'en
  // majuscules) — distinct des chips de filtre ci-dessus (S.tab).
  navTab: (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 12.5, fontWeight: active ? 700 : 500,
    background: active ? 'var(--color-primary-muted)' : 'transparent',
    color: active ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
    transition: 'all .12s',
  }),
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-surface-subtle)', whiteSpace: 'nowrap' },
  td: { padding: '10px 14px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-primary)' },
  input: { width: '100%', padding: '9px 11px', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)', fontSize: 13, outline: 'none' },
  label: { display: 'block', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--color-text-tertiary)', marginBottom: 6 },
  btnPrimary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10,
    border: 'none', background: 'var(--color-primary)', color: 'var(--color-on-primary)',
    fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', cursor: 'pointer' },
  btnSecondary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10,
    border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)',
    fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', cursor: 'pointer' },
  btnDanger: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10,
    border: 'none', background: 'var(--color-danger)', color: 'var(--color-on-danger)',
    fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', cursor: 'pointer' },
  btnIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
    borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer' },
  // Bouton d'action coloré (une teinte sémantique par type d'opération, comme
  // dans l'ancien StockView : réception=success, sortie=primary, transfert=info, audit=warning).
  btnTint: (tint) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10,
    border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
    background: `var(--color-${tint}-muted)`, color: `var(--color-${tint}-text)`,
  }),
  card: { borderRadius: 18, border: '1px solid var(--color-border)', background: 'var(--color-card)',
    boxShadow: 'var(--shadow-sm)', overflow: 'hidden' },
  modal: { position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--color-scrim)', padding: 16 },
  modalInner: { width: '100%', maxWidth: 640, borderRadius: 16, border: '1px solid var(--color-border)',
    background: 'var(--color-popover)', boxShadow: 'var(--shadow-xl)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' },
  badge: (bg, fg, border) => ({
    display: 'inline-flex', alignItems: 'center', padding: '3px 10px', fontSize: 10, fontWeight: 800,
    textTransform: 'uppercase', letterSpacing: '0.03em',
    borderRadius: 9999, background: bg, color: fg, border: border ? `1px solid ${border}` : 'none',
  }),
  kpi: { padding: '16px 20px', borderRadius: 10, background: 'var(--color-surface-subtle)',
    display: 'flex', flexDirection: 'column', gap: 4 },
  kpiLabel: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' },
  kpiValue: { fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  grid4: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 },
  searchWrap: { position: 'relative' },
}

/* ─── Modal animation keyframes ──────────────────────────────────────── */

const ModalStyle = () => React.createElement('style', null, `
@keyframes xstock-fade-in { to { opacity: 1; } }
@keyframes xstock-slide-up { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes xstock-zoom-in { from { transform: scale(.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`)

/* ─── Modal shell (portal overlay) ───────────────────────────────────── */

const overlayBase = {
  position: 'fixed', inset: 0, zIndex: 400,
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  background: 'color-mix(in srgb, var(--color-scrim, rgba(0,0,0,.5)) 60%, transparent)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  animation: 'xstock-fade-in .2s ease forwards',
}

const overlayDesktop = {
  alignItems: 'center', padding: 24,
}

const panelBase = {
  width: '100%',
  background: 'var(--color-popover, var(--color-card, #fff))',
  borderTopLeftRadius: 32,
  borderTopRightRadius: 32,
  boxShadow: '0 -4px 40px rgba(0,0,0,.12), 0 0 0 1px var(--color-border, rgba(0,0,0,.08))',
  maxHeight: '92vh',
  overflowY: 'auto',
  animation: 'xstock-slide-up .25s ease-out forwards',
}

const panelDesktop = {
  maxWidth: 640,
  borderRadius: 32,
  boxShadow: '0 8px 48px rgba(0,0,0,.15), 0 0 0 1px var(--color-border, rgba(0,0,0,.08))',
  animation: 'xstock-zoom-in .2s ease-out forwards',
}

const panelWide = { maxWidth: 800 }

function ModalShell({ children, wide, onClose }) {
  const [desktop, setDesktop] = React.useState(window.innerWidth >= 640)
  React.useEffect(() => {
    const handler = () => setDesktop(window.innerWidth >= 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const overlayStyle = { ...overlayBase, ...(desktop ? overlayDesktop : {}) }
  const panelStyle = { ...panelBase, ...(desktop ? panelDesktop : {}), ...(wide ? panelWide : {}) }

  const content = React.createElement(React.Fragment, null,
    React.createElement(ModalStyle),
    React.createElement('div', {
      className: 'xstock-plugin', style: overlayStyle,
      onClick: e => { if (e.target === e.currentTarget) onClose?.() },
    },
      React.createElement('div', { style: panelStyle }, children),
    ),
  )

  return createPortal ? createPortal(content, modalRoot) : content
}

function ModalHeader({ title, subtitle, onClose }) {
  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '20px 24px', borderBottom: '1px solid var(--color-border, rgba(0,0,0,.06))',
    },
  },
    React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' } }, title),
      subtitle && React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--color-primary, var(--color-text-tertiary))', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' } }, subtitle),
    ),
    React.createElement('button', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 36, height: 36, borderRadius: '50%', border: 'none',
        background: 'var(--color-surface, rgba(0,0,0,.04))', color: 'var(--color-text-tertiary)',
        cursor: 'pointer', flexShrink: 0, marginLeft: 16,
      },
      'aria-label': 'Fermer', onClick: onClose,
    }, React.createElement(Icon.x, { size: 18 })),
  )
}

/* ─── Confirm dialog ─────────────────────────────────────────────────── */

function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }) {
  const content = React.createElement(React.Fragment, null,
    React.createElement(ModalStyle),
    React.createElement('div', {
      className: 'xstock-plugin',
      style: {
        position: 'fixed', inset: 0, zIndex: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'color-mix(in srgb, var(--color-scrim, rgba(0,0,0,.5)) 60%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: 'xstock-fade-in .2s ease forwards',
      },
      onClick: e => { if (e.target === e.currentTarget) onCancel?.() },
    },
      React.createElement('div', {
        style: {
          width: '100%', maxWidth: 380,
          background: 'var(--color-popover, #fff)',
          borderRadius: 28,
          boxShadow: '0 8px 48px rgba(0,0,0,.15)',
          padding: 28,
          textAlign: 'center',
          animation: 'xstock-zoom-in .2s ease-out forwards',
        },
      },
        danger && React.createElement('div', { style: {
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--color-danger-muted, #fef2f2)',
          color: 'var(--color-danger, #ef4444)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        } }, React.createElement(Icon.alertTri, { size: 24 })),
        React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' } }, title),
        message && React.createElement('div', { style: { fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 8, lineHeight: 1.4 } }, message),
        React.createElement('div', { style: { display: 'flex', gap: 10, marginTop: 24 } },
          React.createElement('button', {
            style: {
              flex: 1, padding: '12px 0', borderRadius: 14, border: '1px solid var(--color-border)',
              background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer',
              fontWeight: 600, fontSize: 12,
            },
            onClick: onCancel,
          }, 'Annuler'),
          React.createElement('button', {
            style: {
              flex: 1, padding: '12px 0', borderRadius: 14, border: 'none',
              background: danger ? 'var(--color-danger, #ef4444)' : 'var(--color-primary)',
              color: danger ? 'var(--color-on-danger)' : 'var(--color-on-primary)', cursor: 'pointer',
              fontWeight: 700, fontSize: 12,
            },
            onClick: onConfirm,
          }, confirmLabel ?? 'Confirmer'),
        ),
      ),
    ),
  )

  return createPortal ? createPortal(content, modalRoot) : content
}

/* ─── Badge helper ─────────────────────────────────────────────────────── */

const Badge = ({ status, label }) => {
  const m = {
    active: ['var(--color-success-muted)', 'var(--color-success-text)', 'var(--color-success-border)'],
    inactive: ['var(--color-surface-subtle)', 'var(--color-text-secondary)', 'var(--color-border)'],
    draft: ['var(--color-surface-subtle)', 'var(--color-text-secondary)', 'var(--color-border)'],
    ready: ['var(--color-info-muted)', 'var(--color-info-text)', 'var(--color-info-border)'],
    done: ['var(--color-success-muted)', 'var(--color-success-text)', 'var(--color-success-border)'],
    cancelled: ['var(--color-danger-muted)', 'var(--color-danger-text)', 'var(--color-danger-border)'],
    open: ['var(--color-info-muted)', 'var(--color-info-text)', 'var(--color-info-border)'],
    validated: ['var(--color-success-muted)', 'var(--color-success-text)', 'var(--color-success-border)'],
    true: ['var(--color-success-muted)', 'var(--color-success-text)', 'var(--color-success-border)'],
    false: ['var(--color-surface-subtle)', 'var(--color-text-secondary)', 'var(--color-border)'],
  }
  const [bg, fg, br] = m[String(status ?? '')] ?? ['var(--color-surface-subtle)', 'var(--color-text-secondary)', 'var(--color-border)']
  return React.createElement('span', { style: S.badge(bg, fg, br) }, label ?? String(status ?? '—'))
}

// Variante "point coloré + texte" (sans fond) — pour les tableaux denses où
// une pastille pleine par ligne charge trop visuellement.
const DotBadge = ({ status, label }) => {
  const colors = {
    true: 'var(--color-success)', active: 'var(--color-success)',
    false: 'var(--color-text-tertiary)', inactive: 'var(--color-text-tertiary)',
  }
  const color = colors[String(status ?? '')] ?? 'var(--color-text-tertiary)'
  return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-primary)' } },
    React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 } }),
    label ?? String(status ?? '—'),
  )
}

/* ─── KPI card ─────────────────────────────────────────────────────────── */

function KpiCard({ icon, tint, label, value, sub, subTint, onClick }) {
  return React.createElement('div', {
    className: onClick ? 'xstock-kpi-clickable' : undefined,
    style: { ...S.card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative',
      cursor: onClick ? 'pointer' : 'default', transition: onClick ? 'box-shadow .12s, transform .12s' : undefined },
    onClick, role: onClick ? 'button' : undefined, tabIndex: onClick ? 0 : undefined,
    onKeyDown: onClick ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } }) : undefined,
  },
    onClick && React.createElement(Icon.arrowUpRight, {
      size: 13, style: { position: 'absolute', top: 16, right: 16, color: 'var(--color-text-tertiary)' },
    }),
    React.createElement('span', {
      style: { width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center',
        background: `var(--color-${tint}-muted)`, color: `var(--color-${tint}-text)` },
    }, React.createElement(icon, { size: 15 })),
    React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: 4 } }, label),
      React.createElement('div', { style: { fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)' } }, value),
    ),
    sub && React.createElement('div', { style: { fontSize: 12, color: subTint ? `var(--color-${subTint})` : 'var(--color-text-tertiary)', fontWeight: subTint ? 700 : 500 } }, sub),
  )
}

/* ─── Row action menu ─────────────────────────────────────────────────── */
// Un seul bouton "⋯" par ligne plutôt que des icônes qui n'apparaissent
// qu'au survol — plus simple à découvrir, fonctionne aussi au clavier/tactile.

function DropdownMenu({ items, trigger }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const triggerEl = trigger ?? React.createElement('button', { style: S.btnIcon, 'aria-label': 'Actions' },
    React.createElement(Icon.more, { size: 15 }))

  return React.createElement('div', { ref, style: { position: 'relative', display: 'inline-block' } },
    React.cloneElement(triggerEl, {
      'aria-haspopup': 'menu', 'aria-expanded': open,
      onClick: (e) => { e.stopPropagation(); setOpen(o => !o) },
    }),
    open && React.createElement('div', {
      style: {
        position: 'absolute', top: '110%', right: 0, zIndex: 50, minWidth: 200,
        borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-popover)',
        boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 1,
      },
      onClick: (e) => e.stopPropagation(),
    }, items.map((it, i) => it.divider
      ? React.createElement('div', { key: i, style: { height: 1, background: 'var(--color-border)', margin: '4px 2px' } })
      : React.createElement('button', {
          key: i,
          style: {
            display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
            padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent',
            color: it.danger ? 'var(--color-danger)' : 'var(--color-text-primary)', fontSize: 13, cursor: 'pointer',
          },
          onClick: () => { setOpen(false); it.onClick() },
        }, it.icon && React.createElement(it.icon, { size: 14 }), it.label),
    )),
  )
}

/* ─── Stock level indicator ───────────────────────────────────────────── */
// Quantité disponible (agrégée tous entrepôts) + repère visuel de niveau,
// calculé depuis le seuil min réel du produit — jamais une valeur inventée.

function StockBar({ quantity, minThreshold }) {
  const empty = quantity <= 0
  const low = !empty && minThreshold > 0 && quantity <= minThreshold
  const color = empty ? 'var(--color-danger)' : low ? 'var(--color-warning)' : 'var(--color-success)'
  const label = empty ? 'Rupture' : low ? 'Stock bas' : 'En stock'
  const ceiling = minThreshold > 0 ? minThreshold * 3 : Math.max(quantity, 1)
  const pct = empty ? 0 : Math.max(8, Math.min(100, Math.round((quantity / ceiling) * 100)))
  // Point + pastille de largeur fixe plutôt qu'un trait fin collé au texte —
  // pour ne pas ressembler à un soulignement de champ éditable (la ligne
  // n'est pas modifiable ici, l'édition se fait via la ligne / le menu).
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 96 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
      React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 } }),
      React.createElement('span', { style: { fontFamily: 'monospace', fontWeight: 700 } }, quantity.toLocaleString('fr-FR')),
      React.createElement('span', { style: { fontSize: 11, color, fontWeight: 600 } }, label),
    ),
    React.createElement('div', { style: { height: 4, width: 72, borderRadius: 9999, background: 'var(--color-surface-subtle)', overflow: 'hidden' } },
      React.createElement('div', { style: { height: '100%', width: `${pct}%`, background: color, borderRadius: 9999 } }),
    ),
  )
}

/* ─── Category tag ────────────────────────────────────────────────────── */
// Pastille de couleur dérivée du nom de catégorie (même catégorie = même
// couleur toujours) — juste un repère de balayage visuel, aucune donnée
// supplémentaire n'est inventée.

function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h % 360
}

function CategoryTag({ label }) {
  if (!label) return React.createElement('span', { style: { color: 'var(--color-text-tertiary)' } }, '—')
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
    React.createElement('span', { style: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: `hsl(${hashHue(label)} 60% 50%)` } }),
    React.createElement('span', null, label),
  )
}

/* ─── Move type badge metadata ────────────────────────────────────────── */
// Partagé entre MovementsTab et WarehouseDetailModal — une seule source pour
// libellé + couleurs par type de mouvement.

const MOVE_TYPE_META = {
  in:         { label: 'Entrée',     bg: 'var(--color-success-muted)', fg: 'var(--color-success-text)' },
  out:        { label: 'Sortie',     bg: 'var(--color-danger-muted)',  fg: 'var(--color-danger-text)' },
  transfer:   { label: 'Transfert',  bg: 'var(--color-info-muted)',    fg: 'var(--color-info-text)' },
  adjustment: { label: 'Ajustement', bg: 'var(--color-warning-muted)', fg: 'var(--color-warning-text)' },
}

/* ─── Sparkline ────────────────────────────────────────────────────────── */
// Mini-courbe dérivée de vraies données de mouvement (delta de solde jour
// par jour) — jamais une tendance inventée. Une série entièrement à zéro
// affiche une ligne pointillée plate ("aucune activité") plutôt qu'un faux
// signal de stabilité.

function Sparkline({ data, width = 96, height = 26, color }) {
  if (!data || data.length === 0) return null
  if (data.every(v => v === 0)) {
    return React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` },
      React.createElement('line', { x1: 0, y1: height / 2, x2: width, y2: height / 2,
        stroke: 'var(--color-border)', strokeWidth: 1.5, strokeDasharray: '3 3' }))
  }
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const stepX = data.length > 1 ? width / (data.length - 1) : 0
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ')
  const up = data[data.length - 1] >= data[0]
  const stroke = color ?? (up ? 'var(--color-success)' : 'var(--color-danger)')
  return React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}`, style: { display: 'block', overflow: 'visible' } },
    React.createElement('polyline', { points, fill: 'none', stroke, strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

// Delta net (balanceAfter - balanceBefore) par jour sur les `days` derniers
// jours, pour un entrepôt — dérivé des vrais mouvements, pas une estimation.
function buildDailyTrend(moves, warehouseId, days = 7) {
  const today = new Date()
  const keys = []
  const buckets = new Map()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    keys.push(key)
    buckets.set(key, 0)
  }
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  cutoff.setHours(0, 0, 0, 0)
  for (const m of moves) {
    if (m.warehouseId !== warehouseId) continue
    const d = new Date(m.moveDate)
    if (d < cutoff) continue
    const key = d.toISOString().slice(0, 10)
    if (!buckets.has(key)) continue
    buckets.set(key, buckets.get(key) + (m.balanceAfter - m.balanceBefore))
  }
  return keys.map(k => buckets.get(k))
}

/* ─── Loading spinner ──────────────────────────────────────────────────── */

const Spinner = () =>
  React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 48 } },
    React.createElement('div', { style: {
      width: 28, height: 28, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)',
      borderRadius: '50%', animation: 'xstock-spin .6s linear infinite',
    } }),
    React.createElement('style', null, '@keyframes xstock-spin{to{transform:rotate(360deg)}}'),
  )

// Placeholder de lignes de tableau pendant le premier chargement — moins
// de "saut" visuel qu'un spinner centré quand la table occupe déjà l'espace.
function TableSkeleton({ rows = 6, cols = 5 }) {
  return React.createElement(Fragment, null,
    React.createElement('style', null,
      '@keyframes xstock-shimmer{0%{opacity:.5}50%{opacity:1}100%{opacity:.5}}'),
    React.createElement('div', { style: S.card },
      Array.from({ length: rows }).map((_, r) =>
        React.createElement('div', {
          key: r,
          style: { display: 'flex', gap: 24, alignItems: 'center', padding: '14px 16px',
            borderBottom: r < rows - 1 ? '1px solid var(--color-border)' : 'none' },
        },
          Array.from({ length: cols }).map((__, c) =>
            React.createElement('div', {
              key: c,
              style: { height: 12, borderRadius: 6, background: 'var(--color-surface-subtle)',
                flex: c === 0 ? 2 : 1, animation: `xstock-shimmer 1.4s ease-in-out ${(r * cols + c) * 0.04}s infinite` },
            }),
          ),
        ),
      ),
    ),
  )
}

// État vide avec icône + texte d'action — remplace la simple ligne de texte
// centrée, pour signaler explicitement quoi faire plutôt que juste "rien ici".
function EmptyState({ icon, title, hint, action }) {
  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '56px 24px', textAlign: 'center' },
  },
    icon && React.createElement('span', {
      style: { width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center',
        background: 'var(--color-surface-subtle)', color: 'var(--color-text-tertiary)' },
    }, React.createElement(icon, { size: 20 })),
    React.createElement('div', { style: { fontWeight: 700, color: 'var(--color-text-secondary)', fontSize: 13 } }, title),
    hint && React.createElement('div', { style: { fontSize: 12, color: 'var(--color-text-tertiary)', maxWidth: 320 } }, hint),
    action && React.createElement('button', {
      style: { ...S.btnPrimary, marginTop: 8 }, onClick: action.onClick,
    }, action.icon && React.createElement(action.icon, { size: 14 }), ' ' + action.label),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   PRODUCTS TAB
   ════════════════════════════════════════════════════════════════════════ */

function ProductsTab({ app, api, onNavigate }) {
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [levels, setLevels] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [edit, setEdit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [adjusting, setAdjusting] = useState(null)
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [selected, setSelected] = useState(() => new Set())

  const toggleSort = useCallback((key) => {
    setSortKey(prevKey => {
      setSortDir(prevDir => (prevKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'))
      return key
    })
  }, [])

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true)
    try {
      const [p, w, l] = await Promise.all([api.products.list(), api.warehouses.list(), api.movements.levels()])
      setProducts(p ?? []); setWarehouses(w ?? []); setLevels(l ?? [])
    } catch (e) { if (!silent) app.notify('Erreur chargement produits', 'error') }
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [])
  // Rafraîchit silencieusement quand un autre poste enregistre un mouvement —
  // le stock affiché ici doit rester à jour sans action de l'utilisateur.
  useEffect(() => app.onRealtime('xstock', () => load(true)), [load])

  const stockByProduct = useMemo(() => {
    const m = new Map()
    for (const l of levels) m.set(l.productId, (m.get(l.productId) ?? 0) + l.availableQuantity)
    return m
  }, [levels])

  const categories = useMemo(() =>
    Array.from(new Set(products.map(p => p.categoryId).filter(Boolean))).sort(),
    [products],
  )

  const lowStockCount = useMemo(() =>
    products.filter(p => p.isActive && p.minThreshold > 0 && (stockByProduct.get(p.id) ?? 0) <= p.minThreshold).length,
    [products, stockByProduct],
  )

  // KPI — tout est calculé depuis les vraies données déjà chargées (produits,
  // entrepôts, niveaux de stock) : pas de revenu/commandes/clients, xstock
  // ne gère pas de ventes.
  const activeCount = useMemo(() => products.filter(p => p.isActive).length, [products])
  const newThisWeekCount = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return products.filter(p => p.createdAt && new Date(p.createdAt).getTime() >= weekAgo).length
  }, [products])
  const stockValue = useMemo(() => {
    const purchasePriceById = new Map(products.map(p => [p.id, p.purchasePrice ?? 0]))
    return levels.reduce((sum, l) => sum + l.availableQuantity * (purchasePriceById.get(l.productId) ?? 0), 0)
  }, [levels, products])
  const activeWarehouseCount = useMemo(() => warehouses.filter(w => w.isActive).length, [warehouses])

  const toggleSelect = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const handleBulkExport = useCallback(() => {
    const rows = products.filter(p => selected.has(p.id))
    exportCSV(`produits_selection_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Code', 'Nom', 'Catégorie', 'Stock', 'Prix de vente', 'Statut'],
      rows.map(p => [p.code, p.name, p.categoryId ?? '', stockByProduct.get(p.id) ?? 0, p.salePrice ?? '', p.isActive ? 'Actif' : 'Inactif']),
    )
  }, [products, selected, stockByProduct])

  // Nombre d'éléments sélectionnés dans chaque état — la barre d'actions
  // groupées s'y adapte au lieu de proposer systématiquement « Désactiver ».
  const selectionCounts = useMemo(() => {
    let active = 0, inactive = 0
    for (const id of selected) {
      const p = products.find(x => x.id === id)
      if (!p) continue
      if (p.isActive) active++; else inactive++
    }
    return { active, inactive }
  }, [selected, products])

  const handleBulkDeactivate = useCallback(async () => {
    const ids = Array.from(selected).filter(id => products.find(p => p.id === id)?.isActive)
    if (!ids.length) return
    try {
      await Promise.all(ids.map(id => api.products.deactivate(id)))
      clearSelection()
      await load()
      app.notify(`${ids.length} produit(s) désactivé(s)`, 'success')
    } catch (e) { app.notify(e?.message ?? 'Erreur lors de la désactivation groupée', 'error') }
  }, [selected, products, load, clearSelection])

  // Pendant de handleBulkDeactivate. Son absence rendait la désactivation
  // groupée IRRÉVERSIBLE en masse : on pouvait désactiver tout un catalogue
  // d'un clic et devoir le réactiver article par article.
  // Il n'existe pas d'endpoint /activate ; la réactivation passe par un PATCH
  // `isActive: true`, comme le fait déjà l'action unitaire.
  const handleBulkReactivate = useCallback(async () => {
    const ids = Array.from(selected).filter(id => products.find(p => p.id === id)?.isActive === false)
    if (!ids.length) return
    try {
      await Promise.all(ids.map(id => api.products.update(id, { isActive: true })))
      clearSelection()
      await load()
      app.notify(`${ids.length} produit(s) réactivé(s)`, 'success')
    } catch (e) { app.notify(e?.message ?? 'Erreur lors de la réactivation groupée', 'error') }
  }, [selected, products, load, clearSelection])

  const filtered = useMemo(() => {
    let list = products
    if (statusFilter !== 'all') list = list.filter(p => p.isActive === (statusFilter === 'active'))
    if (categoryFilter !== 'all') list = list.filter(p => p.categoryId === categoryFilter)
    if (lowStockOnly) list = list.filter(p => p.minThreshold > 0 && (stockByProduct.get(p.id) ?? 0) <= p.minThreshold)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p => p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q))
    }
    return list
  }, [products, search, categoryFilter, statusFilter, lowStockOnly, stockByProduct])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const getVal = {
      name: p => p.name?.toLowerCase() ?? '',
      categoryId: p => p.categoryId?.toLowerCase() ?? '',
      stock: p => stockByProduct.get(p.id) ?? 0,
      salePrice: p => p.salePrice ?? 0,
      isActive: p => p.isActive ? 1 : 0,
    }[sortKey]
    return filtered.slice().sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [filtered, sortKey, sortDir, stockByProduct])

  const handleExport = useCallback(() => {
    exportCSV(`produits_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Code', 'Nom', 'Catégorie', 'Unité', 'Stock', 'Seuil min', 'Prix de vente', 'Prix d\'achat', 'Statut'],
      sorted.map(p => [
        p.code, p.name, p.categoryId ?? '', p.unit, stockByProduct.get(p.id) ?? 0, p.minThreshold ?? '',
        p.salePrice ?? '', p.purchasePrice ?? '', p.isActive ? 'Actif' : 'Inactif',
      ]),
    )
  }, [sorted, stockByProduct])

  const handleDeactivate = useCallback(async () => {
    if (!deletingId) return
    try { await api.products.deactivate(deletingId); setDeletingId(null); await load(); app.notify('Produit désactivé — visible sous le filtre "Inactifs"', 'success') }
    catch (e) { app.notify(e?.message ?? 'Erreur lors de la désactivation', 'error') }
  }, [deletingId])

  // Pas d'endpoint "reactivate" dédié côté backend — un simple update
  // isActive:true fait l'affaire (même schéma que celui déjà utilisé par le
  // formulaire d'édition).
  const handleReactivate = useCallback(async (id) => {
    try { await api.products.update(id, { isActive: true }); await load(); app.notify('Produit réactivé', 'success') }
    catch (e) { app.notify(e?.message ?? 'Erreur lors de la réactivation', 'error') }
  }, [load])

  const handleSave = useCallback(async (data) => {
    setSaving(true)
    try {
      if (edit) await api.products.update(edit.id, data)
      else await api.products.create(data)
      setFormOpen(false)
      setEdit(null)
      await load()
      app.notify(edit ? 'Produit modifié' : 'Produit créé', 'success')
    } catch (e) { app.notify(e?.message ?? 'Erreur enregistrement', 'error') }
    setSaving(false)
  }, [edit])

  const handleAdjust = useCallback(async (data) => {
    setSaving(true)
    try {
      await api.movements.adjust({ productId: adjusting.id, ...data })
      setAdjusting(null)
      await load()
      app.notify('Stock ajusté', 'success')
    } catch (e) { app.notify("Erreur lors de l'ajustement", 'error') }
    setSaving(false)
  }, [adjusting])

  const productName = deletingId ? products.find(p => p.id === deletingId)?.name : ''

  if (loading) return React.createElement(TableSkeleton, { cols: 6 })

  const allVisibleSelected = sorted.length > 0 && sorted.every(p => selected.has(p.id))
  const someVisibleSelected = sorted.some(p => selected.has(p.id))

  return React.createElement(Fragment, null,
    React.createElement('div', { style: S.grid4 },
      React.createElement(KpiCard, {
        icon: Icon.package, tint: 'primary', label: 'Produits actifs', value: activeCount.toLocaleString('fr-FR'),
        sub: newThisWeekCount > 0 ? `+${newThisWeekCount} cette semaine` : 'Aucun nouveau cette semaine',
        subTint: newThisWeekCount > 0 ? 'success' : undefined,
      }),
      React.createElement(KpiCard, {
        icon: Icon.trending, tint: 'success', label: 'Valeur du stock', value: stockValue.toLocaleString('fr-FR', { maximumFractionDigits: 0 }),
        sub: `Sur ${activeWarehouseCount} entrepôt${activeWarehouseCount > 1 ? 's' : ''} actif${activeWarehouseCount > 1 ? 's' : ''}`,
      }),
      React.createElement(KpiCard, {
        icon: Icon.warehouse, tint: 'info', label: 'Entrepôts actifs', value: activeWarehouseCount.toLocaleString('fr-FR'),
        sub: warehouses.length > activeWarehouseCount ? `${warehouses.length - activeWarehouseCount} inactif(s)` : 'Tous actifs',
        onClick: onNavigate ? () => onNavigate('warehouses') : undefined,
      }),
      React.createElement(KpiCard, {
        icon: Icon.alertTri, tint: lowStockCount > 0 ? 'warning' : 'success', label: 'Stock bas', value: lowStockCount.toLocaleString('fr-FR'),
        sub: lowStockCount > 0 ? 'Réapprovisionnement à prévoir' : 'Aucune alerte', subTint: lowStockCount > 0 ? 'warning' : 'success',
        onClick: lowStockCount > 0 ? () => setLowStockOnly(true) : undefined,
      }),
    ),
    lowStockCount > 0 && !lowStockOnly && React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12,
        background: 'var(--color-danger-muted)', color: 'var(--color-danger-text)', border: '1px solid var(--color-danger-border)',
      },
    },
      React.createElement(Icon.alertTri, { size: 15, style: { flexShrink: 0 } }),
      React.createElement('span', { style: { fontSize: 13, fontWeight: 600, flex: 1 } },
        `${lowStockCount} produit${lowStockCount > 1 ? 's' : ''} sous le seuil critique`),
      React.createElement('button', {
        style: { fontSize: 12, fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' },
        onClick: () => setLowStockOnly(true),
      }, 'Filtrer'),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 280 } },
        React.createElement('div', { style: { position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 } },
          React.createElement(Icon.search, { size: 14, style: { position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' } }),
          React.createElement('input', { style: { ...S.input, paddingLeft: 34 }, placeholder: 'Rechercher un produit…', value: search, onChange: e => setSearch(e.target.value) }),
        ),
        React.createElement('div', { style: { position: 'relative' } },
          React.createElement('select', {
            style: { ...S.input, width: 'auto', minWidth: 150, paddingRight: 30, appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', cursor: 'pointer' },
            value: categoryFilter, onChange: e => setCategoryFilter(e.target.value),
          },
            React.createElement('option', { value: 'all' }, 'Toutes catégories'),
            categories.map(c => React.createElement('option', { key: c, value: c }, c)),
          ),
          React.createElement(Icon.chevronDown, { size: 12, style: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' } }),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 2, background: 'var(--color-surface-subtle)', borderRadius: 10, padding: 2 } },
          [['active', 'Actifs'], ['inactive', 'Inactifs'], ['all', 'Tous']].map(([v, l]) =>
            React.createElement('button', {
              key: v,
              style: {
                padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: statusFilter === v ? 'var(--color-card)' : 'transparent',
                color: statusFilter === v ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                boxShadow: statusFilter === v ? 'var(--shadow-sm)' : 'none',
              },
              onClick: () => setStatusFilter(v),
            }, l),
          ),
        ),
        lowStockOnly && React.createElement('button', {
          style: { ...S.badge('var(--color-danger-muted)', 'var(--color-danger-text)'), border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 },
          onClick: () => setLowStockOnly(false),
        }, 'Seuil critique', React.createElement(Icon.x, { size: 11 })),
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
        React.createElement('button', { style: S.btnSecondary, onClick: handleExport, title: 'Exporter en CSV' },
          React.createElement(Icon.download, { size: 14 }), ' Exporter'),
        React.createElement('button', { style: S.btnPrimary, onClick: () => { setEdit(null); setFormOpen(true) } },
          React.createElement(Icon.plus, { size: 15 }), ' Nouveau produit'),
      ),
    ),
    React.createElement('div', { className: 'xstock-table-card', style: { ...S.card, overflow: 'visible', marginTop: 8 } },
      React.createElement('table', { style: S.table, className: 'xstock-hoverable' },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', { style: { ...S.th, width: 36 } },
              React.createElement('input', {
                type: 'checkbox', checked: allVisibleSelected,
                ref: el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected },
                onChange: () => setSelected(prev => {
                  if (allVisibleSelected) { const next = new Set(prev); sorted.forEach(p => next.delete(p.id)); return next }
                  const next = new Set(prev); sorted.forEach(p => next.add(p.id)); return next
                }),
              }),
            ),
            [['Produit', 'name'], ['Catégorie', 'categoryId'], ['Code', 'code'], ['Créé le', 'createdAt'], ['Stock', 'stock'], ['Prix de vente', 'salePrice'], ['Statut', 'isActive'], ['Action', null]].map(([h, key]) =>
              React.createElement('th', {
                key: h ?? 'actions', className: key ? 'xstock-sortable-th' : undefined,
                style: { ...S.th, cursor: key ? 'pointer' : 'default', userSelect: 'none' },
                onClick: key ? () => toggleSort(key) : undefined,
              },
                React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
                  h,
                  key && (sortKey === key
                    ? React.createElement('span', null, sortDir === 'asc' ? ' ▲' : ' ▼')
                    : React.createElement(Icon.chevronDown, { size: 10, className: 'xstock-sort-chevron' })),
                ),
              ),
            ),
          ),
        ),
        React.createElement('tbody', null,
          sorted.length === 0
            ? React.createElement('tr', null,
                React.createElement('td', { colSpan: 8, style: { border: 'none' } },
                  products.length === 0
                    ? React.createElement(EmptyState, {
                        icon: Icon.package, title: 'Aucun produit pour le moment',
                        hint: 'Ajoute ton premier produit pour commencer à suivre le stock.',
                        action: { label: 'Nouveau produit', icon: Icon.plus, onClick: () => { setEdit(null); setFormOpen(true) } },
                      })
                    : React.createElement(EmptyState, {
                        icon: Icon.package, title: 'Aucun produit trouvé',
                        hint: 'Essaie de modifier ou réinitialiser les filtres.',
                      })))
            : sorted.map((p) =>
                React.createElement('tr', {
                  // Le clic sur la ligne ouvrait l'édition — jugé « pas
                  // nécessaire et perturbant » en test. Dans un outil de
                  // saisie on clique pour sélectionner ; l'édition reste
                  // accessible par le menu d'action, explicite.
                  key: p.id, style: { background: selected.has(p.id) ? 'var(--color-primary-muted)' : undefined },
                },
                  React.createElement('td', { style: S.td, onClick: e => e.stopPropagation() },
                    React.createElement('input', { type: 'checkbox', checked: selected.has(p.id), onChange: () => toggleSelect(p.id) }),
                  ),
                  React.createElement('td', { style: S.td },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                      React.createElement('span', { style: { width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center',
                        background: 'var(--color-primary-muted)', color: 'var(--color-primary-text)', flexShrink: 0 } },
                        React.createElement(Icon.package, { size: 14 }),
                      ),
                      React.createElement('div', null,
                        React.createElement('div', { style: { fontWeight: 500 } }, p.name),
                        React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)' } }, p.categoryId ?? 'Sans catégorie'),
                      ),
                    ),
                  ),
                  React.createElement('td', { style: S.td }, React.createElement(CategoryTag, { label: p.categoryId })),
                  // « ID & création » réunissait deux informations sans
                  // rapport, et affichait l'identifiant technique préfixé d'un
                  // « # ». Le code produit est une donnée métier : il se lit et
                  // se recherche, il mérite sa colonne.
                  React.createElement('td', { style: S.td },
                    React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12, fontWeight: 700 } }, p.code || '—'),
                  ),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } },
                    p.createdAt ? new Date(p.createdAt).toLocaleDateString('fr-FR') : '—'),
                  React.createElement('td', { style: S.td }, React.createElement(StockBar, { quantity: stockByProduct.get(p.id) ?? 0, minThreshold: p.minThreshold ?? 0 })),
                  React.createElement('td', { style: S.td },
                    React.createElement('div', { style: { fontFamily: 'monospace', fontWeight: 600 } }, p.salePrice != null ? p.salePrice.toLocaleString('fr-FR') : '—'),
                    p.purchasePrice != null && React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)' } }, `Achat ${p.purchasePrice.toLocaleString('fr-FR')}`),
                  ),
                  React.createElement('td', { style: S.td }, React.createElement(DotBadge, { status: p.isActive, label: p.isActive ? 'Actif' : 'Inactif' })),
                  React.createElement('td', { style: { ...S.td, textAlign: 'right' }, onClick: e => e.stopPropagation() },
                    React.createElement(DropdownMenu, {
                      items: [
                        { label: 'Modifier', icon: Icon.edit, onClick: () => { setEdit(p); setFormOpen(true) } },
                        { label: 'Ajuster le stock', icon: Icon.arrows, onClick: () => setAdjusting(p) },
                        { divider: true },
                        p.isActive
                          ? { label: 'Désactiver', icon: Icon.trash, danger: true, onClick: () => setDeletingId(p.id) }
                          : { label: 'Réactiver', icon: Icon.trending, onClick: () => handleReactivate(p.id) },
                      ],
                    }),
                  ),
                ),
              ),
        ),
      ),
    ),
    selected.size > 0 && React.createElement('div', {
      style: { position: 'sticky', bottom: 16, display: 'flex', justifyContent: 'center', pointerEvents: 'none' },
    },
      React.createElement('div', {
        style: {
          pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px 10px 18px',
          borderRadius: 9999, background: 'var(--color-text-primary)', color: 'var(--color-bg)', boxShadow: '0 8px 24px rgba(0,0,0,.2)',
        },
      },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 700 } }, `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}`),
        React.createElement('button', {
          style: { ...S.btnSecondary, padding: '6px 12px', fontSize: 12, background: 'transparent', color: 'inherit', border: '1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)' },
          onClick: handleBulkExport,
        }, React.createElement(Icon.download, { size: 13 }), ' Exporter'),
        // Les deux actions n'apparaissent que si la sélection les concerne :
        // proposer « Désactiver » sur des produits déjà inactifs n'a pas de
        // sens, et l'absence de « Réactiver » rendait la désactivation
        // groupée irréversible (AUDIT-RETOURS-TERRAIN.md, P1.5).
        selectionCounts.inactive > 0 && React.createElement('button', {
          style: { ...S.btnSecondary, padding: '6px 12px', fontSize: 12, background: 'transparent', color: 'inherit', border: '1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)' },
          onClick: handleBulkReactivate,
          title: `Réactiver ${selectionCounts.inactive} produit(s)`,
        }, React.createElement(Icon.trending, { size: 13 }), ` Réactiver (${selectionCounts.inactive})`),
        selectionCounts.active > 0 && React.createElement('button', {
          style: { ...S.btnSecondary, padding: '6px 12px', fontSize: 12, background: 'transparent', color: 'var(--color-danger)', border: '1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)' },
          onClick: handleBulkDeactivate,
          title: `Désactiver ${selectionCounts.active} produit(s)`,
        }, React.createElement(Icon.trash, { size: 13 }), ` Désactiver (${selectionCounts.active})`),
        React.createElement('button', {
          style: { ...S.btnIcon, color: 'inherit' }, title: 'Désélectionner', onClick: clearSelection,
        }, React.createElement(Icon.x, { size: 14 })),
      ),
    ),
    formOpen && React.createElement(ProductFormModal, { app, product: edit, onSave: handleSave, onClose: () => { setFormOpen(false); setEdit(null) }, saving }),
    adjusting && React.createElement(AdjustStockModal, {
      product: adjusting, warehouses, onSave: handleAdjust, onClose: () => setAdjusting(null), saving,
    }),
    deletingId && React.createElement(ConfirmDialog, {
      title: 'Désactiver ce produit ?',
      message: `"${productName}" ne sera plus disponible pour de nouveaux mouvements. Il reste consultable dans l'historique.`,
      confirmLabel: 'Désactiver',
      danger: true,
      onConfirm: handleDeactivate,
      onCancel: () => setDeletingId(null),
    }),
  )
}

function AdjustStockModal({ product, warehouses, onClose, onSave, saving }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!delta) return
    onSave({ warehouseId, delta, reason })
  }

  return React.createElement(ModalShell, { onClose },
    React.createElement(ModalHeader, { title: 'Ajuster le stock', subtitle: product.name, onClose }),
    React.createElement('form', { onSubmit: handleSubmit, style: { padding: '16px 20px' } },
      React.createElement('label', { style: S.label }, 'Entrepôt *'),
      React.createElement('select', { style: S.input, required: true, value: warehouseId, onChange: e => setWarehouseId(e.target.value) },
        warehouses.map(w => React.createElement('option', { key: w.id, value: w.id }, w.name))),
      React.createElement('label', { style: { ...S.label, marginTop: 12 } }, 'Correction (+ ou -) *'),
      React.createElement('input', { style: S.input, type: 'number', required: true, value: delta, onChange: e => setDelta(+e.target.value) }),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 } }, 'Positif pour ajouter, négatif pour retirer'),
      React.createElement('label', { style: { ...S.label, marginTop: 12 } }, 'Motif *'),
      React.createElement('input', { style: S.input, required: true, value: reason, onChange: e => setReason(e.target.value), placeholder: 'Ex : casse, comptage, péremption…' }),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' } },
        React.createElement('button', { type: 'button', style: S.btnSecondary, onClick: onClose }, 'Annuler'),
        React.createElement('button', { type: 'submit', style: { ...S.btnPrimary, opacity: saving ? 0.6 : 1 }, disabled: saving }, saving ? 'Enregistrement…' : 'Ajuster'),
      ),
    ),
  )
}

function ProductFormModal({ app, product, onSave, onClose, saving }) {
  const isEdit = !!product
  const [form, setForm] = useState({
    code: product?.code ?? '',
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? '',
    unit: product?.unit ?? 'unite',
    valuationMethod: product?.valuationMethod ?? 'fefo',
    salePrice: product?.salePrice ?? 0,
    purchasePrice: product?.purchasePrice ?? 0,
    minThreshold: product?.minThreshold ?? 0,
    maxThreshold: product?.maxThreshold ?? 0,
    isActive: product?.isActive ?? true,
    isLotTracked: product?.isLotTracked ?? false,
  })

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))
  const setNum = (k) => (e) => setForm(p => ({ ...p, [k]: +e.target.value }))

  return React.createElement(ModalShell, { onClose },
    React.createElement(ModalHeader, { title: isEdit ? 'Modifier le produit' : 'Nouveau produit', subtitle: isEdit ? product.name : 'Ajouter un article', onClose }),
    React.createElement('div', { style: { padding: '16px 20px', overflow: 'auto', flex: 1 } },
      React.createElement('div', { style: S.grid2 },
        React.createElement('div', { style: { gridColumn: '1 / -1' } },
          React.createElement('label', { style: S.label }, 'Nom *'),
          React.createElement('input', { style: S.input, value: form.name, onChange: set('name'), required: true }),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Code *'),
          React.createElement('input', { style: S.input, value: form.code, onChange: set('code'), disabled: isEdit, required: true }),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Catégorie'),
          React.createElement('input', { style: S.input, value: form.categoryId, onChange: set('categoryId') }),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Unité'),
          React.createElement('input', { style: S.input, value: form.unit, onChange: set('unit') }),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Valorisation'),
          React.createElement('select', { style: S.input, value: form.valuationMethod, onChange: set('valuationMethod') },
            React.createElement('option', { value: 'fefo' }, 'FEFO (péremption)'),
            React.createElement('option', { value: 'fifo' }, 'FIFO'),
            React.createElement('option', { value: 'lifo' }, 'LIFO'),
            React.createElement('option', { value: 'cmup' }, 'CMUP (coût moyen)'),
          ),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Prix de vente'),
          React.createElement('input', { style: S.input, type: 'number', min: 0, step: 0.01, value: form.salePrice, onChange: setNum('salePrice') }),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, "Prix d'achat"),
          React.createElement('input', { style: S.input, type: 'number', min: 0, step: 0.01, value: form.purchasePrice, onChange: setNum('purchasePrice') }),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Seuil min'),
          React.createElement('input', { style: S.input, type: 'number', min: 0, value: form.minThreshold, onChange: setNum('minThreshold') }),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Seuil max'),
          React.createElement('input', { style: S.input, type: 'number', min: 0, value: form.maxThreshold, onChange: setNum('maxThreshold') }),
        ),
        React.createElement('div', { style: { gridColumn: '1 / -1', display: 'flex', gap: 16, alignItems: 'center' } },
          isEdit && React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 } },
            React.createElement('input', { type: 'checkbox', checked: form.isActive, onChange: e => setForm(p => ({ ...p, isActive: e.target.checked })) }),
            ' Actif',
          ),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 } },
            React.createElement('input', { type: 'checkbox', checked: form.isLotTracked, onChange: e => setForm(p => ({ ...p, isLotTracked: e.target.checked })) }),
            ' Suivi de lot',
          ),
        ),
      ),
    ),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--color-border)' } },
      React.createElement('button', { style: S.btnSecondary, onClick: onClose }, 'Annuler'),
      React.createElement('button', { style: { ...S.btnPrimary, opacity: saving ? 0.6 : 1 }, disabled: saving, onClick: () => onSave(isEdit ? { ...form, code: undefined } : form) },
        saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'),
    ),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   WAREHOUSES TAB
   ════════════════════════════════════════════════════════════════════════ */

function WarehouseFormModal({ app, warehouse, onSave, onClose, saving }) {
  const isEdit = !!warehouse

  const handleSubmit = async () => {
    const name = document.getElementById('wh-name').value
    if (!name) return app.notify('Le nom est requis', 'warning')
    if (isEdit) {
      await onSave({ name, siteId: document.getElementById('wh-site').value || undefined, isActive: document.getElementById('wh-active').checked })
    } else {
      const code = document.getElementById('wh-code').value
      if (!code) return app.notify('Le code est requis', 'warning')
      await onSave({ code, name, siteId: document.getElementById('wh-site').value || undefined })
    }
  }

  return React.createElement(ModalShell, { onClose },
    React.createElement(ModalHeader, { title: isEdit ? "Modifier l'entrepôt" : 'Nouvel entrepôt', subtitle: isEdit ? warehouse.name : undefined, onClose }),
    React.createElement('div', { style: { padding: '16px 20px' } },
      React.createElement('label', { style: S.label }, 'Code'),
      isEdit
        ? React.createElement('div', { style: { fontSize: 13, fontFamily: 'monospace', fontWeight: 600, padding: '9px 0', color: 'var(--color-text-secondary)' } }, warehouse.code)
        : React.createElement('input', { style: S.input, id: 'wh-code', required: true }),
      React.createElement('label', { style: { ...S.label, marginTop: 16 } }, 'Nom *'),
      React.createElement('input', { style: S.input, id: 'wh-name', required: true, defaultValue: warehouse?.name }),
      React.createElement('label', { style: { ...S.label, marginTop: 16 } }, 'Site / Agence'),
      React.createElement('input', { style: S.input, id: 'wh-site', defaultValue: warehouse?.siteId }),
      isEdit && React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, cursor: 'pointer' } },
        React.createElement('input', { type: 'checkbox', id: 'wh-active', defaultChecked: warehouse.isActive }),
        'Entrepôt actif',
      ),
    ),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--color-border)' } },
      React.createElement('button', { style: S.btnSecondary, onClick: onClose }, 'Annuler'),
      React.createElement('button', { style: { ...S.btnPrimary, opacity: saving ? 0.6 : 1 }, disabled: saving, onClick: handleSubmit },
        saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'),
    ),
  )
}

// Popup de détail — ouverte au clic sur une carte entrepôt : bannière
// d'alerte, stats rappelées, tendance 7 jours, répartition des produits
// stockés, mouvements récents. Tout est dérivé des données déjà chargées par
// WarehousesTab (products/levels/moves), rien n'est recalculé côté serveur.
function WarehouseDetailModal({ warehouse, stats, trend, products, levels, moves, onClose, onEdit, onViewProducts }) {
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  const breakdown = useMemo(() => {
    const rows = []
    for (const l of levels) {
      if (l.warehouseId !== warehouse.id || !(l.availableQuantity > 0)) continue
      const product = productById.get(l.productId)
      rows.push({
        productId: l.productId,
        name: product?.name ?? l.productId,
        quantity: l.availableQuantity,
        value: l.availableQuantity * (product?.purchasePrice ?? 0),
      })
    }
    return rows.sort((a, b) => b.value - a.value).slice(0, 5)
  }, [levels, productById, warehouse.id])

  const maxBreakdownValue = Math.max(1, ...breakdown.map(r => r.value))

  const recentMoves = useMemo(() =>
    moves.filter(m => m.warehouseId === warehouse.id)
      .slice().sort((a, b) => new Date(b.moveDate) - new Date(a.moveDate)).slice(0, 5),
    [moves, warehouse.id],
  )

  const weeklyNet = trend.reduce((s, v) => s + v, 0)

  return React.createElement(ModalShell, { wide: true, onClose },
    React.createElement(ModalHeader, {
      title: warehouse.name,
      subtitle: warehouse.code + (warehouse.siteId ? ` · ${warehouse.siteId}` : ''),
      onClose,
    }),
    React.createElement('div', { style: { padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '60vh', overflowY: 'auto' } },
      stats.alerts.size > 0 && React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10,
          background: 'var(--color-danger-muted)', color: 'var(--color-danger-text)', border: '1px solid var(--color-danger-border)' },
      },
        React.createElement(Icon.alertTri, { size: 15, style: { flexShrink: 0 } }),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } },
          `${stats.alerts.size} produit${stats.alerts.size > 1 ? 's' : ''} sous le seuil critique dans cet entrepôt`),
      ),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 } },
        [
          ['Références', stats.skus.size, 'var(--color-text-primary)'],
          ['Unités', stats.units.toLocaleString('fr-FR'), 'var(--color-text-primary)'],
          ['Valeur', stats.value.toLocaleString('fr-FR'), 'var(--color-text-primary)'],
          ['Alertes', stats.alerts.size, stats.alerts.size > 0 ? 'var(--color-danger)' : 'var(--color-text-primary)'],
        ].map(([label, value, color]) =>
          React.createElement('div', { key: label, style: { padding: 12, borderRadius: 10, background: 'var(--color-surface-subtle)' } },
            React.createElement('div', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 } }, label),
            React.createElement('div', { style: { fontSize: 17, fontWeight: 800, fontFamily: 'monospace', color } }, value),
          ),
        ),
      ),
      React.createElement('div', null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
          React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)' } }, 'Activité nette — 7 derniers jours'),
          React.createElement('span', {
            style: { fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
              color: weeklyNet > 0 ? 'var(--color-success)' : weeklyNet < 0 ? 'var(--color-danger)' : 'var(--color-text-tertiary)' },
          }, `${weeklyNet > 0 ? '+' : ''}${weeklyNet.toLocaleString('fr-FR')}`),
        ),
        React.createElement(Sparkline, { data: trend, width: 400, height: 48 }),
      ),
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 8 } }, 'Répartition des produits stockés'),
        breakdown.length === 0
          ? React.createElement('div', { style: { fontSize: 12, color: 'var(--color-text-tertiary)' } }, 'Aucun stock disponible dans cet entrepôt')
          : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              breakdown.map(row =>
                React.createElement('div', { key: row.productId, style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  React.createElement('div', { style: { flex: '0 0 140px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.name),
                  React.createElement('div', { style: { flex: 1, height: 6, borderRadius: 9999, background: 'var(--color-surface-subtle)', overflow: 'hidden' } },
                    React.createElement('div', { style: { height: '100%', width: `${Math.max(4, (row.value / maxBreakdownValue) * 100)}%`, background: 'var(--color-primary)', borderRadius: 9999 } }),
                  ),
                  React.createElement('div', { style: { flex: '0 0 auto', fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-tertiary)', minWidth: 60, textAlign: 'right' } },
                    row.quantity.toLocaleString('fr-FR')),
                ),
              ),
            ),
      ),
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 8 } }, 'Mouvements récents'),
        recentMoves.length === 0
          ? React.createElement('div', { style: { fontSize: 12, color: 'var(--color-text-tertiary)' } }, 'Aucun mouvement récent')
          : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              recentMoves.map(m => {
                const meta = MOVE_TYPE_META[m.type] ?? { label: m.type, bg: 'var(--color-surface-subtle)', fg: 'var(--color-text-secondary)' }
                return React.createElement('div', { key: m.id, style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
                  React.createElement('span', { style: S.badge(meta.bg, meta.fg) }, meta.label),
                  React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.productName ?? m.productId),
                  React.createElement('span', { style: { fontFamily: 'monospace', color: 'var(--color-text-tertiary)' } }, new Date(m.moveDate).toLocaleDateString('fr-FR')),
                )
              }),
            ),
      ),
    ),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px', borderTop: '1px solid var(--color-border)' } },
      React.createElement('button', { style: S.btnSecondary, onClick: onViewProducts }, 'Voir les produits'),
      React.createElement('button', { style: S.btnPrimary, onClick: onEdit }, 'Modifier'),
    ),
  )
}

function WarehousesTab({ app, api, onNavigate }) {
  const [warehouses, setWarehouses] = useState([])
  const [products, setProducts] = useState([])
  const [levels, setLevels] = useState([])
  const [moves, setMoves] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [detailWarehouse, setDetailWarehouse] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true)
    try {
      const [w, p, l, m] = await Promise.all([api.warehouses.list(), api.products.list(), api.movements.levels(), api.movements.list()])
      setWarehouses(w ?? []); setProducts(p ?? []); setLevels(l ?? []); setMoves(m ?? [])
    } catch (e) { if (!silent) app.notify('Erreur chargement', 'error') }
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => app.onRealtime('xstock', () => load(true)), [load])

  const statsByWarehouse = useMemo(() => {
    const productById = new Map(products.map(p => [p.id, p]))
    const perWh = new Map()
    for (const l of levels) {
      if (!(l.availableQuantity > 0)) continue
      const product = productById.get(l.productId)
      const stats = perWh.get(l.warehouseId) ?? { skus: new Set(), units: 0, value: 0, alerts: new Set() }
      stats.skus.add(l.productId)
      stats.units += l.availableQuantity
      stats.value += l.availableQuantity * (product?.purchasePrice ?? 0)
      if (product?.minThreshold > 0 && l.availableQuantity <= product.minThreshold) stats.alerts.add(l.productId)
      perWh.set(l.warehouseId, stats)
    }
    return perWh
  }, [products, levels])

  // Tendance 7 jours par entrepôt — dérivée des vrais mouvements (delta de
  // solde jour par jour), affichée en mini-sparkline sur chaque carte.
  const trendByWarehouse = useMemo(() => {
    const map = new Map()
    for (const wh of warehouses) map.set(wh.id, buildDailyTrend(moves, wh.id))
    return map
  }, [moves, warehouses])

  // KPI globaux — agrégés depuis statsByWarehouse, mêmes chiffres que les
  // cartes individuelles, juste sommés sur tout le parc d'entrepôts.
  const activeWarehouseCount = useMemo(() => warehouses.filter(w => w.isActive).length, [warehouses])
  const totalStockValue = useMemo(() => {
    let sum = 0
    for (const stats of statsByWarehouse.values()) sum += stats.value
    return sum
  }, [statsByWarehouse])
  const trackedSkuCount = useMemo(() => {
    const all = new Set()
    for (const stats of statsByWarehouse.values()) stats.skus.forEach(id => all.add(id))
    return all.size
  }, [statsByWarehouse])
  const totalAlertCount = useMemo(() => {
    const all = new Set()
    for (const stats of statsByWarehouse.values()) stats.alerts.forEach(id => all.add(id))
    return all.size
  }, [statsByWarehouse])

  const filteredWarehouses = useMemo(() => {
    if (!search) return warehouses
    const q = search.toLowerCase()
    return warehouses.filter(w => w.name?.toLowerCase().includes(q) || w.code?.toLowerCase().includes(q) || w.siteId?.toLowerCase().includes(q))
  }, [warehouses, search])

  const handleCreate = useCallback(async (data) => {
    setSaving(true)
    try {
      await api.warehouses.create(data)
      setFormOpen(false); await load()
      app.notify('Entrepôt créé', 'success')
    } catch (e) { app.notify('Erreur création', 'error') }
    setSaving(false)
  }, [load])

  const handleUpdate = useCallback(async (data) => {
    setSaving(true)
    try {
      await api.warehouses.update(editingWarehouse.id, data)
      setFormOpen(false); setEditingWarehouse(null); await load()
      app.notify('Entrepôt modifié', 'success')
    } catch (e) { app.notify('Erreur lors de la modification', 'error') }
    setSaving(false)
  }, [editingWarehouse, load])

  if (loading) return Spinner()

  const emptyStats = { skus: new Set(), units: 0, value: 0, alerts: new Set() }

  return React.createElement(Fragment, null,
    React.createElement('div', { style: S.grid4 },
      React.createElement(KpiCard, {
        icon: Icon.warehouse, tint: 'primary', label: 'Entrepôts actifs', value: activeWarehouseCount.toLocaleString('fr-FR'),
        sub: warehouses.length > activeWarehouseCount ? `${warehouses.length - activeWarehouseCount} inactif(s)` : `${warehouses.length} au total`,
      }),
      React.createElement(KpiCard, {
        icon: Icon.trending, tint: 'success', label: 'Valeur du stock', value: totalStockValue.toLocaleString('fr-FR', { maximumFractionDigits: 0 }),
        sub: 'Tous entrepôts confondus',
      }),
      React.createElement(KpiCard, {
        icon: Icon.package, tint: 'info', label: 'Références suivies', value: trackedSkuCount.toLocaleString('fr-FR'),
        sub: 'Produits avec stock disponible',
      }),
      React.createElement(KpiCard, {
        icon: Icon.alertTri, tint: totalAlertCount > 0 ? 'warning' : 'success', label: 'Alertes stock', value: totalAlertCount.toLocaleString('fr-FR'),
        sub: totalAlertCount > 0 ? 'Réapprovisionnement à prévoir' : 'Aucune alerte', subTint: totalAlertCount > 0 ? 'warning' : 'success',
      }),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      React.createElement('div', { style: { position: 'relative', flex: 1, maxWidth: 320 } },
        React.createElement(Icon.search, { size: 14, style: { position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' } }),
        React.createElement('input', { style: { ...S.input, paddingLeft: 34 }, placeholder: 'Rechercher un entrepôt…', value: search, onChange: e => setSearch(e.target.value) }),
      ),
      React.createElement('button', { style: { ...S.btnPrimary, marginLeft: 'auto' }, onClick: () => { setEditingWarehouse(null); setFormOpen(true) } },
        React.createElement(Icon.plus, { size: 15 }), ' Nouvel entrepôt'),
    ),
    warehouses.length === 0
      ? React.createElement(EmptyState, {
          icon: Icon.warehouse, title: 'Aucun entrepôt pour le moment',
          hint: 'Ajoute ton premier entrepôt pour commencer à organiser le stock.',
          action: { label: 'Nouvel entrepôt', icon: Icon.plus, onClick: () => { setEditingWarehouse(null); setFormOpen(true) } },
        })
      : filteredWarehouses.length === 0
        ? React.createElement(EmptyState, { icon: Icon.warehouse, title: 'Aucun entrepôt trouvé', hint: 'Essaie de modifier la recherche.' })
        : React.createElement('div', { style: S.grid4 },
            filteredWarehouses.map(wh => {
              const stats = statsByWarehouse.get(wh.id) ?? emptyStats
              const hasAlert = stats.alerts.size > 0
              const trend = trendByWarehouse.get(wh.id) ?? []
              return React.createElement('div', {
                key: wh.id, className: 'xstock-warehouse-card',
                style: {
                  padding: 16, borderRadius: 12, cursor: 'pointer',
                  border: hasAlert ? '1px solid var(--color-danger-border)' : '1px solid var(--color-border)',
                  background: hasAlert ? 'color-mix(in srgb, var(--color-danger) 4%, var(--color-card))' : 'var(--color-card)',
                  display: 'flex', flexDirection: 'column', gap: 12, transition: 'box-shadow .12s, transform .12s',
                },
                onClick: () => setDetailWarehouse(wh),
              },
                React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    React.createElement('span', { style: { width: 36, height: 36, borderRadius: 8, display: 'grid', placeItems: 'center', position: 'relative',
                      background: 'var(--color-primary-muted)', color: 'var(--color-primary-text)' } },
                      React.createElement(Icon.warehouse, { size: 16 }),
                      hasAlert && React.createElement('span', { style: {
                        position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: '50%',
                        background: 'var(--color-danger)', border: '2px solid var(--color-card)',
                      } }),
                    ),
                    React.createElement('div', null,
                      React.createElement('div', { style: { fontWeight: 500 } }, wh.name),
                      React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)' } }, wh.code + (wh.siteId ? ` · ${wh.siteId}` : '')),
                    ),
                  ),
                  React.createElement(Badge, { status: wh.isActive, label: wh.isActive ? 'Actif' : 'Inactif' }),
                ),
                React.createElement(Sparkline, { data: trend, width: 220, height: 24 }),
                React.createElement('div', { style: { display: 'flex', gap: 16, paddingTop: 10, borderTop: '1px solid var(--color-border)' } },
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 600 } }, 'SKUs'),
                    React.createElement('div', { style: { fontSize: 15, fontWeight: 700, fontFamily: 'monospace' } }, stats.skus.size)),
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 600 } }, 'Unités'),
                    React.createElement('div', { style: { fontSize: 15, fontWeight: 700, fontFamily: 'monospace' } }, stats.units.toLocaleString('fr-FR'))),
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 600 } }, 'Valeur'),
                    React.createElement('div', { style: { fontSize: 15, fontWeight: 700, fontFamily: 'monospace' } }, stats.value.toLocaleString('fr-FR'))),
                  hasAlert && React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 10, color: 'var(--color-danger)', textTransform: 'uppercase', fontWeight: 600 } }, 'Alertes'),
                    React.createElement('div', { style: { fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-danger)' } }, stats.alerts.size)),
                ),
                React.createElement('div', {
                  className: 'xstock-warehouse-card-cta',
                  style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--color-primary)' },
                }, 'Voir le détail', React.createElement(Icon.chevronRight, { size: 12 })),
              )
            }),
            React.createElement('button', {
              type: 'button',
              style: {
                padding: 16, borderRadius: 12, border: '1.5px dashed var(--color-border)', cursor: 'pointer',
                background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8, minHeight: 128, color: 'var(--color-text-tertiary)',
              },
              onClick: () => { setEditingWarehouse(null); setFormOpen(true) },
            },
              React.createElement('span', { style: { width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--color-surface-subtle)' } },
                React.createElement(Icon.plus, { size: 16 })),
              React.createElement('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Nouvel entrepôt'),
            ),
          ),
    detailWarehouse && React.createElement(WarehouseDetailModal, {
      warehouse: detailWarehouse,
      stats: statsByWarehouse.get(detailWarehouse.id) ?? emptyStats,
      trend: trendByWarehouse.get(detailWarehouse.id) ?? [],
      products, levels, moves,
      onClose: () => setDetailWarehouse(null),
      onEdit: () => { setEditingWarehouse(detailWarehouse); setDetailWarehouse(null); setFormOpen(true) },
      onViewProducts: () => { setDetailWarehouse(null); onNavigate?.('products') },
    }),
    formOpen && React.createElement(WarehouseFormModal, {
      app, warehouse: editingWarehouse, saving,
      onSave: editingWarehouse ? handleUpdate : handleCreate,
      onClose: () => { setFormOpen(false); setEditingWarehouse(null) },
    }),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   MOVEMENTS TAB
   ════════════════════════════════════════════════════════════════════════ */

function MovementsTab({ app, api }) {
  const [moves, setMoves] = useState([])
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [formKind, setFormKind] = useState('receive')
  const [saving, setSaving] = useState(false)

  const openForm = useCallback((kind) => { setFormKind(kind); setFormOpen(true) }, [])

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true)
    try {
      const [m, p, w] = await Promise.all([api.movements.list(), api.products.list(), api.warehouses.list()])
      setMoves(m ?? [])
      setProducts(p ?? [])
      setWarehouses(w ?? [])
    } catch (e) { if (!silent) app.notify('Erreur chargement', 'error') }
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => app.onRealtime('xstock', () => load(true)), [load])

  const handleCreate = useCallback(async (kind, data) => {
    setSaving(true)
    try {
      await api.movements[kind](data)
      setFormOpen(false)
      await load()
      app.notify('Mouvement enregistré', 'success')
    } catch (e) { app.notify(e?.message ?? "Erreur lors de l'enregistrement", 'error') }
    setSaving(false)
  }, [load])

  const filtered = useMemo(() => {
    let list = moves
    if (typeFilter !== 'ALL') list = list.filter(m => m.type === typeFilter)
    return list.slice().sort((a, b) => new Date(b.moveDate) - new Date(a.moveDate))
  }, [moves, typeFilter])

  if (loading) return React.createElement(TableSkeleton, { cols: 7 })

  return React.createElement(Fragment, null,
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 } },
      React.createElement('div', { style: S.tabs },
        [['ALL', 'Tous'], ['in', 'Entrées'], ['out', 'Sorties'], ['transfer', 'Transferts'], ['adjustment', 'Ajustements']].map(([v, l]) =>
          React.createElement('button', {
            key: v, style: S.tab(typeFilter === v), onClick: () => setTypeFilter(v),
          }, l),
        ),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        React.createElement('button', { style: S.btnTint('success'), onClick: () => openForm('receive') },
          React.createElement(Icon.download, { size: 13 }), ' Réception'),
        React.createElement('button', { style: S.btnTint('info'), onClick: () => openForm('transfer') },
          React.createElement(Icon.arrows, { size: 13 }), ' Transfert'),
        React.createElement('button', { style: S.btnTint('warning'), onClick: () => openForm('adjust') },
          React.createElement(Icon.edit, { size: 13 }), ' Ajustement'),
        React.createElement('button', { style: S.btnPrimary, onClick: () => openForm('issue') },
          React.createElement(Icon.upload, { size: 13 }), ' Sortie'),
      ),
    ),
    React.createElement('div', { className: 'xstock-table-card', style: { ...S.card, overflow: 'visible' } },
      React.createElement('table', { style: S.table },
        React.createElement('thead', null,
          React.createElement('tr', null,
            ['Date', 'Type', 'Produit', 'Qté', 'Entrepôt', 'Référence', 'Auteur'].map(h =>
              React.createElement('th', { key: h, style: S.th }, h)),
          ),
        ),
        React.createElement('tbody', null,
          filtered.length === 0
            ? React.createElement('tr', null,
                React.createElement('td', { colSpan: 7, style: { border: 'none' } },
                  React.createElement(EmptyState, {
                    icon: Icon.arrows, title: 'Aucun mouvement',
                    hint: 'Réceptionne, transfère ou ajuste du stock avec les boutons ci-dessus.',
                  })))
            : filtered.map(m => {
                const meta = MOVE_TYPE_META[m.type] ?? { label: m.type, bg: 'var(--color-surface-subtle)', fg: 'var(--color-text-secondary)' }
                const sign = m.type === 'in' ? '+' : m.type === 'out' ? '-' : ''
                return React.createElement('tr', { key: m.id },
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' } },
                    new Date(m.moveDate).toLocaleDateString('fr-FR')),
                  React.createElement('td', { style: S.td },
                    React.createElement('span', { style: S.badge(meta.bg, meta.fg) }, meta.label)),
                  React.createElement('td', { style: { ...S.td, fontWeight: 500 } }, m.productName ?? m.productId),
                  React.createElement('td', { style: { ...S.td, fontFamily: 'monospace', fontWeight: 600, color: m.type === 'in' ? 'var(--color-success)' : m.type === 'out' ? 'var(--color-danger)' : 'var(--color-text-primary)' } },
                    `${sign}${m.quantity.toLocaleString('fr-FR')}`),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } }, m.warehouseName ?? m.warehouseId),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-tertiary)' } }, m.reason ?? m.sourceReference ?? '—'),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } }, m.createdBy),
                )
              }),
        ),
      ),
    ),
    formOpen && React.createElement(MovementFormModal, {
      products, warehouses, saving, initialKind: formKind, onClose: () => setFormOpen(false), onSave: handleCreate,
    }),
  )
}

function MovementFormModal({ products, warehouses, initialKind, onClose, onSave, saving }) {
  const [kind, setKind] = useState(initialKind ?? 'receive')
  const [productId, setProductId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [delta, setDelta] = useState(0)
  const [batchNumber, setBatchNumber] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [witnessId, setWitnessId] = useState('')
  const [reason, setReason] = useState('')
  const [sourceReference, setSourceReference] = useState('')

  const KINDS = [
    ['receive', 'Réception'],
    ['issue', 'Sortie'],
    ['transfer', 'Transfert'],
    ['adjust', 'Ajustement'],
  ]

  const handleSubmit = (e) => {
    e.preventDefault()
    if (kind === 'receive') {
      onSave('receive', { productId, warehouseId, quantity, batchNumber: batchNumber || undefined, expiryDate: expiryDate || undefined, sourceReference: sourceReference || undefined, reason: reason || undefined })
    } else if (kind === 'issue') {
      onSave('issue', { productId, warehouseId, quantity, witnessId: witnessId || undefined, sourceReference: sourceReference || undefined, reason: reason || undefined })
    } else if (kind === 'transfer') {
      onSave('transfer', { productId, sourceWarehouseId: warehouseId, destinationWarehouseId, quantity, sourceReference: sourceReference || undefined, reason: reason || undefined })
    } else {
      if (!delta) return
      onSave('adjust', { productId, warehouseId, delta, reason })
    }
  }

  return React.createElement(ModalShell, { onClose },
    React.createElement(ModalHeader, { title: 'Nouveau mouvement', onClose }),
    React.createElement('form', { onSubmit: handleSubmit, style: { padding: '16px 20px' } },
      React.createElement('div', { style: { display: 'flex', gap: 2, background: 'var(--color-surface-subtle)', borderRadius: 10, padding: 2, marginBottom: 16 } },
        KINDS.map(([v, l]) => React.createElement('button', {
          key: v, type: 'button',
          style: {
            flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: kind === v ? 'var(--color-card)' : 'transparent',
            color: kind === v ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
            boxShadow: kind === v ? 'var(--shadow-sm)' : 'none',
          },
          onClick: () => setKind(v),
        }, l)),
      ),

      React.createElement('label', { style: S.label }, 'Produit *'),
      React.createElement('select', { style: S.input, required: true, value: productId, onChange: e => setProductId(e.target.value) },
        React.createElement('option', { value: '' }, 'Sélectionner…'),
        products.map(p => React.createElement('option', { key: p.id, value: p.id }, `${p.name} (${p.code})`))),

      React.createElement('div', { style: { ...S.grid2, marginTop: 12 } },
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, kind === 'transfer' ? 'Entrepôt source *' : 'Entrepôt *'),
          React.createElement('select', { style: S.input, required: true, value: warehouseId, onChange: e => setWarehouseId(e.target.value) },
            React.createElement('option', { value: '' }, 'Sélectionner…'),
            warehouses.map(w => React.createElement('option', { key: w.id, value: w.id }, w.name)))),
        kind === 'transfer' && React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Entrepôt destination *'),
          React.createElement('select', { style: S.input, required: true, value: destinationWarehouseId, onChange: e => setDestinationWarehouseId(e.target.value) },
            React.createElement('option', { value: '' }, 'Sélectionner…'),
            warehouses.filter(w => w.id !== warehouseId).map(w => React.createElement('option', { key: w.id, value: w.id }, w.name)))),
        kind !== 'adjust' && React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Quantité *'),
          React.createElement('input', { style: S.input, type: 'number', min: 0.01, step: 0.01, required: true, value: quantity, onChange: e => setQuantity(+e.target.value) })),
        kind === 'adjust' && React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Correction (+ ou -) *'),
          React.createElement('input', { style: S.input, type: 'number', required: true, value: delta, onChange: e => setDelta(+e.target.value) })),
      ),

      kind === 'receive' && React.createElement('div', { style: { ...S.grid2, marginTop: 12 } },
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'N° de lot (si suivi de lot)'),
          React.createElement('input', { style: S.input, value: batchNumber, onChange: e => setBatchNumber(e.target.value) })),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Date de péremption'),
          React.createElement('input', { style: S.input, type: 'date', value: expiryDate, onChange: e => setExpiryDate(e.target.value) })),
      ),

      kind === 'issue' && React.createElement('div', { style: { marginTop: 12 } },
        React.createElement('label', { style: S.label }, 'Témoin (stupéfiants, si requis)'),
        React.createElement('input', { style: S.input, value: witnessId, onChange: e => setWitnessId(e.target.value) })),

      React.createElement('label', { style: { ...S.label, marginTop: 12 } }, kind === 'adjust' ? 'Motif *' : 'Motif'),
      React.createElement('input', { style: S.input, required: kind === 'adjust', value: reason, onChange: e => setReason(e.target.value) }),

      kind !== 'adjust' && React.createElement(Fragment, null,
        React.createElement('label', { style: { ...S.label, marginTop: 12 } }, 'Référence (optionnel)'),
        React.createElement('input', { style: S.input, value: sourceReference, onChange: e => setSourceReference(e.target.value), placeholder: 'Ex : BL fournisseur, n° de commande…' }),
      ),

      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' } },
        React.createElement('button', { type: 'button', style: S.btnSecondary, onClick: onClose }, 'Annuler'),
        React.createElement('button', { type: 'submit', style: { ...S.btnPrimary, opacity: saving ? 0.6 : 1 }, disabled: saving }, saving ? 'Enregistrement…' : 'Enregistrer'),
      ),
    ),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   INVENTORY TAB
   ════════════════════════════════════════════════════════════════════════ */

const INVENTORY_STATUS_LABELS = {
  draft: 'Brouillon', in_progress: 'En cours', validated: 'Validé', cancelled: 'Annulé',
}

// Popup de détail — ouverte au clic sur un comptage : lignes attendu/compté/
// écart (saisie inline tant que le comptage est ouvert), et actions
// Valider/Annuler. Les lignes sont chargées à l'ouverture (pas préchargées
// pour tous les comptages — coûterait un appel par comptage pour rien).
function InventoryDetailModal({ app, api, count, onClose, onChanged }) {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingLineId, setSavingLineId] = useState(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [validating, setValidating] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setLines(await api.inventory.lines(count.id) ?? []) }
    catch (e) { app.notify('Erreur chargement des lignes', 'error') }
    setLoading(false)
  }, [count.id])

  useEffect(() => { load() }, [load])

  const isOpen = count.status === 'draft' || count.status === 'in_progress'

  const handleSetLine = async (productId, value) => {
    const qty = Number(value)
    if (Number.isNaN(qty) || qty < 0) return
    setSavingLineId(productId)
    try {
      const updated = await api.inventory.setLine(count.id, productId, qty)
      setLines(prev => prev.map(l => l.productId === productId ? updated : l))
    } catch (e) { app.notify("Erreur lors de l'enregistrement du comptage", 'error') }
    setSavingLineId(null)
  }

  const handleValidate = async () => {
    setValidating(true)
    try {
      await api.inventory.validate(count.id, overrideReason || undefined)
      app.notify('Inventaire validé', 'success')
      onChanged(); onClose()
    } catch (e) { app.notify(e?.message ?? 'Écart bloquant — renseigne une justification ci-dessous et réessaie', 'error') }
    setValidating(false)
  }

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await api.inventory.cancel(count.id)
      app.notify('Inventaire annulé', 'success')
      onChanged(); onClose()
    } catch (e) { app.notify('Erreur', 'error') }
    setCancelling(false)
  }

  const uncounted = lines.filter(l => l.countedQuantity == null).length

  return React.createElement(ModalShell, { wide: true, onClose },
    React.createElement(ModalHeader, {
      title: count.warehouseName ?? count.warehouseId,
      subtitle: `${count.type === 'full' ? 'Général' : 'Cyclique'} · ${new Date(count.countDate).toLocaleDateString('fr-FR')}`,
      onClose,
    }),
    React.createElement('div', { style: { padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflowY: 'auto' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        React.createElement(Badge, { status: count.status, label: INVENTORY_STATUS_LABELS[count.status] ?? count.status }),
        isOpen && uncounted > 0 && React.createElement('span', { style: { fontSize: 12, color: 'var(--color-text-tertiary)' } }, `${uncounted} ligne(s) non comptée(s)`),
      ),
      loading
        ? React.createElement(TableSkeleton, { rows: 4, cols: 4 })
        : lines.length === 0
          ? React.createElement(EmptyState, { icon: Icon.clipboard, title: 'Aucune ligne', hint: 'Cet inventaire ne contient aucun produit.' })
          : React.createElement('table', { style: S.table },
              React.createElement('thead', null,
                React.createElement('tr', null, ['Produit', 'Attendu', 'Compté', 'Écart'].map(h => React.createElement('th', { key: h, style: S.th }, h))),
              ),
              React.createElement('tbody', null,
                lines.map(l => {
                  const variance = l.variance ?? (l.countedQuantity != null ? l.countedQuantity - l.expectedQuantity : null)
                  return React.createElement('tr', { key: l.productId },
                    React.createElement('td', { style: S.td }, l.productName ?? l.productId),
                    React.createElement('td', { style: { ...S.td, fontFamily: 'monospace' } }, l.expectedQuantity.toLocaleString('fr-FR')),
                    React.createElement('td', { style: S.td },
                      isOpen
                        ? React.createElement('input', {
                            type: 'number', min: 0, step: 0.01, style: { ...S.input, width: 100 },
                            defaultValue: l.countedQuantity ?? '', disabled: savingLineId === l.productId,
                            onBlur: e => { const v = e.target.value; if (v !== '' && Number(v) !== l.countedQuantity) handleSetLine(l.productId, v) },
                          })
                        : (l.countedQuantity ?? '—')),
                    React.createElement('td', {
                      style: { ...S.td, fontFamily: 'monospace', fontWeight: 700,
                        color: variance > 0 ? 'var(--color-success)' : variance < 0 ? 'var(--color-danger)' : 'var(--color-text-tertiary)' },
                    }, variance == null ? '—' : `${variance > 0 ? '+' : ''}${variance.toLocaleString('fr-FR')}`),
                  )
                }),
              ),
            ),
      isOpen && React.createElement('div', null,
        React.createElement('label', { style: S.label }, 'Justification (si écart bloquant à la validation)'),
        React.createElement('input', { style: S.input, value: overrideReason, onChange: e => setOverrideReason(e.target.value), placeholder: 'ex. casse constatée, erreur de saisie…' }),
      ),
    ),
    isOpen && React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px', borderTop: '1px solid var(--color-border)' } },
      React.createElement('button', { style: { ...S.btnDanger, opacity: cancelling ? 0.6 : 1 }, disabled: cancelling, onClick: handleCancel }, cancelling ? 'Annulation…' : "Annuler l'inventaire"),
      React.createElement('button', { style: { ...S.btnPrimary, opacity: validating ? 0.6 : 1 }, disabled: validating, onClick: handleValidate }, validating ? 'Validation…' : 'Valider'),
    ),
  )
}

function InventoryTab({ app, api }) {
  const [counts, setCounts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detailCount, setDetailCount] = useState(null)

  // Le backend n'a pas d'endpoint "lister tous les comptages" — seulement
  // /by-warehouse/{id} — on agrège donc côté client, un appel par entrepôt.
  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true)
    try {
      const whs = await api.warehouses.list() ?? []
      setWarehouses(whs)
      const perWarehouse = await Promise.all(whs.map(w => api.inventory.byWarehouse(w.id).catch(() => [])))
      setCounts(perWarehouse.flat())
    } catch (e) { if (!silent) app.notify('Erreur chargement', 'error') }
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => app.onRealtime('xstock', () => load(true)), [load])

  const sorted = useMemo(() => {
    let list = counts
    if (statusFilter !== 'ALL') list = list.filter(c => c.status === statusFilter)
    return list.slice().sort((a, b) => new Date(b.countDate) - new Date(a.countDate))
  }, [counts, statusFilter])

  const openCount = useMemo(() => counts.filter(c => c.status === 'draft' || c.status === 'in_progress').length, [counts])
  const validatedCount = useMemo(() => counts.filter(c => c.status === 'validated').length, [counts])
  const cancelledCount = useMemo(() => counts.filter(c => c.status === 'cancelled').length, [counts])

  const handleCreate = useCallback(async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    setSaving(true)
    try {
      await api.inventory.create({
        warehouseId: fd.get('warehouseId'),
        type: fd.get('type'),
        countDate: fd.get('countDate'),
      })
      setFormOpen(false); await load()
      app.notify('Inventaire créé', 'success')
    } catch (e) { app.notify('Erreur création', 'error') }
    setSaving(false)
  }, [load])

  if (loading) return React.createElement(TableSkeleton, { cols: 4 })

  return React.createElement(Fragment, null,
    React.createElement('div', { style: S.grid4 },
      React.createElement(KpiCard, { icon: Icon.clipboard, tint: 'primary', label: 'Comptages', value: counts.length.toLocaleString('fr-FR'), sub: 'Tous entrepôts confondus' }),
      React.createElement(KpiCard, {
        icon: Icon.arrows, tint: openCount > 0 ? 'warning' : 'success', label: 'En cours', value: openCount.toLocaleString('fr-FR'),
        sub: openCount > 0 ? 'À finaliser' : 'Aucun comptage ouvert', subTint: openCount > 0 ? 'warning' : 'success',
        onClick: openCount > 0 ? () => setStatusFilter('draft') : undefined,
      }),
      React.createElement(KpiCard, { icon: Icon.trending, tint: 'success', label: 'Validés', value: validatedCount.toLocaleString('fr-FR'), sub: 'Comptages clôturés' }),
      React.createElement(KpiCard, { icon: Icon.trash, tint: 'info', label: 'Annulés', value: cancelledCount.toLocaleString('fr-FR'), sub: 'Comptages abandonnés' }),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 } },
      React.createElement('div', { style: S.tabs },
        [['ALL', 'Tous'], ['draft', 'Brouillon'], ['in_progress', 'En cours'], ['validated', 'Validés'], ['cancelled', 'Annulés']].map(([v, l]) =>
          React.createElement('button', { key: v, style: S.tab(statusFilter === v), onClick: () => setStatusFilter(v) }, l),
        ),
      ),
      React.createElement('button', { style: S.btnPrimary, onClick: () => setFormOpen(true) },
        React.createElement(Icon.plus, { size: 15 }), ' Nouvel inventaire'),
    ),
    sorted.length === 0
      ? React.createElement(EmptyState, {
          icon: Icon.clipboard, title: counts.length === 0 ? 'Aucun inventaire pour le moment' : 'Aucun inventaire trouvé',
          hint: counts.length === 0 ? 'Démarre un comptage physique pour suivre les écarts de stock.' : 'Essaie un autre filtre.',
          action: counts.length === 0 ? { label: 'Nouvel inventaire', icon: Icon.plus, onClick: () => setFormOpen(true) } : undefined,
        })
      : React.createElement('div', { className: 'xstock-table-card', style: { ...S.card, overflow: 'visible' } },
          React.createElement('table', { style: S.table, className: 'xstock-hoverable' },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['Date', 'Entrepôt', 'Type', 'Statut'].map(h =>
                  React.createElement('th', { key: h, style: S.th }, h)),
              ),
            ),
            React.createElement('tbody', null,
              sorted.map(c =>
                React.createElement('tr', { key: c.id, style: { cursor: 'pointer' }, onClick: () => setDetailCount(c) },
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' } },
                    new Date(c.countDate).toLocaleDateString('fr-FR')),
                  React.createElement('td', { style: S.td }, c.warehouseName ?? c.warehouseId),
                  React.createElement('td', { style: S.td }, React.createElement('span', { style: S.badge('var(--color-info-muted)', 'var(--color-info-text)') },
                    c.type === 'full' ? 'Général' : 'Cyclique')),
                  React.createElement('td', { style: S.td }, React.createElement(Badge, { status: c.status, label: INVENTORY_STATUS_LABELS[c.status] ?? c.status })),
                ),
              ),
            ),
          ),
        ),
    formOpen && React.createElement(ModalShell, { onClose: () => setFormOpen(false) },
      React.createElement(ModalHeader, { title: 'Nouvel inventaire', onClose: () => setFormOpen(false) }),
      React.createElement('form', { onSubmit: handleCreate, style: { padding: '16px 20px' } },
        React.createElement('label', { style: S.label }, 'Entrepôt *'),
        React.createElement('select', { name: 'warehouseId', style: S.input, required: true },
          React.createElement('option', { value: '' }, 'Sélectionner…'),
          warehouses.filter(w => w.isActive).map(w =>
            React.createElement('option', { key: w.id, value: w.id }, w.name)),
        ),
        React.createElement('label', { style: { ...S.label, marginTop: 16 } }, 'Date du comptage *'),
        React.createElement('input', { type: 'date', name: 'countDate', style: S.input, required: true, defaultValue: new Date().toISOString().slice(0, 10) }),
        React.createElement('div', { style: { marginTop: 16, display: 'flex', gap: 16, alignItems: 'center' } },
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 } },
            React.createElement('input', { type: 'radio', name: 'type', value: 'full', defaultChecked: true }),
            ' Général',
          ),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 } },
            React.createElement('input', { type: 'radio', name: 'type', value: 'cycle' }),
            ' Cyclique',
          ),
        ),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' } },
          React.createElement('button', { type: 'button', style: S.btnSecondary, onClick: () => setFormOpen(false) }, 'Annuler'),
          React.createElement('button', { type: 'submit', style: { ...S.btnPrimary, opacity: saving ? 0.6 : 1 }, disabled: saving },
            saving ? 'Création…' : 'Démarrer'),
        ),
      ),
    ),
    detailCount && React.createElement(InventoryDetailModal, {
      app, api, count: detailCount, onClose: () => setDetailCount(null), onChanged: () => load(true),
    }),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   TRANSFERS TAB
   ════════════════════════════════════════════════════════════════════════ */

const TRANSFER_STATUS_LABELS = { draft: 'Brouillon', ready: 'Prêt', done: 'Terminé', cancelled: 'Annulé' }

// Popup de détail — ouverte au clic sur un transfert : lignes demandé/
// transféré (chargées à l'ouverture) + les mêmes actions que la ligne de
// tableau (prêt/exécuter/annuler), pour ne pas avoir à fermer la popup pour agir.
function TransferDetailModal({ app, api, transfer, onClose, busy, onAction }) {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setLines(await api.transfers.lines(transfer.id) ?? []) }
    catch (e) { app.notify('Erreur chargement des lignes', 'error') }
    setLoading(false)
  }, [transfer.id])

  useEffect(() => { load() }, [load])

  return React.createElement(ModalShell, { wide: true, onClose },
    React.createElement(ModalHeader, {
      title: transfer.sourceReference ?? `Transfert ${transfer.id.slice(0, 8)}`,
      subtitle: `${transfer.sourceWarehouseName ?? '—'} → ${transfer.destinationWarehouseName ?? '—'}`,
      onClose,
    }),
    React.createElement('div', { style: { padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflowY: 'auto' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        React.createElement(Badge, { status: transfer.status, label: TRANSFER_STATUS_LABELS[transfer.status] ?? transfer.status }),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--color-text-tertiary)' } }, `Créé par ${transfer.createdBy}`),
      ),
      loading
        ? React.createElement(TableSkeleton, { rows: 4, cols: 3 })
        : lines.length === 0
          ? React.createElement(EmptyState, { icon: Icon.arrows, title: 'Aucune ligne', hint: 'Ce transfert ne contient aucun produit.' })
          : React.createElement('table', { style: S.table },
              React.createElement('thead', null,
                React.createElement('tr', null, ['Produit', 'Demandé', 'Transféré'].map(h => React.createElement('th', { key: h, style: S.th }, h))),
              ),
              React.createElement('tbody', null,
                lines.map(l =>
                  React.createElement('tr', { key: l.id ?? l.productId },
                    React.createElement('td', { style: S.td }, l.productName ?? l.productId),
                    React.createElement('td', { style: { ...S.td, fontFamily: 'monospace' } }, l.requestedQuantity.toLocaleString('fr-FR')),
                    React.createElement('td', {
                      style: { ...S.td, fontFamily: 'monospace', color: l.transferredQuantity ? 'var(--color-success)' : 'var(--color-text-tertiary)' },
                    }, l.transferredQuantity != null ? l.transferredQuantity.toLocaleString('fr-FR') : '—'),
                  ),
                ),
              ),
            ),
    ),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px', borderTop: '1px solid var(--color-border)' } },
      transfer.status === 'draft' && React.createElement('button', { style: { ...S.btnSecondary, opacity: busy ? 0.6 : 1 }, disabled: busy, onClick: () => onAction('ready') }, 'Marquer prêt'),
      transfer.status === 'ready' && React.createElement('button', { style: { ...S.btnPrimary, opacity: busy ? 0.6 : 1 }, disabled: busy, onClick: () => onAction('execute') }, 'Exécuter'),
      (transfer.status === 'draft' || transfer.status === 'ready') && React.createElement('button', { style: { ...S.btnDanger, opacity: busy ? 0.6 : 1 }, disabled: busy, onClick: () => onAction('cancel') }, 'Annuler'),
    ),
  )
}

function TransfersTab({ app, api }) {
  const [transfers, setTransfers] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [detailTransfer, setDetailTransfer] = useState(null)

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true)
    try {
      const [t, w, p] = await Promise.all([api.transfers.list(), api.warehouses.list(), api.products.list()])
      setTransfers(t ?? []); setWarehouses(w ?? []); setProducts(p ?? [])
    } catch (e) { if (!silent) app.notify('Erreur chargement', 'error') }
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => app.onRealtime('xstock', () => load(true)), [load])

  const runAction = useCallback(async (action, id) => {
    setBusyId(id)
    try {
      await api.transfers[action](id)
      await load(true)
      setDetailTransfer(prev => prev && prev.id === id ? null : prev)
    }
    catch (e) { app.notify('Erreur', 'error') }
    setBusyId(null)
  }, [load])

  const handleCreate = useCallback(async (data) => {
    setSaving(true)
    try {
      await api.transfers.create({ type: 'transfer', ...data })
      setFormOpen(false); await load()
      app.notify('Transfert créé', 'success')
    } catch (e) { app.notify('Erreur création', 'error') }
    setSaving(false)
  }, [load])

  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return transfers
    return transfers.filter(t => t.status === statusFilter)
  }, [transfers, statusFilter])

  const pendingCount = useMemo(() => transfers.filter(t => t.status === 'draft' || t.status === 'ready').length, [transfers])
  const doneCount = useMemo(() => transfers.filter(t => t.status === 'done').length, [transfers])
  const cancelledCount = useMemo(() => transfers.filter(t => t.status === 'cancelled').length, [transfers])

  if (loading) return React.createElement(TableSkeleton, { cols: 6 })

  return React.createElement(Fragment, null,
    React.createElement('div', { style: S.grid4 },
      React.createElement(KpiCard, { icon: Icon.arrows, tint: 'primary', label: 'Transferts', value: transfers.length.toLocaleString('fr-FR'), sub: 'Tous statuts confondus' }),
      React.createElement(KpiCard, {
        icon: Icon.clipboard, tint: pendingCount > 0 ? 'warning' : 'success', label: 'En attente', value: pendingCount.toLocaleString('fr-FR'),
        sub: pendingCount > 0 ? 'À préparer ou exécuter' : 'Rien en attente', subTint: pendingCount > 0 ? 'warning' : 'success',
        onClick: pendingCount > 0 ? () => setStatusFilter('draft') : undefined,
      }),
      React.createElement(KpiCard, { icon: Icon.trending, tint: 'success', label: 'Terminés', value: doneCount.toLocaleString('fr-FR'), sub: 'Transferts exécutés' }),
      React.createElement(KpiCard, { icon: Icon.trash, tint: 'info', label: 'Annulés', value: cancelledCount.toLocaleString('fr-FR'), sub: 'Transferts abandonnés' }),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 } },
      React.createElement('div', { style: S.tabs },
        [['ALL', 'Tous'], ['draft', 'Brouillon'], ['ready', 'Prêt'], ['done', 'Terminé'], ['cancelled', 'Annulé']].map(([v, l]) =>
          React.createElement('button', { key: v, style: S.tab(statusFilter === v), onClick: () => setStatusFilter(v) }, l),
        ),
      ),
      React.createElement('button', { style: S.btnPrimary, onClick: () => setFormOpen(true) },
        React.createElement(Icon.plus, { size: 15 }), ' Nouveau transfert'),
    ),
    filtered.length === 0
      ? React.createElement(EmptyState, {
          icon: Icon.arrows, title: transfers.length === 0 ? 'Aucun transfert pour le moment' : 'Aucun transfert trouvé',
          hint: transfers.length === 0 ? 'Planifie un transfert de stock entre deux entrepôts.' : 'Essaie un autre filtre.',
          action: transfers.length === 0 ? { label: 'Nouveau transfert', icon: Icon.plus, onClick: () => setFormOpen(true) } : undefined,
        })
      : React.createElement('div', { className: 'xstock-table-card', style: { ...S.card, overflow: 'visible' } },
          React.createElement('table', { style: S.table, className: 'xstock-hoverable' },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['Référence', 'Origine', 'Destination', 'Statut', 'Créé par', ''].map(h =>
                  React.createElement('th', { key: h, style: S.th }, h)),
              ),
            ),
            React.createElement('tbody', null,
              filtered.map(t =>
                React.createElement('tr', { key: t.id, style: { cursor: 'pointer' }, onClick: () => setDetailTransfer(t) },
                  React.createElement('td', { style: { ...S.td, fontFamily: 'monospace', fontSize: 12 } }, t.sourceReference ?? t.id.slice(0, 8)),
                  React.createElement('td', { style: S.td }, t.sourceWarehouseName ?? t.sourceWarehouseId ?? '—'),
                  React.createElement('td', { style: S.td }, t.destinationWarehouseName ?? t.destinationWarehouseId ?? '—'),
                  React.createElement('td', { style: S.td }, React.createElement(Badge, { status: t.status, label: TRANSFER_STATUS_LABELS[t.status] ?? t.status })),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } }, t.createdBy),
                  React.createElement('td', { style: { ...S.td, textAlign: 'right' }, onClick: e => e.stopPropagation() },
                    t.status === 'draft' && React.createElement('button', {
                      style: { ...S.btnSecondary, padding: '5px 10px', fontSize: 11 }, disabled: busyId === t.id,
                      onClick: () => runAction('ready', t.id),
                    }, 'Marquer prêt'),
                    t.status === 'ready' && React.createElement('button', {
                      style: { ...S.btnPrimary, padding: '5px 10px', fontSize: 11, marginLeft: 6 }, disabled: busyId === t.id,
                      onClick: () => runAction('execute', t.id),
                    }, 'Exécuter'),
                    (t.status === 'draft' || t.status === 'ready') && React.createElement('button', {
                      style: { ...S.btnIcon, color: 'var(--color-danger)' }, disabled: busyId === t.id,
                      onClick: () => runAction('cancel', t.id), title: 'Annuler', 'aria-label': 'Annuler le transfert',
                    }, React.createElement(Icon.trash, { size: 13 })),
                  ),
                ),
              ),
            ),
          ),
        ),
    formOpen && React.createElement(TransferFormModal, {
      warehouses, products, saving, onClose: () => setFormOpen(false), onSave: handleCreate,
    }),
    detailTransfer && React.createElement(TransferDetailModal, {
      app, api, transfer: detailTransfer, busy: busyId === detailTransfer.id,
      onClose: () => setDetailTransfer(null), onAction: (action) => runAction(action, detailTransfer.id),
    }),
  )
}

function TransferFormModal({ warehouses, products, saving, onClose, onSave }) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState('')
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('')
  const [lines, setLines] = useState([{ productId: '', requestedQuantity: 1 }])

  const updateLine = (i, patch) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))

  const handleSubmit = (e) => {
    e.preventDefault()
    const validLines = lines.filter(l => l.productId && l.requestedQuantity > 0)
    if (!validLines.length) return
    onSave({ sourceWarehouseId, destinationWarehouseId, lines: validLines })
  }

  return React.createElement(ModalShell, { onClose },
    React.createElement(ModalHeader, { title: 'Nouveau transfert', onClose }),
    React.createElement('form', { onSubmit: handleSubmit, style: { padding: '16px 20px', overflow: 'auto', flex: 1 } },
      React.createElement('label', { style: S.label }, 'Entrepôt source *'),
      React.createElement('select', { style: S.input, required: true, value: sourceWarehouseId, onChange: e => setSourceWarehouseId(e.target.value) },
        React.createElement('option', { value: '' }, 'Sélectionner…'),
        warehouses.filter(w => w.isActive).map(w => React.createElement('option', { key: w.id, value: w.id }, w.name)),
      ),
      React.createElement('label', { style: { ...S.label, marginTop: 12 } }, 'Entrepôt destination *'),
      React.createElement('select', { style: S.input, required: true, value: destinationWarehouseId, onChange: e => setDestinationWarehouseId(e.target.value) },
        React.createElement('option', { value: '' }, 'Sélectionner…'),
        warehouses.filter(w => w.isActive && w.id !== sourceWarehouseId).map(w => React.createElement('option', { key: w.id, value: w.id }, w.name)),
      ),
      React.createElement('label', { style: { ...S.label, marginTop: 12 } }, 'Produits à transférer *'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        lines.map((line, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement('select', { style: { ...S.input, flex: 1 }, required: true, value: line.productId,
              onChange: e => updateLine(i, { productId: e.target.value }) },
              React.createElement('option', { value: '' }, 'Produit…'),
              products.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name)),
            ),
            React.createElement('input', { style: { ...S.input, width: 100 }, type: 'number', min: 0, step: 0.01, required: true,
              value: line.requestedQuantity, onChange: e => updateLine(i, { requestedQuantity: +e.target.value }) }),
            React.createElement('button', { type: 'button', style: { ...S.btnIcon, color: 'var(--color-danger)' }, disabled: lines.length === 1,
              onClick: () => setLines(ls => ls.filter((_, idx) => idx !== i)) }, React.createElement(Icon.trash, { size: 13 })),
          ),
        ),
      ),
      React.createElement('button', { type: 'button', style: { ...S.btnSecondary, marginTop: 8, padding: '6px 12px', fontSize: 12 },
        onClick: () => setLines(ls => [...ls, { productId: '', requestedQuantity: 1 }]) },
        React.createElement(Icon.plus, { size: 12 }), ' Ajouter une ligne'),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' } },
        React.createElement('button', { type: 'button', style: S.btnSecondary, onClick: onClose }, 'Annuler'),
        React.createElement('button', { type: 'submit', style: { ...S.btnPrimary, opacity: saving ? 0.6 : 1 }, disabled: saving },
          saving ? 'Création…' : 'Créer le transfert'),
      ),
    ),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   INTELLIGENCE TAB
   ════════════════════════════════════════════════════════════════════════ */

const CRITICALITY_COLOR = {
  critical: ['var(--color-danger-muted)', 'var(--color-danger-text)'],
  high:     ['var(--color-warning-muted)', 'var(--color-warning-text)'],
  medium:   ['var(--color-info-muted)', 'var(--color-info-text)'],
  low:      ['var(--color-surface-subtle)', 'var(--color-text-secondary)'],
}

function IntelligenceTab({ app, api }) {
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)

  const [suggestions, setSuggestions] = useState([])
  const [suggestionsBusy, setSuggestionsBusy] = useState(false)
  const [actionBusyId, setActionBusyId] = useState(null)

  const [riskWarehouseId, setRiskWarehouseId] = useState('')
  const [risks, setRisks] = useState(null)
  const [riskBusy, setRiskBusy] = useState(false)

  const [rpProductId, setRpProductId] = useState('')
  const [rpWarehouseId, setRpWarehouseId] = useState('')
  const [rpLeadTime, setRpLeadTime] = useState(7)
  const [reorderResult, setReorderResult] = useState(null)
  const [forecastResult, setForecastResult] = useState(null)
  const [rpBusy, setRpBusy] = useState(false)

  const [classification, setClassification] = useState(null)
  const [classifyBusy, setClassifyBusy] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [p, w, s] = await Promise.all([api.products.list(), api.warehouses.list(), api.intelligence.pendingSuggestions()])
        setProducts(p ?? []); setWarehouses(w ?? []); setSuggestions(s ?? [])
      } catch (e) { app.notify('Erreur chargement', 'error') }
      setLoading(false)
    })()
  }, [])

  const productName = useCallback((id) => products.find(p => p.id === id)?.name ?? id, [products])

  const loadSuggestions = useCallback(async () => {
    try { setSuggestions(await api.intelligence.pendingSuggestions() ?? []) }
    catch (e) { app.notify('Erreur', 'error') }
  }, [])

  const generateSuggestions = useCallback(async () => {
    setSuggestionsBusy(true)
    try {
      await api.intelligence.generateTransferSuggestions({})
      await loadSuggestions()
      app.notify('Suggestions générées', 'success')
    } catch (e) { app.notify('Erreur génération', 'error') }
    setSuggestionsBusy(false)
  }, [loadSuggestions])

  const runSuggestionAction = useCallback(async (action, id) => {
    setActionBusyId(id)
    try { await api.intelligence[action](id); await loadSuggestions() }
    catch (e) { app.notify('Erreur', 'error') }
    setActionBusyId(null)
  }, [loadSuggestions])

  const runStockoutRisk = useCallback(async () => {
    if (!riskWarehouseId) return app.notify('Sélectionner un entrepôt', 'warning')
    setRiskBusy(true)
    try { setRisks(await api.intelligence.stockoutRisk({ warehouseId: riskWarehouseId }) ?? []) }
    catch (e) { app.notify('Erreur', 'error') }
    setRiskBusy(false)
  }, [riskWarehouseId])

  const runReorderPoint = useCallback(async () => {
    if (!rpProductId || !rpWarehouseId) return app.notify('Sélectionner un produit et un entrepôt', 'warning')
    setRpBusy(true)
    try {
      const [rp, fc] = await Promise.all([
        api.intelligence.reorderPoint({ productId: rpProductId, warehouseId: rpWarehouseId, leadTimeDays: rpLeadTime }),
        api.intelligence.forecast({ productId: rpProductId, warehouseId: rpWarehouseId }),
      ])
      setReorderResult(rp); setForecastResult(fc)
    } catch (e) { app.notify('Erreur calcul — historique de demande insuffisant ?', 'error') }
    setRpBusy(false)
  }, [rpProductId, rpWarehouseId, rpLeadTime])

  const runClassify = useCallback(async () => {
    setClassifyBusy(true)
    try { setClassification(await api.intelligence.classify({})) }
    catch (e) { app.notify('Erreur classification', 'error') }
    setClassifyBusy(false)
  }, [])

  if (loading) return Spinner()

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 20 } },

    // ── Suggestions de transfert ──────────────────────────────────
    React.createElement('div', { style: { ...S.card, padding: 20 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
        React.createElement('div', { style: { fontWeight: 600 } }, 'Suggestions de transfert inter-sites'),
        React.createElement('button', { style: { ...S.btnSecondary, padding: '6px 12px', fontSize: 12, opacity: suggestionsBusy ? 0.6 : 1 },
          disabled: suggestionsBusy, onClick: generateSuggestions }, suggestionsBusy ? 'Génération…' : 'Générer'),
      ),
      suggestions.length === 0
        ? React.createElement('div', { style: { fontSize: 13, color: 'var(--color-text-tertiary)' } }, 'Aucune suggestion en attente')
        : React.createElement('table', { style: S.table },
            React.createElement('thead', null, React.createElement('tr', null,
              ['Produit', 'Site source', 'Site destination', 'Quantité', 'Raison', 'Statut', ''].map(h =>
                React.createElement('th', { key: h, style: S.th }, h)))),
            React.createElement('tbody', null, suggestions.map(sg =>
              React.createElement('tr', { key: sg.id },
                React.createElement('td', { style: S.td }, productName(sg.productId)),
                React.createElement('td', { style: S.td }, sg.sourceSiteId),
                React.createElement('td', { style: S.td }, sg.destinationSiteId),
                React.createElement('td', { style: { ...S.td, fontFamily: 'monospace' } }, sg.suggestedQuantity),
                React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } }, sg.reason),
                React.createElement('td', { style: S.td }, React.createElement(Badge, { status: sg.status })),
                React.createElement('td', { style: { ...S.td, textAlign: 'right', whiteSpace: 'nowrap' } },
                  sg.status === 'suggested' && React.createElement(Fragment, null,
                    React.createElement('button', { style: { ...S.btnSecondary, padding: '4px 10px', fontSize: 11 }, disabled: actionBusyId === sg.id,
                      onClick: () => runSuggestionAction('approveSuggestion', sg.id) }, 'Approuver'),
                    React.createElement('button', { style: { ...S.btnSecondary, padding: '4px 10px', fontSize: 11, marginLeft: 6, color: 'var(--color-danger)' }, disabled: actionBusyId === sg.id,
                      onClick: () => runSuggestionAction('rejectSuggestion', sg.id) }, 'Rejeter'),
                  ),
                  sg.status === 'approved' && React.createElement('button', { style: { ...S.btnPrimary, padding: '4px 10px', fontSize: 11 }, disabled: actionBusyId === sg.id,
                    onClick: () => runSuggestionAction('executeSuggestion', sg.id) }, 'Exécuter'),
                ),
              ),
            )),
          ),
    ),

    // ── Point de commande & prévision ──────────────────────────────
    React.createElement('div', { style: { ...S.card, padding: 20 } },
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 12 } }, 'Point de commande & prévision'),
      React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' } },
        React.createElement('div', { style: { minWidth: 200 } },
          React.createElement('label', { style: S.label }, 'Produit'),
          React.createElement('select', { style: S.input, value: rpProductId, onChange: e => setRpProductId(e.target.value) },
            React.createElement('option', { value: '' }, 'Sélectionner…'),
            products.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name)))),
        React.createElement('div', { style: { minWidth: 180 } },
          React.createElement('label', { style: S.label }, 'Entrepôt'),
          React.createElement('select', { style: S.input, value: rpWarehouseId, onChange: e => setRpWarehouseId(e.target.value) },
            React.createElement('option', { value: '' }, 'Sélectionner…'),
            warehouses.map(w => React.createElement('option', { key: w.id, value: w.id }, w.name)))),
        React.createElement('div', { style: { width: 120 } },
          React.createElement('label', { style: S.label }, 'Délai (j)'),
          React.createElement('input', { style: S.input, type: 'number', min: 0.5, step: 0.5, value: rpLeadTime, onChange: e => setRpLeadTime(+e.target.value) })),
        React.createElement('button', { style: { ...S.btnPrimary, opacity: rpBusy ? 0.6 : 1 }, disabled: rpBusy, onClick: runReorderPoint },
          rpBusy ? 'Calcul…' : 'Calculer'),
      ),
      (reorderResult || forecastResult) && React.createElement('div', { style: { ...S.grid4, marginTop: 16 } },
        reorderResult && React.createElement(Fragment, null,
          React.createElement('div', { style: S.kpi },
            React.createElement('div', { style: S.kpiLabel }, 'Demande moy./jour'),
            React.createElement('div', { style: S.kpiValue }, reorderResult.avgDailyDemand.toFixed(2))),
          React.createElement('div', { style: S.kpi },
            React.createElement('div', { style: S.kpiLabel }, 'Stock de sécurité'),
            React.createElement('div', { style: S.kpiValue }, reorderResult.safetyStock.toFixed(1))),
          React.createElement('div', { style: S.kpi },
            React.createElement('div', { style: S.kpiLabel }, 'Point de commande'),
            React.createElement('div', { style: { ...S.kpiValue, color: 'var(--color-primary)' } }, reorderResult.reorderPoint.toFixed(1))),
        ),
        forecastResult && React.createElement('div', { style: S.kpi },
          React.createElement('div', { style: S.kpiLabel }, `Prévision (${forecastResult.method})`),
          React.createElement('div', { style: S.kpiValue }, forecastResult.forecast.toFixed(1))),
      ),
    ),

    // ── Risque de rupture ──────────────────────────────────────────
    React.createElement('div', { style: { ...S.card, padding: 20 } },
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 12 } }, 'Risque de rupture de stock'),
      React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-end' } },
        React.createElement('div', { style: { minWidth: 220 } },
          React.createElement('label', { style: S.label }, 'Entrepôt'),
          React.createElement('select', { style: S.input, value: riskWarehouseId, onChange: e => setRiskWarehouseId(e.target.value) },
            React.createElement('option', { value: '' }, 'Sélectionner…'),
            warehouses.map(w => React.createElement('option', { key: w.id, value: w.id }, w.name)))),
        React.createElement('button', { style: { ...S.btnPrimary, opacity: riskBusy ? 0.6 : 1 }, disabled: riskBusy, onClick: runStockoutRisk },
          riskBusy ? 'Analyse…' : 'Analyser'),
      ),
      risks && (risks.length === 0
        ? React.createElement('div', { style: { fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 12 } }, 'Aucun risque détecté')
        : React.createElement('table', { style: { ...S.table, marginTop: 12 } },
            React.createElement('thead', null, React.createElement('tr', null,
              ['Produit', 'Stock actuel', 'Jours restants', 'Délai fournisseur', 'Criticité'].map(h =>
                React.createElement('th', { key: h, style: S.th }, h)))),
            React.createElement('tbody', null, risks.map(r => {
              const [bg, fg] = CRITICALITY_COLOR[r.criticality] ?? CRITICALITY_COLOR.low
              return React.createElement('tr', { key: r.productId },
                React.createElement('td', { style: S.td }, productName(r.productId)),
                React.createElement('td', { style: { ...S.td, fontFamily: 'monospace' } }, r.currentStock),
                React.createElement('td', { style: S.td }, r.daysRemaining.toFixed(1)),
                React.createElement('td', { style: S.td }, r.leadTimeDays),
                React.createElement('td', { style: S.td }, React.createElement('span', { style: S.badge(bg, fg) }, r.criticality)),
              )
            })),
          )),
    ),

    // ── Classification ABC/XYZ ──────────────────────────────────────
    React.createElement('div', { style: { ...S.card, padding: 20 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
        React.createElement('div', { style: { fontWeight: 600 } }, 'Classification ABC/XYZ'),
        React.createElement('button', { style: { ...S.btnSecondary, padding: '6px 12px', fontSize: 12, opacity: classifyBusy ? 0.6 : 1 },
          disabled: classifyBusy, onClick: runClassify }, classifyBusy ? 'Classification…' : 'Lancer'),
      ),
      classification && React.createElement('table', { style: S.table },
        React.createElement('thead', null, React.createElement('tr', null,
          ['Produit', 'ABC', 'XYZ'].map(h => React.createElement('th', { key: h, style: S.th }, h)))),
        React.createElement('tbody', null, Object.entries(classification).map(([productId, c]) =>
          React.createElement('tr', { key: productId },
            React.createElement('td', { style: S.td }, productName(productId)),
            React.createElement('td', { style: S.td }, c.abc ?? '—'),
            React.createElement('td', { style: S.td }, c.xyz ?? '—'),
          ),
        )),
      ),
    ),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   ATTACHMENTS TAB
   ════════════════════════════════════════════════════════════════════════ */

const OWNER_TYPES = [
  ['product', 'Produit'],
  ['batch', 'Lot'],
  ['warehouse', 'Entrepôt'],
  ['inventory_count', 'Comptage'],
  ['controlled_substance_register', 'Registre stupéfiants'],
]

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function AttachmentsTab({ app, api }) {
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [ownerType, setOwnerType] = useState('product')
  const [ownerId, setOwnerId] = useState('')
  const [attachments, setAttachments] = useState(null)
  const [listBusy, setListBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [p, w] = await Promise.all([api.products.list(), api.warehouses.list()])
        setProducts(p ?? []); setWarehouses(w ?? [])
      } catch (e) { app.notify('Erreur chargement', 'error') }
      setLoading(false)
    })()
  }, [])

  const loadAttachments = useCallback(async () => {
    if (!ownerId) return app.notify('Sélectionner ou saisir un identifiant', 'warning')
    setListBusy(true)
    try { setAttachments(await api.attachments.listForOwner(ownerType, ownerId) ?? []) }
    catch (e) { app.notify('Erreur chargement', 'error') }
    setListBusy(false)
  }, [ownerType, ownerId])

  const handleUpload = useCallback(async () => {
    if (!ownerId) return app.notify('Sélectionner ou saisir un identifiant', 'warning')
    const picked = await app.dialog.open({ title: 'Choisir un fichier', multiple: false })
    if (!picked) return
    setUploading(true)
    try {
      await api.attachments.upload(ownerType, ownerId, picked)
      await loadAttachments()
      app.notify('Fichier ajouté', 'success')
    } catch (e) { app.notify("Erreur lors de l'upload", 'error') }
    setUploading(false)
  }, [ownerType, ownerId, loadAttachments])

  const handleDownload = useCallback(async (att) => {
    try { await api.attachments.download(att.id, att.originalName) }
    catch (e) { app.notify('Erreur téléchargement', 'error') }
  }, [])

  const handleDelete = useCallback(async (id) => {
    setBusyId(id)
    try {
      await api.attachments.remove(id)
      setAttachments(prev => prev.filter(a => a.id !== id))
      app.notify('Pièce jointe supprimée', 'success')
    } catch (e) { app.notify('Erreur suppression', 'error') }
    setBusyId(null)
  }, [])

  if (loading) return Spinner()

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
    React.createElement('div', { style: { ...S.card, padding: 20 } },
      React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' } },
        React.createElement('div', { style: { minWidth: 200 } },
          React.createElement('label', { style: S.label }, 'Type de ressource'),
          React.createElement('select', { style: S.input, value: ownerType, onChange: e => { setOwnerType(e.target.value); setOwnerId(''); setAttachments(null) } },
            OWNER_TYPES.map(([v, l]) => React.createElement('option', { key: v, value: v }, l)))),
        React.createElement('div', { style: { minWidth: 220 } },
          React.createElement('label', { style: S.label }, 'Ressource'),
          ownerType === 'product'
            ? React.createElement('select', { style: S.input, value: ownerId, onChange: e => setOwnerId(e.target.value) },
                React.createElement('option', { value: '' }, 'Sélectionner…'),
                products.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name)))
            : ownerType === 'warehouse'
            ? React.createElement('select', { style: S.input, value: ownerId, onChange: e => setOwnerId(e.target.value) },
                React.createElement('option', { value: '' }, 'Sélectionner…'),
                warehouses.map(w => React.createElement('option', { key: w.id, value: w.id }, w.name)))
            : React.createElement('input', { style: S.input, value: ownerId, onChange: e => setOwnerId(e.target.value), placeholder: 'ID de la ressource' })),
        React.createElement('button', { style: { ...S.btnSecondary, opacity: listBusy ? 0.6 : 1 }, disabled: listBusy, onClick: loadAttachments },
          listBusy ? 'Chargement…' : 'Afficher'),
        React.createElement('button', { style: { ...S.btnPrimary, opacity: uploading ? 0.6 : 1 }, disabled: uploading, onClick: handleUpload },
          React.createElement(Icon.paperclip, { size: 14 }), uploading ? ' Envoi…' : ' Ajouter un fichier'),
      ),
    ),

    attachments && React.createElement('div', { className: 'xstock-table-card', style: { ...S.card, overflow: 'visible' } },
      React.createElement('table', { style: S.table },
        React.createElement('thead', null, React.createElement('tr', null,
          ['Fichier', 'Taille', 'Type', 'Ajouté par', ''].map(h => React.createElement('th', { key: h, style: S.th }, h)))),
        React.createElement('tbody', null,
          attachments.length === 0
            ? React.createElement('tr', null, React.createElement('td', { colSpan: 5, style: { textAlign: 'center', padding: 32, color: 'var(--color-text-tertiary)' } }, 'Aucune pièce jointe'))
            : attachments.map(a =>
                React.createElement('tr', { key: a.id },
                  React.createElement('td', { style: { ...S.td, fontWeight: 500 } }, a.originalName),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } }, formatSize(a.sizeBytes)),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } }, a.mimeType),
                  React.createElement('td', { style: { ...S.td, fontSize: 12, color: 'var(--color-text-tertiary)' } }, a.uploadedBy),
                  React.createElement('td', { style: { ...S.td, textAlign: 'right', whiteSpace: 'nowrap' } },
                    React.createElement('button', { style: S.btnIcon, title: 'Télécharger', 'aria-label': `Télécharger ${a.originalName}`, onClick: () => handleDownload(a) },
                      React.createElement(Icon.download, { size: 14 })),
                    React.createElement('button', { style: { ...S.btnIcon, color: 'var(--color-danger)' }, disabled: busyId === a.id,
                      title: 'Supprimer', 'aria-label': `Supprimer ${a.originalName}`, onClick: () => handleDelete(a.id) }, React.createElement(Icon.trash, { size: 13 })),
                  ),
                ),
              ),
        ),
      ),
    ),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   SETTINGS TAB
   ════════════════════════════════════════════════════════════════════════ */

// Types d'alerte pouvant encore réellement se déclencher — cold_chain_excursion
// et consumption_anomaly restent dans l'enum backend (des lignes existantes
// peuvent les référencer) mais leurs déclencheurs ont été retirés du plugin ;
// inutile de proposer un ciblage pour une alerte qui ne partira jamais.
const ACTIVE_ALERT_TYPES = ['stock_threshold', 'batch_expiry', 'controlled_substance_variance', 'transfer_suggestion']

function AlertTargetingModal({ members, alertLabels, availableTypes, editing, saving, onSave, onClose }) {
  const [alertType, setAlertType] = useState(editing?.alertType ?? availableTypes[0] ?? '')
  const [mode, setMode] = useState(editing?.roleId ? 'role' : editing?.permission ? 'permission' : 'users')
  const [selectedUsers, setSelectedUsers] = useState(() => new Set(editing?.userIds ?? []))
  const [roleId, setRoleId] = useState(editing?.roleId ?? '')
  const [permission, setPermission] = useState(editing?.permission ?? '')
  const [search, setSearch] = useState('')

  const filteredMembers = useMemo(() => {
    if (!search) return members
    const q = search.toLowerCase()
    return members.filter(m => m.email?.toLowerCase().includes(q))
  }, [members, search])

  const toggleUser = (id) => setSelectedUsers(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const canSave = alertType && (
    (mode === 'users' && selectedUsers.size > 0) ||
    (mode === 'role' && roleId.trim()) ||
    (mode === 'permission' && permission.trim())
  )

  const handleSave = () => {
    if (!canSave) return
    const payload = { alertType }
    if (mode === 'users') payload.userIds = Array.from(selectedUsers)
    else if (mode === 'role') payload.roleId = roleId.trim()
    else payload.permission = permission.trim()
    onSave(payload)
  }

  return React.createElement(ModalShell, { onClose },
    React.createElement(ModalHeader, { title: editing ? 'Modifier le ciblage' : 'Nouveau ciblage', subtitle: alertLabels[alertType], onClose }),
    React.createElement('div', { style: { padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 } },
      React.createElement('div', null,
        React.createElement('label', { style: S.label }, "Type d'alerte"),
        editing
          ? React.createElement('div', { style: { fontSize: 13, fontWeight: 600, padding: '9px 0' } }, alertLabels[alertType] ?? alertType)
          : React.createElement('select', { style: S.input, value: alertType, onChange: e => setAlertType(e.target.value) },
              availableTypes.map(t => React.createElement('option', { key: t, value: t }, alertLabels[t] ?? t))),
      ),
      React.createElement('div', null,
        React.createElement('label', { style: S.label }, 'Cibler par'),
        React.createElement('div', { style: { display: 'flex', gap: 2, background: 'var(--color-surface-subtle)', borderRadius: 10, padding: 2 } },
          [['users', 'Utilisateurs'], ['role', 'Rôle'], ['permission', 'Permission']].map(([v, l]) =>
            React.createElement('button', {
              key: v, type: 'button',
              style: {
                flex: 1, padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: mode === v ? 'var(--color-card)' : 'transparent',
                color: mode === v ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                boxShadow: mode === v ? 'var(--shadow-sm)' : 'none',
              },
              onClick: () => setMode(v),
            }, l),
          ),
        ),
      ),
      mode === 'users' && React.createElement('div', null,
        React.createElement('div', { style: { position: 'relative', marginBottom: 8 } },
          React.createElement(Icon.search, { size: 13, style: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' } }),
          React.createElement('input', { style: { ...S.input, paddingLeft: 30 }, placeholder: 'Rechercher un utilisateur…', value: search, onChange: e => setSearch(e.target.value) }),
        ),
        members.length === 0
          ? React.createElement(EmptyState, {
              icon: Icon.users, title: 'Aucun utilisateur trouvé',
              hint: "Impossible de charger la liste des membres du tenant.",
            })
          : React.createElement('div', { style: { maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 10 } },
              filteredMembers.map(m =>
                React.createElement('label', {
                  key: m.userId,
                  style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)' },
                },
                  React.createElement('input', { type: 'checkbox', checked: selectedUsers.has(m.userId), onChange: () => toggleUser(m.userId) }),
                  React.createElement('span', {
                    style: { width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                      background: 'var(--color-primary-muted)', color: 'var(--color-primary-text)', fontSize: 11, fontWeight: 700 },
                  }, (m.email ?? '?').slice(0, 2).toUpperCase()),
                  React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('div', { style: { fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.email ?? m.userId),
                    m.roleId && React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)' } }, m.roleId),
                  ),
                ),
              ),
            ),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 } }, `${selectedUsers.size} sélectionné(s)`),
      ),
      mode === 'role' && React.createElement('div', null,
        React.createElement('label', { style: S.label }, 'Identifiant du rôle'),
        React.createElement('input', { style: S.input, value: roleId, onChange: e => setRoleId(e.target.value), placeholder: 'ex. admin' }),
      ),
      mode === 'permission' && React.createElement('div', null,
        React.createElement('label', { style: S.label }, 'Permission'),
        React.createElement('input', { style: S.input, value: permission, onChange: e => setPermission(e.target.value), placeholder: 'ex. xstock:alerts:stock' }),
      ),
    ),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px', borderTop: '1px solid var(--color-border)' } },
      React.createElement('button', { style: S.btnSecondary, onClick: onClose }, 'Annuler'),
      React.createElement('button', {
        style: { ...S.btnPrimary, opacity: (!canSave || saving) ? 0.6 : 1 }, disabled: !canSave || saving, onClick: handleSave,
      }, saving ? 'Enregistrement…' : 'Enregistrer'),
    ),
  )
}

function SettingsTab({ app, api }) {
  const [settings, setSettings] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [targetingOpen, setTargetingOpen] = useState(false)
  const [targetingEdit, setTargetingEdit] = useState(null)
  const [savingTargeting, setSavingTargeting] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [s, a, m] = await Promise.all([api.settings.get(), api.settings.alerts(), api.settings.members()])
        setSettings(s ?? {})
        setAlerts(a ?? [])
        // xauth.MemberResponse n'a pas d'alias_generator CAMEL (contrairement
        // aux schémas xstock) — normalise ici pour rester cohérent avec le
        // reste du fichier qui suppose du camelCase partout.
        setMembers((Array.isArray(m) ? m : []).map(x => ({ userId: x.user_id, email: x.email, roleId: x.role_id })))
      } catch (e) { app.notify('Erreur chargement paramètres', 'error') }
      setLoading(false)
    })()
  }, [])

  const update = useCallback(async (patch) => {
    try {
      const r = await api.settings.update(patch)
      setSettings(r)
      app.notify('Paramètres mis à jour', 'success')
    } catch (e) { app.notify('Erreur', 'error') }
  }, [])

  const resetAlert = useCallback(async (alertType) => {
    try {
      await api.settings.resetAlert(alertType)
      setAlerts(prev => prev.filter(a => a.alertType !== alertType))
      app.notify('Ciblage réinitialisé', 'success')
    } catch (e) { app.notify('Erreur', 'error') }
  }, [])

  const saveTargeting = useCallback(async (payload) => {
    setSavingTargeting(true)
    try {
      const saved = await api.settings.upsertAlert(payload)
      setAlerts(prev => [...prev.filter(a => a.alertType !== saved.alertType), saved])
      setTargetingOpen(false)
      setTargetingEdit(null)
      app.notify('Ciblage enregistré', 'success')
    } catch (e) { app.notify("Erreur lors de l'enregistrement du ciblage", 'error') }
    setSavingTargeting(false)
  }, [])

  const ALERT_LABELS = {
    stock_threshold: 'Seuil de stock',
    batch_expiry: 'Péremption de lot',
    consumption_anomaly: 'Anomalie de consommation',
    cold_chain_excursion: 'Excursion chaîne du froid',
    controlled_substance_variance: 'Écart stupéfiants',
    transfer_suggestion: 'Suggestion de transfert',
  }

  const memberByUserId = useMemo(() => new Map(members.map(m => [m.userId, m])), [members])
  const configuredTypes = useMemo(() => new Set(alerts.map(a => a.alertType)), [alerts])
  const creatableTypes = useMemo(() => ACTIVE_ALERT_TYPES.filter(t => !configuredTypes.has(t)), [configuredTypes])

  if (loading) return Spinner()

  return React.createElement(Fragment, null,
    React.createElement('div', { style: S.grid2 },
      React.createElement('div', { style: { ...S.card, padding: 24 } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 16 } }, 'Réapprovisionnement'),
        React.createElement('div', null,
          React.createElement('label', { style: S.label }, 'Délai fournisseur par défaut (jours)'),
          React.createElement('input', { style: S.input, type: 'number', min: 0, step: 0.5, defaultValue: settings?.defaultLeadTimeDays,
            onBlur: e => update({ defaultLeadTimeDays: +e.target.value }) }),
        ),
        React.createElement('div', { style: { marginTop: 12 } },
          React.createElement('label', { style: S.label }, 'Niveau de service par défaut (0-1)'),
          React.createElement('input', { style: S.input, type: 'number', min: 0, max: 1, step: 0.01, defaultValue: settings?.defaultServiceLevel,
            onBlur: e => update({ defaultServiceLevel: +e.target.value }) }),
        ),
        React.createElement('div', { style: { marginTop: 12 } },
          React.createElement('label', { style: S.label }, 'Alerte péremption (jours avant)'),
          React.createElement('input', { style: S.input, type: 'number', min: 0, defaultValue: settings?.expiryWarningDays,
            onBlur: e => update({ expiryWarningDays: +e.target.value }) }),
        ),
      ),
      React.createElement('div', { style: { ...S.card, padding: 24 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
          React.createElement('div', { style: { fontWeight: 600 } }, 'Ciblage des alertes'),
          React.createElement('button', {
            style: { ...S.btnSecondary, padding: '6px 12px', fontSize: 11, opacity: creatableTypes.length === 0 ? 0.5 : 1 },
            disabled: creatableTypes.length === 0,
            title: creatableTypes.length === 0 ? "Tous les types d'alerte ont déjà un ciblage personnalisé" : undefined,
            onClick: () => { setTargetingEdit(null); setTargetingOpen(true) },
          }, React.createElement(Icon.plus, { size: 13 }), ' Nouveau ciblage'),
        ),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 16 } },
          "Chaque type d'alerte suit le comportement par défaut sauf ciblage personnalisé ci-dessous ; le réinitialiser restaure le défaut."),
        alerts.length === 0
          ? React.createElement(EmptyState, {
              icon: Icon.users, title: 'Aucun ciblage personnalisé',
              hint: "Les alertes suivent le comportement par défaut (permission requise) tant qu'aucun ciblage n'est défini.",
            })
          : alerts.map(a =>
              React.createElement('div', { key: a.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8, border: '1px solid var(--color-border)', marginBottom: 8, gap: 10 } },
                React.createElement('div', { style: { minWidth: 0 } },
                  React.createElement('div', { style: { fontSize: 13 } }, ALERT_LABELS[a.alertType] ?? a.alertType),
                  React.createElement('div', { style: { fontSize: 11, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    a.roleId ? `Rôle : ${a.roleId}`
                      : a.permission ? `Permission : ${a.permission}`
                      : (a.userIds?.length ? a.userIds.map(id => memberByUserId.get(id)?.email ?? id).join(', ') : 'Aucun utilisateur')),
                ),
                React.createElement('div', { style: { display: 'flex', gap: 2, flexShrink: 0 } },
                  React.createElement('button', { style: S.btnIcon, title: 'Modifier', 'aria-label': `Modifier le ciblage ${ALERT_LABELS[a.alertType] ?? a.alertType}`,
                    onClick: () => { setTargetingEdit(a); setTargetingOpen(true) } },
                    React.createElement(Icon.edit, { size: 13 })),
                  React.createElement('button', { style: S.btnIcon, title: 'Réinitialiser', 'aria-label': `Réinitialiser l'alerte ${ALERT_LABELS[a.alertType] ?? a.alertType}`, onClick: () => resetAlert(a.alertType) },
                    React.createElement(Icon.trash, { size: 13 })),
                ),
              ),
            ),
      ),
    ),
    targetingOpen && React.createElement(AlertTargetingModal, {
      members, alertLabels: ALERT_LABELS,
      availableTypes: targetingEdit ? [targetingEdit.alertType] : creatableTypes,
      editing: targetingEdit, saving: savingTargeting,
      onSave: saveTargeting,
      onClose: () => { setTargetingOpen(false); setTargetingEdit(null) },
    }),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   DASHBOARD WIDGETS (KPI cards)
   ════════════════════════════════════════════════════════════════════════ */

function DashboardWidget({ api }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const [products, levels, warehouses] = await Promise.all([
          api.products.list(), api.movements.levels(), api.warehouses.list(),
        ])
        setData({
          products: Array.isArray(products) ? products : [],
          levels: Array.isArray(levels) ? levels : [],
          warehouses: Array.isArray(warehouses) ? warehouses : [],
        })
      } catch (e) {}
    })()
  }, [])

  if (!data) return Spinner()

  const totalStock = data.levels.reduce((s, l) => s + (l.availableQuantity ?? 0), 0)
  const lowStock = data.products.filter(p => p.minThreshold != null && p.minThreshold > 0).length
  const activeWarehouses = data.warehouses.filter(w => w.isActive).length

  return React.createElement('div', { style: S.grid4 },
    React.createElement('div', { style: S.kpi },
      React.createElement('div', { style: S.kpiLabel }, 'Produits'),
      React.createElement('div', { style: S.kpiValue }, data.products.length.toLocaleString('fr-FR')),
    ),
    React.createElement('div', { style: S.kpi },
      React.createElement('div', { style: S.kpiLabel }, 'Stock total'),
      React.createElement('div', { style: S.kpiValue }, totalStock.toLocaleString('fr-FR')),
    ),
    React.createElement('div', { style: S.kpi },
      React.createElement('div', { style: S.kpiLabel }, 'Alertes seuil bas'),
      React.createElement('div', { style: { ...S.kpiValue, color: 'var(--color-warning)' } }, lowStock.toLocaleString('fr-FR')),
    ),
    React.createElement('div', { style: S.kpi },
      React.createElement('div', { style: S.kpiLabel }, 'Entrepôts'),
      React.createElement('div', { style: S.kpiValue }, activeWarehouses.toLocaleString('fr-FR')),
    ),
  )
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════════════════ */

// Groupé par intention plutôt que par "zone du produit" : gestion du flux de
// stock (Produits→Transferts), analyse (Intelligence), fichiers (Pièces
// jointes). Paramètres n'est pas une vue de données — rendu à part, en bout
// de barre, avec une icône dédiée (cf. StockPage).
const NAV_GROUPS = [
  { label: 'Flux', items: [
    { id: 'products',   label: 'Produits',    icon: Icon.package },
    { id: 'warehouses', label: 'Entrepôts',   icon: Icon.warehouse },
    { id: 'movements',  label: 'Mouvements',  icon: Icon.arrows },
    { id: 'transfers',  label: 'Transferts',  icon: Icon.arrows },
    { id: 'inventory',  label: 'Inventaires', icon: Icon.clipboard },
  ] },
  { label: 'Analyse', items: [
    { id: 'intelligence', label: 'Intelligence', icon: Icon.trending },
  ] },
  { label: 'Fichiers', items: [
    { id: 'attachments', label: 'Pièces jointes', icon: Icon.paperclip },
  ] },
]

const SETTINGS_ITEM = { id: 'settings', label: 'Paramètres', icon: Icon.settings }

const ALL_NAV_ITEMS = [...NAV_GROUPS.flatMap(g => g.items), SETTINGS_ITEM]

// Items toujours visibles en mode compact ; le reste bascule dans "Plus ▾".
const NAV_PRIMARY_IDS = ['products', 'warehouses', 'movements']

const NAV_SUBTITLES = {
  products: 'Catalogue des articles en stock',
  warehouses: 'Lieux de stockage et emplacements',
  movements: 'Entrées, sorties, transferts et ajustements',
  inventory: 'Comptages physiques et variances',
  transfers: 'Documents de transfert planifiés',
  intelligence: 'Réapprovisionnement, prévision, suggestions de transfert',
  attachments: 'Fichiers liés aux produits, lots, entrepôts…',
  settings: 'Configuration générale et alertes',
}

function StockPage({ app, api, tab: initialTab }) {
  const [tab, setTab] = useState(initialTab ?? 'products')
  const compact = useMediaQuery(880)

  const current = ALL_NAV_ITEMS.find(t => t.id === tab)
  const overflowItems = ALL_NAV_ITEMS.filter(t => t.id !== 'settings' && !NAV_PRIMARY_IDS.includes(t.id))
  const overflowActive = overflowItems.some(t => t.id === tab)

  return React.createElement('div', { className: 'xstock-plugin', style: { padding: 24, display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' } },
    React.createElement('style', null, `
      .xstock-plugin button:focus-visible, .xstock-plugin input:focus-visible, .xstock-plugin select:focus-visible, .xstock-plugin textarea:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
      .xstock-plugin .xstock-breadcrumb-home:hover { text-decoration: underline; color: var(--color-text-primary); }
      .xstock-plugin .xstock-kpi-clickable:hover { box-shadow: 0 6px 20px rgba(0,0,0,.12); transform: translateY(-2px); }
      .xstock-plugin .xstock-sort-chevron { opacity: 0; transition: opacity .12s; }
      .xstock-plugin .xstock-sortable-th:hover .xstock-sort-chevron { opacity: .55; }
      .xstock-plugin .xstock-hoverable tbody tr:hover td { background: var(--color-surface-subtle); }
      .xstock-plugin .xstock-warehouse-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,.12); transform: translateY(-2px); }
      .xstock-plugin .xstock-warehouse-card-cta { opacity: 0; transition: opacity .12s; }
      .xstock-plugin .xstock-warehouse-card:hover .xstock-warehouse-card-cta { opacity: 1; }
      /* Les tableaux gardent le coin arrondi visuel du card wrapper sans que
         celui-ci ait overflow:hidden — sinon les menus "⋯" des dernières
         lignes sont rognés (voir DropdownMenu). */
      .xstock-plugin .xstock-table-card table thead tr:first-child th:first-child { border-top-left-radius: 18px; }
      .xstock-plugin .xstock-table-card table thead tr:first-child th:last-child { border-top-right-radius: 18px; }
      .xstock-plugin .xstock-table-card table tbody tr:last-child td:first-child { border-bottom-left-radius: 18px; }
      .xstock-plugin .xstock-table-card table tbody tr:last-child td:last-child { border-bottom-right-radius: 18px; }
    `),
    React.createElement('nav', {
      'aria-label': "Fil d'ariane",
      style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 },
    },
      React.createElement('button', {
        className: 'xstock-breadcrumb-home',
        style: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 13, fontWeight: 600 },
        onClick: () => setTab('products'),
      }, 'Stock'),
      React.createElement(Icon.chevronRight, { size: 13, style: { color: 'var(--color-text-tertiary)', opacity: 0.6, flexShrink: 0 } }),
      React.createElement('span', { style: { color: 'var(--color-primary)', fontWeight: 800 } }, current.label),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      React.createElement('span', { style: S.iconBox }, React.createElement(Icon.package, { size: 18 })),
      React.createElement('div', null,
        React.createElement('div', { style: S.title }, current.label),
        React.createElement('div', { style: S.subtitle }, NAV_SUBTITLES[tab]),
      ),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid var(--color-border)', paddingBottom: 14 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
        !compact
          ? NAV_GROUPS.map((group, i) =>
              React.createElement(Fragment, { key: group.label },
                i > 0 && React.createElement('span', { style: { width: 1, height: 16, background: 'var(--color-border)', margin: '0 8px' } }),
                group.items.map(t =>
                  React.createElement('button', {
                    key: t.id, style: S.navTab(tab === t.id), onClick: () => setTab(t.id),
                  }, React.createElement(t.icon, { size: 14 }), t.label),
                ),
              ),
            )
          : [
              ...ALL_NAV_ITEMS.filter(t => NAV_PRIMARY_IDS.includes(t.id)).map(t =>
                React.createElement('button', {
                  key: t.id, style: S.navTab(tab === t.id), onClick: () => setTab(t.id),
                }, React.createElement(t.icon, { size: 14 }), t.label),
              ),
              React.createElement(DropdownMenu, {
                key: 'overflow',
                trigger: React.createElement('button', { style: S.navTab(overflowActive) },
                  'Plus', React.createElement(Icon.chevronDown, { size: 12 })),
                items: overflowItems.map(t => ({ label: t.label, icon: t.icon, onClick: () => setTab(t.id) })),
              }),
            ],
      ),
      React.createElement('button', {
        style: { ...S.btnIcon, color: tab === 'settings' ? 'var(--color-primary)' : 'var(--color-text-tertiary)' },
        'aria-label': 'Paramètres', title: 'Paramètres', onClick: () => setTab('settings'),
      }, React.createElement(Icon.settings, { size: 16 })),
    ),
    tab === 'products' && React.createElement(ProductsTab, { app, api, onNavigate: setTab }),
    tab === 'warehouses' && React.createElement(WarehousesTab, { app, api, onNavigate: setTab }),
    tab === 'movements' && React.createElement(MovementsTab, { app, api }),
    tab === 'inventory' && React.createElement(InventoryTab, { app, api }),
    tab === 'transfers' && React.createElement(TransfersTab, { app, api }),
    tab === 'intelligence' && React.createElement(IntelligenceTab, { app, api }),
    tab === 'attachments' && React.createElement(AttachmentsTab, { app, api }),
    tab === 'settings' && React.createElement(SettingsTab, { app, api }),
  )
}

/* ─── Translations ────────────────────────────────────────────────────── */

const fr = {
  'stock.name': 'Stock',
  'stock.products.title': 'Produits',
  'stock.products.new': 'Nouveau produit',
  'stock.warehouses.title': 'Entrepôts',
  'stock.warehouses.new': 'Nouvel entrepôt',
  'stock.movements.title': 'Mouvements',
  'stock.inventory.title': 'Inventaires',
  'stock.settings.title': 'Paramètres',
}

const en = {
  'stock.name': 'Stock',
  'stock.products.title': 'Products',
  'stock.products.new': 'New product',
  'stock.warehouses.title': 'Warehouses',
  'stock.movements.title': 'Stock movements',
  'stock.inventory.title': 'Inventory',
  'stock.settings.title': 'Settings',
}

/* ─── Plugin entry ────────────────────────────────────────────────────── */

export { fr, en }

export default definePlugin((app) => {
  let currentTab = 'products'
  app.addTranslations({ fr, en })
  const a = api(app)
  app.registerRoutes([
    { path: '/stock', component: () => React.createElement(StockPage, { app, api: a, tab: currentTab }),
      meta: { title: app.t('stock.name'), permission: 'stock:products:read' } },
  ])
  app.registerSidebar([
    { label: app.t('stock.name'), path: '/stock', icon: 'package', section: 'Opérations', order: 10, permission: 'stock:products:read' },
  ])
  app.registerDashboardWidget({
    id: 'stock.overview', title: 'Aperçu Stock', component: () => React.createElement(DashboardWidget, { api: a }), defaultSize: 'md',
  })
  app.registerCommand({
    id: 'stock.open', label: app.t('stock.name'), icon: 'package', run: () => app.navigate('/stock'),
  })
  app.log.info('Plugin Stock v0.2.0 chargé')
  return {
    onload() {},
    onunload() { app.log.info('Plugin Stock déchargé') },
  }
})
