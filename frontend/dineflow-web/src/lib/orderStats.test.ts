import { describe, expect, it } from 'vitest'
import type { AdminOrder } from '../api/auth'
import { isOrderPayable } from './orderStats'

function createOrder(overrides: Partial<AdminOrder>): AdminOrder {
  return {
    id: 'order-1',
    restaurantId: 'restaurant-1',
    restaurantName: 'Central Market Table',
    orderNumber: 'ORD-1001',
    pickupDate: null,
    pickupNumber: null,
    pickupCode: '0001',
    tableSessionId: null,
    customerId: null,
    customerName: null,
    customerEmail: null,
    tableId: null,
    tableNumber: null,
    orderType: 'Takeaway',
    status: 'Pending',
    paymentMethod: 'Online',
    paymentStatus: 'Unpaid',
    paymentAttempts: 0,
    canProcess: true,
    totalAmount: 20,
    currency: 'aud',
    customerNote: null,
    scheduledTime: null,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: null,
    items: [],
    availableActions: [],
    latestPayment: null,
    ...overrides,
  }
}

describe('payment eligibility', () => {
  it('excludes pay-at-counter orders from Stripe Checkout', () => {
    expect(isOrderPayable(createOrder({ paymentMethod: 'PayAtCounter' }))).toBe(false)
  })

  it('allows an unpaid active online order', () => {
    expect(isOrderPayable(createOrder({ paymentMethod: 'Online', paymentStatus: 'Unpaid' }))).toBe(true)
  })

  it('excludes paid and cancelled online orders', () => {
    expect(isOrderPayable(createOrder({ paymentStatus: 'Paid' }))).toBe(false)
    expect(isOrderPayable(createOrder({ status: 'Cancelled' }))).toBe(false)
  })

  it('never offers checkout on money that already moved', () => {
    // These used to slip through the old deny-list and rendered a Checkout button the backend
    // then refused.
    expect(isOrderPayable(createOrder({ paymentStatus: 'Refunded' }))).toBe(false)
    expect(isOrderPayable(createOrder({ paymentStatus: 'PartiallyRefunded' }))).toBe(false)
    expect(isOrderPayable(createOrder({ paymentStatus: 'NotRequired' }))).toBe(false)
  })

  it('allows the recoverable online payment states', () => {
    for (const paymentStatus of ['Pending', 'Unpaid', 'Failed', 'Cancelled', 'Expired'] as const) {
      expect(isOrderPayable(createOrder({ paymentStatus }))).toBe(true)
    }
  })
})
