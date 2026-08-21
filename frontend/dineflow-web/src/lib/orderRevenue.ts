import type { AdminOrder } from '../api/auth'

/**
 * What an order actually contributed, for counts and revenue.
 *
 * <p>
 * Both used to test `paymentStatus === 'Paid'` exactly, so an order dropped out of them the moment
 * any money went back: refunding one dollar of a twenty-six dollar order removed the whole
 * twenty-six from the day's revenue. The order had not stopped being paid for — part of it had been
 * given back, which is a different thing and a much smaller number.
 * </p>
 *
 * <p>
 * The rule: money that completed counts, net of what was returned. Everything else counts for
 * nothing — an order awaiting payment is not revenue, and neither is one that will be settled at
 * the till later.
 * </p>
 */

/** Payment states in which money was actually taken. */
const settledPaymentStatuses = new Set(['Paid', 'PartiallyRefunded', 'Refunded'])

/** Whether this order took the customer's money at all. */
export function isRevenueSettled(order: AdminOrder): boolean {
  return settledPaymentStatuses.has(order.paymentStatus)
}

/**
 * What the restaurant kept, in the order's own currency units.
 *
 * <p>
 * Refunds are netted off rather than voiding the order, so a fully refunded order contributes zero
 * without also erasing the fact that it happened.
 * </p>
 */
export function netRevenueOf(order: AdminOrder): number {
  if (!isRevenueSettled(order)) {
    return 0
  }

  const refundedCents = order.latestPayment?.refundedAmountCents ?? 0
  const kept = order.totalAmount - refundedCents / 100

  // A refund larger than the order — an over-refund, or money attributed across several payments —
  // takes revenue to zero and no further. Negative revenue is not a thing a day can have.
  return kept > 0 ? kept : 0
}

export function sumNetRevenue(orders: AdminOrder[]): number {
  return orders.reduce((total, order) => total + netRevenueOf(order), 0)
}
