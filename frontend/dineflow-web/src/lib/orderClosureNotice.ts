/**
 * What to tell a customer whose order was turned away.
 *
 * <p>
 * Staff pick a reason when they reject or cancel an order — "Item is unavailable", "Duplicate
 * order" — and it used to be written to the order's history and go no further. The customer's own
 * page showed the order as Rejected and nothing else, at exactly the moment the reason decides what
 * they do next: order again without that dish, or give up and eat elsewhere.
 * </p>
 */

export type OrderClosure = {
  /** "Reject" or "Cancel". */
  action: string
  /** The restaurant's own wording, verbatim. Null when nobody recorded one. */
  reason: string | null
  /** True when the customer ended the order themselves. */
  endedByCustomer: boolean
  at: string
}

export type OrderClosureNotice = {
  heading: string
  /** The recorded reason, or null when there is none to show. */
  reason: string | null
  /** Shown in place of a reason, so an absent one is never mistaken for an unexplained refusal. */
  fallback: string | null
}

/**
 * Builds the notice, or null when the order was not closed.
 *
 * <p>
 * A customer who cancelled their own order is told so rather than being shown their own decision as
 * though the restaurant had made it — a small misattribution, but one that earns a phone call.
 * </p>
 */
export function buildOrderClosureNotice(closure: OrderClosure | null | undefined): OrderClosureNotice | null {
  if (!closure) {
    return null
  }

  const reason = closure.reason?.trim() ? closure.reason.trim() : null

  if (closure.endedByCustomer) {
    return {
      heading: 'You cancelled this order',
      reason,
      fallback: null,
    }
  }

  const heading = closure.action.toLowerCase() === 'reject'
    ? 'The restaurant could not take this order'
    : 'The restaurant cancelled this order'

  return {
    heading,
    reason,
    // Saying nothing would read as a refusal with no explanation at all, which is worse than
    // admitting none was recorded — and it tells the customer that asking is worth their time.
    fallback: reason ? null : 'No reason was given. Contact the restaurant if you need to know more.',
  }
}
