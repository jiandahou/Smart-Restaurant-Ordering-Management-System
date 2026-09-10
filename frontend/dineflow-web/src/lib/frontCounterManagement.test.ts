import { describe, expect, it } from 'vitest'
import type { AdminOrder } from '@/api/auth'
import {
  getFrontCounterAmountDue,
  canSwitchToCounterPayment,
  getFrontCounterActionLabel,
  getFrontCounterBlockReason,
  getFrontCounterOrderAction,
  getTableSettlementBlockReason,
  isFrontCounterCarriedOver,
  matchesFrontCounterQueue,
} from './frontCounterManagement'

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'order-1',
    pendingRefundRequest: null,
    restaurantId: 'restaurant-1',
    restaurantName: 'Central Market Table',
    currency: 'AUD',
    tableId: null,
    tableNumber: null,
    customerId: null,
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    orderNumber: 'ORD-1',
    pickupDate: '2026-07-29',
    pickupNumber: 42,
    pickupCode: '#042',
    tableSessionId: null,
    orderType: 'Takeaway',
    status: 'Ready',
    paymentStatus: 'Unpaid',
    paymentMethod: 'PayAtCounter',
    canProcess: true,
    availableActions: ['Complete'],
    totalAmount: 24,
    customerNote: null,
    scheduledTime: null,
    createdAt: '2026-07-29T01:00:00.000Z',
    updatedAt: null,
    paymentAttempts: 0,
    latestPayment: null,
    items: [],
    ...overrides,
  }
}

describe('front counter management', () => {
  it('separates payment recording from completion', () => {
    expect(getFrontCounterOrderAction(order({ status: 'Pending' }))).toBe('recordPayment')
    expect(getFrontCounterOrderAction(order())).toBe('payAndComplete')
    expect(getFrontCounterOrderAction(order({
      paymentMethod: 'Online',
      paymentStatus: 'PartiallyRefunded',
    }))).toBe('complete')
  })

  it('never charges refunded or settled orders again', () => {
    expect(getFrontCounterOrderAction(order({ paymentStatus: 'Refunded' }))).toBeNull()
    expect(getFrontCounterAmountDue(order({ paymentStatus: 'Refunded' }))).toBe(0)
    expect(getFrontCounterAmountDue(order({ paymentStatus: 'PartiallyRefunded' }))).toBe(0)
  })

  it('classifies ready, payment issue, and carried-over queues', () => {
    const now = new Date('2026-07-29T03:00:00.000Z')
    expect(matchesFrontCounterQueue(order(), 'ready', '2026-07-29', now)).toBe(true)
    expect(matchesFrontCounterQueue(order({
      paymentMethod: 'Online',
      paymentStatus: 'Pending',
    }), 'paymentIssue', '2026-07-29', now)).toBe(true)
    expect(isFrontCounterCarriedOver(order({
      pickupDate: '2026-07-28',
    }), '2026-07-29', now)).toBe(true)
  })
})

describe('getTableSettlementBlockReason', () => {
  function table(activeOrders: AdminOrder[]) {
    return { activeSessionId: 'session-1', activeOrders }
  }

  /**
   * The bug this covers. A dine-in guest who left the online payment unfinished leaves an order the
   * kitchen is forbidden to touch, so it can never be marked Ready — and the counter told the
   * cashier to go and get it marked Ready. The one thing that was actually wrong went unmentioned.
   */
  it('names the payment hold rather than the kitchen it is holding up', () => {
    const held = order({
      status: 'Pending',
      orderType: 'DineIn',
      tableNumber: 'T3',
      pickupNumber: 19,
      paymentMethod: 'Online',
      paymentStatus: 'Unpaid',
    })

    const reason = getTableSettlementBlockReason(table([held]))

    expect(reason).toContain('T3-019')
    expect(reason).toMatch(/paying online/i)
    expect(reason).not.toMatch(/marked Ready/i)
  })

  /**
   * The mirror of it: a paid order the kitchen is still cooking has no counter action either, and
   * calling that a payment problem would send the cashier to the till instead of the pass.
   */
  it('still points at the kitchen when the money is settled', () => {
    const cooking = order({
      status: 'Preparing',
      paymentMethod: 'Online',
      paymentStatus: 'Paid',
    })

    expect(getTableSettlementBlockReason(table([cooking])))
      .toBe('Every active order must be marked Ready before closing the table.')
  })

  /** A counter order that has not been paid yet is not a hold: the cashier takes the money here. */
  it('does not treat cash owed at the till as a payment problem', () => {
    const owed = order({ status: 'Accepted', paymentMethod: 'PayAtCounter', paymentStatus: 'Unpaid' })

    expect(getTableSettlementBlockReason(table([owed])))
      .toBe('Every active order must be marked Ready before closing the table.')
  })

  /** A refunded order cannot be charged or completed, so it has to leave before the table closes. */
  it('says to cancel a refunded order', () => {
    const refunded = order({ status: 'Ready', paymentStatus: 'Refunded' })

    expect(getTableSettlementBlockReason(table([refunded])))
      .toMatch(/fully refunded\. Cancel it/i)
  })

  /** The payment hold is reported even when it is not the order the eye lands on first. */
  it('finds a held order behind ones that are fine', () => {
    const ready = order({ status: 'Ready', paymentMethod: 'Online', paymentStatus: 'Paid' })
    const held = order({ status: 'Pending', paymentMethod: 'Online', paymentStatus: 'Failed' })

    expect(getTableSettlementBlockReason(table([ready, held])))
      .toMatch(/paying online/i)
  })

  it('lets a table close once every order is Ready and settled', () => {
    const settled = order({ status: 'Ready', paymentMethod: 'Online', paymentStatus: 'Paid' })

    expect(getTableSettlementBlockReason(table([settled]))).toBeNull()
  })

  it('has nothing to say about a table with no bill', () => {
    expect(getTableSettlementBlockReason({ activeSessionId: null, activeOrders: [] }))
      .toBe('This table has no active bill to settle.')
    expect(getTableSettlementBlockReason(table([])))
      .toBe('This table has no active bill to settle.')
  })
})

describe('rescuing an order whose online payment never happened', () => {
  function abandoned(overrides: Partial<AdminOrder> = {}): AdminOrder {
    return order({
      status: 'Pending',
      paymentMethod: 'Online',
      paymentStatus: 'Unpaid',
      restaurantPaymentPolicy: 'PayAtCounterAllowed',
      latestPayment: null,
      ...overrides,
    })
  }

  /**
   * The diner chose to pay online, never did, and walked up to the counter with cash. The order is
   * stuck: the kitchen is stopped because the money is unresolved, and the till is owed nothing,
   * because nothing is owed at the till until the order says that is where it will be paid.
   */
  it('offers the till as the way out', () => {
    expect(getFrontCounterOrderAction(abandoned())).toBe('switchToCounter')
    expect(getFrontCounterActionLabel(abandoned())).toBe('Take payment here instead')
  })

  it('covers a card that was attempted and failed', () => {
    expect(canSwitchToCounterPayment(abandoned({ paymentStatus: 'Failed' }))).toBe(true)
    expect(canSwitchToCounterPayment(abandoned({ paymentStatus: 'Expired' }))).toBe(true)
  })

  /**
   * The refusal that protects money: a checkout still running may be taking payment at this very
   * second, and stepping in front of it is how one dinner gets paid for twice.
   */
  it('will not step in front of a checkout that is still running', () => {
    const midCheckout = abandoned({
      latestPayment: { status: 'Pending', refundableAmountCents: 0 } as AdminOrder['latestPayment'],
    })

    expect(canSwitchToCounterPayment(midCheckout)).toBe(false)
    expect(getFrontCounterOrderAction(midCheckout)).toBeNull()
  })

  /** A shop that requires payment up front has decided it does not take money at the door. */
  it('respects a restaurant that does not take money at the counter', () => {
    expect(canSwitchToCounterPayment(abandoned({ restaurantPaymentPolicy: 'PrepayRequired' })))
      .toBe(false)
  })

  it('has nothing to offer on an order that is already closed', () => {
    expect(canSwitchToCounterPayment(abandoned({ status: 'Cancelled' }))).toBe(false)
    expect(canSwitchToCounterPayment(abandoned({ status: 'Rejected' }))).toBe(false)
  })

  it('does not touch money that has already been taken', () => {
    expect(canSwitchToCounterPayment(abandoned({ paymentStatus: 'Paid' }))).toBe(false)
    expect(canSwitchToCounterPayment(abandoned({ paymentStatus: 'Refunded' }))).toBe(false)
  })

  /** The explanations stop describing a dead end and start naming the way out. */
  it('tells the cashier what to do rather than only what is wrong', () => {
    expect(getFrontCounterBlockReason(abandoned())).toMatch(/Take payment here instead/i)

    const table = { activeSessionId: 'session-1', activeOrders: [abandoned({ tableNumber: 'T3', pickupNumber: 19 })] }
    expect(getTableSettlementBlockReason(table)).toMatch(/T3-019 never finished paying online/i)
  })

  /** And where it truly is a dead end, it still says so. */
  it('keeps the old sentence when the till cannot help', () => {
    const stuck = abandoned({
      tableNumber: 'T3',
      pickupNumber: 19,
      restaurantPaymentPolicy: 'PrepayRequired',
    })

    expect(getTableSettlementBlockReason({ activeSessionId: 'session-1', activeOrders: [stuck] }))
      .toMatch(/cannot reach Ready/i)
  })
})
