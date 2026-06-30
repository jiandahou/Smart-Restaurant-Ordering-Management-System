import type { AdminOrder } from '../api/auth'

export function getRefundableAmountCents(order: AdminOrder) {
  return order.latestPayment?.refundableAmountCents ?? 0
}

export function canRefundOrder(order: AdminOrder) {
  const latestPayment = order.latestPayment
  const paymentIntentId = latestPayment?.providerPaymentIntentId

  return order.paymentMethod === 'Online'
    && (order.paymentStatus === 'Paid' || order.paymentStatus === 'PartiallyRefunded')
    && latestPayment?.provider === 'Stripe'
    && Boolean(paymentIntentId)
    && !paymentIntentId!.startsWith('pi_demo_')
    && !latestPayment.hasPendingRefund
    && getRefundableAmountCents(order) > 0
}
