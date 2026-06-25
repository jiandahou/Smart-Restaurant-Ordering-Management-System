const guestOrderCookieName = 'dineflow.guestOrderIds'
const guestOrderCookieMaxAgeSeconds = 60 * 60 * 24 * 90
const maximumStoredGuestOrders = 50

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

export function getGuestOrderIds() {
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
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .slice(0, maximumStoredGuestOrders)
  } catch {
    return []
  }
}

export function rememberGuestOrder(orderId: string | null | undefined) {
  if (!orderId) {
    return
  }

  const nextOrderIds = [
    orderId,
    ...getGuestOrderIds().filter((storedOrderId) => storedOrderId !== orderId),
  ].slice(0, maximumStoredGuestOrders)

  writeCookie(guestOrderCookieName, encodeURIComponent(JSON.stringify(nextOrderIds)))
}
