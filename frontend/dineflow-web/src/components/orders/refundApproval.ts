import type { AdminRefundRequest, PaymentEnvironment } from '../../api/auth'

export function canConfirmRefundApproval(
  request: AdminRefundRequest | null,
  mode: PaymentEnvironment['mode'] | null,
  confirmation: string,
  amountCents: number | null,
) {
  if (!request || mode === null || mode === 'Unconfigured') {
    return false
  }

  if (amountCents === null || amountCents <= 0) {
    return false
  }

  if (amountCents > request.requestedAmountCents || amountCents > request.refundableAmountCents) {
    return false
  }

  return mode !== 'Live' || confirmation.trim() === request.orderNumber
}
