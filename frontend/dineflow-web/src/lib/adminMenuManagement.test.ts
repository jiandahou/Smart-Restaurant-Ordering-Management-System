import { describe, expect, it } from 'vitest'
import type { MenuCategory, MenuItem } from '@/api/auth'
import {
  allergenDisclosures,
  getMenuMetrics,
  hasNoAllergenDeclaration,
  menuItemMatchesSearch,
  menuItemMatchesStatus,
  menuItemStatusLabel,
} from './adminMenuManagement'

const category = {
  id: 'category-1',
  restaurantId: 'restaurant-1',
  name: 'Mains',
  description: null,
  displayOrder: 10,
  isActive: true,
  createdAt: '2026-01-01',
  updatedAt: null,
} satisfies MenuCategory

function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'item-1',
    restaurantId: 'restaurant-1',
    categoryId: category.id,
    categoryName: category.name,
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
    spiceLevel: 0,
    servingSize: null,
    calories: null,
    isPopular: false,
    isRecommended: false,
    displayOrder: 10,
    createdAt: '2026-01-01',
    updatedAt: null,
    optionGroups: [{
      id: 'group-1',
      menuItemId: 'item-1',
      name: 'Preparation',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 10,
      isActive: true,
      createdAt: '2026-01-01',
      updatedAt: null,
      options: [{
        id: 'option-1',
        groupId: 'group-1',
        name: 'Extra seasoning',
        priceAdjustment: 1,
        adjustmentType: 0,
        maxQuantity: 1,
        displayOrder: 10,
        isAvailable: true,
        createdAt: '2026-01-01',
        updatedAt: null,
      }],
    }],
    ...overrides,
  }
}

describe('admin menu management helpers', () => {
  it('searches item, category, allergen, option group and option names', () => {
    const value = item()
    expect(menuItemMatchesSearch(value, 'arancini')).toBe(true)
    expect(menuItemMatchesSearch(value, 'mains')).toBe(true)
    expect(menuItemMatchesSearch(value, 'dairy')).toBe(true)
    expect(menuItemMatchesSearch(value, 'preparation')).toBe(true)
    expect(menuItemMatchesSearch(value, 'seasoning')).toBe(true)
    expect(menuItemMatchesSearch(value, 'dessert')).toBe(false)
  })

  /**
   * Search read `allergens` and stopped there, so an item whose only mention of a risk was in
   * "may contain" or in the cross-contact statement could not be found by searching for it.
   */
  describe('allergen disclosure fields in search', () => {
    const fields = ['allergens', 'mayContainAllergens', 'crossContactStatement'] as const
    const undeclared = { allergens: null, mayContainAllergens: null, crossContactStatement: null }

    it.each(fields)('finds an item whose only mention of sesame is in %s', (field) => {
      const value = item({ ...undeclared, [field]: 'Traces of sesame' })

      expect(menuItemMatchesSearch(value, 'sesame')).toBe(true)
    })

    // Tying the two together so a fourth disclosure field cannot be added to one and forgotten in
    // the other: whatever counts as a declaration is by definition something search can reach.
    it.each(fields)('counts %s as a declaration and as searchable text alike', (field) => {
      const value = item({ ...undeclared, [field]: 'Traces of sesame' })

      expect(hasNoAllergenDeclaration(value)).toBe(false)
      expect(allergenDisclosures(value)).toEqual(['Traces of sesame'])
    })

    it('has nothing to declare and nothing to match when every field is blank', () => {
      const value = item({ ...undeclared })

      expect(hasNoAllergenDeclaration(value)).toBe(true)
      expect(allergenDisclosures(value)).toEqual([])
      expect(menuItemMatchesSearch(value, 'sesame')).toBe(false)
    })

    it('does not treat whitespace as a declaration', () => {
      expect(hasNoAllergenDeclaration(item({ ...undeclared, crossContactStatement: '   ' }))).toBe(true)
    })

    it('keeps each field separate rather than matching across a joined blob', () => {
      const value = item({ ...undeclared, allergens: 'Peanut', crossContactStatement: 'Shared fryer' })

      expect(menuItemMatchesSearch(value, 'peanut shared')).toBe(false)
    })
  })

  it('classifies operational item states', () => {
    expect(menuItemMatchesStatus(item(), 'live')).toBe(true)
    expect(menuItemMatchesStatus(item({ isAvailable: false }), 'hidden')).toBe(true)
    expect(menuItemMatchesStatus(item({ isSoldOut: true }), 'sold-out')).toBe(true)
    expect(menuItemMatchesStatus(item({ stockQuantity: 5 }), 'low-stock')).toBe(true)
    expect(menuItemMatchesStatus(item({ stockQuantity: 6 }), 'low-stock')).toBe(false)
    expect(menuItemMatchesStatus(item({ isWatched: true }), 'watched')).toBe(true)
  })

  it('summarises menu health without double-counting total items', () => {
    const items = [
      item(),
      item({ id: 'item-2', isAvailable: false }),
      item({ id: 'item-3', isSoldOut: true, stockQuantity: 0 }),
    ]

    expect(getMenuMetrics([category], items)).toEqual({
      categories: 1,
      items: 3,
      live: 1,
      hidden: 1,
      soldOut: 1,
      lowStock: 1,
      // The shared fixture declares an allergen, so nothing here is undeclared.
      allergensUndeclared: 0,
    })
    expect(menuItemStatusLabel(items[0])).toBe('Live')
    expect(menuItemStatusLabel(items[1])).toBe('Hidden')
    expect(menuItemStatusLabel(items[2])).toBe('Sold out')
  })
})

describe('allergen declarations', () => {
  it('treats an item with no allergen fields at all as undeclared', () => {
    expect(hasNoAllergenDeclaration(item({
      allergens: null,
      mayContainAllergens: null,
      crossContactStatement: null,
    }))).toBe(true)
  })

  it('treats whitespace as no declaration', () => {
    expect(hasNoAllergenDeclaration(item({
      allergens: '   ',
      mayContainAllergens: null,
      crossContactStatement: null,
    }))).toBe(true)
  })

  it.each([
    ['allergens', { allergens: 'Milk' }],
    ['may-contain', { allergens: null, mayContainAllergens: 'Peanut' }],
    ['cross-contact', { allergens: null, crossContactStatement: 'Shared fryer.' }],
  ])('counts any one of the three fields as declared (%s)', (_label, overrides) => {
    expect(hasNoAllergenDeclaration(item(overrides))).toBe(false)
  })

  it('counts only live items as undeclared, since hidden ones are not on sale', () => {
    const undeclaredLive = item({ id: 'a', allergens: null })
    const undeclaredHidden = item({ id: 'b', allergens: null, isAvailable: false })
    const declared = item({ id: 'c', allergens: 'Milk' })

    const metrics = getMenuMetrics([category], [undeclaredLive, undeclaredHidden, declared])

    expect(metrics.allergensUndeclared).toBe(1)
    expect(menuItemMatchesStatus(undeclaredLive, 'allergens-undeclared')).toBe(true)
    expect(menuItemMatchesStatus(undeclaredHidden, 'allergens-undeclared')).toBe(false)
    expect(menuItemMatchesStatus(declared, 'allergens-undeclared')).toBe(false)
  })
})
