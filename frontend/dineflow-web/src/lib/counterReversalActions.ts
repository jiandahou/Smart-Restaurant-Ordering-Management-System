import type { AdminOrder } from '../api/auth'

export type CounterReversalAction = 'void' | 'refund'

const counterProviders = new Set(['Counter', 'CounterCash', 'CounterCard'])

/**
 * Which ways money taken at the counter may be reversed, mirroring CounterPaymentPolicy.
 *
 * <p>
 * These are two different decisions, not two stages of one. A void says the payment should never
 * have been taken — it puts the order back to unpaid so it can be rung up again. A refund says the
 * sale was real and the money is being handed back. On a clean, fully paid counter payment both are
 * available, and only the cashier knows which happened.
 * </p>
 *
 * <p>
 * This used to return one of them, and it picked the void, so the first refund on any counter
 * payment could not be recorded at all. The only button offered was one that rewrites a valid sale
 * into a mistake and leaves the order collectable again — a false record of what happened to real
 * money, reached by a cashier who was simply trying to give some back.
 * </p>
 */
export function getCounterReversalActions(order: AdminOrder): CounterReversalAction[] {
  const payment = order.latestPayment
  if (!payment || !counterProviders.has(payment.provider)) {
    return []
  }

  const actions: CounterReversalAction[] = []

  // Only while the payment is untouched: once anything has been refunded against it, the honest
  // record is another refund rather than a rewrite of history.
  if (payment.status === 'Paid' && payment.refundCount === 0) {
    actions.push('void')
  }

  if (
    (payment.status === 'Paid' || payment.status === 'PartiallyRefunded')
    && payment.refundableAmountCents > 0
  ) {
    actions.push('refund')
  }

  return actions
}

export function counterReversalLabel(action: CounterReversalAction): string {
  return action === 'void' ? 'Void payment' : 'Refund'
}

/**
 * What the cashier is told they are choosing between.
 *
 * <p>
 * Shown because the two words are not self-explanatory at a counter with somebody waiting, and
 * picking the wrong one writes the wrong thing into the day's takings.
 * </p>
 */
export function counterReversalDescription(action: CounterReversalAction): string {
  return action === 'void'
    ? 'The payment should not have been taken. The order goes back to unpaid and can be charged again.'
    : 'The sale was real and money is going back to the customer. The order stays as it is.'
}
