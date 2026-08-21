import { describe, expect, it } from 'vitest'
import type { MenuItem } from '@/api/auth'
import { describeMenuItemChanges } from './menuItemConflict'

function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'item-1',
    restaurantId: 'restaurant-1',
    categoryId: 'category-1',
    categoryName: 'Mains',
    name: 'Market Arancini',
    description: 'Crisp rice bites',
    price: 16,
    imageUrl: null,
    isAvailable: true,
    isSoldOut: false,
    isWatched: false,
    stockQuantity: null,
    isVegetarian: true,
    isVegan: false,
    isGlutenFree: false,
    isHalal: false,
    allergens: 'dairy',
    mayContainAllergens: null,
    crossContactStatement: null,
    spiceLevel: 0,
    servingSize: null,
    calories: null,
    isPopular: false,
    isRecommended: false,
    displayOrder: 10,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    optionGroups: [],
    ...overrides,
  }
}

describe('what someone else changed', () => {
  it('says nothing when the item has not moved', () => {
    expect(describeMenuItemChanges(item(), item())).toEqual([])
  })

  it('reports the reported case: a description changed under the editor', () => {
    const changes = describeMenuItemChanges(item(), item({ description: 'Now with saffron' }))

    expect(changes).toEqual([
      { label: 'Description', from: 'Crisp rice bites', to: 'Now with saffron' },
    ])
  })

  it('reports a price change in the form it is charged in', () => {
    const changes = describeMenuItemChanges(item(), item({ price: 18.5 }))

    expect(changes).toEqual([{ label: 'Price', from: '16.00', to: '18.50' }])
  })

  it('names each allergen field separately', () => {
    // "Someone changed the allergens" is not enough to judge whether overwriting is safe.
    const changes = describeMenuItemChanges(
      item(),
      item({ mayContainAllergens: 'Peanut', crossContactStatement: 'Shared fryer' }),
    )

    expect(changes.map((change) => change.label)).toEqual(['May contain', 'Cross-contact'])
    expect(changes[0]).toEqual({ label: 'May contain', from: '—', to: 'Peanut' })
  })

  it('reads booleans as words rather than true and false', () => {
    const changes = describeMenuItemChanges(item(), item({ isAvailable: false }))

    expect(changes).toEqual([{ label: 'Available', from: 'Yes', to: 'No' }])
  })

  it('lists every field that moved, not just the first', () => {
    const changes = describeMenuItemChanges(
      item(),
      item({ name: 'Arancini', price: 17, isGlutenFree: true }),
    )

    expect(changes.map((change) => change.label)).toEqual(['Name', 'Price', 'Gluten-free'])
  })

  it('does not report a change when only whitespace differs', () => {
    expect(describeMenuItemChanges(item(), item({ description: '  Crisp rice bites  ' }))).toEqual([])
  })
})
