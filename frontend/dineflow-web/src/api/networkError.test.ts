import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, fetchOrNetworkError } from './auth'

/**
 * "Failed to fetch" reached the customer.
 *
 * <p>
 * `fetch` rejects with a bare `TypeError` carrying that message, written for a console. Every
 * server error on the way out of `request` is shaped into something a person can act on, but the
 * transport failure was not caught at all, so on a table QR page with no signal the toast read
 * literally "Failed to fetch" — no cause, no next step, and no word on whether the order went
 * through.
 * </p>
 */
describe('fetchOrNetworkError', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function failWith(error: unknown) {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
  }

  it('hands back a real response untouched', async () => {
    const response = new Response('{}', { status: 200 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(fetchOrNetworkError('/api/anything')).resolves.toBe(response)
  })

  /**
   * An HTTP error is an answer from the server. It carries a status and the server's own wording,
   * and belongs to the caller — only the rejection is translated here.
   */
  it('leaves an HTTP error to the caller rather than calling it a network failure', async () => {
    const response = new Response('{"message":"Nope"}', { status: 409 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    const result = await fetchOrNetworkError('/api/anything')

    expect(result.status).toBe(409)
  })

  it('replaces the raw browser wording with something a diner can act on', async () => {
    failWith(new TypeError('Failed to fetch'))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const error = await fetchOrNetworkError('/api/anything').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).message).not.toMatch(/failed to fetch/i)
    expect((error as NetworkError).message).toMatch(/offline/i)
  })

  /** Saying nothing was sent is the point: it is what makes trying again safe. */
  it('says nothing was sent', async () => {
    failWith(new TypeError('Failed to fetch'))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const error = await fetchOrNetworkError('/api/anything').catch((err: unknown) => err)

    expect((error as NetworkError).message).toMatch(/nothing was sent/i)
  })

  /**
   * The device having a connection while DineFlow is unreachable is a different sentence: telling
   * someone with full signal that they are offline sends them to fix the wrong thing.
   */
  it('distinguishes a dead device from an unreachable DineFlow', async () => {
    failWith(new TypeError('Failed to fetch'))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)

    const error = await fetchOrNetworkError('/api/anything').catch((err: unknown) => err)

    expect((error as NetworkError).message).toMatch(/could not reach dineflow/i)
    expect((error as NetworkError).message).not.toMatch(/you appear to be offline/i)
  })

  /** Callers already branch on `instanceof ApiError`; none of them should stop working. */
  it('stays an ApiError, with no status, and a code to branch on', async () => {
    failWith(new TypeError('Failed to fetch'))

    const error = await fetchOrNetworkError('/api/anything').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(0)
    expect((error as ApiError).code).toBe('network_unavailable')
  })

  /** An abort was asked for by the app. Reporting it as a dead network would be a lie. */
  it('lets an abort through as an abort', async () => {
    failWith(new DOMException('The user aborted a request.', 'AbortError'))

    const error = await fetchOrNetworkError('/api/anything').catch((err: unknown) => err)

    expect(error).not.toBeInstanceOf(NetworkError)
    expect((error as DOMException).name).toBe('AbortError')
  })
})
