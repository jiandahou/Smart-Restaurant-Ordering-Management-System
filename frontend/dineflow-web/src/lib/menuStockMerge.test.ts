import { describe, expect, it } from 'vitest'
import type { PublicMenu, PublicMenuItem, PublicMenuStock } from '@/api/publicMenu'
import { mergeMenuStock } from './menuStockMerge'

function option(id: string, remainingStock: number | null = null) {
  return {
    id,
    groupId: 'group-1',
    name: `Option ${id}`,
    priceAdjustment: 0,
    adjustmentType: 0,
    allergens: null,
    mayContainAllergens: null,
    crossContactStatement: null,
    maxQuantity: 1,
    remainingStock,
    displayOrder: 0,
    isAvailable: true,
  } as PublicMenuItem['optionGroups'][number]['options'][number]
}

function item(overrides: Partial<PublicMenuItem> = {}): PublicMenuItem {
  return {
    id: 'item-1',
    categoryId: 'category-1',
    name: 'Garlic Bread',
    description: null,
    price: 8.5,
    imageUrl: null,
    isAvailable: true,
    isSoldOut: false,
    remainingStock: 3,
    isVegetarian: false,
    isVegan: false,
    isGlutenFree: false,
    isHalal: false,
    allergens: null,
    mayContainAllergens: null,
    crossContactStatement: null,
    allergenInfoLastVerifiedAt: null,
    spiceLevel: 0,
    servingSize: null,
    calories: null,
    isPopular: false,
    isRecommended: false,
    displayOrder: 0,
    optionGroups: [],
    ...overrides,
  } as PublicMenuItem
}

function menu(...items: PublicMenuItem[]): PublicMenu {
  return {
    restaurantId: 'restaurant-1',
    categories: [{ id: 'category-1', name: 'Sides', description: null, displayOrder: 0, items }],
  }
}

function reading(overrides: Partial<PublicMenuStock> = {}): PublicMenuStock {
  return { restaurantId: 'restaurant-1', items: [], options: [], ...overrides }
}

const itemsOf = (result: PublicMenu) => result.categories[0].items

describe('mergeMenuStock', () => {
  /** The reported fault: somebody else took the last one and the page went on offering it. */
  it('crosses out a dish that sold out while the page was open', () => {
    const merged = mergeMenuStock(
      menu(item()),
      reading({ items: [{ id: 'item-1', isSoldOut: true, remainingStock: null }] }),
    )

    expect(itemsOf(merged)[0].isSoldOut).toBe(true)
    expect(itemsOf(merged)[0].remainingStock).toBeNull()
  })

  it('follows a count down as other people order', () => {
    const merged = mergeMenuStock(
      menu(item({ remainingStock: 3 })),
      reading({ items: [{ id: 'item-1', isSoldOut: false, remainingStock: 1 }] }),
    )

    expect(itemsOf(merged)[0].remainingStock).toBe(1)
  })

  /** Stock comes back too — a cancelled order returns its portions. */
  it('puts a dish back when its portions are released', () => {
    const merged = mergeMenuStock(
      menu(item({ isSoldOut: true, remainingStock: null })),
      reading({ items: [{ id: 'item-1', isSoldOut: false, remainingStock: 2 }] }),
    )

    expect(itemsOf(merged)[0].isSoldOut).toBe(false)
    expect(itemsOf(merged)[0].remainingStock).toBe(2)
  })

  it('follows a modifier that ran out', () => {
    const withOptions = item({
      optionGroups: [{
        id: 'group-1',
        menuItemId: 'item-1',
        name: 'Finish',
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        displayOrder: 0,
        isActive: true,
        options: [option('option-1', 4), option('option-2')],
      }],
    })

    const merged = mergeMenuStock(
      menu(withOptions),
      reading({ options: [{ id: 'option-1', remainingStock: 0 }] }),
    )

    const options = itemsOf(merged)[0].optionGroups[0].options
    expect(options[0].remainingStock).toBe(0)
    // Untouched, and still the very same object.
    expect(options[1]).toBe(withOptions.optionGroups[0].options[1])
  })

  /**
   * A dish the reading does not mention has been withdrawn from the menu, not sold out. Inventing
   * a sold-out badge for it would be answering "I no longer know" with a claim.
   */
  it('leaves a dish it was told nothing about exactly as it was', () => {
    const original = menu(item({ remainingStock: 3 }))

    const merged = mergeMenuStock(
      original,
      reading({ items: [{ id: 'someone-else', isSoldOut: true, remainingStock: null }] }),
    )

    expect(merged).toBe(original)
    expect(itemsOf(merged)[0].remainingStock).toBe(3)
    expect(itemsOf(merged)[0].isSoldOut).toBe(false)
  })

  /**
   * The identity checks are the point of the rule, not an optimisation detail: this runs on a timer
   * under a diner who is mid-scroll, and re-rendering a whole menu to display identical information
   * is a cost they can see.
   */
  it('returns the very same menu when nothing has moved', () => {
    const original = menu(item({ remainingStock: 3 }))

    const merged = mergeMenuStock(
      original,
      reading({ items: [{ id: 'item-1', isSoldOut: false, remainingStock: 3 }] }),
    )

    expect(merged).toBe(original)
  })

  it('keeps the categories and dishes that did not change', () => {
    const unchanged = item({ id: 'item-2', remainingStock: 9 })
    const original = menu(item({ remainingStock: 3 }), unchanged)

    const merged = mergeMenuStock(
      original,
      reading({ items: [{ id: 'item-1', isSoldOut: true, remainingStock: null }] }),
    )

    expect(merged).not.toBe(original)
    expect(itemsOf(merged)[1]).toBe(unchanged)
  })

  it('treats an empty reading as nothing to say', () => {
    const original = menu(item())

    expect(mergeMenuStock(original, reading())).toBe(original)
  })
})
