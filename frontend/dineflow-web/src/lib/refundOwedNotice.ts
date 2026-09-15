import { formatMoney } from './formatMoney'

/**
 * How long money owed to a turned-away customer may sit before it stops reading as ordinary work.
 *
 * <p>
 * Shorter than the day allowed for a refund <em>request</em>, and deliberately. A request is a
 * customer who noticed and asked, so somebody already knows they are waiting. This is the other
 * case: the restaurant took the money and then cancelled the order, and the person owed it may have
 * no idea it was taken. Nobody is chasing it from their end, so the only clock is this one.
 * </p>
 *
 * <p>
 * A shift is the unit because that is how long it can plausibly be called "we are getting to it".
 * Past that, the money is being held rather than processed.
 * </p>
 */
export const refundOwedOverdueMs = 4 * 60 * 60 * 1000

export type RefundOwedNotice = {
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
 * What the operations bell should say about money owed to customers the restaurant turned away.
 *
 * <p>
 * The amount is named rather than only the count, because one order and forty are the same size of
 * problem on a badge and are not the same size of problem in the till. The count says how many
 * people are owed; the amount says how much of a hole it is.
 * </p>
 *
 * @param count how many turned-away orders are still holding money.
 * @param amountCents how much they are holding in total.
 * @param oldestTakenAt when the oldest of that money was charged; null when unknown, in which case
 *   the notice still appears and simply does not claim an age it cannot support.
 */
export function buildRefundOwedNotice(
  count: number,
  amountCents: number,
  oldestTakenAt: string | null,
  currency: string | null | undefined,
  now: number = Date.now(),
): RefundOwedNotice | null {
  if (count <= 0) {
    return null
  }

  const oldest = oldestTakenAt ? new Date(oldestTakenAt).getTime() : Number.NaN
  // A clock skewed forward, or a charge taken a moment ago, both read as no wait rather than as a
  // negative one.
  const waitedMs = Number.isNaN(oldest) ? null : Math.max(0, now - oldest)
  const isOverdue = waitedMs !== null && waitedMs >= refundOwedOverdueMs
  const total = formatMoney(Math.max(0, amountCents) / 100, currency)

  return {
    severity: isOverdue ? 'error' : 'warning',
    title: count === 1
      ? `${total} is owed back to a customer`
      : `${total} is owed back across ${count} orders`,
    message: waitedMs === null
      ? 'These orders were cancelled or rejected after the customer had paid, and the money has not gone back.'
      : `These orders were cancelled or rejected after the customer had paid. The oldest was charged ${describeWait(waitedMs)} ago and has not been refunded.`,
  }
}
