import type { AdminRefundRequest, PaymentEnvironment } from '../../api/auth'

export function canConfirmRefundApproval(
  request: AdminRefundRequest | null,
  mode: PaymentEnvironment['mode'] | null,
  confirmation: string,
) {
  if (!request || mode === null || mode === 'Unconfigured') {
    return false
  }

  if (request.requestedAmountCents <= 0 || request.requestedAmountCents > request.refundableAmountCents) {
    return false
  }

  return mode !== 'Live' || confirmation.trim() === request.orderNumber
}
