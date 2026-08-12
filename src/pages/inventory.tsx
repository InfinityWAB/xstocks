import { useMemo, useState } from 'react'
import { ClipboardList, Plus } from 'lucide-react'
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StatusBadge } from '../components/StatusBadge'
import type { InventoryCount, InventoryType, Warehouse } from '../types'

const INV_API = '/api/xstock/inventory'
const WH_API = '/api/xstock/warehouses'

function useWarehouses() {
  return useQuery<Warehouse[]>({
    queryKey: ['stock:warehouses'],
    queryFn: () => fetch(`${WH_API}/`).then(r => r.json()),
  })
}

// Le backend n'expose pas de "lister tous les comptages" (seulement
// /by-warehouse/{id}) — on agrège côté client par entrepôt actif.
function useCounts(warehouses: Warehouse[] | undefined) {
  const results = useQueries({
    queries: (warehouses ?? []).map(w => ({
      queryKey: ['stock:inventory', w.id],
      queryFn: () => fetch(`${INV_API}/by-warehouse/${w.id}`).then(r => r.json()) as Promise<InventoryCount[]>,
      enabled: !!warehouses,
    })),
  })
  const isLoading = (warehouses === undefined) || results.some(r => r.isLoading)
  const counts = useMemo(() => results.flatMap(r => r.data ?? []), [results])
  return { counts, isLoading }
}

export function InventoryPage() {
  const { data: warehouses, isLoading: loadingWarehouses } = useWarehouses()
  const { counts, isLoading: loadingCounts } = useCounts(warehouses)
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)

  const warehouseName = useMemo(() => {
    const map = new Map((warehouses ?? []).map(w => [w.id, w.name]))
    return (id: string) => map.get(id) ?? id
  }, [warehouses])

  const startCount = useMutation({
    mutationFn: (data: { warehouseId: string; type: InventoryType; countDate: string }) =>
      fetch(`${INV_API}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock:inventory'] }); setFormOpen(false) },
  })

  const sorted = useMemo(() =>
    counts.slice().sort((a, b) => new Date(b.countDate).getTime() - new Date(a.countDate).getTime()),
    [counts],
  )

  if (loadingWarehouses || loadingCounts) {
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
            <ClipboardList size={20} />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">Inventaires</h1>
            <p className="text-xs text-tertiary">Comptages physiques et variances</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          <Plus size={15} /> Nouvel inventaire
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Entrepôt</th>
              <th>Type</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={4} className="py-16 text-center text-tertiary">Aucun inventaire trouvé</td></tr>
            ) : (
              sorted.map(c => (
                <tr key={c.id}>
                  <td className="text-xs text-tertiary whitespace-nowrap">{new Date(c.countDate).toLocaleDateString('fr-FR')}</td>
                  <td>{warehouseName(c.warehouseId)}</td>
                  <td><span className="badge badge-info">{c.type === 'full' ? 'Général' : 'Cyclique'}</span></td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4" style={{ background: 'var(--color-scrim)' }}
             onClick={e => { if (e.target === e.currentTarget) setFormOpen(false) }}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="font-display font-semibold text-foreground">Nouvel inventaire</h2>
              <button onClick={() => setFormOpen(false)} className="btn btn-ghost btn-icon btn-sm"><span className="text-lg leading-none">×</span></button>
            </div>
            <form onSubmit={e => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              startCount.mutate({
                warehouseId: fd.get('warehouseId') as string,
                type: fd.get('type') as InventoryType,
                countDate: fd.get('countDate') as string,
              })
            }} className="px-6 py-4">
              <label className="label">Entrepôt *</label>
              <select name="warehouseId" className="input mb-4" required>
                <option value="">Sélectionner…</option>
                {warehouses?.filter(w => w.isActive).map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <label className="label">Date du comptage *</label>
              <input type="date" name="countDate" className="input mb-4" required defaultValue={new Date().toISOString().slice(0, 10)} />
              <label className="label">Type</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="type" value="full" defaultChecked className="text-primary" />
                  <span className="text-sm">Général</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="type" value="cycle" className="text-primary" />
                  <span className="text-sm">Cyclique</span>
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
                <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={startCount.isPending}>
                  {startCount.isPending ? 'Création…' : 'Démarrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
