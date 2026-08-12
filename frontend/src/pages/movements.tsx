import { useMemo, useState } from 'react'
import { ArrowLeftRight, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Product, StockMove, StockMoveType, Warehouse } from '../types'

const API = '/api/xstock/movements'
const PRODUCTS_API = '/api/xstock/products'
const WAREHOUSES_API = '/api/xstock/warehouses'

function useMovements() {
  return useQuery<StockMove[]>({
    queryKey: ['stock:movements'],
    queryFn: () => fetch(`${API}/`).then(r => r.json()),
  })
}

function useProducts() {
  return useQuery<Product[]>({
    queryKey: ['stock:products'],
    queryFn: () => fetch(`${PRODUCTS_API}/`).then(r => r.json()),
  })
}

function useWarehouses() {
  return useQuery<Warehouse[]>({
    queryKey: ['stock:warehouses'],
    queryFn: () => fetch(`${WAREHOUSES_API}/`).then(r => r.json()),
  })
}

export function MovementsPage() {
  const { data: moves, isLoading } = useMovements()
  const { data: products } = useProducts()
  const { data: warehouses } = useWarehouses()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | StockMoveType>('ALL')

  const productName = useMemo(() => {
    const map = new Map((products ?? []).map(p => [p.id, p.name]))
    return (id: string) => map.get(id) ?? id
  }, [products])

  const warehouseName = useMemo(() => {
    const map = new Map((warehouses ?? []).map(w => [w.id, w.name]))
    return (id: string) => map.get(id) ?? id
  }, [warehouses])

  const filtered = useMemo(() => {
    if (!moves) return []
    let list = moves
    if (typeFilter !== 'ALL') list = list.filter(m => m.type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        productName(m.productId).toLowerCase().includes(q) ||
        m.reason?.toLowerCase().includes(q) ||
        m.sourceReference?.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => new Date(b.moveDate).getTime() - new Date(a.moveDate).getTime())
  }, [moves, search, typeFilter, productName])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-module-stock/12 text-module-stock">
            <ArrowLeftRight size={20} />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">Mouvements de stock</h1>
            <p className="text-xs text-tertiary">Entrées, sorties, transferts et ajustements</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
          <input className="input pl-9" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1">
          {[
            { value: 'ALL', label: 'Tous' },
            { value: 'in', label: 'Entrées' },
            { value: 'out', label: 'Sorties' },
            { value: 'transfer', label: 'Transferts' },
            { value: 'adjustment', label: 'Ajustements' },
          ].map(t => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value as 'ALL' | StockMoveType)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                typeFilter === t.value ? 'bg-card text-foreground shadow-sm' : 'text-tertiary hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Produit</th>
              <th>Quantité</th>
              <th>Entrepôt</th>
              <th>Référence</th>
              <th>Auteur</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-tertiary">Aucun mouvement trouvé</td>
              </tr>
            ) : (
              filtered.map(m => (
                <tr key={m.id}>
                  <td className="text-xs text-tertiary whitespace-nowrap">{new Date(m.moveDate).toLocaleDateString('fr-FR')}</td>
                  <td><TypeBadge type={m.type} /></td>
                  <td className="font-medium text-foreground">{productName(m.productId)}</td>
                  <td className={`font-mono tabular font-semibold ${m.type === 'in' ? 'text-success' : m.type === 'out' ? 'text-danger' : ''}`}>
                    {m.type === 'in' ? '+' : m.type === 'out' ? '-' : ''}{m.quantity.toLocaleString('fr-FR')}
                  </td>
                  <td className="text-sm text-tertiary">{warehouseName(m.warehouseId)}</td>
                  <td className="font-mono text-xs text-tertiary">{m.reason ?? m.sourceReference ?? '—'}</td>
                  <td className="text-sm text-tertiary">{m.createdBy}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TypeBadge({ type }: { type: StockMoveType }) {
  const cfg: Record<StockMoveType, { label: string; className: string }> = {
    in:         { label: 'Entrée',      className: 'badge-success' },
    out:        { label: 'Sortie',      className: 'badge-danger' },
    transfer:   { label: 'Transfert',   className: 'badge-info' },
    adjustment: { label: 'Ajustement',  className: 'badge-warning' },
  }
  const c = cfg[type] ?? { label: type, className: 'badge-neutral' }
  return <span className={`badge ${c.className}`}>{c.label}</span>
}
