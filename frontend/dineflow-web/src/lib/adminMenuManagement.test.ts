import { describe, expect, it } from 'vitest'
import type { MenuCategory, MenuItem } from '@/api/auth'
import {
  getMenuMetrics,
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
    })
    expect(menuItemStatusLabel(items[0])).toBe('Live')
    expect(menuItemStatusLabel(items[1])).toBe('Hidden')
    expect(menuItemStatusLabel(items[2])).toBe('Sold out')
  })
})
