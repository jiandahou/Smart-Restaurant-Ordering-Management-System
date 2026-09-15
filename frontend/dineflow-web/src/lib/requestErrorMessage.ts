/**
 * What to tell somebody when a request failed and the server did not say why.
 *
 * <p>
 * The fallback used to be the status line itself — a diner whose checkout hit a 500 was shown
 * "Request failed with HTTP 500", and one who opened a slightly mangled QR link got
 * "Request failed with HTTP 404". Neither is rare: the API answers unhandled failures with RFC 9457
 * problem details, which carry <code>title</code> and never <code>message</code>, so every one of
 * them fell through to this; and a route whose id does not parse is answered with no body at all.
 * </p>
 *
 * <p>
 * A status code tells the reader nothing they can act on and quite a lot about how the thing is
 * built. What they need to know is whether to try again, and whether it was their doing.
 * </p>
 */
export function getRequestErrorMessage(status: number, body: unknown): string {
  // The API's own convention, and always preferred: it was written for this exact reader.
  const message = typeof body === 'object' && body !== null
    ? (body as { message?: unknown }).message
    : undefined

  if (typeof message === 'string' && message.trim().length > 0) {
    return message.trim()
  }

  if (status === 404) {
    return 'That link is no longer valid. Check the code on your table, or ask a member of staff.'
  }

  if (status === 408) {
    return 'That took too long. Check your connection and try again.'
  }

  if (status === 429) {
    return 'That was a lot of requests at once. Wait a moment and try again.'
  }

  if (status >= 500) {
    return 'Something went wrong at our end. Try again in a moment — nothing has been charged.'
  }

  return 'Something went wrong. Try again.'
}
