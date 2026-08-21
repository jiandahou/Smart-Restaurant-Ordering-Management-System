import type { AdminOrder, AdminOrderItem } from '../api/auth'

/**
 * How a line reads once part of it has been refunded.
 *
 * <p>
 * A refund is money leaving; the kitchen only ever saw the order. Refund one dish out of four and
 * the ticket still said four, so the dish that nobody was paying for got made anyway — and the
 * outgoing count at the pass was wrong with it.
 * </p>
 *
 * <p>
 * The distinction that matters is between a line that is gone and a line that has shrunk. Striking
 * through "3 × Butter Chicken" when one of the three was refunded would have the kitchen make none
 * of them, which is worse than making three.
 * </p>
 */

export type RefundedItemDisplay = {
  /** Units the kitchen should still make. Zero when the line is off. */
  remainingQuantity: number
  /** True when nothing is left to make and the line should read as struck through. */
  isFullyRefunded: boolean
  /** True when some units were refunded but others still stand. */
  isPartiallyRefunded: boolean
  /** Short label for the refunded part, or null when nothing was refunded. */
  refundLabel: string | null
}

export function describeRefundedItem(item: AdminOrderItem): RefundedItemDisplay {
  const refunded = Math.max(0, Math.min(item.refundedQuantity ?? 0, item.quantity))
  const remaining = item.quantity - refunded

  if (refunded === 0) {
    return {
      remainingQuantity: item.quantity,
      isFullyRefunded: false,
      isPartiallyRefunded: false,
      refundLabel: null,
    }
  }

  if (remaining === 0) {
    return {
      remainingQuantity: 0,
      isFullyRefunded: true,
      isPartiallyRefunded: false,
      refundLabel: 'Refunded — do not make',
    }
  }

  return {
    remainingQuantity: remaining,
    isFullyRefunded: false,
    isPartiallyRefunded: true,
    refundLabel: `${refunded} refunded`,
  }
}

/**
 * Units the kitchen still has to make across an order.
 *
 * <p>
 * Counted from what is left rather than what was ordered. A ticket that says four while one has been
 * refunded sends the pass looking for a dish that is not coming.
 * </p>
 */
export function remainingItemCount(order: Pick<AdminOrder, 'items'>): number {
  return order.items.reduce((count, item) => count + describeRefundedItem(item).remainingQuantity, 0)
}

/** True when nothing on the order is left to make, so the ticket is finished with. */
export function isEntirelyRefunded(order: Pick<AdminOrder, 'items'>): boolean {
  return order.items.length > 0 && remainingItemCount(order) === 0
}
