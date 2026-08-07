import { describe, expect, it } from 'vitest'
import { canCustomerCancelOrder } from './customerOrderCancellation'

describe('customer order cancellation', () => {
  it.each(['Unpaid', 'Failed', 'Expired', 'Cancelled', 'NotRequired'] as const)(
    'allows a pending order whose payment is %s',
    (paymentStatus) => {
      expect(canCustomerCancelOrder({ status: 0, paymentStatus })).toBe(true)
    },
  )

  it.each(['Pending', 'Paid', 'PartiallyRefunded', 'Refunded'] as const)(
    'blocks a pending order whose payment is %s',
    (paymentStatus) => {
      expect(canCustomerCancelOrder({ status: 0, paymentStatus })).toBe(false)
    },
  )

  it('blocks cancellation once the restaurant has accepted the order', () => {
    expect(canCustomerCancelOrder({ status: 1, paymentStatus: 'Unpaid' })).toBe(false)
  })
})
