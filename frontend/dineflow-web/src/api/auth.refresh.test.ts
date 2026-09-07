import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStoredRefreshToken,
  getMe,
  getMfaSettings,
  getStoredRefreshToken,
  getStoredToken,
  login,
  refreshAccessToken,
  storeRefreshToken,
  storeToken,
  type AuthUser,
} from './auth'

const sampleUser: AuthUser = {
  id: 'user-1',
  email: 'owner@dineflow.test',
  fullName: 'Test Owner',
  avatarUrl: null,
  restaurantId: null,
  roles: ['PlatformOwner'],
  hasPassword: true,
  externalProviders: [],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('request() silent refresh on 401', () => {
  it('refreshes the access token once and retries the original request', async () => {
    storeToken('stale-access-token')
    storeRefreshToken('valid-refresh-token')

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401)) // GET /api/auth/me (stale token)
      .mockResolvedValueOnce(jsonResponse({ // POST /api/auth/refresh
        message: 'Token refreshed.',
        token: 'fresh-access-token',
        refreshToken: 'rotated-refresh-token',
        user: sampleUser,
      }))
      .mockResolvedValueOnce(jsonResponse(sampleUser)) // GET /api/auth/me (retried)
    vi.stubGlobal('fetch', fetchMock)

    const result = await getMe()

    expect(result).toEqual(sampleUser)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/me')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/me')

    // Rotation: both tokens in storage are the new ones, not the stale/original pair.
    expect(getStoredToken()).toBe('fresh-access-token')
    expect(getStoredRefreshToken()).toBe('rotated-refresh-token')
  })

  it('does not attempt a refresh when no refresh token is stored, and the original error propagates', async () => {
    storeToken('stale-access-token')
    clearStoredRefreshToken()

    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMe()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears both tokens when the refresh token itself is rejected', async () => {
    storeToken('stale-access-token')
    storeRefreshToken('revoked-refresh-token')

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401)) // GET /api/auth/me
      .mockResolvedValueOnce(jsonResponse({ message: 'Session expired.' }, 401)) // POST /api/auth/refresh fails
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMe()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2) // no third retry attempt once refresh fails
    expect(getStoredToken()).toBeNull()
    expect(getStoredRefreshToken()).toBeNull()
  })

  it('never retries the login endpoint itself (a 401 there means "wrong password", not "expired session")', async () => {
    storeRefreshToken('some-refresh-token') // simulate an existing session attempting re-auth

    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'Invalid email or password.' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(login('owner@dineflow.test', 'wrong-password')).rejects.toThrow('Invalid email or password.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not expose a server exception detail through request errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      title: 'An unexpected error occurred.',
      detail: 'Microsoft.EntityFrameworkCore.DbUpdateException: sensitive server stack trace',
    }, 500))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMfaSettings()).rejects.toThrow(
      'The service encountered an unexpected error. Please try again.',
    )
  })
})

describe('refreshAccessToken() single-flight', () => {
  it('shares one in-flight request across concurrent callers', async () => {
    storeRefreshToken('valid-refresh-token')

    let resolveFetch!: (value: Response) => void
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn().mockReturnValueOnce(pendingResponse)
    vi.stubGlobal('fetch', fetchMock)

    const first = refreshAccessToken()
    const second = refreshAccessToken() // fired before the first has resolved

    resolveFetch(jsonResponse({
      message: 'Token refreshed.',
      token: 'fresh-access-token',
      refreshToken: 'rotated-refresh-token',
      user: sampleUser,
    }))

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toBe('refreshed')
    expect(secondResult).toBe('refreshed')
    expect(fetchMock).toHaveBeenCalledTimes(1) // only one network call for both callers
  })
})

/**
 * Two tabs of one browser share a single refresh token. Both wake when the access token expires,
 * both present it, and one loses — which used to clear the tokens and drop the user to the login
 * screen. On a restaurant's till that means new orders stop appearing, the alert stops sounding and
 * tickets stop printing, with nobody aware until a customer asks where their food is.
 *
 * <p>The sibling that won has already stored the replacement, so the answer is to read it and go on.</p>
 */
describe('two tabs refreshing the token they share', () => {
  it('keeps the session when a sibling tab got there first', async () => {
    storeToken('stale-access')
    storeRefreshToken('shared-refresh')

    const fetchMock = vi.fn(async () => {
      // The sibling stores its replacement while this request is in flight.
      storeRefreshToken('rotated-by-sibling')
      return jsonResponse({ message: 'Refreshed in another tab.', retry: true }, 409)
    })
    vi.stubGlobal('fetch', fetchMock)

    await refreshAccessToken()

    expect(getStoredRefreshToken()).toBe('rotated-by-sibling')
  })

  /**
   * Retrying with the very token that was refused would land straight back on the same answer —
   * and worse: the server treats a replay outside its grace window as a stolen token and revokes
   * every token the account holds, signing out every tab and device.
   */
  it('does not replay the same token when no sibling stored a new one', async () => {
    storeToken('stale-access')
    storeRefreshToken('shared-refresh')

    const fetchMock = vi.fn(async () => jsonResponse({ retry: true }, 409))
    vi.stubGlobal('fetch', fetchMock)

    // 'unavailable', not 'dead': the server said retry, so no verdict was ever reached.
    await expect(refreshAccessToken()).resolves.toBe('unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Nothing is wrong with this session, so nothing is thrown away.
    expect(getStoredRefreshToken()).toBe('shared-refresh')
  })

  /**
   * The sibling wins, stores its replacement, and the storage event wakes us.
   *
   * <p>
   * This used to be a fixed 250ms look-once: a sibling still mid-request had written nothing by
   * then, so the retry budget was a fiction and the loser gave up on a session that was fine.
   * </p>
   */
  it('goes again with the replacement the sibling stores', async () => {
    storeToken('stale-access')
    storeRefreshToken('shared-refresh')

    const fetchMock = vi.fn(async () => (fetchMock.mock.calls.length === 1
      ? jsonResponse({ retry: true }, 409)
      : jsonResponse({ token: 'fresh-access', refreshToken: 'fresh-refresh' }, 200)))
    vi.stubGlobal('fetch', fetchMock)

    const refreshing = refreshAccessToken()

    // The sibling lands a moment later, as it does in a real race.
    await new Promise((resolve) => setTimeout(resolve, 10))
    storeRefreshToken('sibling-refresh')
    window.dispatchEvent(new StorageEvent('storage', { key: 'dineflow.auth.refreshToken' }))

    await expect(refreshing).resolves.toBe('refreshed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getStoredToken()).toBe('fresh-access')
  })

  /** A session that really has ended must still end, or the app loops on a dead token. */
  it('still signs out when the refresh token is genuinely rejected', async () => {
    storeToken('stale-access')
    storeRefreshToken('dead-refresh')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Session expired.' }, 401)))

    // 'dead' is the one outcome that may end a session: the server looked and refused.
    await expect(refreshAccessToken()).resolves.toBe('dead')
    expect(getStoredToken()).toBeNull()
    expect(getStoredRefreshToken()).toBeNull()
  })
})
