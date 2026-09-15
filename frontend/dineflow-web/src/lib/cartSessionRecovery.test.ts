import { describe, expect, it } from 'vitest'

import { cartSessionIsGone } from './cartSessionRecovery'

/** The shape `cartRequest` throws: an Error carrying the HTTP status. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status })
}

describe('deciding whether a stored cart session is finished', () => {
  it('discards the session when the server says the cart is not there for this participant', () => {
    for (const status of [400, 401, 403, 404, 410]) {
      expect(cartSessionIsGone(httpError(status))).toBe(true)
    }
  })

  /**
   * The bug this guards: a restarting backend answers 502, the page threw the cart id and token
   * away, joined a fresh empty cart, and the customer's real cart was left in the database with
   * their items in it — still Active, reachable by nobody.
   */
  it('keeps the session through a server that is restarting or broken', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(cartSessionIsGone(httpError(status))).toBe(false)
    }
  })

  /** Cart token lockout is temporary. Discarding the token would turn it into a lost cart. */
  it('keeps the session through rate limiting', () => {
    expect(cartSessionIsGone(httpError(429))).toBe(false)
  })

  it('keeps the session when the cart is merely contested', () => {
    expect(cartSessionIsGone(httpError(409))).toBe(false)
  })

  /** No status at all: offline, DNS failure, or an AbortSignal timeout. All temporary. */
  it('keeps the session when the request never reached a server', () => {
    expect(cartSessionIsGone(new TypeError('Failed to fetch'))).toBe(false)
    expect(cartSessionIsGone(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(false)
    expect(cartSessionIsGone(undefined)).toBe(false)
    expect(cartSessionIsGone(null)).toBe(false)
  })

  /** An unrecognised failure must never cost somebody their order, so the default is to keep. */
  it('keeps the session for anything it does not recognise', () => {
    expect(cartSessionIsGone({ status: 'weird' })).toBe(false)
    expect(cartSessionIsGone(httpError(418))).toBe(false)
  })
})
