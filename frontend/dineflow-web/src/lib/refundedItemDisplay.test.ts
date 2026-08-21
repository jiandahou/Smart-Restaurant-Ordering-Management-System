import { describe, expect, it } from 'vitest'

import type { AdminOrderItem } from '../api/auth'
import { describeRefundedItem, isEntirelyRefunded, remainingItemCount } from './refundedItemDisplay'

function refunded(quantity: number, refundedQuantity: number): AdminOrderItem {
  return {
    id: 'line-1',
    itemNameSnapshot: 'Butter Chicken',
    quantity,
    refundedQuantity,
    selectedOptions: [],
  } as unknown as AdminOrderItem
}

/**
 * A refund is money leaving; the kitchen only ever saw the order. Refund one dish out of four and
 * the ticket still said four, so the dish nobody was paying for got made anyway.
 */
describe('a line that has been partly refunded', () => {
  it('leaves an untouched line alone', () => {
    const display = describeRefundedItem(refunded(3, 0))

    expect(display.remainingQuantity).toBe(3)
    expect(display.isFullyRefunded).toBe(false)
    expect(display.refundLabel).toBeNull()
  })

  /**
   * The distinction that matters: striking through "3 × Butter Chicken" when one was refunded
   * would have the kitchen make none of them, which is worse than making three.
   */
  it('shrinks rather than disappears when only some units were refunded', () => {
    const display = describeRefundedItem(refunded(3, 1))

    expect(display.remainingQuantity).toBe(2)
    expect(display.isFullyRefunded).toBe(false)
    expect(display.isPartiallyRefunded).toBe(true)
    expect(display.refundLabel).toBe('1 refunded')
  })

  it('is struck through once nothing is left to make', () => {
    const display = describeRefundedItem(refunded(2, 2))

    expect(display.remainingQuantity).toBe(0)
    expect(display.isFullyRefunded).toBe(true)
    expect(display.refundLabel).toContain('do not make')
  })

  /** Refund records can outrun the line; the kitchen still cannot make fewer than none. */
  it('never reports a negative amount left to make', () => {
    expect(describeRefundedItem(refunded(1, 5)).remainingQuantity).toBe(0)
  })
})

describe('what the kitchen still has to make', () => {
  it('counts only what is left', () => {
    const order = { items: [refunded(3, 1), refunded(2, 2), refunded(1, 0)] }

    expect(remainingItemCount(order)).toBe(3)
  })

  it('knows when a ticket is finished with', () => {
    expect(isEntirelyRefunded({ items: [refunded(2, 2), refunded(1, 1)] })).toBe(true)
    expect(isEntirelyRefunded({ items: [refunded(2, 2), refunded(1, 0)] })).toBe(false)
  })

  /** An order with no lines is not a finished ticket, it is an empty one. */
  it('does not call an empty order finished', () => {
    expect(isEntirelyRefunded({ items: [] })).toBe(false)
  })
})
