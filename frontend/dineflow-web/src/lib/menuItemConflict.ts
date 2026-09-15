import type { MenuItem } from '@/api/auth'

/**
 * What someone else changed while this item was open for editing.
 *
 * <p>
 * A menu item update sends every field, so two people editing one item do not each save their own
 * change: the second save carries the first person's fields as they were before, and puts them
 * back. Nothing failed and nothing was reported — the first person simply found their work undone
 * later, with no way to tell what had happened.
 * </p>
 *
 * <p>
 * The comparison is between the copy the form was opened with and the copy the server now holds, so
 * it describes the other person's edit rather than this one. That is the thing the person staring
 * at the conflict cannot otherwise see.
 * </p>
 */

export type MenuItemChange = {
  label: string
  from: string
  to: string
}

type ComparedField = {
  label: string
  read: (item: MenuItem) => string
}

const money = (value: number) => value.toFixed(2)
const text = (value: string | null | undefined) => value?.trim() || '—'
const flag = (value: boolean) => (value ? 'Yes' : 'No')

/**
 * Allergen and dietary fields are named individually rather than lumped together, because "someone
 * changed the allergens" is not enough for the reader to judge whether saving over it is safe.
 */
const comparedFields: ComparedField[] = [
  { label: 'Name', read: (item) => item.name },
  { label: 'Category', read: (item) => item.categoryName },
  { label: 'Description', read: (item) => text(item.description) },
  { label: 'Price', read: (item) => money(item.price) },
  { label: 'Available', read: (item) => flag(item.isAvailable) },
  { label: 'Sold out', read: (item) => flag(item.isSoldOut) },
  { label: 'Allergens', read: (item) => text(item.allergens) },
  { label: 'May contain', read: (item) => text(item.mayContainAllergens) },
  { label: 'Cross-contact', read: (item) => text(item.crossContactStatement) },
  { label: 'Vegetarian', read: (item) => flag(item.isVegetarian) },
  { label: 'Vegan', read: (item) => flag(item.isVegan) },
  { label: 'Gluten-free', read: (item) => flag(item.isGlutenFree) },
  { label: 'Halal', read: (item) => flag(item.isHalal) },
  { label: 'Spice level', read: (item) => String(item.spiceLevel) },
  { label: 'Serving size', read: (item) => text(item.servingSize) },
  { label: 'Calories', read: (item) => (item.calories === null ? '—' : String(item.calories)) },
  { label: 'Popular', read: (item) => flag(item.isPopular) },
  { label: 'Recommended', read: (item) => flag(item.isRecommended) },
  { label: 'Display order', read: (item) => String(item.displayOrder) },
]

/** Every field that differs between the copy the form was opened with and the current one. */
export function describeMenuItemChanges(openedWith: MenuItem, current: MenuItem): MenuItemChange[] {
  return comparedFields
    .map(({ label, read }) => ({ label, from: read(openedWith), to: read(current) }))
    .filter((change) => change.from !== change.to)
}
