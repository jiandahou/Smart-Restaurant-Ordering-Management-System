import { describe, expect, it } from 'vitest'
import {
  buildEscPosKitchenTicket,
  defaultThermalPrinterSettings,
  escposBeep,
  printKitchenTicketWithQzTray,
  QzTrayError,
  QZ_TRAY_DOWNLOAD_URL,
  type KitchenTicket,
} from './thermalPrinter'

const sampleTicket: KitchenTicket = {
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
})

describe('buildEscPosKitchenTicket', () => {
  const baseSettings = { paperWidth: '80mm' as const, cutPaper: true, beepOnPrint: false }

  it('includes the buzzer command only when beepOnPrint is enabled', () => {
    expect(buildEscPosKitchenTicket(sampleTicket, baseSettings)).not.toContain(escposBeep)
    expect(buildEscPosKitchenTicket(sampleTicket, { ...baseSettings, beepOnPrint: true })).toContain(escposBeep)
  })

  it('prints the order number double-sized and the scope as a reverse banner', () => {
    const ticket = buildEscPosKitchenTicket(sampleTicket, baseSettings)
    expect(ticket).toContain(`\x1d!\x11${sampleTicket.orderNumber}\x1d!\x00`)
    expect(ticket).toContain(`\x1dB\x01\x1bE\x01 ${sampleTicket.orderScope.toUpperCase()} `)
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
