import type { AdminOrder } from '../api/auth'
import { isRevenueSettled, sumNetRevenue } from './orderRevenue'

const activeOrderStatuses = new Set(['Pending', 'Accepted', 'Preparing', 'Ready'])

/**
 * Mirrors OrderPaymentEligibility.IsPayableOnlineStatus on the backend. Deliberately an allowlist:
 * the previous denylist only excluded 'Paid', so every status added afterwards (Refunded,
 * PartiallyRefunded, NotRequired) silently became payable and offered a Checkout button the
 * backend then refused. Keep this in step with the backend rule.
 */
export const payablePaymentStatuses = [
  'Pending',
  'Unpaid',
  'Failed',
  'Cancelled',
  'Expired',
] as const satisfies readonly AdminOrder['paymentStatus'][]

const payablePaymentStatusSet: ReadonlySet<string> = new Set(payablePaymentStatuses)

/**
 * Whether staff can still send this order to an online checkout.
 *
 * <p>
 * Mirrors the server's OnlineCheckoutEligibility. Completed used to be missing from the closed list,
 * so orders that had been handed over while still owing money were offered a Checkout button here
 * and could be charged through to a real Stripe session — a payment link nobody is standing at, for
 * a transaction already closed.
 * </p>
 *
 * <p>
 * A completed order that still owes money is a bookkeeping incident rather than an unpaid bill: the
 * money is recorded at the counter, where it is written down with a name against it, or the order is
 * reopened deliberately first.
 * </p>
 */
export function isOrderPayable(order: AdminOrder) {
  if (order.paymentMethod !== 'Online' || !payablePaymentStatusSet.has(order.paymentStatus)) {
    return false
  }

  return !['Completed', 'Cancelled', 'Rejected'].includes(order.status)
}

/**
 * Whether cash may still be taken over the counter for this order.
 *
 * <p>
 * Mirrors the server's OrderPaymentEligibility.CanSettleAtCounter. Four screens each decided this
 * for themselves with the same two-clause test — pay-at-counter, not already Paid — and all four
 * were wrong the same way: a cancelled order kept its "Mark paid" button while Admin Payments, on
 * the same order, said Not payable. The endpoint refuses it, so the button could only ever produce
 * an error, and the error arrives after the money has been taken at the till.
 * </p>
 *
 * <p>
 * Completed is deliberately allowed. Eating first and paying on the way out is the ordinary case
 * for pay-at-counter, not an anomaly.
 * </p>
 */
export function canSettleAtCounter(order: AdminOrder) {
  if (order.paymentMethod !== 'PayAtCounter') {
    return false
  }

  // Settled for fulfilment, in the server's words: a partly refunded order still took the money,
  // and asking for it again would take it twice.
  if (['Paid', 'PartiallyRefunded', 'NotRequired', 'Refunded'].includes(order.paymentStatus)) {
    return false
  }

  return !['Cancelled', 'Rejected'].includes(order.status)
}

export function getOrderStats(orders: AdminOrder[]) {
  return {
    total: orders.length,
    activeKitchen: orders.filter((order) => activeOrderStatuses.has(order.status)).length,
    // Settled, not literally 'Paid': a partly refunded order still took the customer's money.
    paid: orders.filter(isRevenueSettled).length,
    pendingPayment: orders.filter((order) => order.paymentStatus === 'Pending').length,
    failedPayment: orders.filter((order) => order.paymentStatus === 'Failed').length,
    payable: orders.filter(isOrderPayable).length,
    // Net of refunds. Filtering on 'Paid' dropped the whole order the moment a dollar went
    // back, so refunding A$1 of an A$26.61 order removed A$26.61 from the day's takings.
    revenue: sumNetRevenue(orders),
  }
}
