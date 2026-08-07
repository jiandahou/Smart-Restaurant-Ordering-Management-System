const guestOrderCookieName = 'dineflow.guestOrderIds'
const guestOrderCookieMaxAgeSeconds = 60 * 60 * 24 * 90
const maximumStoredGuestOrders = 50

/**
 * A guest order is reachable only by presenting the token issued when it was placed. The order id
 * is a plain identifier that shows up in logs, printed tickets and support threads, so it is not
 * treated as a secret on its own.
 */
export type StoredGuestOrder = {
  orderId: string
  guestAccessToken: string | null
}

function canUseDocumentCookie() {
  return typeof document !== 'undefined' && typeof document.cookie === 'string'
}

function readCookie(name: string) {
  if (!canUseDocumentCookie()) {
    return null
  }

  const prefix = `${name}=`
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))

  return cookie ? cookie.slice(prefix.length) : null
}

function writeCookie(name: string, value: string) {
  if (!canUseDocumentCookie()) {
    return
  }

  document.cookie = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${guestOrderCookieMaxAgeSeconds}`,
    'SameSite=Lax',
  ].join('; ')
}

/**
 * Reads both the current shape and the original id-only array, so orders saved before tokens
 * existed are not silently dropped from a customer's order list.
 */
export function getStoredGuestOrders(): StoredGuestOrder[] {
  const rawValue = readCookie(guestOrderCookieName)

  if (!rawValue) {
    return []
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(rawValue))
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry): StoredGuestOrder | null => {
        if (typeof entry === 'string' && entry.length > 0) {
          return { orderId: entry, guestAccessToken: null }
        }

        if (entry && typeof entry === 'object' && typeof entry.orderId === 'string' && entry.orderId) {
          return {
            orderId: entry.orderId,
            guestAccessToken: typeof entry.guestAccessToken === 'string' ? entry.guestAccessToken : null,
          }
        }

        return null
      })
      .filter((entry): entry is StoredGuestOrder => entry !== null)
      .slice(0, maximumStoredGuestOrders)
  } catch {
    return []
  }
}

export function getGuestOrderIds() {
  return getStoredGuestOrders().map((entry) => entry.orderId)
}

export function rememberGuestOrder(
  orderId: string | null | undefined,
  guestAccessToken: string | null = null,
) {
  if (!orderId) {
    return
  }

  const existing = getStoredGuestOrders()
  // Never downgrade a stored token to null: checkout returns it once, and later calls that only
  // know the id must not wipe the only copy the customer has.
  const previousToken = existing.find((entry) => entry.orderId === orderId)?.guestAccessToken ?? null

  const nextOrders: StoredGuestOrder[] = [
    { orderId, guestAccessToken: guestAccessToken ?? previousToken },
    ...existing.filter((entry) => entry.orderId !== orderId),
  ].slice(0, maximumStoredGuestOrders)

  writeCookie(guestOrderCookieName, encodeURIComponent(JSON.stringify(nextOrders)))
}
