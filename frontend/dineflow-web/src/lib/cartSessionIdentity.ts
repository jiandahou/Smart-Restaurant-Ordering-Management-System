/**
 * Which identity a stored cart session belongs to.
 *
 * <p>
 * A cart session is a participant token kept in sessionStorage so a reload does not lose the cart.
 * It recorded nothing about who was signed in when it was issued, so signing out left the tab
 * holding a token the server still associated with the account that had just left: the page said
 * "Ordering as Guest" while the order it placed carried the previous customer's id, and their name
 * and email appeared against it in the restaurant's order list.
 * </p>
 *
 * <p>
 * The server now refuses that combination outright — this is the client half, so the tab quietly
 * starts a new session instead of being told off for one it did not know was wrong.
 * </p>
 */

/** Nobody signed in. A real value rather than null so a stored session always names an identity. */
export const guestIdentity = 'guest'

/** The identity a cart session started now would belong to. */
export function cartIdentityOf(user: { id: string } | null | undefined): string {
  return user?.id ?? guestIdentity
}

/**
 * True when a stored session was issued to somebody other than the person here now — a sign-in, a
 * sign-out, or a different account. A session with no recorded identity was written before this
 * existed and cannot be vouched for, so it counts as a mismatch too.
 */
export function cartSessionBelongsToSomeoneElse(
  storedIdentity: string | null | undefined,
  currentIdentity: string,
): boolean {
  return storedIdentity !== currentIdentity
}
