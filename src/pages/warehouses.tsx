import { useMemo, useState } from 'react'
import { Plus, Warehouse, MapPin } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StatusBadge } from '../components/StatusBadge'
import type { Warehouse as WarehouseType, StockLocation } from '../types'

const API = '/api/xstock/warehouses'

function useWarehouses() {
  return useQuery<WarehouseType[]>({
    queryKey: ['stock:warehouses'],
    queryFn: () => fetch(`${API}/`).then(r => r.json()),
  })
}

function useLocations(warehouseId: string | null) {
  return useQuery<StockLocation[]>({
    queryKey: ['stock:locations', warehouseId],
    queryFn: () => fetch(`${API}/${warehouseId}/locations`).then(r => r.json()),
    enabled: !!warehouseId,
  })
}

function useUpsertWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<WarehouseType> & { id?: string }) => {
      if (data.id) {
        const { id, ...patch } = data
        return fetch(`${API}/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(r => r.json())
      }
      return fetch(`${API}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.json())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock:warehouses'] }),
  })
}

export function WarehousesPage() {
  const { data: warehouses, isLoading } = useWarehouses()
  const upsert = useUpsertWarehouse()
  const [formOpen, setFormOpen] = useState(false)
  const [editWh, setEditWh] = useState<WarehouseType | null>(null)
  const [selectedWh, setSelectedWh] = useState<string | null>(null)
  const { data: locations } = useLocations(selectedWh)

  const sorted = useMemo(() => (warehouses ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)), [warehouses])

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
            <Warehouse size={20} />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">Entrepôts</h1>
            <p className="text-xs text-tertiary">Lieux de stockage et emplacements</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditWh(null); setFormOpen(true) }}>
          <Plus size={15} /> Nouvel entrepôt
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {sorted.map(wh => (
          <button
            key={wh.id}
            onClick={() => setSelectedWh(selectedWh === wh.id ? null : wh.id)}
            className={`rounded-xl border p-5 text-left transition-all ${
              selectedWh === wh.id
                ? 'border-primary bg-primary-muted/30 shadow-sm'
                : 'border-border bg-card hover:shadow-sm'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-muted text-primary-text">
                  <Warehouse size={18} />
                </span>
                <div>
                  <p className="font-medium text-foreground">{wh.name}</p>
                  <p className="text-xs text-tertiary">{wh.code}{wh.siteId ? ` · ${wh.siteId}` : ''}</p>
                </div>
              </div>
              <StatusBadge status={wh.isActive} label={wh.isActive ? 'Actif' : 'Inactif'} />
            </div>
          </button>
        ))}
      </div>

      {selectedWh && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Emplacements</h3>
            <span className="text-xs text-tertiary">{locations?.length ?? 0} emplacement(s)</span>
          </div>
          {locations?.length === 0 ? (
            <p className="py-8 text-center text-sm text-tertiary">Aucun emplacement défini</p>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {locations?.map(loc => (
                <div key={loc.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3">
                  <MapPin size={14} className="text-tertiary shrink-0" />
                  <span className="text-sm text-foreground">{loc.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {formOpen && (
        <WarehouseFormModal
          warehouse={editWh}
          onSave={async data => { await upsert.mutateAsync(data); setFormOpen(false); setEditWh(null) }}
          onClose={() => { setFormOpen(false); setEditWh(null) }}
          saving={upsert.isPending}
        />
      )}
    </div>
  )
}

type WarehouseFormModalProps = {
  warehouse: WarehouseType | null
  onSave: (data: Partial<WarehouseType>) => Promise<void>
  onClose: () => void
  saving: boolean
}

function WarehouseFormModal({ warehouse, onSave, onClose, saving }: WarehouseFormModalProps) {
  const isEdit = !!warehouse
  const [code, setCode] = useState(warehouse?.code ?? '')
  const [name, setName] = useState(warehouse?.name ?? '')
  const [siteId, setSiteId] = useState(warehouse?.siteId ?? '')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Partial<WarehouseType> = { name, siteId: siteId || undefined }
    if (isEdit) payload.id = warehouse!.id
    else payload.code = code
    await onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4" style={{ background: 'var(--color-scrim)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-popover shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-display font-semibold text-foreground">{isEdit ? 'Modifier' : 'Nouvel entrepôt'}</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm"><span className="text-lg leading-none">×</span></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4">
          {!isEdit && (
            <>
              <label className="label">Code *</label>
              <input className="input mb-4" required value={code} onChange={e => setCode(e.target.value)} />
            </>
          )}
          <label className="label">Nom *</label>
          <input className="input mb-4" required value={name} onChange={e => setName(e.target.value)} />
          <label className="label">Site / Agence</label>
          <input className="input" value={siteId} onChange={e => setSiteId(e.target.value)} />
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
