import type { CustomerOrder } from '@/api/auth'

const cancellablePaymentStatuses = new Set(['Unpaid', 'Failed', 'Expired', 'Cancelled', 'NotRequired'])

export function canCustomerCancelOrder(
  order: Pick<CustomerOrder, 'status' | 'paymentStatus'>,
): boolean {
  return order.status === 0 && cancellablePaymentStatuses.has(order.paymentStatus)
}
