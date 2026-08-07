import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEscPosKitchenTicket,
  defaultThermalPrinterSettings,
  enqueueNetworkPrint,
  escposBeep,
  formatQzPrinterConnectionLabel,
  networkPrinterCooldownMs,
  printKitchenTicketWithQzTray,
  qzKeepAliveIntervalMs,
  QzTrayError,
  QZ_TRAY_DOWNLOAD_URL,
  qzWebsocketPingIntervalSeconds,
  releaseWebSerialSession,
  testQzSerialConnection,
  testWebSerialConnection,
  testWebUsbConnection,
  type KitchenTicket,
  type QzTrayPrinterDescriptor,
} from './thermalPrinter'

const sampleTicket: KitchenTicket = {
  serviceCode: '007',
  orderNumber: 'T-001',
  restaurantName: 'Test Kitchen',
  orderScope: 'Takeaway',
  status: 'Pending',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  printedAt: new Date('2026-01-01T00:00:00Z'),
  itemCount: 1,
  items: [{ quantity: 1, name: 'Butter Chicken', optionGroups: [] }],
}

describe('printKitchenTicketWithQzTray typed errors', () => {
  it('throws QzTrayError(no-printer) before touching the connection when no printer name is set', async () => {
    const settings = { ...defaultThermalPrinterSettings, mode: 'qz-tray' as const, qzPrinterName: '' }

    await expect(printKitchenTicketWithQzTray(sampleTicket, settings)).rejects.toMatchObject({
      name: 'QzTrayError',
      reason: 'no-printer',
    })
  })

  it('exposes the official QZ Tray download URL for the settings panel', () => {
    expect(QZ_TRAY_DOWNLOAD_URL).toBe('https://qz.io/download/')
  })

  it('QzTrayError carries a machine-readable reason', () => {
    const error = new QzTrayError('not-running', 'unreachable')
    expect(error).toBeInstanceOf(Error)
    expect(error.reason).toBe('not-running')
  })

  it('keeps the QZ websocket alive more often than its 60-second default', () => {
    expect(qzWebsocketPingIntervalSeconds).toBe(15)
    expect(qzKeepAliveIntervalMs).toBe(20_000)
    expect(qzKeepAliveIntervalMs).toBeLessThan(60_000)
  })
})

describe('system printer connection labels', () => {
  const printer = {
    name: 'POS80 Printer(3)',
    driverName: 'POS80ENG',
    portName: 'USB003',
    connectionKind: 'usb',
    connectionLabel: 'USB · USB003',
    isVirtual: false,
    isDefault: false,
    sharedPortQueueCount: 1,
  } satisfies QzTrayPrinterDescriptor

  it('shows the Windows transport and port without changing the queue name', () => {
    expect(formatQzPrinterConnectionLabel(printer)).toBe('USB · USB003')
    expect(printer.name).toBe('POS80 Printer(3)')
  })

  it('warns when multiple Windows queues point at the same physical port', () => {
    expect(formatQzPrinterConnectionLabel({ ...printer, sharedPortQueueCount: 2 }))
      .toBe('USB · USB003 · shared by 2 queues')
  })

  it('still identifies a virtual queue when the local bridge has no port label', () => {
    expect(formatQzPrinterConnectionLabel({
      ...printer,
      name: 'Microsoft Print to PDF',
      portName: null,
      connectionKind: null,
      connectionLabel: null,
      isVirtual: true,
    })).toBe('Virtual printer')
  })

  it('leaves a physical queue unlabelled when connection metadata is unavailable', () => {
    expect(formatQzPrinterConnectionLabel({
      ...printer,
      portName: null,
      connectionKind: null,
      connectionLabel: null,
    })).toBeNull()
  })
})

describe('non-printing connection tests', () => {
  afterEach(async () => {
    await releaseWebSerialSession()
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'usb', { configurable: true, value: undefined })
  })

  it('rejects a QZ serial test before touching QZ when no COM port is selected', async () => {
    await expect(testQzSerialConnection('  ', 9600)).rejects.toMatchObject({
      name: 'QzTrayError',
      reason: 'no-printer',
    })
  })

  it('opens Web Serial, writes only the non-printing status request, and keeps the port open', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const close = vi.fn().mockResolvedValue(undefined)
    const port = {
      open: vi.fn().mockResolvedValue(undefined),
      close,
      writable: { getWriter: () => ({ write, releaseLock }) },
      readable: null,
    }
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: vi.fn().mockResolvedValue([port]),
        requestPort: vi.fn().mockResolvedValue(port),
      },
    })

    await expect(testWebSerialConnection(9600)).resolves.toEqual({ label: 'Serial port' })
    expect(port.open).toHaveBeenCalledWith({ baudRate: 9600 })
    expect([...write.mock.calls[0][0]]).toEqual([0x10, 0x04, 0x01])
    expect(close).not.toHaveBeenCalled()
  })

  it('claims WebUSB, writes only the non-printing status request, then releases it', async () => {
    const transferOut = vi.fn().mockResolvedValue({})
    const device = {
      opened: false,
      vendorId: 0x1234,
      productId: 0x5678,
      manufacturerName: 'Test',
      productName: 'Printer',
      configuration: {
        interfaces: [{
          interfaceNumber: 0,
          alternates: [{ endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk' }] }],
        }],
      },
      open: vi.fn().mockResolvedValue(undefined),
      selectConfiguration: vi.fn().mockResolvedValue(undefined),
      claimInterface: vi.fn().mockResolvedValue(undefined),
      releaseInterface: vi.fn().mockResolvedValue(undefined),
      transferOut,
      close: vi.fn().mockResolvedValue(undefined),
    }
    Object.defineProperty(navigator, 'usb', {
      configurable: true,
      value: {
        getDevices: vi.fn().mockResolvedValue([device]),
        requestDevice: vi.fn().mockResolvedValue(device),
      },
    })

    await expect(testWebUsbConnection({
      ...defaultThermalPrinterSettings,
      mode: 'web-usb',
      usbVendorId: '0x1234',
      usbProductId: '0x5678',
      usbInterfaceNumber: 0,
      usbEndpointNumber: 1,
    })).resolves.toMatchObject({
      label: 'Test Printer',
      interfaceNumber: 0,
      endpointNumber: 1,
    })
    expect([...transferOut.mock.calls[0][1]]).toEqual([0x10, 0x04, 0x01])
    expect(device.claimInterface).toHaveBeenCalledWith(0)
    expect(device.releaseInterface).toHaveBeenCalledWith(0)
    expect(device.close).toHaveBeenCalled()
  })
})

describe('buildEscPosKitchenTicket', () => {
  const baseSettings = { paperWidth: '80mm' as const, cutPaper: true, beepOnPrint: false }

  it('includes the buzzer command only when beepOnPrint is enabled', () => {
    expect(buildEscPosKitchenTicket(sampleTicket, baseSettings)).not.toContain(escposBeep)
    expect(buildEscPosKitchenTicket(sampleTicket, { ...baseSettings, beepOnPrint: true })).toContain(escposBeep)
  })

  it('prints the called service code double-sized and the scope as a reverse banner', () => {
    const ticket = buildEscPosKitchenTicket(sampleTicket, baseSettings)
    expect(ticket).toContain(`\x1d!\x11${sampleTicket.serviceCode}\x1d!\x00`)
    expect(ticket).toContain(`\x1dB\x01\x1bE\x01 ${sampleTicket.orderScope.toUpperCase()} `)
  })

  it('keeps the order number in small print so tickets stay reconcilable', () => {
    const ticket = buildEscPosKitchenTicket(sampleTicket, baseSettings)
    expect(ticket).toContain('ORDER')
    expect(ticket).toContain(sampleTicket.orderNumber)
    // ...but not blown up as the number the kitchen works from.
    expect(ticket).not.toContain(`\x1d!\x11${sampleTicket.orderNumber}\x1d!\x00`)
  })

  it('does not print the order number twice when the code fell back to it', () => {
    const legacy = { ...sampleTicket, serviceCode: sampleTicket.orderNumber }
    const ticket = buildEscPosKitchenTicket(legacy, baseSettings)
    expect(ticket).toContain(`\x1d!\x11${legacy.orderNumber}\x1d!\x00`)
    expect(ticket).not.toContain('ORDER')
  })

  it('keeps every control byte in the ASCII range so UTF-8 encoding is byte-safe', () => {
    const ticket = buildEscPosKitchenTicket(sampleTicket, { ...baseSettings, beepOnPrint: true })
    for (const char of ticket) {
      const code = char.charCodeAt(0)
      if (code < 0x20 && !['\n', '\x1b', '\x1d'].includes(char)) {
        expect(code).toBeLessThan(0x80)
      }
    }
    expect([...ticket].every((char) => char.charCodeAt(0) <= 0x7f || /\p{L}/u.test(char))).toBe(true)
  })

  it('emits the cut command only when cutPaper is enabled', () => {
    expect(buildEscPosKitchenTicket(sampleTicket, baseSettings)).toContain('\x1dV\x41\x00')
    expect(buildEscPosKitchenTicket(sampleTicket, { ...baseSettings, cutPaper: false })).not.toContain('\x1dV\x41\x00')
  })
})

describe('enqueueNetworkPrint', () => {
  // Regression coverage for a real incident: firing several network prints back
  // to back (or auto-print draining a backlog) opened overlapping TCP
  // connections to a cheap embedded WiFi printer, which silently dropped all
  // but one — while QZ's print() still resolved as "success" for every call.

  it('never runs two tasks for the same printer at once, and completes them in call order', async () => {
    const host = '192.168.1.50'
    const port = 9100
    let concurrent = 0
    let maxConcurrent = 0
    const completedOrder: number[] = []

    const makeTask = (id: number, delayMs: number) => async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      completedOrder.push(id)
      concurrent -= 1
    }

    await Promise.all([
      enqueueNetworkPrint(host, port, makeTask(1, 30), 5),
      enqueueNetworkPrint(host, port, makeTask(2, 10), 5),
      enqueueNetworkPrint(host, port, makeTask(3, 5), 5),
    ])

    expect(maxConcurrent).toBe(1)
    expect(completedOrder).toEqual([1, 2, 3])
  })

  it('does not block prints to a different printer', async () => {
    // Distinct hosts from the other tests in this file: networkPrintChains is
    // module-level state that persists across tests, and reusing a host would
    // queue behind a prior test's leftover cool-down instead of proving anything.
    let concurrent = 0
    let maxConcurrent = 0
    const task = () => async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 20))
      concurrent -= 1
    }

    await Promise.all([
      enqueueNetworkPrint('10.0.0.10', 9100, task(), 0),
      enqueueNetworkPrint('10.0.0.11', 9100, task(), 0),
    ])

    expect(maxConcurrent).toBe(2)
  })

  it('a failed print does not jam the queue for the next one', async () => {
    const host = '10.0.0.12'
    const port = 9100

    await expect(
      enqueueNetworkPrint(host, port, async () => {
        throw new Error('printer offline')
      }, 0),
    ).rejects.toThrow('printer offline')

    await expect(enqueueNetworkPrint(host, port, async () => 'ok', 0)).resolves.toBe('ok')
  })

  it('uses a conservative five-second production cool-down', () => {
    expect(networkPrinterCooldownMs).toBe(5_000)
  })

  it('waits for the configured cool-down before starting the next task', async () => {
    const startedAt: number[] = []
    const host = '10.0.0.13'

    await Promise.all([
      enqueueNetworkPrint(host, 9100, async () => {
        startedAt.push(Date.now())
      }, 40),
      enqueueNetworkPrint(host, 9100, async () => {
        startedAt.push(Date.now())
      }, 0),
    ])

    expect(startedAt).toHaveLength(2)
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(30)
  })
})
