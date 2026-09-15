import type { AdminOrder } from '@/api/auth'

/**
 * FS-017. `Pending` covers two situations that need opposite responses: before the money arrives
 * nobody in the kitchen has anything to do, and after it arrives the customer has paid and is
 * waiting on the restaurant. Only the second has a clock running on it.
 *
 * Thresholds mirror OrderAcceptancePolicy on the server so the screen, the customer's
 * cancellation right and the platform's reporting all describe the same order the same way.
 */
export const acceptanceWarningMs = 5 * 60 * 1000
export const acceptanceOverdueMs = 10 * 60 * 1000
export const customerCancellationMs = 20 * 60 * 1000

const settledPaymentStatuses = new Set(['Paid', 'PartiallyRefunded'])

export type AcceptanceUrgency = 'none' | 'waiting' | 'approaching' | 'overdue'

/** Money has settled and the restaurant has not accepted the order yet. */
export function isAwaitingAcceptance(order: Pick<AdminOrder, 'status' | 'paymentStatus'>): boolean {
  return order.status === 'Pending' && settledPaymentStatuses.has(order.paymentStatus)
}

/**
 * When the wait started. Falls back to when the order was raised: an order with no settlement
 * timestamp should still age rather than sit at zero forever.
 */
export function acceptanceClockStartedAt(order: AdminOrder): number {
  const paidAt = order.latestPayment?.paidAt
  return new Date(paidAt ?? order.createdAt).getTime()
}

export function acceptanceWaitMs(order: AdminOrder, now = Date.now()): number {
  return Math.max(0, now - acceptanceClockStartedAt(order))
}

export function acceptanceUrgency(order: AdminOrder, now = Date.now()): AcceptanceUrgency {
  if (!isAwaitingAcceptance(order)) {
    return 'none'
  }

  const waited = acceptanceWaitMs(order, now)
  if (waited >= acceptanceOverdueMs) return 'overdue'
  if (waited >= acceptanceWarningMs) return 'approaching'
  return 'waiting'
}

/** "4m", "12m", "1h 05m" — compact enough for a badge on a busy screen. */
export function formatWaitDuration(waitedMs: number): string {
  const totalMinutes = Math.floor(waitedMs / 60_000)

  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }

  const hours = Math.floor(totalMinutes / 60)
  return `${hours}h ${String(totalMinutes % 60).padStart(2, '0')}m`
}

/**
 * What the Pending badge should actually say. "Pending" alone is the whole problem: it reads the
 * same whether the kitchen must act now or has nothing to do.
 */
export function pendingStatusLabel(order: Pick<AdminOrder, 'status' | 'paymentStatus'>): string | null {
  if (order.status !== 'Pending') {
    return null
  }

  return isAwaitingAcceptance(order) ? 'Awaiting acceptance' : 'Awaiting payment'
}

/** Overdue first, then longest-waiting, so the screen orders itself by who has waited most. */
export function compareByAcceptanceUrgency(a: AdminOrder, b: AdminOrder, now = Date.now()): number {
  const aAwaiting = isAwaitingAcceptance(a)
  const bAwaiting = isAwaitingAcceptance(b)

  if (aAwaiting !== bAwaiting) {
    return aAwaiting ? -1 : 1
  }

  if (!aAwaiting) {
    return 0
  }

  return acceptanceWaitMs(b, now) - acceptanceWaitMs(a, now)
}
