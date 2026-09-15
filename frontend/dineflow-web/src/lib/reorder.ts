import { addCartItem, clearCartItems, getCart, joinCart, type Cart } from '@/api/carts'
import type { CustomerOrder } from '@/api/auth'
import { normalizeCustomerMenuOrderType, type CustomerMenuOrderType } from '@/lib/customerMenuNavigation'
import { cartSessionIsGone } from '@/lib/cartSessionRecovery'

// Must match the session key scheme used by CustomerMenuPage's loadOrJoinCart:
//   `${cartSessionPrefix}.restaurant:${restaurantId}:${orderType.toLowerCase()}`
const cartSessionPrefix = 'dineflow.customer-cart'

export type ReorderResult = {
  restaurantId: string
  orderType: CustomerMenuOrderType
  cart: Cart
  addedCount: number
  skippedCount: number
  /**
   * Items the menu now needs fresh choices for.
   *
   * <p>
   * A restaurant can add a required option group after an order was placed — a size, a doneness —
   * and the old order recorded no answer for it. Those lines are not unavailable, they are
   * incomplete, and the difference matters: telling somebody their favourite dish is unavailable
   * when it is on the menu in front of them is simply wrong. The server already separates the two,
   * answering 409 for gone and 400 for needs-choices.
   * </p>
   */
  needsChoices: { menuItemId: string; name: string }[]
  /** True when the items went on top of a cart that already had something in it. */
  mergedIntoExistingCart: boolean
}

/**
 * What to do about a cart that already has items in it.
 *
 * <p>
 * Reordering used to answer this by not asking: it joined a fresh cart every time, so pressing
 * "Order again" twice left two active carts for the same restaurant — the second on screen, the
 * first stranded in the database with items nobody would ever see again. Whichever way this is
 * answered, it has to be answered on purpose.
 * </p>
 */
export type ReorderStrategy = 'merge' | 'replace'

/** A cart already open for this restaurant and ordering mode, if there is one. */
export type ExistingCart = {
  cart: Cart
  participantToken: string
  participantId: string
}

function storageKeyFor(restaurantId: string, orderType: CustomerMenuOrderType) {
  return `${cartSessionPrefix}.restaurant:${restaurantId}:${orderType.toLowerCase()}`
}

/**
 * The cart this browser is already holding for the restaurant, or null.
 *
 * <p>
 * Checked before joining, not after: joining is what creates the second cart. The server resolves
 * this too for a signed-in customer, but it cannot for a guest — their browser is the only thing
 * that knows which cart is theirs.
 * </p>
 */
export async function findOpenCart(
  restaurantId: string,
  orderType: CustomerMenuOrderType,
): Promise<ExistingCart | null> {
  let stored: { cartId?: string; participantToken?: string; participantId?: string; identity?: string }

  try {
    stored = JSON.parse(sessionStorage.getItem(storageKeyFor(restaurantId, orderType)) ?? 'null') ?? {}
  } catch {
    return null
  }

  if (!stored.cartId || !stored.participantToken || !stored.participantId) {
    return null
  }

  try {
    const cart = await getCart(stored.cartId, stored.participantToken)

    return cart.status === 'Active'
      ? { cart, participantToken: stored.participantToken, participantId: stored.participantId }
      : null
  } catch (error) {
    if (!cartSessionIsGone(error)) {
      // The server is unreachable, not answering that this cart is gone. Reporting "no open cart"
      // here would send the reorder on to join a second one, leaving the customer's existing cart
      // behind — so the failure is raised and the caller can say so plainly.
      throw error
    }

    // Expired, submitted, or belonging to somebody else now. Either way it is not resumable.
    return null
  }
}

/**
 * Re-adds every line of a past order into the cart for that restaurant and ordering mode, resuming
 * the one already open rather than starting another.
 *
 * <p>
 * Items that are unavailable, sold out, or whose menu item no longer exists are skipped rather than
 * failing the whole reorder.
 * </p>
 */
export async function reorderIntoCart(
  order: CustomerOrder,
  {
    strategy = 'merge',
    identity,
    orderType: chosenOrderType,
  }: {
    strategy?: ReorderStrategy
    /**
     * How to order this time, when it differs from last time.
     *
     * <p>
     * A past dine-in order was tied to a table, and an order records the table's id but not its QR
     * token — which is the only way to rejoin that table's cart. So the previous ordering mode
     * cannot simply be repeated, and the customer has to say which one they want now.
     * </p>
     */
    orderType?: CustomerMenuOrderType
    /**
     * Who this cart session belongs to — `cartIdentityOf(user)`. Required, because the menu page
     * discards any stored session that does not name one, and would then join yet another cart:
     * the exact thing this function exists to stop.
     */
    identity: string
  },
): Promise<ReorderResult> {
  const restaurantId = order.restaurantId
  if (!restaurantId) {
    throw new Error('This order is not linked to a restaurant menu.')
  }

  const orderType = chosenOrderType ?? normalizeCustomerMenuOrderType(order.orderType)
  const existing = await findOpenCart(restaurantId, orderType)
  const hadItems = (existing?.cart.items.length ?? 0) > 0

  let cart: Cart
  let participantToken: string
  let participantId: string

  if (existing) {
    cart = existing.cart
    participantToken = existing.participantToken
    participantId = existing.participantId

    if (strategy === 'replace' && hadItems) {
      cart = await clearCartItems(cart.id, participantToken)
    }
  } else {
    const joined = await joinCart({ restaurantId, orderType })
    cart = joined.cart
    participantToken = joined.participantToken
    participantId = joined.participantId
  }

  let addedCount = 0
  let skippedCount = 0
  const needsChoices: { menuItemId: string; name: string }[] = []

  for (const item of order.orderItems) {
    if (!item.menuItemId) {
      skippedCount += 1
      continue
    }

    const selectedOptionIds = item.selectedOptions
      .map((option) => option.menuItemOptionId)
      .filter((id): id is string => Boolean(id))

    try {
      cart = await addCartItem(cart.id, participantToken, {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        ...(item.note ? { note: item.note } : {}),
        ...(selectedOptionIds.length > 0 ? { selectedOptionIds } : {}),
      })
      addedCount += 1
    } catch (error) {
      // 400 means the menu wants choices this order never recorded; 409 means the dish is really
      // gone. Counting both as "skipped" is what produced the untrue "none of these are available".
      if ((error as { status?: number })?.status === 400) {
        needsChoices.push({ menuItemId: item.menuItemId, name: item.itemNameSnapshot })
      } else {
        skippedCount += 1
      }
    }
  }

  // Only when there is genuinely nothing to do. If something needs choosing, the customer has
  // somewhere to go and saying otherwise would send them away for no reason.
  if (addedCount === 0 && needsChoices.length === 0) {
    throw new Error('None of the items on this order are available to reorder right now.')
  }

  sessionStorage.setItem(
    storageKeyFor(restaurantId, orderType),
    JSON.stringify({ cartId: cart.id, participantToken, participantId, identity }),
  )

  // Refresh so the returned cart reflects any server-side line merging.
  try {
    cart = await getCart(cart.id, participantToken)
  } catch {
    // Non-fatal: fall back to the cart we already have.
  }

  return {
    restaurantId,
    orderType,
    cart,
    addedCount,
    skippedCount,
    needsChoices,
    mergedIntoExistingCart: hadItems && strategy === 'merge',
  }
}
