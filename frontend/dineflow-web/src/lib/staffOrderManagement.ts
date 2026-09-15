import type {
  AdminOrder,
  AdminPaymentStatus,
  OrderTransitionAction,
} from '@/api/auth'

export type StaffPaymentState =
  | 'eligible'
  | 'counterDue'
  | 'awaiting'
  | 'failed'
  | 'refunded'
  | 'unsettledClosure'

const fulfillmentEligibleStatuses = new Set<AdminPaymentStatus>([
  'Paid',
  'PartiallyRefunded',
  'NotRequired',
])

const paymentAwaitingStatuses = new Set<AdminPaymentStatus>(['Pending', 'Unpaid'])
const paymentFailedStatuses = new Set<AdminPaymentStatus>(['Failed', 'Cancelled', 'Expired'])

const expectedNextAction: Partial<Record<AdminOrder['status'], OrderTransitionAction>> = {
  Pending: 'Accept',
  Accepted: 'StartPreparing',
  Preparing: 'MarkReady',
  Ready: 'Complete',
}

/**
 * An order the restaurant turned away that is still holding the customer's money.
 *
 * <p>
 * Two things produce it and both used to be silent. A refund can fail, and a payment can land after
 * the decision: cancelling asks Stripe to close the checkout page, that request can fail, and a
 * customer with the tab still open pays for an order that no longer exists.
 * </p>
 *
 * <p>
 * Checked before anything else, because every other reading of a paid order says the kitchen may
 * start — and this one is the opposite: the kitchen is already finished and it is the money that
 * needs a person.
 * </p>
 */
const moneyHoldingPaymentStatuses = new Set<AdminPaymentStatus>(['Paid', 'PartiallyRefunded'])

/**
 * Whether this order is still sitting on money the customer handed over.
 *
 * <p>
 * The payment is asked first, because it is where the money is. Asking only the order's own
 * <code>paymentStatus</code> — a summary of the payments kept beside them — meant that whenever the
 * two disagreed, the summary won and always in the same direction: an order reading Cancelled with
 * a succeeded charge against it was declared square, and the card that should have said "refund it"
 * said nothing at all.
 * </p>
 *
 * <p>
 * The status is still checked alongside the amount. <code>refundableAmountCents</code> is only
 * "charged less refunded" and is not itself told whether the charge ever went through, so an
 * expired checkout that took nothing would otherwise read as money owed — the same bug pointing the
 * other way.
 * </p>
 *
 * <p>
 * Only the latest payment reaches this screen, so an order paid across two of them is answered on
 * the newer one. The server sums all of them; this is the narrower view the card is given, and it
 * covers the case that actually happens — one charge, one order.
 * </p>
 */
function holdsCustomerMoney(order: AdminOrder) {
  const payment = order.latestPayment
  if (payment) {
    return moneyHoldingPaymentStatuses.has(payment.status) && payment.refundableAmountCents > 0
  }

  // No payment on the card to read, so the summary is the only thing that knows.
  return moneyHoldingPaymentStatuses.has(order.paymentStatus)
}

function isUnsettledClosure(order: AdminOrder) {
  return (
    (order.status === 'Cancelled' || order.status === 'Rejected') &&
    order.paymentMethod === 'Online' &&
    holdsCustomerMoney(order)
  )
}

export function getStaffPaymentState(order: AdminOrder): StaffPaymentState {
  if (isUnsettledClosure(order)) {
    return 'unsettledClosure'
  }

  if (order.paymentStatus === 'Refunded') {
    return 'refunded'
  }

  if (fulfillmentEligibleStatuses.has(order.paymentStatus)) {
    return 'eligible'
  }

  if (order.paymentMethod === 'PayAtCounter') {
    return 'counterDue'
  }

  if (paymentAwaitingStatuses.has(order.paymentStatus)) {
    return 'awaiting'
  }

  if (paymentFailedStatuses.has(order.paymentStatus)) {
    return 'failed'
  }

  return 'failed'
}

export function isStaffPaymentHold(order: AdminOrder) {
  const state = getStaffPaymentState(order)
  return (
    state === 'awaiting' ||
    state === 'failed' ||
    state === 'refunded' ||
    state === 'unsettledClosure'
  )
}

export function canStaffProcessOrder(order: AdminOrder) {
  const state = getStaffPaymentState(order)
  return state === 'eligible' || state === 'counterDue'
}

export function getStaffPaymentMessage(order: AdminOrder) {
  switch (getStaffPaymentState(order)) {
    case 'awaiting':
      return 'Awaiting online payment. Kitchen processing is paused.'
    case 'failed':
      return 'Online payment needs attention before kitchen processing.'
    case 'refunded':
      return order.status === 'Pending'
        ? 'Payment was fully refunded. Reject this order before fulfillment.'
        : 'Payment was fully refunded. Cancel this order before fulfillment.'
    case 'unsettledClosure':
      // Says what is true and what to do about it. The order is finished either way; the money is
      // the open question, and nothing else on this card raises it.
      return order.status === 'Rejected'
        ? 'This order was rejected but the customer has still paid. Refund it.'
        : 'This order was cancelled but the customer has still paid. Refund it.'
    default:
      return null
  }
}

export function getStaffPrimaryAction(order: AdminOrder) {
  const expected = expectedNextAction[order.status]
  return expected && (order.availableActions ?? []).includes(expected) ? expected : null
}

/**
 * Undoing a close.
 *
 * <p>
 * The server offers <code>Reopen</code> on every finished order — completed, cancelled and rejected
 * alike — and the screen offered it on none of them: eighty-six closed cards, not one button. An
 * order cancelled by mistake, or rejected before someone noticed the kitchen could take it after
 * all, had no way back from this screen at all.
 * </p>
 *
 * <p>
 * Kept apart from the primary action rather than folded into it. Reopening is a correction, not the
 * next step in the order's life, and a list of finished orders should not be a wall of buttons
 * inviting one.
 * </p>
 *
 * <p>
 * What may be reopened is the server's decision, read from <code>availableActions</code>. Reopening
 * an unpaid or refunded order is allowed there and lands it back in the payment queue, where the
 * kitchen leaves it alone until the money is settled — so there is no second opinion to add here.
 * </p>
 */
export function getStaffRecoveryAction(order: AdminOrder) {
  return (order.availableActions ?? []).includes('Reopen')
    ? ('Reopen' satisfies OrderTransitionAction)
    : null
}

export function getStaffDestructiveActions(order: AdminOrder) {
  const availableActions = order.availableActions ?? []

  if (order.status === 'Pending' && availableActions.includes('Reject')) {
    return ['Reject'] satisfies OrderTransitionAction[]
  }

  if (availableActions.includes('Cancel')) {
    return ['Cancel'] satisfies OrderTransitionAction[]
  }

  return [] satisfies OrderTransitionAction[]
}

export function isCarriedOverOrder(order: AdminOrder, now: Date, thresholdHours = 24) {
  if (['Completed', 'Cancelled', 'Rejected'].includes(order.status)) {
    return false
  }

  const createdAt = new Date(order.createdAt).getTime()
  if (!Number.isFinite(createdAt)) {
    return false
  }

  return now.getTime() - createdAt >= thresholdHours * 60 * 60 * 1_000
}

export function hasSafetyNote(order: AdminOrder) {
  const notes = [
    order.customerNote,
    ...order.items.map((item) => item.note),
  ].filter((note): note is string => Boolean(note?.trim()))

  return notes.some(isSafetyNoteText)
}

export function isSafetyNoteText(note?: string | null) {
  return Boolean(note && /\b(allerg(?:y|ic|en|ies)|anaphyla|coeliac|celiac|gluten[- ]free|peanut|tree nut|shellfish|dairy|sesame)\b/i.test(note))
}
