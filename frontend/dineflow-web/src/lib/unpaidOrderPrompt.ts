import type { CustomerOrder } from '@/api/auth'

/**
 * Telling a customer who came back to the menu that they already have an order waiting to be paid.
 *
 * <p>
 * Checking out reserves stock and takes a pickup number before any payment, and that reservation
 * now expires. Left to discover this on their own, a customer who bounced off the payment screen
 * would simply start again — building a second order while the first quietly held their food, and
 * then wondering why the dish went sold out. So the moment they are back at the menu they are told
 * the order exists, what happens if they ignore it, and given the two ways to resolve it.
 * </p>
 */

/** Payment states that mean the order is sitting unpaid rather than settled or mid-payment. */
const unpaidStatuses = new Set(['Unpaid', 'Failed', 'Expired', 'Cancelled'])

export type UnpaidOrderPrompt = {
  order: CustomerOrder
  /** When it releases what it is holding. */
  expiresAt: Date
  /** Milliseconds left, floored at zero. */
  remainingMs: number
}

/**
 * Whether an order is the kind this prompt is about: placed, unpaid, still holding its reservation.
 *
 * <p>
 * `unpaidExpiresAt` comes from the server and is null whenever a payment is in flight, which is
 * what keeps the dialog away from somebody who is on the card form in another tab.
 * </p>
 */
export function isAwaitingPayment(order: CustomerOrder): boolean {
  return (
    order.status === 0 &&
    // Counter orders are Unpaid by design — the customer said they would settle at the till, and
    // the kitchen may already be cooking. Prompting them to "finish paying" contradicts the choice
    // they just made and offers to cancel a meal that is on its way.
    order.paymentMethod !== 'PayAtCounter' &&
    unpaidStatuses.has(order.paymentStatus) &&
    order.unpaidExpiresAt !== null
  )
}

/**
 * The unpaid order to prompt about, or null.
 *
 * <p>
 * The oldest one wins when there are several: it is the one about to expire, so it is the one where
 * the choice actually matters. Anything already past its deadline is skipped — the sweep is about
 * to take it, and offering to "continue payment" on an order that is being released would send the
 * customer to a checkout that fails.
 * </p>
 */
export function findUnpaidOrderToPrompt(
  orders: readonly CustomerOrder[],
  restaurantId: string,
  now: Date = new Date(),
): UnpaidOrderPrompt | null {
  const candidates = orders
    .filter((order) => order.restaurantId === restaurantId && isAwaitingPayment(order))
    .map((order) => ({ order, expiresAt: new Date(order.unpaidExpiresAt!) }))
    .filter(({ expiresAt }) => Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime())
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())

  const first = candidates[0]

  return first
    ? { ...first, remainingMs: Math.max(0, first.expiresAt.getTime() - now.getTime()) }
    : null
}

/** "20 minutes", "9 minutes", "under a minute" — what the customer has left. */
export function describeRemaining(remainingMs: number): string {
  if (remainingMs <= 0) {
    return 'no time'
  }

  const minutes = Math.ceil(remainingMs / 60_000)

  return minutes <= 1 ? 'under a minute' : `${minutes} minutes`
}
