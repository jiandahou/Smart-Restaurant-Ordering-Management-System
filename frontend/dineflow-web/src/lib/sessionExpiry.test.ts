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
