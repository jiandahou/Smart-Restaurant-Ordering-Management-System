import type { AdminOrder } from '@/api/auth'
import { formatServiceCode } from './serviceCode'
import {
  getStaffPaymentState,
  isStaffPaymentHold,
  type StaffPaymentState,
} from './staffOrderManagement'

export type FrontCounterQueue = 'ready' | 'paymentDue' | 'paymentIssue' | 'carried' | 'all'
export type FrontCounterOrderAction =
  | 'recordPayment'
  | 'payAndComplete'
  | 'complete'
  | 'switchToCounter'
  | null

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

/**
 * Whether the till can rescue an order whose online payment never happened.
 *
 * <p>
 * The diner chose to pay online and did not: the tab closed, the phone died, or they simply changed
 * their mind on the way past the counter. The order is stuck — the kitchen is stopped on purpose
 * because the money is unresolved, and nothing at the counter is owed, because nothing is owed at
 * the till until the order says that is where it will be paid.
 * </p>
 *
 * <p>
 * Every condition here mirrors one the server enforces, deliberately rather than defensively. An
 * action that is always refused is worse than a missing one: someone takes the cash first and finds
 * out afterwards that the system will not record it.
 * </p>
 */
export function canSwitchToCounterPayment(order: AdminOrder) {
  // A live checkout session may be taking the money at this very second, and stepping in front of
  // it is how one dinner gets paid for twice.
  if (order.latestPayment?.status === 'Pending') return false

  // A shop that requires payment up front has decided it does not take money at the door.
  if (order.restaurantPaymentPolicy === 'PrepayRequired') return false

  if (order.status === 'Cancelled' || order.status === 'Rejected') return false

  const paymentState = getStaffPaymentState(order)
  return paymentState === 'awaiting' || paymentState === 'failed'
}

export function getFrontCounterOrderAction(order: AdminOrder): FrontCounterOrderAction {
  const paymentState = getStaffPaymentState(order)

  if (paymentState === 'counterDue') {
    return order.status === 'Ready' ? 'payAndComplete' : 'recordPayment'
  }

  if (paymentState === 'eligible' && order.status === 'Ready') {
    return 'complete'
  }

  if (canSwitchToCounterPayment(order)) {
    return 'switchToCounter'
  }

  return null
}

export function getFrontCounterActionLabel(order: AdminOrder) {
  const action = getFrontCounterOrderAction(order)
  if (action === 'recordPayment') return 'Record payment'
  if (action === 'payAndComplete') return 'Take payment & complete'
  if (action === 'complete') return 'Complete pickup'
  if (action === 'switchToCounter') return 'Take payment here instead'

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
    return canSwitchToCounterPayment(order)
      ? 'The online payment was never completed. Take payment here instead to release the kitchen.'
      : 'Resolve the online payment before completing pickup.'
  }

  if (paymentState === 'eligible' && order.status !== 'Ready') {
    return 'Payment is settled. Wait for the kitchen to mark this order Ready.'
  }

  return null
}

/** Only what deciding this needs, so a test does not have to build a whole table. */
export type SettleableTable = {
  activeSessionId: string | null
  activeOrders: AdminOrder[]
}

/**
 * Why this table cannot be closed yet, or null when it can.
 *
 * <p>
 * Ordered by what the person reading it can actually do. Asking about the kitchen first reads as
 * the natural order — an order that is not Ready is not ready — but an order held for payment is
 * stopped in the kitchen <em>because</em> the money is unresolved, so it will never reach Ready and
 * "wait for Ready" is advice that never comes true. The cashier goes to chase a kitchen that is
 * correctly doing nothing, while the guest stands at the counter holding the money.
 * </p>
 *
 * <p>
 * Which is why the payment states are asked about by name rather than by "no action is available".
 * A paid order still being cooked also has no counter action, and calling that a payment problem
 * would be the same mistake pointing the other way.
 * </p>
 */
export function getTableSettlementBlockReason(table: SettleableTable) {
  if (!table.activeSessionId || table.activeOrders.length === 0) {
    return 'This table has no active bill to settle.'
  }

  const held = table.activeOrders.find((order) => isStaffPaymentHold(order))
  if (held) {
    const code = formatServiceCode(held)
    if (getStaffPaymentState(held) === 'refunded') {
      return `${code} was fully refunded. Cancel it before closing the table.`
    }

    // Now that the till can rescue one of these, the sentence says what to do rather than only
    // what is wrong.
    return canSwitchToCounterPayment(held)
      ? `${code} never finished paying online. Take payment for it here, then close the table.`
      : `${code} is waiting on its online payment, which is what stopped the kitchen. `
        + 'It cannot reach Ready until that is resolved.'
  }

  if (table.activeOrders.some((order) => order.status !== 'Ready')) {
    return 'Every active order must be marked Ready before closing the table.'
  }

  if (table.activeOrders.some((order) => getFrontCounterOrderAction(order) === null)) {
    return 'Resolve refunded or online payment issues before closing the table.'
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

