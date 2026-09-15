/**
 * How a refunded line reads once extras can be refunded on their own.
 *
 * <p>
 * "1 × Chicken Wings — 0.74" reads as the whole plate returned for 74 cents. It was the sauce on
 * it, and saying so is the one thing the record exists for. The wording lives here rather than at
 * each screen so the receipt, the refund history and the request list cannot drift into three
 * different ways of describing the same row.
 * </p>
 */
export function refundedItemLabel(item: {
  menuItemNameSnapshot: string
  optionNameSnapshot?: string | null
}): string {
  return item.optionNameSnapshot
    ? `${item.optionNameSnapshot} on ${item.menuItemNameSnapshot}`
    : item.menuItemNameSnapshot
}
