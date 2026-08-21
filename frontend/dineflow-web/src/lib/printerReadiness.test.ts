import { beforeEach, describe, expect, it } from 'vitest'
import {
  defaultThermalPrinterSettings,
  probePrinterReadiness,
  type PrinterProbes,
  type ThermalPrinterSettings,
} from './thermalPrinter'

/**
 * FS-021. The QZ Tray status describes the websocket between the page and the desktop app, both on
 * the same machine — it stays "connected" when the laptop leaves the shop or the printer is
 * unplugged. These pin the behaviour that actually answers "will a ticket come out".
 */
let probes: PrinterProbes

beforeEach(() => {
  probes = {
    isQzConnected: () => true,
    listPrinters: async () => ['Kitchen POS80'],
    listSerialPorts: async () => ['COM3'],
    probeNetwork: async () => true,
    checkHealth: async () => ({ ok: true, status: 'READY' }),
    getSerialSession: () => ({}),
  }
})

function settings(overrides: Partial<ThermalPrinterSettings> = {}): ThermalPrinterSettings {
  return { ...defaultThermalPrinterSettings, ...overrides }
}

describe('network printers', () => {
  const networked = () => settings({
    mode: 'qz-tray', qzTargetType: 'network', qzNetworkHost: '192.168.1.50', qzNetworkPort: 9100,
  })

  it('is ready when the printer accepts a socket', async () => {
    expect((await probePrinterReadiness(networked(), probes)).state).toBe('ready')
  })

  it('is unreachable when it does not answer — the away-from-the-shop case', async () => {
    probes.probeNetwork = async () => false
    const readiness = await probePrinterReadiness(networked(), probes)

    expect(readiness.state).toBe('unreachable')
    expect(readiness.detail).toContain('192.168.1.50:9100')
  })

  it('reports missing configuration separately from being unreachable', async () => {
    const readiness = await probePrinterReadiness(
      settings({ mode: 'qz-tray', qzTargetType: 'network', qzNetworkHost: '   ' }),
      probes,
    )

    expect(readiness.state).toBe('not-configured')
  })
})

describe('operating-system print queues', () => {
  const queued = () => settings({
    mode: 'qz-tray', qzTargetType: 'printer', qzPrinterName: 'Kitchen POS80',
  })

  it('is ready when the queue exists and reports no fault', async () => {
    expect((await probePrinterReadiness(queued(), probes)).state).toBe('ready')
  })

  it('is unreachable once the queue disappears, which is what unplugging USB looks like', async () => {
    probes.listPrinters = async () => []
    const readiness = await probePrinterReadiness(queued(), probes)

    expect(readiness.state).toBe('unreachable')
    expect(readiness.detail).toContain('no longer installed')
  })

  it('is unreachable when the spooler reports a fault', async () => {
    probes.checkHealth = async () => ({ ok: false, status: 'PAPER_OUT' })
    const readiness = await probePrinterReadiness(queued(), probes)

    expect(readiness.state).toBe('unreachable')
    expect(readiness.detail).toContain('PAPER_OUT')
  })

  it('is unreachable when QZ Tray itself is gone', async () => {
    probes.isQzConnected = () => false

    expect((await probePrinterReadiness(queued(), probes)).state).toBe('unreachable')
  })
})

describe('serial ports', () => {
  it('is unreachable once the COM port vanishes', async () => {
    probes.listSerialPorts = async () => ['COM7']
    const readiness = await probePrinterReadiness(
      settings({ mode: 'qz-tray', qzTargetType: 'serial', qzSerialPort: 'COM3' }),
      probes,
    )

    expect(readiness.state).toBe('unreachable')
  })
})

describe('web serial', () => {
  it('is unreachable once the browser session is gone', async () => {
    probes.getSerialSession = () => null

    expect((await probePrinterReadiness(settings({ mode: 'web-serial' }), probes)).state)
      .toBe('unreachable')
  })
})

describe('modes with nothing to probe', () => {
  it('treats browser printing as always available', async () => {
    expect((await probePrinterReadiness(settings({ mode: 'browser' }), probes)).state).toBe('ready')
  })

  it('admits when a transport cannot be verified without printing', async () => {
    // Claiming "ready" here would recreate the very false confidence this replaces.
    const readiness = await probePrinterReadiness(
      settings({ mode: 'web-usb', usbVendorId: '0x1234', usbProductId: '0x5678' }),
      probes,
    )

    expect(readiness.state).toBe('unknown')
  })
})

describe('failures', () => {
  it('reports a thrown probe as unreachable rather than crashing the heartbeat', async () => {
    probes.listPrinters = async () => { throw new Error('QZ went away mid-probe') }
    const readiness = await probePrinterReadiness(
      settings({ mode: 'qz-tray', qzTargetType: 'printer', qzPrinterName: 'Kitchen POS80' }),
      probes,
    )

    expect(readiness.state).toBe('unreachable')
    expect(readiness.detail).toContain('QZ went away mid-probe')
  })
})

/**
 * FS-021 follow-up. A verdict that only refreshes on a timer looks broken: staff open a screen
 * that has been asleep, see a stale "connected", and conclude they have to reload the page.
 */
describe('when the verdict is refreshed', () => {
  const context = (import.meta.glob('../printing/RestaurantPrintingContext.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>)['../printing/RestaurantPrintingContext.tsx']

  const probeEffect = () => {
    const start = context.indexOf('const probeIfVisible')
    expect(start).toBeGreaterThanOrEqual(0)
    return context.slice(context.lastIndexOf('useEffect', start), context.indexOf('}, [canUseRestaurantPrinting', start))
  }

  it('probes as soon as the tab is looked at again, not only on the interval', () => {
    const body = probeEffect()

    expect(body).toContain("addEventListener('visibilitychange'")
    expect(body).toContain("addEventListener('focus'")
  })

  it('removes its listeners when the provider unmounts', () => {
    const body = probeEffect()

    expect(body).toContain("removeEventListener('visibilitychange'")
    expect(body).toContain("removeEventListener('focus'")
  })

  it('re-probes when the configured printer changes, so the answer is about the right one', () => {
    expect(context).toContain('printerTargetKey')
    expect(context).toContain('}, [canUseRestaurantPrinting, printerTargetKey, qzConnectionStatus])')
  })

  it('waits for QZ startup and re-probes as soon as the websocket connects', () => {
    const body = probeEffect()

    expect(body).toContain("qzConnectionStatus !== 'connected'")
    expect(body).toContain('setPrinterReadiness(null)')
    expect(context).toContain("isQzTrayConnected() ? 'connected' : 'checking'")
  })

  it('re-probes after a print fails', () => {
    // Otherwise a failure toast sits next to a "ready" badge.
    expect(context).toContain('void probePrinterReadiness(settingsRef.current).then(setPrinterReadiness)')
  })

  it('does not poll a hidden tab', () => {
    expect(probeEffect()).toContain("document.visibilityState === 'visible'")
  })
})
