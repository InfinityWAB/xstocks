import { ERPPlugin, type Manifest } from '@infintywab/plugin-sdk'
import { ProductsPage } from './pages/products'
import { WarehousesPage } from './pages/warehouses'
import { MovementsPage } from './pages/movements'
import { InventoryPage } from './pages/inventory'
import { TransfersPage } from './pages/transfers'
import { SettingsPage } from './pages/settings'
import { StockDashboardWidgets } from './widgets/dashboard'

export class StockPlugin extends ERPPlugin {
  async onload() {
    this.app.registerRoutes([
      { path: '/stock/products',           component: ProductsPage,    meta: { title: 'Produits', icon: 'Package' } },
      { path: '/stock/warehouses',         component: WarehousesPage,  meta: { title: 'Entrepôts', icon: 'Warehouse' } },
      { path: '/stock/movements',          component: MovementsPage,   meta: { title: 'Mouvements', icon: 'ArrowLeftRight' } },
      { path: '/stock/inventory',          component: InventoryPage,   meta: { title: 'Inventaires', icon: 'ClipboardList' } },
      { path: '/stock/transfers',          component: TransfersPage,   meta: { title: 'Transferts', icon: 'ArrowLeftRight' } },
      { path: '/stock/settings',           component: SettingsPage,    meta: { title: 'Paramètres', icon: 'Settings' } },
    ])

    this.app.registerSidebar([
      { label: 'Produits',     path: '/stock/products',   icon: 'Package',        section: 'Stock', order: 10 },
      { label: 'Entrepôts',    path: '/stock/warehouses', icon: 'Warehouse',      section: 'Stock', order: 20 },
      { label: 'Mouvements',   path: '/stock/movements',  icon: 'ArrowLeftRight', section: 'Stock', order: 30 },
      { label: 'Inventaires',  path: '/stock/inventory',  icon: 'ClipboardList',  section: 'Stock', order: 40 },
      { label: 'Transferts',   path: '/stock/transfers',  icon: 'ArrowLeftRight', section: 'Stock', order: 50 },
      { label: 'Paramètres',   path: '/stock/settings',   icon: 'Settings',        section: 'Stock', order: 99 },
    ])

    this.app.registerDashboardWidget({
      id: 'stock.overview',
      title: 'Aperçu Stock',
      component: StockDashboardWidgets,
      defaultSize: 'md',
    })

    this.app.registerCommand({
      id: 'stock:goto-products',
      label: 'Aller aux produits',
      icon: 'Package',
      category: 'Stock',
      run: () => this.app.navigate('/stock/products'),
    })

    this.app.registerSettingsSection({
      id: 'stock',
      label: 'Stock',
      icon: 'Package',
      component: SettingsPage,
    })
  }

  onunload() {}
}

export const manifest: Manifest = {
  id: 'stock',
  name: 'Gestion de Stock',
  version: '0.1.0',
  author: 'FasoOrchestra',
  permissions: ['stock:read', 'stock:write'],
  dependencies: [],
}
