import type { AdminOrder } from '../api/auth'

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

export function isOrderPayable(order: AdminOrder) {
  if (order.paymentMethod !== 'Online' || !payablePaymentStatusSet.has(order.paymentStatus)) {
    return false
  }

  return !['Cancelled', 'Rejected'].includes(order.status)
}

export function getOrderStats(orders: AdminOrder[]) {
  return {
    total: orders.length,
    activeKitchen: orders.filter((order) => activeOrderStatuses.has(order.status)).length,
    paid: orders.filter((order) => order.paymentStatus === 'Paid').length,
    pendingPayment: orders.filter((order) => order.paymentStatus === 'Pending').length,
    failedPayment: orders.filter((order) => order.paymentStatus === 'Failed').length,
    payable: orders.filter(isOrderPayable).length,
    revenue: orders
      .filter((order) => order.paymentStatus === 'Paid')
      .reduce((total, order) => total + order.totalAmount, 0),
  }
}
