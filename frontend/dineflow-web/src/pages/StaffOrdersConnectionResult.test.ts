import { describe, expect, it } from 'vitest'

// Vite hands the file over as text; reading it through node would drag node's types into an app
// config that deliberately does not carry them.
import page from './StaffOrdersPage.tsx?raw'

/**
 * That the settings dialog actually reads the recorded result.
 *
 * <p>
 * The module's own tests check that a check round-trips per route. This checks the dialog derives
 * what it shows from that record instead of from its own state — five statuses cleared by hand from
 * a dozen places is what let "Passed" and "Not tested" describe the same printer at the same moment.
 * </p>
 */
describe('the printer settings dialog', () => {
  it('derives every badge from the recorded route result', () => {
    expect(page).toContain('lastPrinterConnectionCheck(')
    for (const transport of ['qz-printer', 'qz-network', 'qz-serial', 'web-serial', 'web-usb']) {
      expect(page).toContain(`connectionTestStatus('${transport}')`)
    }
  })

  it('keeps no per-transport status of its own to fall out of step', () => {
    // The defect in one line: state the dialog owned, and therefore state the dialog could lose.
    expect(page).not.toContain('setQzPrinterTestStatus')
    expect(page).not.toContain('setQzNetworkTestStatus')
    expect(page).not.toContain('setWebUsbTestStatus')
  })

  it('does not throw the results away when the tab is switched', () => {
    // The reported trigger. Looking at the front counter is not a statement about the kitchen.
    // The tab handler alone, not a window around it: a prose comment mentioning "reset" is not a
    // call, and neither is another Tabs component further up the file.
    const handler = page
      .split('\n')
      .find((line) => line.includes("setPrinterArea(value as 'kitchen' | 'front-counter')")) ?? ''

    expect(handler).toContain('onValueChange')
    expect(handler).not.toMatch(/reset\w*\(/)
  })

  it('has no hand-rolled reset left to clear a result nothing changed', () => {
    expect(page).not.toContain('resetAllConnectionTests')
    expect(page).not.toContain('resetQzTargetTests')
  })

  it('writes a completed check to the route it was run against', () => {
    expect(page).toContain('recordPrinterConnectionCheck(printerRouteKey(printerArea, settings, transport), outcome)')
  })

  it('leaves a recorded result alone when a picker is cancelled', () => {
    // Cancelling the browser's device picker teaches nothing, and used to read as "Not tested" —
    // erasing a pass the printer had already given. Both device pickers, not just the first found.
    const cancelHandlers = page
      .split("error.name === 'NotFoundError'")
      .slice(1)
      .map((section) => section.slice(0, 120))

    expect(cancelHandlers.length).toBeGreaterThanOrEqual(2)
    expect(cancelHandlers.filter((section) => section.includes('setTestingTransport(null)')))
      .toHaveLength(2)
    expect(cancelHandlers.some((section) => section.includes("'untested'"))).toBe(false)
  })
})
