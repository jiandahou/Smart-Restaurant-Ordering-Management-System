import type { CustomerOrder } from '@/api/auth'

const cancellablePaymentStatuses = new Set(['Unpaid', 'Failed', 'Expired', 'Cancelled', 'NotRequired'])

/** Nothing has been charged, so cancelling costs nobody anything. */
export function canCustomerCancelOrder(
  order: Pick<CustomerOrder, 'status' | 'paymentStatus'>,
): boolean {
  return order.status === 0 && cancellablePaymentStatuses.has(order.paymentStatus)
}

/**
 * FS-017. A paid order the restaurant never accepted leaves the customer with neither food nor
 * money. Past the threshold they can take the decision back and be refunded. The server decides
 * when — it owns the clock and the payment record — so this only reads its answer.
 */
export function canCustomerCancelForRefund(
  order: Pick<CustomerOrder, 'canCancelForRefund'>,
): boolean {
  return order.canCancelForRefund === true
}
