import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QzTrayError, requestSignature } from './thermalPrinter'

const refreshAccessToken = vi.hoisted(() => vi.fn())

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/auth')>()),
  refreshAccessToken,
}))

function signedIn(token = 'staff-token') {
  localStorage.setItem('dineflow.auth.token', token)
}

function respondWith(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  localStorage.clear()
})

/**
 * QZ Tray raises a native "Cannot verify trust — Invalid Signature" dialog that names no
 * application, explains nothing, and cannot be silenced with "Remember this decision". It was
 * appearing at random on a till whose certificate was installed, chained and correctly paired —
 * because the certificate was never what QZ was objecting to. Individual requests were reaching it
 * with `signature: ""` while their neighbours carried a full SHA512 signature and passed silently.
 *
 * <p>
 * The empty string came from this function: every failure path returned one, and qz-tray does
 * `obj.signature = signature || ""` and sends the request regardless. An empty signature is not a
 * refusal to sign — it is an unsigned request, delivered.
 * </p>
 */
describe('signing a QZ request', () => {
  it('returns the signature the backend produced', async () => {
    signedIn()
    globalThis.fetch = respondWith({ signature: 'abc123' }) as unknown as typeof fetch

    await expect(requestSignature('data')).resolves.toBe('abc123')
  })

  /** The case that produced the popup: no session yet, which is normal for a moment after a reload. */
  it('refuses rather than signing with nothing when not signed in', async () => {
    globalThis.fetch = respondWith({ signature: 'abc123' }) as unknown as typeof fetch

    await expect(requestSignature('data')).rejects.toBeInstanceOf(QzTrayError)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('refuses when the signing endpoint fails', async () => {
    signedIn()
    globalThis.fetch = respondWith({ message: 'boom' }, 500) as unknown as typeof fetch

    await expect(requestSignature('data')).rejects.toBeInstanceOf(QzTrayError)
  })

  it('refuses when DineFlow cannot be reached at all', async () => {
    signedIn()
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    await expect(requestSignature('data')).rejects.toBeInstanceOf(QzTrayError)
  })

  /** A 200 with nothing in it is the server misconfigured, and is still not something to send. */
  it('refuses when the response carries no signature', async () => {
    signedIn()
    globalThis.fetch = respondWith({}) as unknown as typeof fetch

    await expect(requestSignature('data')).rejects.toBeInstanceOf(QzTrayError)
  })

  /** Every refusal must be recognisable, so the page can say why instead of QZ saying nothing. */
  it('names the reason so the page can explain it', async () => {
    signedIn()
    globalThis.fetch = respondWith({}, 500) as unknown as typeof fetch

    await expect(requestSignature('data')).rejects.toMatchObject({ reason: 'not-signed' })
  })

  /**
   * The till sits idle between services and its access token expires. Refreshing and signing again
   * is what keeps that from reaching the customer as a dialog from another application.
   */
  it('refreshes an expired session and signs again', async () => {
    signedIn('expired')
    refreshAccessToken.mockImplementation(async () => {
      localStorage.setItem('dineflow.auth.token', 'fresh')
      return true
    })

    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call += 1
      return call === 1
        ? new Response(JSON.stringify({ message: 'expired' }), { status: 401 })
        : new Response(JSON.stringify({ signature: 'signed-after-refresh' }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(requestSignature('data')).resolves.toBe('signed-after-refresh')
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
  })

  it('gives up rather than looping when the refresh does not help', async () => {
    signedIn('expired')
    refreshAccessToken.mockResolvedValue(true)
    globalThis.fetch = respondWith({ message: 'still expired' }, 401) as unknown as typeof fetch

    await expect(requestSignature('data')).rejects.toBeInstanceOf(QzTrayError)
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })
})
