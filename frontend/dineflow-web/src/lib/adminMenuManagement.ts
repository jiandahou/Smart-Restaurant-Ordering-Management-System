import type { MenuCategory, MenuItem } from '@/api/auth'

export type MenuItemStatusFilter = 'all' | 'live' | 'hidden' | 'sold-out' | 'low-stock' | 'watched'

export type MenuMetrics = {
  categories: number
  items: number
  live: number
  hidden: number
  soldOut: number
  lowStock: number
}

export const lowStockThreshold = 5

export function menuItemMatchesSearch(item: MenuItem, rawTerm: string) {
  const term = rawTerm.trim().toLowerCase()
  if (!term) return true

  const searchable = [
    item.name,
    item.description ?? '',
    item.categoryName,
    item.allergens ?? '',
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
  }
}

export function menuItemStatusLabel(item: MenuItem) {
  if (!item.isAvailable) return 'Hidden'
  if (item.isSoldOut) return 'Sold out'
  return 'Live'
}
