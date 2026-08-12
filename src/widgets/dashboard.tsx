import { AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Product, StockLevel, Warehouse } from '../types'

function useStats() {
  return useQuery({
    queryKey: ['stock:dashboard'],
    queryFn: () => Promise.all([
      fetch('/api/xstock/products/').then(r => r.json() as Promise<Product[]>),
      fetch('/api/xstock/movements/levels/').then(r => r.json() as Promise<StockLevel[]>),
      fetch('/api/xstock/warehouses/').then(r => r.json() as Promise<Warehouse[]>),
    ]).then(([products, levels, warehouses]) => ({ products, levels, warehouses })),
  })
}

export function StockDashboardWidgets() {
  const { data, isLoading } = useStats()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const totalProducts = data?.products?.length ?? 0
  const activeProducts = data?.products?.filter(p => p.isActive).length ?? 0
  const lowStock = data?.products?.filter(p => p.minThreshold != null && p.minThreshold > 0).length ?? 0
  const totalStock = (data?.levels ?? []).reduce((s, l) => s + (l.availableQuantity ?? 0), 0)
  const activeWarehouses = data?.warehouses?.filter(w => w.isActive).length ?? 0

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="metric-card">
        <span className="metric-card-label">Produits actifs</span>
        <div className="flex items-baseline gap-2">
          <span className="metric-card-value">{activeProducts}</span>
          <span className="text-xs text-tertiary">/ {totalProducts}</span>
        </div>
      </div>
      <div className="metric-card">
        <span className="metric-card-label">Stock total</span>
        <span className="metric-card-value">{totalStock.toLocaleString('fr-FR')}</span>
      </div>
      <div className="metric-card">
        <span className="metric-card-label">Alertes seuil bas</span>
        <div className="flex items-center gap-2">
          <span className="metric-card-value text-warning">{lowStock}</span>
          {lowStock > 0 && <AlertTriangle size={16} className="text-warning" />}
        </div>
      </div>
      <div className="metric-card">
        <span className="metric-card-label">Entrepôts</span>
        <span className="metric-card-value">{activeWarehouses}</span>
      </div>
    </div>
  )
}
