import type { MenuCategory, MenuItem } from '@/api/auth'

export type MenuItemStatusFilter =
  | 'all'
  | 'live'
  | 'hidden'
  | 'sold-out'
  | 'low-stock'
  | 'watched'
  | 'allergens-undeclared'

export type MenuMetrics = {
  categories: number
  items: number
  live: number
  hidden: number
  soldOut: number
  lowStock: number
  /** Live items with no allergen declaration of any kind. */
  allergensUndeclared: number
}

/**
 * Every free-text field a restaurant can disclose allergen risk in, as one list.
 *
 * The three fields are not interchangeable — "contains peanut", "may contain peanut" and a
 * cross-contact statement are separate legal declarations — but nothing that reads them may read
 * only some. Search used to look at `allergens` alone, so an item whose only mention of sesame was
 * in its cross-contact statement could not be found by searching for sesame: the one item a recall
 * or an allergy query most needs to surface was the one item that stayed hidden.
 */
export function allergenDisclosures(item: MenuItem): string[] {
  return [item.allergens, item.mayContainAllergens, item.crossContactStatement]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value !== '')
}

/**
 * True when the restaurant has said nothing at all about this dish's allergens. Deliberately not
 * a publishing block — a restaurant is never forced to invent a declaration — but customers are
 * told the information is missing, so the kitchen should be able to see the same thing.
 */
export function hasNoAllergenDeclaration(item: MenuItem) {
  return allergenDisclosures(item).length === 0
}

export const lowStockThreshold = 5

export function menuItemMatchesSearch(item: MenuItem, rawTerm: string) {
  const term = rawTerm.trim().toLowerCase()
  if (!term) return true

  const searchable = [
    item.name,
    item.description ?? '',
    item.categoryName,
    ...allergenDisclosures(item),
    ...item.optionGroups.flatMap((group) => [
      group.name,
      ...group.options.map((option) => option.name),
    ]),
  ]

  return searchable.some((value) => value.toLowerCase().includes(term))
}

export function menuItemMatchesStatus(item: MenuItem, status: MenuItemStatusFilter) {
  switch (status) {
    case 'live':
      return item.isAvailable && !item.isSoldOut
    case 'hidden':
      return !item.isAvailable
    case 'sold-out':
      return item.isSoldOut
    case 'low-stock':
      return item.stockQuantity !== null && item.stockQuantity <= lowStockThreshold
    case 'watched':
      return item.isWatched
    case 'allergens-undeclared':
      return item.isAvailable && hasNoAllergenDeclaration(item)
    default:
      return true
  }
}

export function getMenuMetrics(categories: MenuCategory[], items: MenuItem[]): MenuMetrics {
  return {
    categories: categories.length,
    items: items.length,
    live: items.filter((item) => item.isAvailable && !item.isSoldOut).length,
    hidden: items.filter((item) => !item.isAvailable).length,
    soldOut: items.filter((item) => item.isSoldOut).length,
    lowStock: items.filter(
      (item) => item.stockQuantity !== null && item.stockQuantity <= lowStockThreshold,
    ).length,
    allergensUndeclared: items.filter(
      (item) => item.isAvailable && hasNoAllergenDeclaration(item),
    ).length,
  }
}

export function menuItemStatusLabel(item: MenuItem) {
  if (!item.isAvailable) return 'Hidden'
  if (item.isSoldOut) return 'Sold out'
  return 'Live'
}
