import { addCartItem } from '@/api/carts'
import type { CustomerOrder } from '@/api/auth'

/**
 * Putting the contents of an unpaid order back into the cart.
 *
 * <p>
 * A customer who left an online order unpaid and came back to the menu had no way to act on it
 * except paying or cancelling. Wanting roughly the same meal again meant finding every dish and
 * every option by hand — while the order they already placed sat there holding exactly those
 * portions.
 * </p>
 *
 * <p>
 * That last part is the trap: their own unpaid order reserves the stock, so copying it can fail on
 * the very items they are trying to re-add, and "sold out" would be a baffling thing to read about
 * a dish that is sold out to nobody but themselves. Each failure is therefore named for what the
 * customer can do about it.
 * </p>
 */

export type CopyFailureReason =
  /** The stock is reserved by the very order being copied. */
  | 'held_by_this_order'
  /** Genuinely out of stock, or fewer left than the order wants. */
  | 'sold_out'
  /** Taken off the menu, hidden, or belonging elsewhere now. */
  | 'unavailable'
  /** The menu now asks for choices this order never recorded. */
  | 'needs_choices'
  /** Something the customer can only retry. */
  | 'unknown'

export type CopyFailure = {
  itemName: string
  reason: CopyFailureReason
}

export type CopyOrderResult = {
  addedCount: number
  failures: CopyFailure[]
  /** Set when the restaurant stopped taking orders; nothing could be added at all. */
  closedMessage: string | null
}

type AddError = {
  status?: number
  code?: string
  message?: string
  details?: { remaining?: number | null; reason?: string | null } | null
}

/**
 * Works out why one line could not be added.
 *
 * @param heldByThisOrder how many of this dish the order being copied is holding. A stock refusal
 * on a dish the order itself reserves is that reservation, not a shortage in the kitchen.
 */
export function classifyCopyFailure(
  error: unknown,
  itemName: string,
  heldByThisOrder: number,
): CopyFailure {
  const failure = error as AddError | null
  const status = failure?.status

  // 400 is the menu asking for a choice the old order has no answer for — a size, a doneness.
  if (status === 400) {
    return { itemName, reason: 'needs_choices' }
  }

  if (failure?.code === 'insufficient_stock') {
    return {
      itemName,
      reason: heldByThisOrder > 0 ? 'held_by_this_order' : 'sold_out',
    }
  }

  if (status === 409) {
    return { itemName, reason: 'unavailable' }
  }

  return { itemName, reason: 'unknown' }
}

/** How many of a dish an order holds, across every line. */
export function quantityInOrder(order: CustomerOrder, menuItemId: string | null): number {
  if (!menuItemId) {
    return 0
  }

  return order.orderItems
    .filter((line) => line.menuItemId === menuItemId)
    .reduce((total, line) => total + line.quantity, 0)
}

/**
 * Adds every line of an order into an existing cart, reporting what could not be taken.
 *
 * <p>
 * A closed restaurant stops the whole thing: every remaining line would fail the same way, and a
 * list of identical failures tells the customer less than one sentence does.
 * </p>
 */
export async function copyOrderIntoCart(
  order: CustomerOrder,
  cartId: string,
  participantToken: string,
): Promise<CopyOrderResult> {
  let addedCount = 0
  const failures: CopyFailure[] = []

  for (const line of order.orderItems) {
    if (!line.menuItemId) {
      failures.push({ itemName: line.itemNameSnapshot, reason: 'unavailable' })
      continue
    }

    const selectedOptionIds = line.selectedOptions
      .map((option) => option.menuItemOptionId)
      .filter((id): id is string => Boolean(id))

    try {
      await addCartItem(cartId, participantToken, {
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        ...(line.note ? { note: line.note } : {}),
        ...(selectedOptionIds.length > 0 ? { selectedOptionIds } : {}),
      })
      addedCount += 1
    } catch (error) {
      const closed = closedRestaurantMessage(error)

      if (closed) {
        return { addedCount, failures, closedMessage: closed }
      }

      failures.push(
        classifyCopyFailure(error, line.itemNameSnapshot, quantityInOrder(order, line.menuItemId)),
      )
    }
  }

  return { addedCount, failures, closedMessage: null }
}

/**
 * The server's own words when it has stopped taking orders, or null.
 *
 * <p>
 * Its message names the reason and often the reopening time, which is more use than anything that
 * could be reconstructed here.
 * </p>
 */
function closedRestaurantMessage(error: unknown): string | null {
  const failure = error as AddError | null

  if (failure?.status !== 409) {
    return null
  }

  // `reason` is what a closed restaurant carries and an unavailable dish does not. It arrives
  // inside `details`, since the client only lifts status and code to the top level.
  return failure.details?.reason
    ? failure.message ?? 'The restaurant is not taking orders right now.'
    : null
}

/**
 * What to tell the customer about a line that could not be taken.
 *
 * <p>
 * Kept out of the component so the wording is testable, and so the awkward case — a dish held by
 * the customer's own unpaid order — is stated once rather than improvised at the call site.
 * </p>
 */
export function describeCopyFailure(failure: CopyFailure): string {
  switch (failure.reason) {
    case 'held_by_this_order':
      return `${failure.itemName} — the last of it is in this unpaid order. Pay for it, or cancel the order first.`
    case 'sold_out':
      return `${failure.itemName} — not enough left.`
    case 'unavailable':
      return `${failure.itemName} — no longer on the menu.`
    case 'needs_choices':
      return `${failure.itemName} — now needs a choice, so add it from the menu.`
    default:
      return `${failure.itemName} — could not be added.`
  }
}
