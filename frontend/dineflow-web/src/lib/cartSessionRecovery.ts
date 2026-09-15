/**
 * Deciding whether a stored cart session is worth keeping after a failed request.
 *
 * <p>
 * A browser holds the only way back into a guest's cart: the cart id and participant token in
 * sessionStorage. Reading the cart used to discard both whenever the request threw, whatever the
 * reason — so a backend restart, a 502 from a container still warming up, or a phone losing signal
 * for a second all looked exactly like "this cart no longer exists". The page then joined a fresh,
 * empty cart, and the real one was left in the database with the customer's items in it, still
 * Active, reachable by nobody.
 * </p>
 *
 * <p>
 * Only the server saying so should end a session. Everything else — 5xx, rate limiting, timeouts,
 * offline — is temporary, and the right response is to keep the token and let the customer retry.
 * Hence the default below is to keep: an unrecognised failure must never cost somebody their order.
 * </p>
 */

/**
 * Statuses that mean the cart is genuinely unreachable for this participant, and no amount of
 * retrying will change that.
 */
const goneStatuses = new Set([
  400, // The cart id is not a cart at all — a malformed or stale identifier.
  401, // The participant token is not valid.
  403, // Valid token, but it no longer owns this cart.
  404, // No such cart.
  410, // The cart was explicitly ended.
])

/**
 * True when the stored session should be thrown away.
 *
 * <p>
 * Deliberately narrow. 429 is excluded on purpose: cart token lockout is a temporary state, and
 * discarding the token during it would turn a rate limit into a lost cart. So is every 5xx.
 * </p>
 */
export function cartSessionIsGone(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status

  return typeof status === 'number' && goneStatuses.has(status)
}
