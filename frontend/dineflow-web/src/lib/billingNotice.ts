import type { RestaurantBillingStanding } from '../api/auth'

/**
 * How close the deadline has to be before the bell mentions it at all.
 *
 * <p>
 * The operations bell holds things somebody should do something about now. A deadline four weeks
 * out is not one of them, and putting it there teaches people that the bell contains items they can
 * safely leave — which is the habit that makes them leave the printer alert too.
 * </p>
 */
export const billingNoticeLeadTimeMs = 14 * 24 * 60 * 60 * 1000

/** Inside this, the countdown stops being a reminder and starts being the last warning. */
export const billingUrgentWithinMs = 3 * 24 * 60 * 60 * 1000

export type BillingNotice = {
  severity: 'warning' | 'error'
  title: string
  message: string
}

/**
 * Rounded down, never up. This is time before a deadline, and a number that overstates it is a
 * number that costs somebody the day they thought they had.
 */
function describeRemaining(remainingMs: number): string {
  const hours = Math.floor(remainingMs / (60 * 60 * 1000))

  if (hours <= 1) return 'less than an hour'
  if (hours < 48) return `${hours} hours`

  return `${Math.floor(hours / 24)} days`
}

/**
 * What the operations bell should say about the platform account.
 *
 * <p>
 * Returns null when there is nothing to act on: nothing is owed, it is paid, or the deadline is far
 * enough away that saying so is noise. Counts towards <code>suspendsAt</code> rather than the month
 * mark, because that is the moment ordering actually stops — a countdown that reaches zero hours
 * before anything happens reads as broken the first time and as one to ignore every time after.
 * </p>
 */
export function buildBillingNotice(
  billing: RestaurantBillingStanding | null | undefined,
  restaurantName: string | null,
  now: number = Date.now(),
): BillingNotice | null {
  if (!billing || billing.standing === 'NotBilled' || billing.standing === 'Current') {
    return null
  }

  const prefix = restaurantName ? `${restaurantName}: ` : ''

  if (billing.standing === 'Suspended') {
    return {
      severity: 'error',
      title: `${prefix}online ordering is paused`,
      message:
        'Customers cannot order online until the platform account is settled. Your orders, '
        + 'history and settings are untouched, and paying reopens ordering straight away.',
    }
  }

  const suspendsAt = billing.suspendsAt ? new Date(billing.suspendsAt).getTime() : Number.NaN
  if (Number.isNaN(suspendsAt)) {
    // Behind with no date attached: worth saying once, without inventing a deadline.
    return {
      severity: 'warning',
      title: `${prefix}platform account is unpaid`,
      message: 'Settle it to keep online ordering available.',
    }
  }

  // A clock running backwards would mean the deadline passed without the standing catching up.
  // Treat that as no time left rather than as a negative countdown.
  const remainingMs = Math.max(0, suspendsAt - now)
  if (remainingMs > billingNoticeLeadTimeMs) {
    return null
  }

  return {
    severity: remainingMs <= billingUrgentWithinMs ? 'error' : 'warning',
    title: `${prefix}online ordering stops in ${describeRemaining(remainingMs)}`,
    message: 'The platform account is unpaid. Settling it stops the countdown.',
  }
}
