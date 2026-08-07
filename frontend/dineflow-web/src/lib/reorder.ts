import { addCartItem, getCart, joinCart, type Cart } from '@/api/carts'
import type { CustomerOrder } from '@/api/auth'
import { normalizeCustomerMenuOrderType, type CustomerMenuOrderType } from '@/lib/customerMenuNavigation'

// Must match the session key scheme used by CustomerMenuPage's loadOrJoinCart:
//   `${cartSessionPrefix}.restaurant:${restaurantId}:${orderType.toLowerCase()}`
const cartSessionPrefix = 'dineflow.customer-cart'

export type ReorderResult = {
  restaurantId: string
  orderType: CustomerMenuOrderType
  cart: Cart
  addedCount: number
  skippedCount: number
}

/**
 * Re-adds every line of a past order into a fresh cart with the same ordering
 * mode for the same restaurant, then persists the cart session under the key CustomerMenuPage
 * reads, so navigating to `/r/{restaurantId}/menu` resumes this exact cart.
 *
 * Items that are unavailable, sold out, or whose menu item no longer exists are
 * skipped rather than failing the whole reorder.
 */
export async function reorderIntoCart(order: CustomerOrder): Promise<ReorderResult> {
  const restaurantId = order.restaurantId
  if (!restaurantId) {
    throw new Error('This order is not linked to a restaurant menu.')
  }

  const orderType = normalizeCustomerMenuOrderType(order.orderType)
  const joined = await joinCart({ restaurantId, orderType })
  let cart = joined.cart
  let addedCount = 0
  let skippedCount = 0

  for (const item of order.orderItems) {
    if (!item.menuItemId) {
      skippedCount += 1
      continue
    }

    const selectedOptionIds = item.selectedOptions
      .map((option) => option.menuItemOptionId)
      .filter((id): id is string => Boolean(id))

    try {
      cart = await addCartItem(cart.id, joined.participantToken, {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        ...(item.note ? { note: item.note } : {}),
        ...(selectedOptionIds.length > 0 ? { selectedOptionIds } : {}),
      })
      addedCount += 1
    } catch {
      skippedCount += 1
    }
  }

  if (addedCount === 0) {
    throw new Error('None of the items on this order are available to reorder right now.')
  }

  const storageKey = `${cartSessionPrefix}.restaurant:${restaurantId}:${orderType.toLowerCase()}`
  sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      cartId: cart.id,
      participantToken: joined.participantToken,
      participantId: joined.participantId,
    }),
  )

  // Refresh so the returned cart reflects any server-side line merging.
  try {
    cart = await getCart(cart.id, joined.participantToken)
  } catch {
    // Non-fatal: fall back to the cart we already have.
  }

  return { restaurantId, orderType, cart, addedCount, skippedCount }
}
