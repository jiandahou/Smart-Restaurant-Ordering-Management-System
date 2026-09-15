import { describe, expect, it } from 'vitest'

import type { CustomerOrder } from '@/api/auth'
import { describeRemaining, findUnpaidOrderToPrompt, isAwaitingPayment } from './unpaidOrderPrompt'

const now = new Date('2026-08-12T10:00:00Z')

function order(overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: 'order-1',
    restaurantId: 'restaurant-1',
    orderNumber: 'ORD-1',
    status: 0,
    paymentStatus: 'Unpaid',
    paymentMethod: 'Online',
    totalAmount: 25,
    createdAt: '2026-08-12T09:45:00Z',
    unpaidExpiresAt: '2026-08-12T10:05:00Z',
    orderItems: [],
    ...overrides,
  } as unknown as CustomerOrder
}

describe('spotting an order that is still waiting to be paid', () => {
  it('recognises a placed, unpaid order', () => {
    expect(isAwaitingPayment(order())).toBe(true)
    expect(isAwaitingPayment(order({ paymentStatus: 'Failed' }))).toBe(true)
    expect(isAwaitingPayment(order({ paymentStatus: 'Expired' }))).toBe(true)
  })

  it('ignores an order that is already paid', () => {
    expect(isAwaitingPayment(order({ paymentStatus: 'Paid', unpaidExpiresAt: null }))).toBe(false)
  })

  /**
   * The server sends no deadline while a checkout session is live. Prompting then would interrupt
   * somebody who is on the card form in another tab, and offer to cancel what they are paying for.
   */
  it('ignores an order with a payment in flight', () => {
    expect(isAwaitingPayment(order({ paymentStatus: 'Pending', unpaidExpiresAt: null }))).toBe(false)
  })

  it('ignores an order that is no longer pending', () => {
    expect(isAwaitingPayment(order({ status: 5 }))).toBe(false)
  })
})

describe('choosing which unpaid order to prompt about', () => {
  it('prompts about an unpaid order for this restaurant', () => {
    const result = findUnpaidOrderToPrompt([order()], 'restaurant-1', now)

    expect(result?.order.orderNumber).toBe('ORD-1')
    expect(result?.remainingMs).toBe(5 * 60_000)
  })

  /** Somebody else's restaurant is not this menu's problem. */
  it('ignores orders from another restaurant', () => {
    expect(findUnpaidOrderToPrompt([order({ restaurantId: 'restaurant-2' })], 'restaurant-1', now)).toBeNull()
  })

  it('picks the one closest to expiring when there are several', () => {
    const result = findUnpaidOrderToPrompt(
      [
        order({ id: 'later', orderNumber: 'ORD-LATER', unpaidExpiresAt: '2026-08-12T10:12:00Z' }),
        order({ id: 'sooner', orderNumber: 'ORD-SOONER', unpaidExpiresAt: '2026-08-12T10:03:00Z' }),
      ],
      'restaurant-1',
      now,
    )

    expect(result?.order.orderNumber).toBe('ORD-SOONER')
  })

  /**
   * The sweep is about to take it. Offering "continue payment" here would send the customer to a
   * checkout for an order that is being released underneath them.
   */
  it('does not prompt about an order whose deadline has already passed', () => {
    expect(
      findUnpaidOrderToPrompt([order({ unpaidExpiresAt: '2026-08-12T09:59:00Z' })], 'restaurant-1', now),
    ).toBeNull()
  })

  it('survives a deadline the server could not express', () => {
    expect(findUnpaidOrderToPrompt([order({ unpaidExpiresAt: 'not-a-date' })], 'restaurant-1', now)).toBeNull()
    expect(findUnpaidOrderToPrompt([], 'restaurant-1', now)).toBeNull()
  })
})

describe('telling the customer how long is left', () => {
  it('rounds up so the number never reads as less than they have', () => {
    expect(describeRemaining(20 * 60_000)).toBe('20 minutes')
    expect(describeRemaining(8.2 * 60_000)).toBe('9 minutes')
  })

  it('avoids saying "1 minutes"', () => {
    expect(describeRemaining(45_000)).toBe('under a minute')
    expect(describeRemaining(60_000)).toBe('under a minute')
  })

  it('says nothing is left rather than a negative number', () => {
    expect(describeRemaining(0)).toBe('no time')
    expect(describeRemaining(-5_000)).toBe('no time')
  })
})

/**
 * A counter order is Unpaid by design: the customer chose to settle at the till and the kitchen may
 * already be cooking. Prompting them to finish paying contradicts the choice they just made, and
 * offers to cancel a meal that is on its way.
 */
describe('leaving counter orders alone', () => {
  it('does not prompt about an order being paid for at the counter', () => {
    expect(isAwaitingPayment(order({ paymentMethod: 'PayAtCounter' }))).toBe(false)
  })

  it('still prompts about an online order that has not been paid', () => {
    expect(isAwaitingPayment(order({ paymentMethod: 'Online' }))).toBe(true)
  })

  it('keeps counter orders out of the prompt entirely', () => {
    expect(
      findUnpaidOrderToPrompt([order({ paymentMethod: 'PayAtCounter' })], 'restaurant-1', now),
    ).toBeNull()
  })
})
