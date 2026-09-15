import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/auth'
import { isSessionRejected } from './sessionExpiry'

/**
 * Loading the current user runs on every page load, and its failure cleared the session outright.
 * A backend restarting or a dropped connection failed the same way, so a till dropped to the login
 * screen mid-service because the network hiccuped.
 */
describe('deciding whether a failed request ended the session', () => {
  it('ends the session when the server rejects the credentials', () => {
    expect(isSessionRejected(new ApiError('Unauthorized', 401))).toBe(true)
    expect(isSessionRejected(new ApiError('Forbidden', 403))).toBe(true)
  })

  /** The case that logged people out during a deploy. */
  it('keeps the session when the server could not be reached', () => {
    expect(isSessionRejected(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('keeps the session when the server itself is broken', () => {
    expect(isSessionRejected(new ApiError('Bad gateway', 502))).toBe(false)
    expect(isSessionRejected(new ApiError('Server error', 500))).toBe(false)
    expect(isSessionRejected(new ApiError('Unavailable', 503))).toBe(false)
  })

  /** A rotation race answers 409 and is explicitly not a rejection. */
  it('keeps the session when another tab refreshed first', () => {
    expect(isSessionRejected(new ApiError('Refreshed in another tab', 409))).toBe(false)
  })

  it('keeps the session for anything it cannot recognise', () => {
    expect(isSessionRejected(undefined)).toBe(false)
    expect(isSessionRejected('boom')).toBe(false)
  })
})

/**
 * A refresh can end without a verdict.
 *
 * <p>
 * Two tabs share one refresh token. When both wake after the access token expires, both present it;
 * one rotates and the other is answered 409 with retry:true — the server saying, in as many words,
 * that nothing is wrong with this session. If the sibling has not stored its replacement by the
 * time we look, the original request is still a 401, and that 401 used to end the session. A
 * customer who had just paid came back to My Orders signed out, their order replaced by whatever
 * the browser had saved for guests, with no message to say why.
 * </p>
 */
describe('when the refresh never reached a verdict', () => {
  it('keeps the session, even though the request itself was a 401', () => {
    const unresolved = new ApiError('Unauthorized', 401, undefined, undefined, true)

    expect(isSessionRejected(unresolved)).toBe(false)
  })

  it('keeps the session on a 403 for the same reason', () => {
    expect(isSessionRejected(new ApiError('Forbidden', 403, undefined, undefined, true))).toBe(false)
  })

  /** A verdict was reached and it was "no". That is still the end of the session. */
  it('still ends the session when the refresh was actually rejected', () => {
    expect(isSessionRejected(new ApiError('Unauthorized', 401, undefined, undefined, false))).toBe(true)
  })

  /** Errors raised before any refresh was attempted default to carrying a verdict. */
  it('treats an ordinary 401 as it always did', () => {
    expect(new ApiError('Unauthorized', 401).sessionVerdictUnknown).toBe(false)
    expect(isSessionRejected(new ApiError('Unauthorized', 401))).toBe(true)
  })
})
