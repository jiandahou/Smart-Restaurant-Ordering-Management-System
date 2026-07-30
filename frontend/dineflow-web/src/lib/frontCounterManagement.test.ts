import { describe, expect, it } from 'vitest'
import type { AdminOrder } from '@/api/auth'
import {
  getFrontCounterAmountDue,
  getFrontCounterOrderAction,
  isFrontCounterCarriedOver,
  matchesFrontCounterQueue,
} from './frontCounterManagement'

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'order-1',
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
