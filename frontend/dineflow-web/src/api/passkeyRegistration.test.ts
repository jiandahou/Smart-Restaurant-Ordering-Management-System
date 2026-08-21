import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPasskey } from './auth'

/**
 * Creating a passkey needs the same focused document as using one, and had none of the handling.
 * It is also the only way in: someone whose first attempt fails silently has no reason to think the
 * problem is the window rather than the feature, and may simply never try again.
 */
const registerOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'localhost', name: 'DineFlow' },
  user: { id: 'dXNlcg', name: 'diner@example.com', displayName: 'Diner' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  timeout: 60_000,
}

const realWindow = globalThis.window

let createCalls: number
let createResult: () => Promise<Credential | null>

/** A window whose focus, listeners and timer this test drives by hand. */
function stubWindow({ focused }: { focused: boolean }) {
  let hasFocus = focused
  const focusListeners: Array<() => void> = []
  let pendingTimeout: (() => void) | null = null

  vi.stubGlobal('document', { hasFocus: () => hasFocus })
  vi.stubGlobal('window', {
    atob: realWindow.atob.bind(realWindow),
    PublicKeyCredential: class {},
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
    focus: () => {},
    localStorage: realWindow.localStorage,
  })

  return {
    deliverFocus: () => {
      hasFocus = true
      for (const listener of [...focusListeners]) listener()
    },
    focusNever: () => pendingTimeout?.(),
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  createCalls = 0
  createResult = () => new Promise(() => {})

  vi.stubGlobal('navigator', {
    credentials: {
      create: vi.fn(() => {
        createCalls++
        return createResult()
      }),
    },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(registerOptions), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adding a passkey while the document is unfocused', () => {
  it('holds the ceremony back rather than letting the browser refuse it', async () => {
    stubWindow({ focused: false })

    void registerPasskey('MacBook').catch(() => {})
    // Long enough for the options round trip to settle.
    await new Promise((resolve) => realWindow.setTimeout(resolve, 0))

    expect(createCalls).toBe(0)
  })

  it('creates the passkey once focus arrives', async () => {
    const stub = stubWindow({ focused: false })

    void registerPasskey('MacBook').catch(() => {})
    await new Promise((resolve) => realWindow.setTimeout(resolve, 0))
    stub.deliverFocus()
    await new Promise((resolve) => realWindow.setTimeout(resolve, 0))

    expect(createCalls).toBe(1)
  })

  it('explains a focus refusal in terms of something the person can do', async () => {
    stubWindow({ focused: true })
    createResult = () => Promise.reject(
      Object.assign(new Error('The document is not focused.'), { name: 'NotAllowedError' }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(registerPasskey('MacBook')).rejects.toThrow(/click anywhere on the page/i)
  })

  it('passes a cancelled prompt through unchanged, because there is nothing to fix', async () => {
    stubWindow({ focused: true })
    createResult = () => Promise.reject(
      Object.assign(new Error('This request has been cancelled by the user.'), { name: 'NotAllowedError' }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(registerPasskey('MacBook')).rejects.toThrow('This request has been cancelled by the user.')
  })
})

describe('adding a passkey while the document is focused', () => {
  it('calls the browser without waiting for a focus that already exists', async () => {
    stubWindow({ focused: true })

    void registerPasskey('MacBook').catch(() => {})
    await new Promise((resolve) => realWindow.setTimeout(resolve, 0))

    expect(createCalls).toBe(1)
  })
})
