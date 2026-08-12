import { describe, expect, it } from 'vitest'
import { mergeProductIntoList } from './products'
import type { Product } from '../types'

const baseProduct: Product = {
  id: 'prod-1',
  tenantId: 'tenant-1',
  code: 'P001',
  name: 'Produit initial',
  unit: 'unite',
  valuationMethod: 'fifo',
  isLotTracked: false,
  isControlledSubstance: false,
  requiresColdChain: false,
  isActive: true,
}

describe('mergeProductIntoList', () => {
  it('ajoute un produit créé au début de la liste', () => {
    const created = { ...baseProduct, id: 'prod-2', name: 'Nouveau produit', code: 'P002' }

    const next = mergeProductIntoList([baseProduct], created)

    expect(next.map(item => item.id)).toEqual(['prod-2', 'prod-1'])
    expect(next[0].name).toBe('Nouveau produit')
  })

  it('met à jour un produit déjà présent', () => {
    const updated = { ...baseProduct, name: 'Produit mis à jour' }

    const next = mergeProductIntoList([baseProduct], updated)

    expect(next).toHaveLength(1)
    expect(next[0].name).toBe('Produit mis à jour')
  })
})
