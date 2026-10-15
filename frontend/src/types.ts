// Ces types reflètent le contrat JSON réel du backend xstock : tous les
// schémas Pydantic utilisent `model_config = CAMEL` (alias_generator=to_camel),
// et FastAPI sérialise les réponses avec les alias par défaut → le wire format
// est camelCase, pas snake_case (même convention que erp/src/api/company.ts).

export type ValuationMethod = 'fifo' | 'lifo' | 'fefo' | 'cmup'
export type ABCClass = 'A' | 'B' | 'C'
export type XYZClass = 'X' | 'Y' | 'Z'
export type StockMoveType = 'in' | 'out' | 'transfer' | 'adjustment'
export type InventoryType = 'cycle' | 'full'
export type InventoryStatus = 'draft' | 'in_progress' | 'validated' | 'cancelled'
export type StockTransferStatus = 'draft' | 'ready' | 'done' | 'cancelled'
export type LocationType =
  | 'stock_internal' | 'receiving' | 'shipping' | 'transit' | 'loss'
  | 'virtual_customer' | 'virtual_supplier'
export type AlertType =
  | 'stock_threshold' | 'batch_expiry' | 'consumption_anomaly'
  | 'cold_chain_excursion' | 'controlled_substance_variance' | 'transfer_suggestion'

export type Product = {
  id: string
  tenantId: string
  code: string
  name: string
  categoryId?: string
  unit: string
  purchasePrice?: number | null
  salePrice?: number
  valuationMethod: ValuationMethod
  isLotTracked: boolean
  minThreshold?: number
  maxThreshold?: number
  abcClass?: ABCClass
  xyzClass?: XYZClass
  inn?: string
  dosageForm?: string
  dosage?: string
  therapeuticClass?: string
  isControlledSubstance: boolean
  requiresColdChain: boolean
  minTemperature?: number
  maxTemperature?: number
  isActive: boolean
  extra?: Record<string, unknown>
}

export type Warehouse = {
  id: string
  tenantId: string
  code: string
  name: string
  siteId?: string
  isActive: boolean
  defaultStockLocationId?: string
}

export type StockLocation = {
  id: string
  tenantId: string
  warehouseId: string
  code: string
  locationType: LocationType
  parentId?: string
  isActive: boolean
}

export type StockMove = {
  id: string
  tenantId: string
  productId: string
  batchId?: string
  type: StockMoveType
  quantity: number
  warehouseId: string
  sourceLocationId?: string
  destinationLocationId?: string
  unitCost?: number | null
  totalValue?: number | null
  balanceBefore: number
  balanceAfter: number
  sourceReference?: string
  reason?: string
  createdBy: string
  moveDate: string
}

export type StockLevel = {
  id: string
  tenantId: string
  productId: string
  warehouseId: string
  locationId?: string
  batchId?: string
  availableQuantity: number
  reservedQuantity: number
  averageCost?: number | null
}

export type StockTransferLine = {
  id: string
  tenantId: string
  transferId: string
  productId: string
  batchId?: string
  requestedQuantity: number
  doneQuantity?: number
}

export type StockTransfer = {
  id: string
  tenantId: string
  type: StockMoveType
  status: StockTransferStatus
  sourceWarehouseId?: string
  destinationWarehouseId?: string
  sourceLocationId?: string
  destinationLocationId?: string
  scheduledDate?: string
  effectiveDate?: string
  sourceReference?: string
  createdBy: string
}

export type InventoryCount = {
  id: string
  tenantId: string
  warehouseId: string
  type: InventoryType
  status: InventoryStatus
  countDate: string
}

export type InventoryCountLine = {
  id: string
  tenantId: string
  inventoryCountId: string
  productId: string
  expectedQuantity: number
  countedQuantity?: number
  variance?: number
}

// L'existence d'une ligne AlertSubscription pour un alertType donné signifie
// "ciblage personnalisé actif" ; il n'y a pas de booléen "enabled" côté
// backend — la suppression de la ligne revient au comportement par défaut.
export type AlertSubscription = {
  id: string
  tenantId: string
  alertType: AlertType
  userIds?: string[]
  roleId?: string
  permission?: string
}

export type StockSettings = {
  id: string
  tenantId: string
  defaultLeadTimeDays: number
  defaultServiceLevel: number
  expiryWarningDays: number
  anomalyZThreshold: number
  coldChainMaxExcursionMinutes: number
  coldChainLookbackHours: number
}
