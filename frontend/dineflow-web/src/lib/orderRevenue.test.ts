import { describe, expect, it } from 'vitest'

import type { AdminOrder } from '../api/auth'
import { isRevenueSettled, netRevenueOf, sumNetRevenue } from './orderRevenue'

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    paymentStatus: 'Paid',
    paymentMethod: 'Online',
    totalAmount: 26.61,
    latestPayment: { refundedAmountCents: 0 },
    ...overrides,
  } as unknown as AdminOrder
}

/**
 * Counts and revenue tested `paymentStatus === 'Paid'` exactly, so an order left both the moment any
 * money went back: refunding one dollar of a twenty-six dollar order removed the whole twenty-six
 * from the day's takings.
 */
describe('what an order contributed to the day', () => {
  it('counts an order that was paid for', () => {
    expect(netRevenueOf(order())).toBeCloseTo(26.61)
  })

  /** The bug, in one assertion. */
  it('nets a partial refund off instead of erasing the order', () => {
    const partial = order({
      paymentStatus: 'PartiallyRefunded',
      latestPayment: { refundedAmountCents: 100 } as AdminOrder['latestPayment'],
    })

    expect(netRevenueOf(partial)).toBeCloseTo(25.61)
  })

  it('leaves a fully refunded order contributing nothing', () => {
    const refunded = order({
      paymentStatus: 'Refunded',
      latestPayment: { refundedAmountCents: 2_661 } as AdminOrder['latestPayment'],
    })

    expect(netRevenueOf(refunded)).toBe(0)
    // Still settled: it happened, and it should not vanish from the record.
    expect(isRevenueSettled(refunded)).toBe(true)
  })

  /** Negative revenue is not a thing a day can have. */
  it('never goes below zero when more went back than came in', () => {
    const over = order({
      paymentStatus: 'Refunded',
      latestPayment: { refundedAmountCents: 5_000 } as AdminOrder['latestPayment'],
    })

    expect(netRevenueOf(over)).toBe(0)
  })

  it.each(['Unpaid', 'Pending', 'Failed', 'Cancelled', 'Expired', 'NotRequired'] as const)(
    'counts nothing for an order that never took the money (%s)',
    (paymentStatus) => {
      const unpaid = order({ paymentStatus: paymentStatus as AdminOrder['paymentStatus'] })

      expect(isRevenueSettled(unpaid)).toBe(false)
      expect(netRevenueOf(unpaid)).toBe(0)
    },
  )

  it('adds up across orders', () => {
    const total = sumNetRevenue([
      order(),
      order({ paymentStatus: 'PartiallyRefunded', latestPayment: { refundedAmountCents: 100 } as AdminOrder['latestPayment'] }),
      order({ paymentStatus: 'Unpaid' }),
    ])

    expect(total).toBeCloseTo(52.22)
  })
})
