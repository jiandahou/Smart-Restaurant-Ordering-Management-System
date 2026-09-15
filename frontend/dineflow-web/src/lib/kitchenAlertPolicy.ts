/**
 * Which orders are worth making a noise about in the kitchen.
 *
 * <p>
 * The alert used to fire on every order the moment it was created, whatever its payment state. An
 * online order arrives unpaid — the customer has not reached the card form yet — and the staff
 * screen correctly refuses to let anyone start on it. So the sound called the kitchen to a ticket
 * they were not allowed to touch, and it did so for every abandoned checkout as well.
 * </p>
 *
 * <p>
 * Worse, the alert was wired only to the created event, so when the money did arrive nothing rang.
 * The one moment a cook needed to know was the one moment that stayed silent.
 * </p>
 *
 * <p>
 * The rule is the one the staff screen already applies to its buttons: make a noise when somebody
 * could actually start cooking.
 * </p>
 */

/** Payment states that mean the money is accounted for. */
const settledPaymentStatuses = new Set(['Paid', 'PartiallyRefunded', 'NotRequired'])

export type KitchenAlertOrder = {
  paymentStatus: string
  paymentMethod: string
}

/**
 * Whether this order should sound the new-order alert.
 *
 * <p>
 * Counter orders qualify as soon as they exist: the customer has committed to paying at the till
 * and the kitchen is expected to cook now. Online orders wait for the payment to land.
 * </p>
 */
export function shouldSoundKitchenAlert(order: KitchenAlertOrder): boolean {
  if (order.paymentMethod === 'PayAtCounter') {
    return true
  }

  return settledPaymentStatuses.has(order.paymentStatus)
}
