import type { AdminOrder } from '@/api/auth'
import {
  getStaffPaymentState,
  isStaffPaymentHold,
  type StaffPaymentState,
} from './staffOrderManagement'

export type FrontCounterQueue = 'ready' | 'paymentDue' | 'paymentIssue' | 'carried' | 'all'
export type FrontCounterOrderAction = 'recordPayment' | 'payAndComplete' | 'complete' | null

export function isFrontCounterCarriedOver(
  order: AdminOrder,
  businessDate: string | null,
  now = new Date(),
) {
  if (order.pickupDate && businessDate) {
    return order.pickupDate < businessDate
  }

  const createdAt = new Date(order.createdAt).getTime()
  return Number.isFinite(createdAt) && now.getTime() - createdAt >= 24 * 60 * 60 * 1_000
}

export function getFrontCounterOrderAction(order: AdminOrder): FrontCounterOrderAction {
  const paymentState = getStaffPaymentState(order)

  if (paymentState === 'counterDue') {
    return order.status === 'Ready' ? 'payAndComplete' : 'recordPayment'
  }

  if (paymentState === 'eligible' && order.status === 'Ready') {
    return 'complete'
  }

  return null
}

export function getFrontCounterActionLabel(order: AdminOrder) {
  const action = getFrontCounterOrderAction(order)
  if (action === 'recordPayment') return 'Record payment'
  if (action === 'payAndComplete') return 'Take payment & complete'
  if (action === 'complete') return 'Complete pickup'

  const paymentState = getStaffPaymentState(order)
  if (paymentState === 'refunded') return 'Fully refunded'
  if (isStaffPaymentHold(order)) return 'Payment issue'
  if (order.status !== 'Ready') return 'Waiting for kitchen'
  return 'No action available'
}

export function getFrontCounterBlockReason(order: AdminOrder) {
  const paymentState = getStaffPaymentState(order)
  if (paymentState === 'refunded') {
    return 'This order was fully refunded and cannot be charged or completed.'
  }

  if (paymentState === 'awaiting' || paymentState === 'failed') {
    return 'Resolve the online payment before completing pickup.'
  }

  if (paymentState === 'eligible' && order.status !== 'Ready') {
    return 'Payment is settled. Wait for the kitchen to mark this order Ready.'
  }

  return null
}

export function getFrontCounterAmountDue(order: AdminOrder) {
  return getStaffPaymentState(order) === 'counterDue' ? order.totalAmount : 0
}

export function matchesFrontCounterQueue(
  order: AdminOrder,
  queue: FrontCounterQueue,
  businessDate: string | null,
  now = new Date(),
) {
  const carriedOver = isFrontCounterCarriedOver(order, businessDate, now)
  const paymentState: StaffPaymentState = getStaffPaymentState(order)

  if (queue === 'carried') return carriedOver
  if (queue === 'paymentDue') return paymentState === 'counterDue'
  if (queue === 'paymentIssue') return isStaffPaymentHold(order)
  if (queue === 'ready') {
    return order.status === 'Ready'
      && (paymentState === 'eligible' || paymentState === 'counterDue')
  }

  return true
}

