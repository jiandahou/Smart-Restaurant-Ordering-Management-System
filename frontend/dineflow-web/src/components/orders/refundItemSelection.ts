/**
 * What the customer has picked to be refunded, and for how much.
 *
 * <p>
 * Keyed by line, or by line and extra when the refund is for one extra rather than the dish. The
 * two are separate selections on purpose: "the wings" and "the sauce on the wings" are different
 * requests for different money, and a key that could not tell them apart would silently make one
 * overwrite the other.
 * </p>
 */
export type RefundItemSelection = Record<string, number>

/** The key a line or one of its extras is held under. */
export function refundSelectionKey(orderItemId: string, orderItemOptionId?: string | null): string {
  return orderItemOptionId ? `${orderItemId}:${orderItemOptionId}` : orderItemId
}

/** The line and extra a key refers to, for turning a selection back into a request. */
export function parseRefundSelectionKey(key: string): {
  orderItemId: string
  orderItemOptionId: string | null
} {
  const separator = key.indexOf(':')

  return separator === -1
    ? { orderItemId: key, orderItemOptionId: null }
    : {
      orderItemId: key.slice(0, separator),
      orderItemOptionId: key.slice(separator + 1),
    }
}

export function toggleItemSelection(
  selection: RefundItemSelection,
  key: string,
  defaultAmountCents: number,
): RefundItemSelection {
  if (key in selection) {
    const next = { ...selection }
    delete next[key]
    return next
  }

  return { ...selection, [key]: defaultAmountCents }
}

export function setItemAmountCents(
  selection: RefundItemSelection,
  key: string,
  amountCents: number,
  maxAmountCents: number,
): RefundItemSelection {
  if (!(key in selection)) {
    return selection
  }

  // Keep zero so clearing the input is possible; validation prevents submitting it.
  const clamped = Math.min(Math.max(Math.round(amountCents), 0), maxAmountCents)
  return { ...selection, [key]: clamped }
}

export function computeSelectedAmountCents(selection: RefundItemSelection): number {
  return Object.values(selection).reduce((total, amountCents) => total + amountCents, 0)
}

export function isValidRefundSelection(selection: RefundItemSelection): boolean {
  const amounts = Object.values(selection)
  return amounts.length > 0 && amounts.every((amountCents) => amountCents > 0)
}

/**
 * Whether picking a line as a whole is still open, given what has already been refunded on it.
 *
 * <p>
 * A line is refunded as a whole or by its parts and never both, so the first refund on it settles
 * which of the two remains. Offering the closed one and having the server refuse it wastes the
 * customer's time on a choice that was never available.
 * </p>
 */
export function canSelectWholeLine(refundGranularity: string | undefined): boolean {
  return refundGranularity !== 'ByItsParts'
}

export function canSelectExtras(refundGranularity: string | undefined): boolean {
  return refundGranularity !== 'AsAWhole'
}
