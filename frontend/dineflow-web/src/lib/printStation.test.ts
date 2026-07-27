import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPrintStationIdentity,
  hasPrintJobTransportReceipt,
  markPrintJobTransportAccepted,
  withPrintStationLeadership,
} from './printStation'

describe('print station leadership', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('keeps one station identity across reloads and one client identity per tab session', () => {
    const first = getPrintStationIdentity()
    const second = getPrintStationIdentity()

    expect(second.stationKey).toBe(first.stationKey)
    expect(second.clientInstanceId).toBe(first.clientInstanceId)
    expect(second.stationName).toContain(first.stationKey.slice(0, 6))
  })

  it('persists a transport receipt across page sessions to prevent duplicate recovery prints', () => {
    expect(hasPrintJobTransportReceipt('job-1')).toBe(false)

    markPrintJobTransportAccepted('job-1')

    expect(hasPrintJobTransportReceipt('job-1')).toBe(true)
  })

  it('does not run when another tab owns the browser lock', async () => {
    const operation = vi.fn(async () => 'printed')
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(async (
          _name: string,
          _options: unknown,
          callback: (lock: unknown | null) => Promise<string | undefined>,
        ) => callback(null)),
      },
    })

    await expect(withPrintStationLeadership('station', 'client', operation)).resolves.toBeUndefined()
    expect(operation).not.toHaveBeenCalled()
  })

  it('runs exactly once when this tab receives the browser lock', async () => {
    const operation = vi.fn(async () => 'printed')
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(async (
          _name: string,
          _options: unknown,
          callback: (lock: unknown | null) => Promise<string | undefined>,
        ) => callback({ name: 'dineflow-print-station' })),
      },
    })

    await expect(withPrintStationLeadership('station', 'client', operation)).resolves.toBe('printed')
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
