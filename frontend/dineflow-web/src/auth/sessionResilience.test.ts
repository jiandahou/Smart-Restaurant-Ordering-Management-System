import { describe, expect, it } from 'vitest'

import { ApiError, storeRefreshToken, storeToken, getStoredToken, getStoredRefreshToken } from '../api/auth'
import { isSessionRejected } from '../lib/sessionExpiry'

/**
 * Loading the current user runs on every page load. Its failure cleared the session outright, so a
 * backend restarting during a deploy signed out every till that happened to be open.
 */
describe('a page load that could not reach the server', () => {
  it('is not treated as the end of the session', () => {
    storeToken('staff-token')
    storeRefreshToken('staff-refresh')

    // What the thunk now decides on, for each failure it can see.
    expect(isSessionRejected(new TypeError('Failed to fetch'))).toBe(false)
    expect(isSessionRejected(new ApiError('Bad gateway', 502))).toBe(false)

    // Nothing was thrown away, so the next attempt still has credentials to use.
    expect(getStoredToken()).toBe('staff-token')
    expect(getStoredRefreshToken()).toBe('staff-refresh')
  })

  it('still ends when the server says the credentials are finished', () => {
    expect(isSessionRejected(new ApiError('Unauthorized', 401))).toBe(true)
  })
})
