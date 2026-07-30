import { describe, expect, it } from 'vitest'
import type { AdminOrder } from '@/api/auth'
import {
  canStaffProcessOrder,
  getStaffDestructiveActions,
  getStaffPaymentMessage,
  getStaffPaymentState,
  getStaffPrimaryAction,
  hasSafetyNote,
  isCarriedOverOrder,
  isStaffPaymentHold,
} from './staffOrderManagement'

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
    pickupDate: null,
    pickupNumber: 42,
    pickupCode: '#042',
    tableSessionId: null,
    orderType: 'Takeaway',
    status: 'Pending',
    paymentStatus: 'Paid',
    paymentMethod: 'Online',
    canProcess: true,
    availableActions: ['Accept', 'MarkReady', 'Complete', 'Reject', 'Cancel'],
    totalAmount: 24,
    customerNote: null,
    scheduledTime: null,
    createdAt: '2026-07-29T01:00:00.000Z',
    updatedAt: null,
    paymentAttempts: 1,
    latestPayment: null,
    items: [{
      id: 'item-1',
      menuItemId: 'menu-1',
      itemNameSnapshot: 'Market Arancini',
      quantity: 1,
      unitPrice: 24,
      totalPrice: 24,
      note: null,
      selectedOptions: [],
    }],
    ...overrides,
  }
}

describe('staff order management helpers', () => {
  it('treats partial refunds and no-payment orders as fulfillment eligible', () => {
    for (const paymentStatus of ['Paid', 'PartiallyRefunded', 'NotRequired'] as const) {
      const value = order({ paymentStatus })
      expect(getStaffPaymentState(value)).toBe('eligible')
      expect(canStaffProcessOrder(value)).toBe(true)
      expect(isStaffPaymentHold(value)).toBe(false)
    }
  })

  it('separates awaiting, failed, and refunded online payments', () => {
    expect(getStaffPaymentState(order({ paymentStatus: 'Pending' }))).toBe('awaiting')
    expect(getStaffPaymentState(order({ paymentStatus: 'Expired' }))).toBe('failed')
    expect(getStaffPaymentState(order({ paymentStatus: 'Refunded' }))).toBe('refunded')
    expect(getStaffPaymentMessage(order({ paymentStatus: 'Refunded' }))).toMatch(/fully refunded/i)
    expect(canStaffProcessOrder(order({
      paymentMethod: 'PayAtCounter',
      paymentStatus: 'Refunded',
    }))).toBe(false)
  })

  it('allows counter-due orders to continue through the kitchen', () => {
    const value = order({
      paymentMethod: 'PayAtCounter',
      paymentStatus: 'Unpaid',
    })
    expect(getStaffPaymentState(value)).toBe('counterDue')
    expect(canStaffProcessOrder(value)).toBe(true)
  })

  it('selects only the expected progressive workflow action', () => {
    expect(getStaffPrimaryAction(order())).toBe('Accept')
    expect(getStaffDestructiveActions(order())).toEqual(['Reject'])
    expect(getStaffPrimaryAction(order({
      status: 'Preparing',
      availableActions: ['MarkReady', 'Cancel'],
    }))).toBe('MarkReady')
    expect(getStaffDestructiveActions(order({
      status: 'Preparing',
      availableActions: ['Reject', 'Cancel'],
    }))).toEqual(['Cancel'])
  })

  it('detects carried-over active orders and allergy notes', () => {
    const now = new Date('2026-07-30T03:00:00.000Z')
    expect(isCarriedOverOrder(order(), now)).toBe(true)
    expect(isCarriedOverOrder(order({ status: 'Completed' }), now)).toBe(false)
    expect(hasSafetyNote(order({ customerNote: 'Tree nut allergy' }))).toBe(true)
    expect(hasSafetyNote(order({ customerNote: 'Extra napkins' }))).toBe(false)
  })
})
