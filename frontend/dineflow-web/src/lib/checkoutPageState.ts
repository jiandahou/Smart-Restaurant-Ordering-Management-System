/**
 * What the checkout page should show for an order it has just been handed.
 *
 * <p>
 * Choosing to pay at the counter used to be recorded only in React state. A refresh — or the phone
 * waking a stale tab — put the page back to its opening screen, offering to take payment for an
 * order that was already placed and settled at the counter. The customer sees a bill they have
 * already dealt with, and the obvious next move is to pay it again.
 * </p>
 *
 * <p>
 * The order itself already knows. Deriving from it means a reload lands where the customer left
 * off, without asking the server again.
 * </p>
 */

/** The part of an order this decision needs. */
export type CheckoutOrderState = {
  paymentMethod?: string | null
}

export type CheckoutResumeState = 'ready' | 'pay_offline'

/**
 * `pay_offline` once the order is set to counter payment: there is nothing left to take here, and
 * the page's job becomes confirming that the order is in.
 */
export function resolveCheckoutResumeState(order: CheckoutOrderState | null | undefined): CheckoutResumeState {
  return order?.paymentMethod === 'PayAtCounter' ? 'pay_offline' : 'ready'
}
