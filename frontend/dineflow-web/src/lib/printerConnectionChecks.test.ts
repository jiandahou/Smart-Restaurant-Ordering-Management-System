import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultThermalPrinterSettings, type ThermalPrinterSettings } from './thermalPrinter'
import {
  lastPrinterConnectionCheck,
  loadPrinterConnectionChecks,
  printerRouteKey,
  recordPrinterConnectionCheck,
} from './printerConnectionChecks'

/**
 * "Test connection: Passed" and "Not tested" were both on screen for the same printer, because the
 * result lived in the dialog and the dialog kept being rebuilt. Two readiness claims that disagree
 * are worse than the pessimistic one alone — staff stop believing either, and then stop checking.
 */
const settings = (overrides: Partial<ThermalPrinterSettings> = {}): ThermalPrinterSettings => ({
  ...defaultThermalPrinterSettings,
  ...overrides,
})

describe('what a printer route is called', () => {
  it('separates the kitchen from the front counter', () => {
    // The reported defect: switching tabs threw the result away because one set of state had to
    // serve both. Two names means neither has to be cleared to show the other.
    const kitchen = printerRouteKey('kitchen', settings({ qzPrinterName: 'star' }), 'qz-printer')
    const counter = printerRouteKey('front-counter', settings({ qzPrinterName: 'star' }), 'qz-printer')

    expect(kitchen).not.toBe(counter)
  })

  it('changes when the route is pointed somewhere else', () => {
    // This is the invalidation: a pass belongs to the printer that answered, so repointing retires
    // it without anything having to remember to.
    expect(printerRouteKey('kitchen', settings({ qzPrinterName: 'star' }), 'qz-printer'))
      .not.toBe(printerRouteKey('kitchen', settings({ qzPrinterName: 'epson' }), 'qz-printer'))

    expect(printerRouteKey('kitchen', settings({ qzNetworkHost: '10.0.0.5', qzNetworkPort: 9100 }), 'qz-network'))
      .not.toBe(printerRouteKey('kitchen', settings({ qzNetworkHost: '10.0.0.6', qzNetworkPort: 9100 }), 'qz-network'))
  })

  it('treats a different baud rate as a different route', () => {
    // A port that answered at 9600 is no evidence about the same port at 115200, and the port name
    // alone would have carried the old pass across.
    expect(printerRouteKey('kitchen', settings({ qzSerialPort: 'COM3', serialBaudRate: 9600 }), 'qz-serial'))
      .not.toBe(printerRouteKey('kitchen', settings({ qzSerialPort: 'COM3', serialBaudRate: 115200 }), 'qz-serial'))
  })

  it('keeps the transports apart even when their targets collide', () => {
    // Contrived but reachable: a Windows printer share happens to be named the way the serial
    // target is spelled. Without the transport in the name, reaching the same box two different
    // ways would share one result, and a serial pass would vouch for the USB cable.
    const config = settings({ qzPrinterName: 'COM3@9600', qzSerialPort: 'COM3', serialBaudRate: 9600 })

    expect(printerRouteKey('kitchen', config, 'qz-printer'))
      .not.toBe(printerRouteKey('kitchen', config, 'qz-serial'))
  })
})

describe('remembering a check', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('survives the dialog being rebuilt', () => {
    const key = printerRouteKey('kitchen', settings({ qzPrinterName: 'star' }), 'qz-printer')

    recordPrinterConnectionCheck(key, 'succeeded')

    expect(lastPrinterConnectionCheck(loadPrinterConnectionChecks(), key)?.outcome).toBe('succeeded')
  })

  it('says nothing about a route that was never checked', () => {
    const checked = printerRouteKey('kitchen', settings({ qzPrinterName: 'star' }), 'qz-printer')
    const other = printerRouteKey('front-counter', settings({ qzPrinterName: 'star' }), 'qz-printer')

    recordPrinterConnectionCheck(checked, 'succeeded')

    expect(lastPrinterConnectionCheck(loadPrinterConnectionChecks(), other)).toBeNull()
  })

  it('keeps a failure as firmly as a pass', () => {
    const key = printerRouteKey('kitchen', settings({ qzPrinterName: 'star' }), 'qz-printer')

    recordPrinterConnectionCheck(key, 'failed')

    expect(lastPrinterConnectionCheck(loadPrinterConnectionChecks(), key)?.outcome).toBe('failed')
  })

  it('replaces an earlier result for the same route', () => {
    const key = printerRouteKey('kitchen', settings({ qzPrinterName: 'star' }), 'qz-printer')

    recordPrinterConnectionCheck(key, 'failed', new Date('2026-08-20T01:00:00Z'))
    recordPrinterConnectionCheck(key, 'succeeded', new Date('2026-08-20T02:00:00Z'))

    expect(lastPrinterConnectionCheck(loadPrinterConnectionChecks(), key)?.outcome).toBe('succeeded')
  })

  it('records when, so a pass cannot silently imply "just now"', () => {
    const key = printerRouteKey('kitchen', settings({ qzPrinterName: 'star' }), 'qz-printer')

    recordPrinterConnectionCheck(key, 'succeeded', new Date('2026-08-20T02:00:00Z'))

    expect(lastPrinterConnectionCheck(loadPrinterConnectionChecks(), key)?.at)
      .toBe('2026-08-20T02:00:00.000Z')
  })

  it('forgets the oldest routes rather than growing without bound', () => {
    for (let index = 0; index < 20; index += 1) {
      recordPrinterConnectionCheck(
        printerRouteKey('kitchen', settings({ qzPrinterName: `printer-${index}` }), 'qz-printer'),
        'succeeded',
        new Date(Date.UTC(2026, 7, 20, index)),
      )
    }

    const checks = loadPrinterConnectionChecks()

    expect(Object.keys(checks).length).toBeLessThanOrEqual(12)
    // The newest survives; the first one tried a fortnight ago does not.
    expect(lastPrinterConnectionCheck(checks, printerRouteKey('kitchen', settings({ qzPrinterName: 'printer-19' }), 'qz-printer'))).not.toBeNull()
    expect(lastPrinterConnectionCheck(checks, printerRouteKey('kitchen', settings({ qzPrinterName: 'printer-0' }), 'qz-printer'))).toBeNull()
  })

  it('drops a record it cannot read rather than showing it as a pass', () => {
    // An unreadable record is no evidence the printer answered.
    window.localStorage.setItem(
      'dineflow.printerConnectionChecks',
      JSON.stringify({ 'kitchen|qz-printer|star': { outcome: 'probably', at: '2026-08-20' } }),
    )

    expect(loadPrinterConnectionChecks()).toEqual({})
  })

  it('survives unreadable storage', () => {
    window.localStorage.setItem('dineflow.printerConnectionChecks', 'not json')

    expect(loadPrinterConnectionChecks()).toEqual({})
  })

  it('does not take the dialog down when storage refuses the write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => recordPrinterConnectionCheck('kitchen|qz-printer|star', 'succeeded')).not.toThrow()

    setItem.mockRestore()
  })
})
