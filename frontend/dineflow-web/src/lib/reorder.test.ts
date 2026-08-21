import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomerOrder } from '@/api/auth'
import type { Cart } from '@/api/carts'

const addCartItem = vi.fn()
const clearCartItems = vi.fn()
const getCart = vi.fn()
const joinCart = vi.fn()

vi.mock('@/api/carts', () => ({
  addCartItem: (...args: unknown[]) => addCartItem(...args),
  clearCartItems: (...args: unknown[]) => clearCartItems(...args),
  getCart: (...args: unknown[]) => getCart(...args),
  joinCart: (...args: unknown[]) => joinCart(...args),
}))

const { findOpenCart, reorderIntoCart } = await import('./reorder')

const emptyCart = { id: 'cart-1', status: 'Active', items: [] } as unknown as Cart

/** An add that failed the way the server reports a dish that is gone, or one missing a choice. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status })
}

function orderWith(items: { menuItemId: string; name: string }[]): CustomerOrder {
  return {
    id: 'order-1',
    restaurantId: 'restaurant-1',
    orderType: 0,
    orderItems: items.map((item, index) => ({
      id: `line-${index}`,
      menuItemId: item.menuItemId,
      itemNameSnapshot: item.name,
      quantity: 1,
      note: null,
      selectedOptions: [],
    })),
  } as unknown as CustomerOrder
}

describe('reordering a past order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    joinCart.mockResolvedValue({ cart: emptyCart, participantToken: 'token', participantId: 'participant' })
    getCart.mockResolvedValue(emptyCart)
  })

  /**
   * The bug this guards: a restaurant adds a required option group after the order was placed, the
   * server answers 400 (choose something), and reorder counted that as "unavailable" — so a customer
   * was told their dish was gone while it sat on the menu in front of them.
   */
  it('reports an item needing a new choice separately from one that is gone', async () => {
    addCartItem
      .mockRejectedValueOnce(httpError(400))
      .mockRejectedValueOnce(httpError(409))

    const result = await reorderIntoCart(
      orderWith([
        { menuItemId: 'item-needs-choice', name: 'Veg Spring Rolls' },
        { menuItemId: 'item-gone', name: 'Retired Special' },
      ]),
      { identity: 'guest' },
    )

    expect(result.needsChoices).toEqual([{ menuItemId: 'item-needs-choice', name: 'Veg Spring Rolls' }])
    expect(result.skippedCount).toBe(1)
    expect(result.addedCount).toBe(0)
  })

  /**
   * Nothing was added, but there is somewhere to go: the caller opens that dish. Throwing here is
   * what produced the untrue "none of these are available".
   */
  it('does not fail the reorder when every failure was a missing choice', async () => {
    addCartItem.mockRejectedValue(httpError(400))

    await expect(
      reorderIntoCart(orderWith([{ menuItemId: 'item-1', name: 'Veg Spring Rolls' }]), { identity: 'guest' }),
    ).resolves.toMatchObject({ addedCount: 0, needsChoices: [{ menuItemId: 'item-1' }] })
  })

  it('still fails when nothing can be added and nothing can be chosen', async () => {
    addCartItem.mockRejectedValue(httpError(409))

    await expect(
      reorderIntoCart(orderWith([{ menuItemId: 'item-1', name: 'Retired Special' }]), { identity: 'guest' }),
    ).rejects.toThrow(/none of the items/i)
  })

  it('adds what it can and keeps the rest as choices to make', async () => {
    addCartItem
      .mockResolvedValueOnce(emptyCart)
      .mockRejectedValueOnce(httpError(400))

    const result = await reorderIntoCart(
      orderWith([
        { menuItemId: 'item-ok', name: 'Chicken Wings' },
        { menuItemId: 'item-needs-choice', name: 'Veg Spring Rolls' },
      ]),
      { identity: 'guest' },
    )

    expect(result.addedCount).toBe(1)
    expect(result.needsChoices.map((entry) => entry.menuItemId)).toEqual(['item-needs-choice'])
    expect(result.skippedCount).toBe(0)
  })
})

/**
 * A cart session is the only way back into a guest's cart. Reporting "no open cart" because the
 * server was restarting sent the reorder on to join a second one, leaving the customer's existing
 * cart stranded in the database with their items in it.
 */
describe('looking for a cart this browser already holds', () => {
  const storageKey = 'dineflow.customer-cart.restaurant:restaurant-1:takeaway'

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ cartId: 'cart-1', participantToken: 'token', participantId: 'participant' }),
    )
    joinCart.mockResolvedValue({ cart: emptyCart, participantToken: 'token', participantId: 'participant' })
  })

  it('raises a restarting server rather than calling the cart missing', async () => {
    getCart.mockRejectedValue(httpError(502))

    await expect(findOpenCart('restaurant-1', 'Takeaway')).rejects.toMatchObject({ status: 502 })
  })

  it('does not join a second cart while the server is unreachable', async () => {
    getCart.mockRejectedValue(httpError(503))

    await expect(
      reorderIntoCart(orderWith([{ menuItemId: 'item-1', name: 'Chicken Wings' }]), {
        identity: 'guest',
        // Matches the storage key seeded above; the fixture order is dine-in.
        orderType: 'Takeaway',
      }),
    ).rejects.toMatchObject({ status: 503 })
    expect(joinCart).not.toHaveBeenCalled()
    // The way back into the real cart is still here for the retry.
    expect(sessionStorage.getItem(storageKey)).not.toBeNull()
  })

  it('reports no open cart when the server says the cart is really gone', async () => {
    getCart.mockRejectedValue(httpError(404))

    await expect(findOpenCart('restaurant-1', 'Takeaway')).resolves.toBeNull()
  })

  it('returns the cart it found when the server answers normally', async () => {
    getCart.mockResolvedValue({ ...emptyCart, status: 'Active' })

    await expect(findOpenCart('restaurant-1', 'Takeaway')).resolves.toMatchObject({
      participantToken: 'token',
      participantId: 'participant',
    })
  })
})
