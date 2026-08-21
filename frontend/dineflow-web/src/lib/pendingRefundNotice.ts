import type { AdminOrderPendingRefundRequest } from '@/api/auth'

/**
 * What an order screen should say about a refund the customer is still waiting on.
 *
 * <p>
 * Refund requests were only ever shown on the payments screen. A kitchen could be preparing an order
 * the customer had already asked to have refunded, and the order screen — the one being watched
 * during service — showed nothing at all. By the time anyone thought to look at payments, the food
 * was often already made.
 * </p>
 */

export type PendingRefundNotice = {
  /** Short enough for a badge on a busy screen. */
  badge: string
  /** The amount and the customer's reason, for the card body. */
  summary: string
  /** Just the amount, for placeholders and fields. */
  amountLabel: string
  /** The customer's own words, or null when they gave none. */
  reason: string | null
  /**
   * True when approving in full would call the order off. Said before the click: staff deciding
   * during service should not learn that the kitchen has been stood down by noticing afterwards.
   */
  warnsOrderWouldBeCancelled: boolean
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'AUD').toUpperCase(),
  }).format(cents / 100)
}

export function buildPendingRefundNotice(
  request: AdminOrderPendingRefundRequest | null | undefined,
): PendingRefundNotice | null {
  if (!request) {
    return null
  }

  const amount = formatAmount(request.requestedAmountCents, request.currency)
  const reason = request.reason?.trim() ? request.reason.trim() : null

  return {
    badge: 'Refund requested',
    summary: reason ? `${amount} — ${reason}` : `${amount} requested`,
    amountLabel: amount,
    reason,
    warnsOrderWouldBeCancelled: request.fullRefundWouldCancelOrder,
  }
}
