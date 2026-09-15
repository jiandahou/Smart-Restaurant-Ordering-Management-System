/**
 * How long a refund request may sit before the queue stops reading as a queue.
 *
 * <p>
 * A refund is money the restaurant is holding that a customer has asked for back, and what decides
 * whether the screen is showing normal work or a problem is age, not count. Three requests filed
 * this afternoon on a busy Friday is a queue being worked. One filed on Tuesday and still sitting
 * on Thursday is somebody's money held with nobody looking.
 * </p>
 *
 * <p>
 * A day is the unit because a person waiting on their money counts in days, and because a
 * restaurant's own answer to "when will someone look at this" is the next time whoever can approve
 * it is at the counter — which is tomorrow, at worst.
 * </p>
 */
export const refundRequestOverdueMs = 24 * 60 * 60 * 1000

/**
 * What the operations bell should say about refund requests nobody has answered yet.
 *
 * <p>
 * Distinct from the per-order notice in <code>pendingRefundNotice</code>, which tells a kitchen
 * that the dish in front of them has a refund pending against it. This one is about the queue as a
 * whole, and is addressed to whoever can answer it.
 * </p>
 */
export type RefundQueueNotice = {
  severity: 'warning' | 'error'
  title: string
  message: string
}

function describeWait(waitedMs: number): string {
  const hours = Math.floor(waitedMs / (60 * 60 * 1000))

  if (hours < 1) return 'less than an hour'
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`

  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * Returns null when there is nothing waiting, so a quiet queue adds nothing to the bell — the point
 * of that list is that everything in it is something to act on.
 *
 * @param oldestCreatedAt when the longest-waiting request was filed; null when unknown, in which
 *   case the notice still appears and simply does not claim an age it cannot support.
 */
export function buildRefundQueueNotice(
  count: number,
  oldestCreatedAt: string | null,
  now: number = Date.now(),
): RefundQueueNotice | null {
  if (count <= 0) {
    return null
  }

  const oldest = oldestCreatedAt ? new Date(oldestCreatedAt).getTime() : Number.NaN
  // A clock skewed forward, or a request filed a moment ago, both read as no wait rather than as a
  // negative one.
  const waitedMs = Number.isNaN(oldest) ? null : Math.max(0, now - oldest)
  const isOverdue = waitedMs !== null && waitedMs >= refundRequestOverdueMs

  return {
    severity: isOverdue ? 'error' : 'warning',
    title: `${count} refund ${count === 1 ? 'request is' : 'requests are'} waiting`,
    message: waitedMs === null
      ? 'A customer has asked for money back and is waiting on a decision.'
      : isOverdue
        ? `The longest has been waiting ${describeWait(waitedMs)}. The customer has had no answer in that time.`
        : `The longest has been waiting ${describeWait(waitedMs)}.`,
  }
}
