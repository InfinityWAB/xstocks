import { useMemo, useState } from 'react'
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StatusBadge } from '../components/StatusBadge'
import type { Product, StockTransfer, Warehouse } from '../types'

const API = '/api/xstock/transfers'
const WH_API = '/api/xstock/warehouses'
const PRODUCTS_API = '/api/xstock/products'

function useTransfers() {
  return useQuery<StockTransfer[]>({
    queryKey: ['stock:transfers'],
    queryFn: () => fetch(`${API}/`).then(r => r.json()),
  })
}

function useWarehouses() {
  return useQuery<Warehouse[]>({
    queryKey: ['stock:warehouses'],
    queryFn: () => fetch(`${WH_API}/`).then(r => r.json()),
  })
}

function useProducts() {
  return useQuery<Product[]>({
    queryKey: ['stock:products'],
    queryFn: () => fetch(`${PRODUCTS_API}/`).then(r => r.json()),
  })
}

function useTransferAction(action: 'ready' | 'execute' | 'cancel') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetch(`${API}/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: action === 'execute' ? '{}' : undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock:transfers'] }),
  })
}

type LineForm = { productId: string; requestedQuantity: number }

export function TransfersPage() {
  const { data: transfers, isLoading } = useTransfers()
  const { data: warehouses } = useWarehouses()
  const { data: products } = useProducts()
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const readyAction = useTransferAction('ready')
  const executeAction = useTransferAction('execute')
  const cancelAction = useTransferAction('cancel')

  const warehouseName = useMemo(() => {
    const map = new Map((warehouses ?? []).map(w => [w.id, w.name]))
    return (id?: string) => (id ? map.get(id) ?? id : '—')
  }, [warehouses])

  const createTransfer = useMutation({
    mutationFn: (data: { sourceWarehouseId: string; destinationWarehouseId: string; lines: LineForm[] }) =>
      fetch(`${API}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'transfer', ...data }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock:transfers'] }); setFormOpen(false) },
  })

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
            <h1 className="font-display text-xl font-semibold text-foreground">Transferts</h1>
            <p className="text-xs text-tertiary">Mouvements inter-entrepôts planifiés</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          <Plus size={15} /> Nouveau transfert
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <table className="table">
          <thead>
            <tr>
              <th>Référence</th>
              <th>Origine</th>
              <th>Destination</th>
              <th>Statut</th>
              <th>Créé par</th>
              <th className="w-40" />
            </tr>
          </thead>
          <tbody>
            {(transfers ?? []).length === 0 ? (
              <tr><td colSpan={6} className="py-16 text-center text-tertiary">Aucun transfert trouvé</td></tr>
            ) : (
              transfers!.map(t => (
                <tr key={t.id}>
                  <td className="font-mono text-xs font-semibold text-foreground">{t.sourceReference ?? t.id.slice(0, 8)}</td>
                  <td className="text-sm">{warehouseName(t.sourceWarehouseId)}</td>
                  <td className="text-sm">{warehouseName(t.destinationWarehouseId)}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td className="text-sm text-tertiary">{t.createdBy}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {t.status === 'draft' && (
                        <button className="btn btn-secondary btn-sm" disabled={readyAction.isPending} onClick={() => readyAction.mutate(t.id)}>Marquer prêt</button>
                      )}
                      {t.status === 'ready' && (
                        <button className="btn btn-primary btn-sm" disabled={executeAction.isPending} onClick={() => executeAction.mutate(t.id)}>Exécuter</button>
                      )}
                      {(t.status === 'draft' || t.status === 'ready') && (
                        <button className="btn btn-ghost btn-icon btn-sm text-danger" disabled={cancelAction.isPending} onClick={() => cancelAction.mutate(t.id)} title="Annuler">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <TransferFormModal
          warehouses={warehouses ?? []}
          products={products ?? []}
          onSave={data => createTransfer.mutate(data)}
          onClose={() => setFormOpen(false)}
          saving={createTransfer.isPending}
        />
      )}
    </div>
  )
}

type TransferFormModalProps = {
  warehouses: Warehouse[]
  products: Product[]
  onSave: (data: { sourceWarehouseId: string; destinationWarehouseId: string; lines: LineForm[] }) => void
  onClose: () => void
  saving: boolean
}

function TransferFormModal({ warehouses, products, onSave, onClose, saving }: TransferFormModalProps) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState('')
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('')
  const [lines, setLines] = useState<LineForm[]>([{ productId: '', requestedQuantity: 1 }])

  const updateLine = (i: number, patch: Partial<LineForm>) =>
    setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validLines = lines.filter(l => l.productId && l.requestedQuantity > 0)
    if (!validLines.length) return
    onSave({ sourceWarehouseId, destinationWarehouseId, lines: validLines })
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4" style={{ background: 'var(--color-scrim)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-popover shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-display font-semibold text-foreground">Nouveau transfert</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm"><span className="text-lg leading-none">×</span></button>
        </div>
        <form onSubmit={handleSubmit} className="max-h-[65vh] overflow-y-auto px-6 py-4">
          <label className="label">Entrepôt source *</label>
          <select className="input mb-4" required value={sourceWarehouseId} onChange={e => setSourceWarehouseId(e.target.value)}>
            <option value="">Sélectionner…</option>
            {warehouses.filter(w => w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="label">Entrepôt destination *</label>
          <select className="input mb-4" required value={destinationWarehouseId} onChange={e => setDestinationWarehouseId(e.target.value)}>
            <option value="">Sélectionner…</option>
            {warehouses.filter(w => w.isActive && w.id !== sourceWarehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>

          <label className="label">Produits à transférer *</label>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="input flex-1" required value={line.productId} onChange={e => updateLine(i, { productId: e.target.value })}>
                  <option value="">Produit…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className="input w-24" type="number" min="0" step="0.01" required
                       value={line.requestedQuantity}
                       onChange={e => updateLine(i, { requestedQuantity: +e.target.value })} />
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-danger"
                        disabled={lines.length === 1}
                        onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-secondary btn-sm mt-2"
                  onClick={() => setLines(ls => [...ls, { productId: '', requestedQuantity: 1 }])}>
            <Plus size={13} /> Ajouter une ligne
          </button>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Création…' : 'Créer le transfert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
