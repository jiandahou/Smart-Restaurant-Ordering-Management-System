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

export function getStaffPaymentState(order: AdminOrder): StaffPaymentState {
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
  return state === 'awaiting' || state === 'failed' || state === 'refunded'
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
    default:
      return null
  }
}

export function getStaffPrimaryAction(order: AdminOrder) {
  const expected = expectedNextAction[order.status]
  return expected && (order.availableActions ?? []).includes(expected) ? expected : null
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
