import type { ThermalPrinterSettings } from '@/lib/thermalPrinter'

/**
 * The last connection check for each printer route, remembered per device.
 *
 * <p>
 * The result lived in the settings dialog's own state, so switching to the front counter tab and
 * back — or reopening the dialog from the print-tasks banner — showed "Not tested" beside a panel
 * still saying the printer had responded. Two readiness claims about one printer, disagreeing, is
 * worse than the pessimistic one alone: staff stop believing either.
 * </p>
 *
 * <p>
 * Keyed by the route rather than stored as a single flag, which is what makes invalidation fall out
 * for free: point the kitchen at a different printer and the key changes, so the old pass cannot be
 * mistaken for a statement about the new target. Looking at a different tab is not a configuration
 * change and no longer reads as one.
 * </p>
 */

const storageKey = 'dineflow.printerConnectionChecks'

/** How many routes to remember. A device works through a handful; the rest is landfill. */
const maximumRemembered = 12

export type PrinterArea = 'kitchen' | 'front-counter'

/** Which way of reaching a printer was checked. One route may offer several. */
export type PrinterTransport = 'qz-printer' | 'qz-network' | 'qz-serial' | 'web-serial' | 'web-usb'

export type PrinterCheckOutcome = 'succeeded' | 'failed'

export type PrinterConnectionCheck = {
  outcome: PrinterCheckOutcome
  /** ISO instant, so the badge can say when rather than implying "just now". */
  at: string
}

/**
 * A stable name for one printer route.
 *
 * <p>
 * The target is part of the name on purpose. A pass belongs to the printer that answered, not to
 * the dialog, so renaming or repointing the target retires the old result without anything having
 * to remember to clear it.
 * </p>
 */
export function printerRouteKey(
  area: PrinterArea,
  settings: ThermalPrinterSettings,
  transport: PrinterTransport,
): string {
  const target =
    transport === 'qz-printer' ? settings.qzPrinterName.trim()
    : transport === 'qz-network' ? `${settings.qzNetworkHost.trim()}:${settings.qzNetworkPort}`
    // Baud rate belongs in the name as much as the port does: a port that answered at 9600 is no
    // evidence about the same port at 115200, and nothing else would retire that result.
    : transport === 'qz-serial' ? `${settings.qzSerialPort.trim()}@${settings.serialBaudRate}`
    : transport === 'web-serial' ? `@${settings.serialBaudRate}`
    // A Web USB target is chosen through a browser picker and carries no identity we may keep, so
    // the interface it answered on is the most specific the route gets.
    : `${settings.usbInterfaceNumber}/${settings.usbEndpointNumber}`

  return [area, transport, target].join('|')
}

export function loadPrinterConnectionChecks(): Record<string, PrinterConnectionCheck> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}

    const stored = JSON.parse(raw) as Record<string, Partial<PrinterConnectionCheck>>
    const checks: Record<string, PrinterConnectionCheck> = {}

    for (const [key, value] of Object.entries(stored ?? {})) {
      // Anything that is not a recognisable outcome is dropped rather than shown: an unreadable
      // record is no evidence the printer answered.
      if (value?.outcome !== 'succeeded' && value?.outcome !== 'failed') continue
      if (typeof value.at !== 'string') continue

      checks[key] = { outcome: value.outcome, at: value.at }
    }

    return checks
  } catch {
    return {}
  }
}

/** Records one result and returns the whole set, newest kept. */
export function recordPrinterConnectionCheck(
  key: string,
  outcome: PrinterCheckOutcome,
  at: Date = new Date(),
): Record<string, PrinterConnectionCheck> {
  const checks = { ...loadPrinterConnectionChecks(), [key]: { outcome, at: at.toISOString() } }
  const kept = Object.entries(checks)
    .sort(([, first], [, second]) => second.at.localeCompare(first.at))
    .slice(0, maximumRemembered)

  const trimmed = Object.fromEntries(kept)

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(trimmed))
    } catch {
      // Losing the record is survivable — the badge reverts to "Not tested", which is where it was
      // before any of this existed. Taking the settings dialog down with it is not.
    }
  }

  return trimmed
}

/** What to show for one route: its recorded outcome, or nothing if it has never been checked. */
export function lastPrinterConnectionCheck(
  checks: Record<string, PrinterConnectionCheck>,
  key: string,
): PrinterConnectionCheck | null {
  return checks[key] ?? null
}
