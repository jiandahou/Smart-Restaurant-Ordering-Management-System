import { describe, expect, it } from 'vitest'

import type { CustomerOrder } from '@/api/auth'
import { buildCheckoutViewFromOrder, isCheckoutReopenable } from './checkoutFromOrder'

function order(overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: 'order-1',
    restaurantId: 'restaurant-1',
    restaurantName: 'The DineFlow Kitchen',
    restaurantLegalBusinessName: 'DineFlow Kitchen Pty Ltd',
    restaurantAbn: '12345678901',
    restaurantGstRegistered: true,
    restaurantPricesIncludeGst: true,
    restaurantPaymentPolicy: 'PayAtCounterAllowed',
    restaurantOnlinePaymentsEnabled: false,
    restaurantRefundContactEmail: 'refunds@example.com',
    restaurantCustomerSurchargeNotice: null,
    tableId: null,
    tableNumber: null,
    customerId: null,
    orderNumber: 'ORD-1',
    currency: 'AUD',
    orderType: 1,
    status: 0,
    paymentStatus: 'Unpaid',
    paymentMethod: 'Online',
    totalAmount: 32,
    customerNote: null,
    scheduledTime: null,
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: null,
    orderItems: [
      {
        id: 'line-1',
        menuItemId: 'dish-1',
        itemNameSnapshot: 'Chicken Wings',
        quantity: 2,
        unitPrice: 16,
        note: 'No coriander',
        selectedOptions: [
          {
            id: 'opt-1',
            menuItemOptionId: 'mo-1',
            groupNameSnapshot: 'Sauce',
            optionNameSnapshot: 'Buffalo',
            priceAdjustmentSnapshot: 0,
          },
        ],
      },
    ],
    ...overrides,
  } as unknown as CustomerOrder
}

/**
 * Checkout used to read everything from the navigation state handed over at the end of a cart, so a
 * customer returning to an unpaid order could never get back to the screen where the payment
 * choices live.
 */
describe('reopening checkout from an order alone', () => {
  it('carries the supplier details a receipt needs', () => {
    const view = buildCheckoutViewFromOrder(order())

    expect(view.restaurantName).toBe('The DineFlow Kitchen')
    expect(view.restaurantLegalBusinessName).toBe('DineFlow Kitchen Pty Ltd')
    expect(view.restaurantAbn).toBe('12345678901')
    expect(view.gstRegistered).toBe(true)
    expect(view.pricesIncludeGst).toBe(true)
    expect(view.refundContactEmail).toBe('refunds@example.com')
  })

  /** Without these the page cannot know which payment buttons are real. */
  it('carries what the restaurant can actually accept', () => {
    const view = buildCheckoutViewFromOrder(order())

    expect(view.paymentPolicy).toBe('PayAtCounterAllowed')
    expect(view.onlinePaymentsEnabled).toBe(false)
  })

  it('rebuilds the line items the summary shows', () => {
    const view = buildCheckoutViewFromOrder(order())
    const line = view.order.orderItems[0]

    expect(line.itemNameSnapshot).toBe('Chicken Wings')
    expect(line.quantity).toBe(2)
    expect(line.totalPrice).toBe(32)
    expect(line.note).toBe('No coriander')
    expect(line.selectedOptions[0].optionNameSnapshot).toBe('Buffalo')
  })

  it('sends the back button to the menu the order came from', () => {
    expect(buildCheckoutViewFromOrder(order()).returnPath).toBe('/r/restaurant-1/menu?orderType=Takeaway')
  })

  it('falls back to my orders when the restaurant is gone', () => {
    expect(buildCheckoutViewFromOrder(order({ restaurantId: null })).returnPath).toBe('/my-orders')
  })

  /** A restaurant with no trading name should not leave the page saying "undefined". */
  it('survives missing supplier details', () => {
    const view = buildCheckoutViewFromOrder(
      order({ restaurantName: null, restaurantLegalBusinessName: null, restaurantRefundContactEmail: null }),
    )

    expect(view.restaurantName).toBe('This restaurant')
    expect(view.refundContactEmail).toBe('')
  })
})

/**
 * Reopening for an order that is paid, cancelled, or being charged would offer to take money for
 * something already settled or in flight.
 */
describe('deciding whether an order can be reopened', () => {
  it('reopens an order that still owes money', () => {
    expect(isCheckoutReopenable(order({ paymentStatus: 'Unpaid' }))).toBe(true)
    expect(isCheckoutReopenable(order({ paymentStatus: 'Failed' }))).toBe(true)
    expect(isCheckoutReopenable(order({ paymentStatus: 'Expired' }))).toBe(true)
  })

  /**
   * Cancelling the Stripe page leaves the order Pending or Cancelled. My Orders offered the payment
   * and this refused it, so the customer was told their order had already been handled.
   */
  it('reopens an order whose payment page was cancelled', () => {
    expect(isCheckoutReopenable(order({ paymentStatus: 'Cancelled' }))).toBe(true)
    expect(isCheckoutReopenable(order({ paymentStatus: 'Pending' }))).toBe(true)
  })

  it('refuses an order that is already paid', () => {
    expect(isCheckoutReopenable(order({ paymentStatus: 'Paid' }))).toBe(false)
  })

  it('refuses an order that is no longer open', () => {
    expect(isCheckoutReopenable(order({ status: 5 }))).toBe(false)
  })
})
