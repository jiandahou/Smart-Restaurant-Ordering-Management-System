import type { PublicMenu, PublicMenuStock } from '@/api/publicMenu'

/**
 * Folds a fresh stock reading into the menu already on screen.
 *
 * <p>
 * Kept apart from the page so the thing that decides what a diner sees can be reasoned about on its
 * own. Two rules matter here and both are about not making the screen worse than the stale data it
 * replaces:
 * </p>
 *
 * <p>
 * A dish the reading does not mention is left exactly as it was. Absence means the dish stopped
 * being on the menu at all — withdrawn mid-service — and the honest response to "I no longer know"
 * is to keep showing what was last known, not to invent a sold-out badge for something that may
 * simply have moved category.
 * </p>
 *
 * <p>
 * And the object is returned unchanged when nothing moved. Menus are large and re-rendering one on
 * a timer, for a diner mid-scroll, is a visible cost paid to display identical information.
 * </p>
 */
export function mergeMenuStock(menu: PublicMenu, stock: PublicMenuStock): PublicMenu {
  const items = new Map(stock.items.map((item) => [item.id, item]))
  const options = new Map(stock.options.map((option) => [option.id, option]))
  let changed = false

  const categories = menu.categories.map((category) => {
    let categoryChanged = false

    const nextItems = category.items.map((item) => {
      const reading = items.get(item.id)
      let nextItem = item

      if (reading && (reading.isSoldOut !== item.isSoldOut
        || (reading.remainingStock ?? null) !== (item.remainingStock ?? null))) {
        nextItem = {
          ...nextItem,
          isSoldOut: reading.isSoldOut,
          remainingStock: reading.remainingStock ?? null,
        }
      }

      const nextGroups = nextItem.optionGroups.map((group) => {
        let groupChanged = false

        const nextOptions = group.options.map((option) => {
          const optionReading = options.get(option.id)
          if (!optionReading
            || (optionReading.remainingStock ?? null) === (option.remainingStock ?? null)) {
            return option
          }

          groupChanged = true
          return { ...option, remainingStock: optionReading.remainingStock ?? null }
        })

        return groupChanged ? { ...group, options: nextOptions } : group
      })

      if (nextGroups.some((group, index) => group !== nextItem.optionGroups[index])) {
        nextItem = { ...nextItem, optionGroups: nextGroups }
      }

      if (nextItem !== item) {
        categoryChanged = true
      }

      return nextItem
    })

    if (!categoryChanged) {
      return category
    }

    changed = true
    return { ...category, items: nextItems }
  })

  return changed ? { ...menu, categories } : menu
}
