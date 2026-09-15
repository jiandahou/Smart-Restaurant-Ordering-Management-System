import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QzTrayError, connectQzTray } from './thermalPrinter'

/**
 * Connecting is what sets printer discovery going, and discovery is signed.
 *
 * <p>
 * Signing is staff-only and goes through the backend, so between a page load and the session being
 * restored — and again after a session expires — nothing can be signed. Connecting anyway put a
 * stream of unsignable calls on the wire; before signing failures were made to fail closed, they
 * reached QZ Tray unsigned and it answered with its native "Cannot verify trust — Invalid Signature"
 * dialog, which names no application and cannot be dismissed for good.
 * </p>
 *
 * <p>
 * The certificate half has the same shape. qz-tray's default on a failed certificate is to connect
 * with <code>certificate: null</code> rather than to give up, which is an anonymous connection and
 * the other route to the same dialog.
 * </p>
 */

const connect = vi.hoisted(() => vi.fn(async () => undefined))
const isActive = vi.hoisted(() => vi.fn(() => false))
const setCertificatePromise = vi.hoisted(() => vi.fn())
// The trust chain is wired once, on the first connection that gets that far, so what qz-tray was
// handed is kept here — clearing the mocks between tests would otherwise lose it.
const wiring = vi.hoisted(() => ({
  signatureFactory: null as
    | ((data: string) => (resolve: (value: string) => void, reject: (reason: unknown) => void) => void)
    | null,
  certificateOptions: undefined as unknown,
}))
const setSignaturePromise = vi.hoisted(() => vi.fn())

vi.mock('qz-tray', () => ({
  default: {
    websocket: {
      connect,
      isActive,
      disconnect: vi.fn(async () => undefined),
      setErrorCallbacks: vi.fn(),
      setClosedCallbacks: vi.fn(),
    },
    api: {
      getVersion: vi.fn(async () => '2.2.6'),
      setPromiseType: vi.fn(),
      setSha256Type: vi.fn(),
    },
    security: {
      setCertificatePromise: (handler: unknown, options: unknown) => {
        wiring.certificateOptions = options
        setCertificatePromise(handler, options)
      },
      setSignatureAlgorithm: vi.fn(),
      setSignaturePromise: (factory: typeof wiring.signatureFactory) => {
        wiring.signatureFactory = factory
        setSignaturePromise(factory)
      },
    },
    printers: { find: vi.fn(async () => []) },
  },
}))

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('opening a QZ Tray connection', () => {
  it('refuses to connect while nothing can be signed', async () => {
    await expect(connectQzTray('test')).rejects.toBeInstanceOf(QzTrayError)
    expect(connect).not.toHaveBeenCalled()
  })

  it('names the reason so the page can explain it instead of QZ', async () => {
    await expect(connectQzTray('test')).rejects.toMatchObject({ reason: 'not-signed' })
  })

  /**
   * Both facts are asserted here because the trust chain is wired once, on the first connection that
   * gets that far — a later test would find the wiring already done and nothing to observe.
   *
   * <p>
   * The certificate option is the second half of failing closed: left at qz-tray's default, a
   * certificate that cannot be fetched is swallowed and the connection proceeds with
   * <code>certificate: null</code> — anonymous, trusted by nothing, remembered by nothing.
   * </p>
   */
  it('connects once a staff session is there to sign with, and refuses to go anonymous', async () => {
    localStorage.setItem('dineflow.auth.token', 'staff-token')

    await connectQzTray('test')

    expect(connect).toHaveBeenCalledTimes(1)
    expect(wiring.certificateOptions).toEqual({ rejectOnFailure: true })
  })

  /**
   * What the signature hook hands back when signing fails.
   *
   * <p>
   * qz-tray does <code>obj.signature = signature || ""</code> and then sends the request either way,
   * so resolving with an empty string is not a refusal — it puts an unsigned request on the wire, and
   * that is the request QZ answers with "Invalid Signature". Only rejecting drops the call: its catch
   * branch rejects the caller and never reaches <code>connection.send</code>.
   * </p>
   *
   * <p>
   * Asserted against the hook qz-tray was actually given, rather than against the function it wraps,
   * because the two have been wired together wrongly before.
   * </p>
   */
  it('hands qz-tray a refusal, never an empty signature, when signing fails', async () => {
    localStorage.setItem('dineflow.auth.token', 'staff-token')
    await connectQzTray('test')

    const factory = wiring.signatureFactory
    expect(factory).not.toBeNull()

    // No session, so signing cannot succeed.
    localStorage.clear()

    const settled = await new Promise<{ outcome: string; value?: unknown }>((done) => {
      factory!('data')(
        (value) => done({ outcome: 'resolved', value }),
        (reason) => done({ outcome: 'rejected', value: reason }),
      )
    })

    expect(settled.outcome).toBe('rejected')
  })
})
