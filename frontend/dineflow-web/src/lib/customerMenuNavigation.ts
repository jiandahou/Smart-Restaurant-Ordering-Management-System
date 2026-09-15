export type CustomerMenuOrderType = 'DineIn' | 'Takeaway'

export function normalizeCustomerMenuOrderType(orderType: number | string): CustomerMenuOrderType {
  return orderType === 0 || orderType === 'DineIn' ? 'DineIn' : 'Takeaway'
}

export function parseCustomerMenuOrderType(value: string | null): CustomerMenuOrderType | null {
  return value === 'DineIn' || value === 'Takeaway' ? value : null
}

export function buildRestaurantMenuPath(restaurantId: string, orderType: number | string) {
  const params = new URLSearchParams({
    orderType: normalizeCustomerMenuOrderType(orderType),
  })

  return `/r/${encodeURIComponent(restaurantId)}/menu?${params.toString()}`
}

/**
 * The menu a customer is currently reading, addressed the way they arrived at it.
 *
 * <p>
 * A table QR has to stay a table QR: the token is the only thing that rejoins that table's shared
 * cart, and rewriting the path to `/r/<id>/menu` would quietly turn a seated diner into a takeaway
 * customer with a cart of their own.
 * </p>
 *
 * <p>
 * Used for both the account menu's link and where signing out lands. Signing out used to go to
 * `/login`, which reads as "you must now sign in" — but a customer signs out to hand the phone back
 * or to order as a guest, and dropping them on a sign-in form stranded them away from the
 * restaurant they were ordering from.
 * </p>
 */
export function buildViewerMenuPath(
  qrToken: string | null | undefined,
  restaurantId: string,
  orderType: number | string,
) {
  return qrToken
    ? `/table/${encodeURIComponent(qrToken)}`
    : buildRestaurantMenuPath(restaurantId, orderType)
}

/**
 * A `returnTo` value that is safe to send someone back to, or null.
 *
 * <p>
 * Only same-origin customer menu paths qualify. A return path arrives in a URL anybody can edit,
 * so an unchecked one turns any page carrying it into an open redirect — and even a same-origin
 * one should not be able to drop a customer into an admin screen.
 * </p>
 */
export function getSafeMenuReturnPath(returnTo: string | null | undefined) {
  if (!returnTo) {
    return null
  }

  const candidate = returnTo.trim()

  // A leading double slash or a scheme makes it another origin however it is written.
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('://')) {
    return null
  }

  const path = candidate.split(/[?#]/, 1)[0]

  return path.startsWith('/table/') || (path.startsWith('/r/') && path.endsWith('/menu'))
    ? candidate
    : null
}
