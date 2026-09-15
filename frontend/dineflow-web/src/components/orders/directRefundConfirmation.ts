import type { PaymentEnvironment } from '../../api/auth'

export function canConfirmDirectRefund(
  orderNumber: string | null | undefined,
  environmentMode: PaymentEnvironment['mode'] | null,
  confirmation: string,
) {
  if (!orderNumber || environmentMode === null || environmentMode === 'Unconfigured') {
    return false
  }

  return environmentMode !== 'Live' || confirmation === orderNumber
}
