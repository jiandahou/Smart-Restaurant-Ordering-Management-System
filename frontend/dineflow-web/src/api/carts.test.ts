import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkoutCart, checkoutTimeoutMs, isTimeout } from './carts'

vi.mock('./auth', () => ({ getStoredToken: () => null }))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('recognising a request that gave up waiting', () => {
  it('tells a timeout apart from an ordinary failure', () => {
    expect(isTimeout(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(true)
    expect(isTimeout(new DOMException('Aborted.', 'AbortError'))).toBe(false)
    expect(isTimeout(new Error('Cart is no longer active.'))).toBe(false)
    expect(isTimeout(null)).toBe(false)
  })
})

/**
 * A checkout with no deadline leaves the page frozen on "Starting checkout…" for as long as the
 * browser is willing to wait — minutes, on a stalled mobile connection — with every cart control
 * disabled and nothing to press.
 */
describe('the checkout deadline', () => {
  it('gives up rather than waiting forever', async () => {
    // AbortSignal.timeout runs on a platform timer that fake timers do not intercept, so the real
    // deadline is swapped for one this test can trip. What is under test is our wiring — that the
    // signal reaches fetch and that its abort surfaces to the caller as a timeout — not the
    // browser's ability to count.
    const requested: number[] = []
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      requested.push(ms as number)
      return controller.signal
    })

    globalThis.fetch = vi.fn((_path: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation timed out.', 'TimeoutError')),
        )
      }),
    ) as unknown as typeof fetch

    const pending = checkoutCart('cart-1', 'token', {
      acceptedCustomerTermsVersion: 'v',
      acknowledgedPrivacyPolicyVersion: 'v',
      acknowledgedAllergenNoticeVersion: 'v',
    })

    controller.abort()

    await expect(pending).rejects.toSatisfy(isTimeout)
    expect(requested).toEqual([checkoutTimeoutMs])

    timeout.mockRestore()
  })

  it('waits long enough for an ordinary checkout on a slow connection', () => {
    // Short enough to hand the screen back while the person is still looking at it, long enough
    // that a merely slow request is not cut off and retried for no reason.
    expect(checkoutTimeoutMs).toBeGreaterThanOrEqual(10_000)
    expect(checkoutTimeoutMs).toBeLessThanOrEqual(30_000)
  })

  it('carries a signal so the request is actually abandoned, not just ignored', async () => {
    // Resolving without honouring the signal would leave the socket open and the tab waiting on a
    // reply nobody is coming back with.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await checkoutCart('cart-1', 'token', {
      acceptedCustomerTermsVersion: 'v',
      acknowledgedPrivacyPolicyVersion: 'v',
      acknowledgedAllergenNoticeVersion: 'v',
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined

    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('leaves reads and other cart writes without a deadline of their own', async () => {
    // Recorded deliberately: only checkout was given one. The others can hang too, and this test
    // is where that decision becomes visible if it is ever revisited.
    const { getCart } = await import('./carts')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await getCart('cart-1', 'token')

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal).toBeUndefined()
  })
})
