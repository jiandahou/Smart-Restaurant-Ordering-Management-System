import { describe, expect, it } from 'vitest'
import type { AdminOrder, AdminPayment } from '@/api/auth'
import { getCounterReversalActions } from './counterReversalActions'

function payment(overrides: Partial<AdminPayment> = {}): AdminPayment {
  return {
    provider: 'CounterCash',
    status: 'Paid',
    refundCount: 0,
    refundableAmountCents: 2_500,
    refundedAmountCents: 0,
    ...overrides,
  } as AdminPayment
}

function order(latestPayment: AdminPayment | null): AdminOrder {
  return { id: 'order-1', latestPayment } as AdminOrder
}

describe('getCounterReversalActions', () => {
  /**
   * The bug this file exists for. A clean counter payment offered only "Void", which rewrites a
   * valid sale into a mistake and puts the order back to unpaid — so a cashier handing money back
   * across the counter had no way to record what actually happened, and the only button in front of
   * them wrote something false into the day's takings.
   */
  it('offers both ways of reversing a clean counter payment', () => {
    expect(getCounterReversalActions(order(payment()))).toEqual(['void', 'refund'])
  })

  /**
   * Once money has gone back, the payment is no longer untouched, and claiming it should never have
   * been taken would be rewriting history that already has a refund in it.
   */
  it('drops the void once anything has been refunded', () => {
    const partly = payment({
      status: 'PartiallyRefunded',
      refundCount: 1,
      refundableAmountCents: 1_500,
    })

    expect(getCounterReversalActions(order(partly))).toEqual(['refund'])
  })

  it('offers nothing once the whole payment has been refunded', () => {
    const spent = payment({
      status: 'Refunded',
      refundCount: 2,
      refundableAmountCents: 0,
    })

    expect(getCounterReversalActions(order(spent))).toEqual([])
  })

  /** A Stripe payment is reversed through Stripe, where it can actually be confirmed. */
  it('offers nothing for a payment the counter did not take', () => {
    expect(getCounterReversalActions(order(payment({ provider: 'Stripe' })))).toEqual([])
    expect(getCounterReversalActions(order(null))).toEqual([])
  })

  /**
   * A voided payment leaves the order unpaid, so there is no longer money at the counter to reverse.
   */
  it('offers nothing on an unpaid order', () => {
    expect(getCounterReversalActions(order(payment({ status: 'Cancelled' })))).toEqual([])
  })

  it('covers every counter provider', () => {
    for (const provider of ['Counter', 'CounterCash', 'CounterCard']) {
      expect(getCounterReversalActions(order(payment({ provider })))).toContain('refund')
    }
  })
})
