/**
 * How long the payment return page keeps asking Stripe before it stops and hands the question back
 * to the customer.
 *
 * <p>
 * The page used to try three times across four and a half seconds. A card payment that settles
 * through a webhook routinely takes longer than that, so a perfectly successful payment ran out of
 * attempts and the page sat on "Confirming payment" — spinner still turning — while the database,
 * My Orders and the admin views all said Paid. There was no refresh, no second look when the tab
 * came back, and no end: the spinner was the terminal state.
 * </p>
 *
 * <p>
 * The schedule below backs off rather than hammering: the first few seconds catch the common case,
 * and the rest waits out a slow webhook without making a request a second for a minute.
 * </p>
 */

/** Milliseconds to wait before each attempt. The first is immediate. */
export const confirmationDelaysMs = [0, 1_000, 2_000, 3_000, 5_000, 8_000, 10_000, 10_000, 10_000, 10_000]

/** Total time the page will spend waiting before it stops and offers a manual re-check. */
export const confirmationBudgetMs = confirmationDelaysMs.reduce((total, delay) => total + delay, 0)

/** Attempts made across that budget. */
export const confirmationAttempts = confirmationDelaysMs.length

/**
 * Whether asking again could ever produce a different answer.
 *
 * <p>
 * Every failure was treated as "not settled yet", so a session the server has never heard of was
 * retried for the full budget with the page still headed "Confirming payment". Nothing was
 * confirming: the answer had already arrived and was final. A progress affordance over a settled
 * error is the worst of both — the customer waits, and then is told something that was true from
 * the first attempt.
 * </p>
 *
 * <p>
 * A rejected id, an unknown session and one belonging to someone else are all statements about the
 * session rather than about the moment. Timeouts, rate limits and server faults are about the
 * moment, and those are worth the wait.
 * </p>
 */
export function isTerminalConfirmationFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status

  return typeof status === 'number' && terminalConfirmationStatuses.includes(status)
}

const terminalConfirmationStatuses = [
  400, // The id is not a Checkout Session id at all.
  403, // The session exists and is not this customer's to confirm.
  404, // No such session was ever created here.
  410, // It was, and has since been disposed of.
]

/**
 * How often the page looks again once the payment itself has settled.
 *
 * <p>
 * Confirming the payment used to end the page's curiosity: it reached "Payment confirmed" and never
 * looked again. But the payment settling is not the last thing that can happen to an order. Staff
 * can reject it seconds later — the kitchen is out of something, the restaurant is closing — and the
 * customer is left reading a green tick about food that is not coming, while the refund goes out to
 * an inbox they may not check for hours.
 * </p>
 *
 * <p>
 * A minute is slow enough to be nearly free and fast enough that nobody sits in front of a wrong
 * answer for long. It costs no Stripe round trip: a settled payment is answered from our own
 * records, and the only thing still moving is the order's status.
 * </p>
 */
export const settledRecheckIntervalMs = 60_000

/**
 * How long that goes on for.
 *
 * <p>
 * Bounded because the page is one people leave open — on a table, in a background tab, overnight.
 * Ten minutes covers the window in which a restaurant realistically turns an order away after
 * taking the money; past it, the refund email and My Orders are the ones telling the story, and a
 * tab left open until morning should not still be asking.
 * </p>
 */
export const settledRecheckWindowMs = 10 * 60_000

/**
 * Whether the page should keep looking.
 *
 * <p>
 * Only from 'confirmed': it is the one settled state that can still turn out to be the wrong story.
 * 'turnedAway' is final — the order is closed and the money is going back, and no further asking
 * changes that. The unsettled states have their own schedule above.
 * </p>
 */
export function shouldRecheckSettled(
  confirmation: string,
  elapsedMs: number,
): boolean {
  return confirmation === 'confirmed' && elapsedMs < settledRecheckWindowMs
}
