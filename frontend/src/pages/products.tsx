import { useCallback, useMemo, useState } from 'react'
import { Plus, Search, Package, Pencil, Ban, AlertTriangle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StatusBadge } from '../components/StatusBadge'
import type { Product, ValuationMethod } from '../types'

const API = '/api/xstock/products'

export function mergeProductIntoList(products: Product[], product: Product): Product[] {
  const next = products.filter(item => item.id !== product.id)
  return [product, ...next]
}

function useProducts() {
  return useQuery<Product[]>({
    queryKey: ['stock:products'],
    queryFn: () => fetch(`${API}/`).then(r => r.json()),
  })
}

function useDeactivateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetch(`${API}/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock:products'] }),
  })
}

function useUpsertProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Product> & { id?: string }) => {
      if (data.id) {
        const { id, ...patch } = data
        return fetch(`${API}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(r => r.json())
      }
      return fetch(`${API}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.json())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock:products'] }),
  })
}

export function ProductsPage() {
  const { data: products, isLoading } = useProducts()
  const queryClient = useQueryClient()
  const deactivateProduct = useDeactivateProduct()
  const upsertProduct = useUpsertProduct()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [deactivateConfirm, setDeactivateConfirm] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!products) return []
    if (!search) return products
    const q = search.toLowerCase()
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      p.categoryId?.toLowerCase().includes(q)
    )
  }, [products, search])

  const openCreate = useCallback(() => {
    setEditProduct(null)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((p: Product) => {
    setEditProduct(p)
    setFormOpen(true)
  }, [])

  const handleSave = useCallback(async (data: Partial<Product>) => {
    const createdOrUpdated = await upsertProduct.mutateAsync(data)
    if (createdOrUpdated?.id) {
      const nextProduct = createdOrUpdated as Product
      const nextProducts = mergeProductIntoList(products ?? [], nextProduct)
      queryClient.setQueryData<Product[]>(['stock:products'], nextProducts)
    }
    setFormOpen(false)
    setEditProduct(null)
  }, [products, upsertProduct, queryClient])

  const handleDeactivate = useCallback(async (id: string) => {
    await deactivateProduct.mutateAsync(id)
    setDeactivateConfirm(null)
  }, [deactivateProduct])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <Header search={search} onSearchChange={setSearch} onCreate={openCreate} />

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th>Produit</th>
              <th>Code</th>
              <th>Catégorie</th>
              <th>Prix vente</th>
              <th>Prix achat</th>
              <th>Seuils</th>
              <th>Statut</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-16 text-center text-tertiary">Aucun produit trouvé</td>
              </tr>
            ) : (
              filtered.map((p, i) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  index={i + 1}
                  onEdit={() => openEdit(p)}
                  onDeactivate={() => setDeactivateConfirm(p.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <ProductFormModal
          product={editProduct}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditProduct(null) }}
          saving={upsertProduct.isPending}
        />
      )}

      {deactivateConfirm && (
        <DeactivateConfirmModal
          onConfirm={() => handleDeactivate(deactivateConfirm)}
          onCancel={() => setDeactivateConfirm(null)}
          loading={deactivateProduct.isPending}
        />
      )}
    </div>
  )
}

type HeaderProps = {
  search: string
  onSearchChange: (v: string) => void
  onCreate: () => void
}

function Header({ search, onSearchChange, onCreate }: HeaderProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-module-stock/12 text-module-stock">
          <Package size={20} />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Produits</h1>
          <p className="text-xs text-tertiary">Catalogue des articles en stock</p>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
          <input
            className="input pl-9 w-64"
            placeholder="Rechercher par nom, code…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={onCreate}>
          <Plus size={15} /> Nouveau produit
        </button>
      </div>
    </div>
  )
}

type ProductRowProps = {
  product: Product
  index: number
  onEdit: () => void
  onDeactivate: () => void
}

function ProductRow({ product: p, index, onEdit, onDeactivate }: ProductRowProps) {
  return (
    <tr className="group cursor-pointer" onClick={onEdit}>
      <td className="text-tertiary">{index}</td>
      <td>
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-muted text-primary-text">
            <Package size={15} />
          </span>
          <p className="font-medium text-foreground">{p.name}</p>
        </div>
      </td>
      <td className="font-mono text-xs text-tertiary">{p.code}</td>
      <td>{p.categoryId ?? '—'}</td>
      <td className="font-mono tabular">{p.salePrice?.toLocaleString('fr-FR') ?? '—'}</td>
      <td className="font-mono tabular">{p.purchasePrice?.toLocaleString('fr-FR') ?? '—'}</td>
      <td>
        {p.minThreshold != null || p.maxThreshold != null ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-tertiary">{p.minThreshold ?? '—'} / {p.maxThreshold ?? '—'}</span>
            {p.minThreshold != null && p.minThreshold > 0 && (
              <AlertTriangle size={13} className="text-warning" />
            )}
          </div>
        ) : '—'}
      </td>
      <td><StatusBadge status={p.isActive} label={p.isActive ? 'Actif' : 'Inactif'} /></td>
      <td>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onEdit} title="Modifier">
            <Pencil size={13} />
          </button>
          {p.isActive && (
            <button className="btn btn-ghost btn-icon btn-sm text-danger" onClick={onDeactivate} title="Désactiver">
              <Ban size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

type ProductFormModalProps = {
  product: Product | null
  onSave: (data: Partial<Product>) => Promise<void>
  onClose: () => void
  saving: boolean
}

function ProductFormModal({ product, onSave, onClose, saving }: ProductFormModalProps) {
  const isEdit = !!product
  const [form, setForm] = useState({
    code: product?.code ?? '',
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? '',
    unit: product?.unit ?? 'unite',
    salePrice: product?.salePrice ?? 0,
    purchasePrice: product?.purchasePrice ?? 0,
    valuationMethod: (product?.valuationMethod ?? 'fefo') as ValuationMethod,
    minThreshold: product?.minThreshold ?? 0,
    maxThreshold: product?.maxThreshold ?? 0,
    isActive: product?.isActive ?? true,
    isLotTracked: product?.isLotTracked ?? false,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Partial<Product> = { ...form }
    if (isEdit) payload.id = product!.id
    await onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4" style={{ background: 'var(--color-scrim)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-popover shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display font-semibold text-foreground">{isEdit ? 'Modifier le produit' : 'Nouveau produit'}</h2>
            <p className="mt-0.5 text-sm text-tertiary">{isEdit ? product!.name : 'Ajouter un article au catalogue'}</p>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm rounded-lg">
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[60vh] overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Nom du produit *</label>
              <input className="input" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Code *</label>
              <input className="input" required disabled={isEdit} value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} />
            </div>
            <div>
              <label className="label">Catégorie</label>
              <input className="input" value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))} />
            </div>
            <div>
              <label className="label">Unité</label>
              <input className="input" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} />
            </div>
            <div>
              <label className="label">Méthode de valorisation</label>
              <select className="input" value={form.valuationMethod}
                      onChange={e => setForm(p => ({ ...p, valuationMethod: e.target.value as ValuationMethod }))}>
                <option value="fefo">FEFO (péremption)</option>
                <option value="fifo">FIFO</option>
                <option value="lifo">LIFO</option>
                <option value="cmup">CMUP (coût moyen)</option>
              </select>
            </div>
            <div>
              <label className="label">Prix de vente</label>
              <input className="input" type="number" min="0" step="0.01" value={form.salePrice}
                     onChange={e => setForm(p => ({ ...p, salePrice: +e.target.value }))} />
            </div>
            <div>
              <label className="label">Prix d'achat</label>
              <input className="input" type="number" min="0" step="0.01" value={form.purchasePrice}
                     onChange={e => setForm(p => ({ ...p, purchasePrice: +e.target.value }))} />
            </div>
            <div>
              <label className="label">Seuil min</label>
              <input className="input" type="number" min="0" value={form.minThreshold}
                     onChange={e => setForm(p => ({ ...p, minThreshold: +e.target.value }))} />
            </div>
            <div>
              <label className="label">Seuil max</label>
              <input className="input" type="number" min="0" value={form.maxThreshold}
                     onChange={e => setForm(p => ({ ...p, maxThreshold: +e.target.value }))} />
            </div>
            <div className="col-span-2 flex items-center gap-6">
              {isEdit && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="rounded border-border" checked={form.isActive}
                         onChange={e => setForm(p => ({ ...p, isActive: e.target.checked }))} />
                  <span className="text-sm">Actif</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded border-border" checked={form.isLotTracked}
                       onChange={e => setForm(p => ({ ...p, isLotTracked: e.target.checked }))} />
                <span className="text-sm">Suivi de lot</span>
              </label>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer le produit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeactivateConfirmModal({ onConfirm, onCancel, loading }: { onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4" style={{ background: 'var(--color-scrim)' }}
         onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-popover p-6 shadow-xl">
        <h3 className="font-semibold text-foreground">Confirmer la désactivation</h3>
        <p className="mt-2 text-sm text-tertiary">Le produit ne sera plus disponible pour de nouveaux mouvements. Il reste consultable dans l'historique.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onCancel}>Annuler</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Désactivation…' : 'Désactiver'}
          </button>
        </div>
      </div>
    </div>
  )
}
