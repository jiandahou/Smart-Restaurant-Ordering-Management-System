import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeError, describePasskeyFailure, startPasskeyAssertion, type PublicKeyCredentialRequestOptionsJson } from './auth'

/**
 * Browsers only open the passkey prompt while the click's transient user activation is still live.
 * Awaiting the challenge fetch first spends that window, so the prompt failed to appear until a
 * second, luckier click. The fix is that nothing may be awaited before navigator.credentials.get.
 */
const options = {
  challenge: 'Y2hhbGxlbmdl',
  timeout: 60_000,
  rpId: 'localhost',
  allowCredentials: [],
  userVerification: 'preferred',
} as unknown as PublicKeyCredentialRequestOptionsJson

/** Captured before any stubbing, so a stubbed window can keep the parts the code really uses. */
const realWindow = globalThis.window

let getCalls: number

beforeEach(() => {
  vi.unstubAllGlobals()
  getCalls = 0
  vi.stubGlobal('document', { hasFocus: () => true })
  vi.stubGlobal('navigator', {
    credentials: {
      get: vi.fn(() => {
        getCalls++
        return new Promise(() => {})
      }),
    },
  })
})

describe('starting a passkey assertion', () => {
  it('calls into the browser synchronously, before any await can run', () => {
    // The assertion is in flight the moment the function returns — no microtask, no round-trip.
    startPasskeyAssertion(options)

    expect(getCalls).toBe(1)
  })

  it('keeps the challenge with the attempt so completion can quote it back', () => {
    const attempt = startPasskeyAssertion(options)

    expect(attempt.options.challenge).toBe('Y2hhbGxlbmdl')
    expect(attempt.credential).toBeInstanceOf(Promise)
  })

  it('does not await the browser before returning', async () => {
    // navigator.credentials.get never settles here; if this function awaited it, the assertion
    // below would never be reached.
    const attempt = startPasskeyAssertion(options)
    let settled = false
    void attempt.credential.then(() => { settled = true })

    await Promise.resolve()

    expect(settled).toBe(false)
    expect(getCalls).toBe(1)
  })
})

describe('the login page click handler', () => {
  const page = (import.meta.glob('../pages/LoginPage.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>)['../pages/LoginPage.tsx']

  const clickHandler = () => {
    const start = page.indexOf('const handlePasskeyLogin')
    expect(start).toBeGreaterThanOrEqual(0)
    return page.slice(start, page.indexOf('\n  const completePasskeyLogin', start))
  }

  it('awaits nothing before opening the prompt', () => {
    const body = clickHandler()

    expect(body).toContain('startPasskeyAssertion')
    expect(body).not.toContain('await')
  })

  it('prefetches the challenge instead of fetching it on click', () => {
    expect(page).toContain('prefetchPasskeyOptions')
    expect(clickHandler()).toContain('passkeyOptionsRef.current')
  })

  it('discards the prefetched challenge after use, because it is single use', () => {
    expect(clickHandler()).toContain('passkeyOptionsRef.current = null')
  })

  it('refreshes the prefetched challenge inside its server-side lifetime', () => {
    // The store keeps it for five minutes.
    const match = page.match(/passkeyOptionsRefreshMs = (\d+) \* 60 \* 1000/)
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBeLessThan(5)
  })
})

/**
 * Safari refuses the ceremony outright with `NotAllowedError: The document is not focused.` when
 * the click that reached the button is also the click that brought the window forward. Focus lands
 * milliseconds later from that same click, so waiting for it is the difference between the prompt
 * appearing on the first click and appearing on the second.
 */
describe('an unfocused document', () => {
  /**
   * A window whose focus, listeners and timer this test drives by hand.
   *
   * `grantsFocusOnRequest` is the browser that honours `window.focus()` on the spot without
   * dispatching an event — nothing would ever wake a listener-only wait there.
   */
  function stubUnfocusedWindow({ grantsFocusOnRequest = false } = {}) {
    let focused = false
    const focusListeners: Array<() => void> = []
    let pendingTimeout: (() => void) | null = null
    const focusRequests = { count: 0 }

    vi.stubGlobal('document', { hasFocus: () => focused })
    vi.stubGlobal('window', {
      atob: realWindow.atob.bind(realWindow),
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'focus') focusListeners.push(fn)
      },
      removeEventListener: (type: string, fn: () => void) => {
        if (type !== 'focus') return
        const index = focusListeners.indexOf(fn)
        if (index >= 0) focusListeners.splice(index, 1)
      },
      setTimeout: (fn: () => void) => {
        pendingTimeout = fn
        return 1
      },
      clearTimeout: () => {
        pendingTimeout = null
      },
      focus: () => {
        focusRequests.count++
        if (grantsFocusOnRequest) focused = true
      },
    })

    return {
      focusRequests,
      /** The focus the click itself delivers, a moment after the handler ran. */
      deliverFocus: () => {
        focused = true
        for (const listener of [...focusListeners]) listener()
      },
      focusNever: () => {
        pendingTimeout?.()
      },
      get listenerCount() {
        return focusListeners.length
      },
    }
  }

  it('holds the ceremony back rather than calling into a document that will refuse it', async () => {
    stubUnfocusedWindow()

    startPasskeyAssertion(options)
    await Promise.resolve()

    expect(getCalls).toBe(0)
  })

  it('opens the prompt as soon as the focus from that same click lands', async () => {
    const stub = stubUnfocusedWindow()

    const attempt = startPasskeyAssertion(options)
    stub.deliverFocus()

    expect(await attempt.diagnostics).toEqual({
      focusedAtClick: false,
      resolvedBy: 'focus-event',
      focusedAtCall: true,
      waitedMs: expect.any(Number),
      framed: false,
    })
    expect(getCalls).toBe(1)
  })

  it('asks for focus instead of only waiting for it', () => {
    // A focused devtools window is the case that never delivers a focus event on its own.
    const stub = stubUnfocusedWindow()

    startPasskeyAssertion(options)

    expect(stub.focusRequests.count).toBe(1)
  })

  it('proceeds when the focus request is granted without an event', async () => {
    const stub = stubUnfocusedWindow({ grantsFocusOnRequest: true })

    const attempt = startPasskeyAssertion(options)

    expect(await attempt.diagnostics).toMatchObject({ focusedAtCall: true, waitedMs: 0 })
    expect(getCalls).toBe(1)
    expect(stub.listenerCount).toBe(0)
  })

  it('tries anyway when focus never arrives, so the browser reports the reason', async () => {
    // A button that silently does nothing is worse than one that surfaces the platform's error.
    const stub = stubUnfocusedWindow()

    const attempt = startPasskeyAssertion(options)
    stub.focusNever()

    expect(await attempt.diagnostics).toMatchObject({ resolvedBy: 'timeout', focusedAtCall: false })
    expect(getCalls).toBe(1)
  })

  it('leaves no focus listener behind either way', async () => {
    const delivered = stubUnfocusedWindow()
    const first = startPasskeyAssertion(options)
    delivered.deliverFocus()
    await first.diagnostics
    expect(delivered.listenerCount).toBe(0)

    const timedOut = stubUnfocusedWindow()
    const second = startPasskeyAssertion(options)
    timedOut.focusNever()
    await second.diagnostics
    expect(timedOut.listenerCount).toBe(0)
  })

  it('calls straight through when the document is already focused', async () => {
    vi.stubGlobal('document', { hasFocus: () => true })

    const attempt = startPasskeyAssertion(options)

    expect(getCalls).toBe(1)
    expect(await attempt.diagnostics).toMatchObject({ resolvedBy: 'already-focused', waitedMs: 0 })
  })
})

describe('describing a failure', () => {
  it('reads a plain serialised error, which is what the thunk hands back', () => {
    // `instanceof Error` is false here, and the real reason used to be replaced with generic copy.
    const serialized = { name: 'NotAllowedError', message: 'The document is not focused.' }

    expect(describeError(serialized, 'fallback')).toEqual({
      name: 'NotAllowedError',
      message: 'The document is not focused.',
    })
  })

  it('still reads a real Error', () => {
    expect(describeError(new TypeError('boom'), 'fallback')).toEqual({ name: 'TypeError', message: 'boom' })
  })

  it('falls back when there is nothing usable', () => {
    expect(describeError(null, 'fallback')).toEqual({ name: 'Error', message: 'fallback' })
    expect(describeError({}, 'fallback')).toEqual({ name: 'Error', message: 'fallback' })
  })
})

describe('explaining a refusal to the person at the keyboard', () => {
  it('turns the focus refusal into the one thing that fixes it', () => {
    // "The document is not focused." tells a developer what happened and a customer nothing.
    expect(describePasskeyFailure('NotAllowedError', 'The document is not focused.'))
      .toMatch(/click anywhere on the page/i)
  })

  it('leaves a cancelled prompt alone, because there is nothing to fix', () => {
    const cancelled = 'This request has been cancelled by the user.'

    expect(describePasskeyFailure('NotAllowedError', cancelled)).toBe(cancelled)
  })

  it('leaves unrelated failures alone', () => {
    expect(describePasskeyFailure('SecurityError', 'The origin of the document is not a valid domain.'))
      .toBe('The origin of the document is not a valid domain.')
  })
})
