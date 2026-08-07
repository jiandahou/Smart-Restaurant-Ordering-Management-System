/** Selected refund amount in minor currency units, keyed by order-item id. */
export type RefundItemSelection = Record<string, number>

export function toggleItemSelection(
  selection: RefundItemSelection,
  itemId: string,
  defaultAmountCents: number,
): RefundItemSelection {
  if (itemId in selection) {
    const next = { ...selection }
    delete next[itemId]
    return next
  }

  return { ...selection, [itemId]: defaultAmountCents }
}

export function setItemAmountCents(
  selection: RefundItemSelection,
  itemId: string,
  amountCents: number,
  maxAmountCents: number,
): RefundItemSelection {
  if (!(itemId in selection)) {
    return selection
  }

  // Keep zero so clearing the input is possible; validation prevents submitting it.
  const clamped = Math.min(Math.max(Math.round(amountCents), 0), maxAmountCents)
  return { ...selection, [itemId]: clamped }
}

export function computeSelectedAmountCents(selection: RefundItemSelection): number {
  return Object.values(selection).reduce((total, amountCents) => total + amountCents, 0)
}

export function isValidRefundSelection(selection: RefundItemSelection): boolean {
  const amounts = Object.values(selection)
  return amounts.length > 0 && amounts.every((amountCents) => amountCents > 0)
}
