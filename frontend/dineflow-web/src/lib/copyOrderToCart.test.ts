import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomerOrder } from '@/api/auth'

const addCartItem = vi.fn()

vi.mock('@/api/carts', () => ({
  addCartItem: (...args: unknown[]) => addCartItem(...args),
}))

const { classifyCopyFailure, copyOrderIntoCart, describeCopyFailure, quantityInOrder } =
  await import('./copyOrderToCart')

/** The shape `cartRequest` rejects with. */
function httpError(status: number, body: Record<string, unknown> = {}) {
  return Object.assign(new Error(String(body.message ?? `HTTP ${status}`)), {
    status,
    code: body.code as string | undefined,
    details: body,
  })
}

function order(lines: { id: string; menuItemId: string | null; name: string; quantity: number }[]): CustomerOrder {
  return {
    id: 'order-1',
    orderItems: lines.map((line) => ({
      id: line.id,
      menuItemId: line.menuItemId,
      itemNameSnapshot: line.name,
      quantity: line.quantity,
      note: null,
      selectedOptions: [],
    })),
  } as unknown as CustomerOrder
}

describe('naming why a line could not be copied', () => {
  /**
   * The awkward one: the customer's own unpaid order reserves the stock, so "sold out" would be a
   * baffling thing to read about a dish that is sold out to nobody but themselves.
   */
  it('blames the order itself when it is the one holding the stock', () => {
    const failure = classifyCopyFailure(
      httpError(409, { code: 'insufficient_stock', remaining: 0 }),
      'Tandoori Platter',
      1,
    )

    expect(failure.reason).toBe('held_by_this_order')
    expect(describeCopyFailure(failure)).toContain('in this unpaid order')
  })

  it('calls it sold out when the order holds none of it', () => {
    const failure = classifyCopyFailure(
      httpError(409, { code: 'insufficient_stock', remaining: 0 }),
      'Daily Soup',
      0,
    )

    expect(failure.reason).toBe('sold_out')
    expect(describeCopyFailure(failure)).toContain('not enough left')
  })

  it('separates a dish taken off the menu from one that ran out', () => {
    const failure = classifyCopyFailure(
      httpError(409, { message: 'Menu item is unavailable, sold out, or belongs to another restaurant.' }),
      'House Kombucha',
      0,
    )

    expect(failure.reason).toBe('unavailable')
  })

  /** 400 is the menu asking for a choice this order never recorded — a size, a doneness. */
  it('sends the customer to the menu when a choice is now required', () => {
    const failure = classifyCopyFailure(httpError(400), 'Veg Fried Rice', 0)

    expect(failure.reason).toBe('needs_choices')
    expect(describeCopyFailure(failure)).toContain('add it from the menu')
  })

  it('falls back to something honest for anything else', () => {
    expect(classifyCopyFailure(httpError(500), 'Masala Chai', 0).reason).toBe('unknown')
    expect(classifyCopyFailure(new TypeError('offline'), 'Masala Chai', 0).reason).toBe('unknown')
  })
})

describe('counting what an order holds', () => {
  it('adds up every line of the same dish', () => {
    const o = order([
      { id: 'a', menuItemId: 'dish-1', name: 'Wings', quantity: 2 },
      { id: 'b', menuItemId: 'dish-1', name: 'Wings', quantity: 1 },
      { id: 'c', menuItemId: 'dish-2', name: 'Chai', quantity: 1 },
    ])

    expect(quantityInOrder(o, 'dish-1')).toBe(3)
    expect(quantityInOrder(o, 'dish-2')).toBe(1)
    expect(quantityInOrder(o, 'dish-3')).toBe(0)
    expect(quantityInOrder(o, null)).toBe(0)
  })
})

describe('copying an order into the cart', () => {
  beforeEach(() => {
    addCartItem.mockReset()
  })

  it('reports what went in and what did not', async () => {
    addCartItem
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(httpError(409, { code: 'insufficient_stock' }))

    const result = await copyOrderIntoCart(
      order([
        { id: 'a', menuItemId: 'dish-1', name: 'Chai', quantity: 1 },
        { id: 'b', menuItemId: 'dish-2', name: 'Tandoori Platter', quantity: 1 },
      ]),
      'cart-1',
      'token',
    )

    expect(result.addedCount).toBe(1)
    expect(result.failures).toEqual([{ itemName: 'Tandoori Platter', reason: 'held_by_this_order' }])
    expect(result.closedMessage).toBeNull()
  })

  /**
   * Every remaining line would fail identically, and a list of identical failures tells the
   * customer less than one sentence does.
   */
  it('stops at once when the restaurant has closed', async () => {
    addCartItem.mockRejectedValue(
      httpError(409, { message: 'Restaurant is outside opening hours.', reason: 'outside_opening_hours' }),
    )

    const result = await copyOrderIntoCart(
      order([
        { id: 'a', menuItemId: 'dish-1', name: 'Chai', quantity: 1 },
        { id: 'b', menuItemId: 'dish-2', name: 'Wings', quantity: 1 },
      ]),
      'cart-1',
      'token',
    )

    expect(result.closedMessage).toBe('Restaurant is outside opening hours.')
    expect(result.failures).toHaveLength(0)
    expect(addCartItem).toHaveBeenCalledTimes(1)
  })

  /** An unavailable dish is also a 409 — it must not be mistaken for the restaurant closing. */
  it('does not mistake an unavailable dish for a closed restaurant', async () => {
    addCartItem.mockRejectedValue(
      httpError(409, { message: 'Menu item is unavailable, sold out, or belongs to another restaurant.' }),
    )

    const result = await copyOrderIntoCart(
      order([{ id: 'a', menuItemId: 'dish-1', name: 'House Kombucha', quantity: 1 }]),
      'cart-1',
      'token',
    )

    expect(result.closedMessage).toBeNull()
    expect(result.failures[0].reason).toBe('unavailable')
  })

  it('carries the note and options across', async () => {
    addCartItem.mockResolvedValue({})
    const o = order([{ id: 'a', menuItemId: 'dish-1', name: 'Wings', quantity: 2 }])
    o.orderItems[0].note = 'No coriander'
    o.orderItems[0].selectedOptions = [
      { menuItemOptionId: 'opt-1' },
      { menuItemOptionId: null },
    ] as CustomerOrder['orderItems'][number]['selectedOptions']

    await copyOrderIntoCart(o, 'cart-1', 'token')

    expect(addCartItem).toHaveBeenCalledWith('cart-1', 'token', {
      menuItemId: 'dish-1',
      quantity: 2,
      note: 'No coriander',
      selectedOptionIds: ['opt-1'],
    })
  })

  it('treats a line whose dish no longer exists as unavailable', async () => {
    const result = await copyOrderIntoCart(
      order([{ id: 'a', menuItemId: null, name: 'Retired Special', quantity: 1 }]),
      'cart-1',
      'token',
    )

    expect(addCartItem).not.toHaveBeenCalled()
    expect(result.failures[0]).toEqual({ itemName: 'Retired Special', reason: 'unavailable' })
  })
})
