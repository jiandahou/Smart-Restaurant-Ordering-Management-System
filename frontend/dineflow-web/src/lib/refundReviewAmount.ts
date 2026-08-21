/**
 * The amount a refund request is being granted for, and what granting it does to the order.
 *
 * <p>
 * Staff may approve less than was asked — a customer wanting the whole order back when only one
 * dish was wrong, say. The server allows any amount above zero and up to the request, so the screen
 * has to as well; offering only "approve in full" quietly removed a decision staff already had.
 * </p>
 *
 * <p>
 * The consequence follows the amount, not the request. Granting part of a request leaves money on
 * the order, so it does not call the order off — and warning that it would, because the *full*
 * request would have, is how staff learn to ignore the warning.
 * </p>
 */

export type RefundReviewAmount = {
  /** Cents to send, or null when the entry is not usable. */
  approvedCents: number | null
  /** Why it is not usable, for the field. Null when it is. */
  error: string | null
  /** True when this grants the whole request. */
  isFull: boolean
}

export function resolveRefundReviewAmount(
  input: string,
  requestedCents: number,
): RefundReviewAmount {
  const trimmed = input.trim()

  if (!trimmed) {
    return { approvedCents: requestedCents, error: null, isFull: true }
  }

  const parsed = Number(trimmed)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { approvedCents: null, error: 'Enter an amount greater than zero.', isFull: false }
  }

  const cents = Math.round(parsed * 100)

  if (cents > requestedCents) {
    return {
      approvedCents: null,
      error: 'Cannot approve more than the customer asked for.',
      isFull: false,
    }
  }

  return { approvedCents: cents, error: null, isFull: cents === requestedCents }
}

/**
 * Whether approving this amount closes the order.
 *
 * @param wouldCancelOnFullRefund what the server says a full refund would do to this order.
 */
export function approvalCancelsOrder(amount: RefundReviewAmount, wouldCancelOnFullRefund: boolean): boolean {
  return amount.isFull && wouldCancelOnFullRefund
}
