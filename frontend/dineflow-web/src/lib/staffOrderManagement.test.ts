import { describe, expect, it } from 'vitest'
import type { AdminOrder } from '@/api/auth'
import {
  canStaffProcessOrder,
  getStaffDestructiveActions,
  getStaffPaymentMessage,
  getStaffPaymentState,
  getStaffPrimaryAction,
  getStaffRecoveryAction,
  hasSafetyNote,
  isCarriedOverOrder,
  isStaffPaymentHold,
} from './staffOrderManagement'

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
      basePriceSnapshot: 24,
      unitPrice: 24,
            totalPrice: 24,
            refundedAmountCents: 0,
            refundableAmountCents: 2400,
            refundedQuantity: 0,
            refundableQuantity: 2,
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

/**
 * Putting a finished order back into service.
 *
 * <p>
 * The server offers <code>Reopen</code> on every terminal order and the screen offered it on none:
 * eighty-six closed cards, zero buttons. An order cancelled by mistake had no way back.
 * </p>
 */
describe('reopening a finished order', () => {
  const terminal = ['Completed', 'Cancelled', 'Rejected'] as const

  it.each(terminal)('offers it on a %s order the server will reopen', (status) => {
    expect(getStaffRecoveryAction(order({ status, availableActions: ['Reopen'] }))).toBe('Reopen')
  })

  /**
   * Whether an order may be reopened is the server's call — reopening a completed order needs the
   * payment to be settled, and it withholds the action when it is not. The screen follows that list
   * rather than keeping a second opinion that could disagree with it.
   */
  it.each(terminal)('offers nothing on a %s order the server withheld it from', (status) => {
    expect(getStaffRecoveryAction(order({ status, availableActions: [] }))).toBeNull()
  })

  it('offers nothing while the order is still running', () => {
    expect(getStaffRecoveryAction(order({ status: 'Preparing', availableActions: ['MarkReady', 'Cancel'] }))).toBeNull()
  })

  /** An order fetched without its actions is not an order with none — it says nothing either way. */
  it('offers nothing when the server said nothing', () => {
    expect(getStaffRecoveryAction(order({ status: 'Cancelled', availableActions: undefined }))).toBeNull()
  })

  /** Reopening is a correction, not the order's next step, so it stays out of the primary slot. */
  it('does not become the primary action', () => {
    const closed = order({ status: 'Cancelled', availableActions: ['Reopen'] })

    expect(getStaffPrimaryAction(closed)).toBeNull()
    expect(getStaffDestructiveActions(closed)).toEqual([])
    expect(getStaffRecoveryAction(closed)).toBe('Reopen')
  })
})
