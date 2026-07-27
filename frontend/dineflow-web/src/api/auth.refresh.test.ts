import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStoredRefreshToken,
  getMe,
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

    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1) // only one network call for both callers
  })
})
