const autoPrintLedgerStorageKey = 'dineflow.autoPrintLedger.v1'
const maxPrintedOrders = 2_000

type StoredAutoPrintLedger = {
  version: 1
  enabledAt: string | null
  printedOrders: Record<string, string>
}

export type AutoPrintLedger = {
  enabledAt: number | null
  printedOrderIds: Set<string>
}

let memoryFallback: StoredAutoPrintLedger | null = null

function emptyLedger(): StoredAutoPrintLedger {
  return {
    version: 1,
    enabledAt: null,
    printedOrders: {},
  }
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeLedger(value: unknown): StoredAutoPrintLedger {
  if (!value || typeof value !== 'object') return emptyLedger()

  const candidate = value as Partial<StoredAutoPrintLedger>
  const printedEntries = Object.entries(candidate.printedOrders ?? {})
    .filter(([orderId, printedAt]) => orderId.trim().length > 0 && parseTimestamp(printedAt) !== null)
    .sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))
    .slice(0, maxPrintedOrders)

  return {
    version: 1,
    enabledAt: parseTimestamp(candidate.enabledAt) === null ? null : candidate.enabledAt!,
    printedOrders: Object.fromEntries(printedEntries),
  }
}

function readStoredLedger(): StoredAutoPrintLedger {
  try {
    const raw = window.localStorage.getItem(autoPrintLedgerStorageKey)
    if (!raw) return memoryFallback ?? emptyLedger()
    const ledger = normalizeLedger(JSON.parse(raw))
    memoryFallback = ledger
    return ledger
  } catch {
    return memoryFallback ?? emptyLedger()
  }
}

function writeStoredLedger(ledger: StoredAutoPrintLedger): void {
  const normalized = normalizeLedger(ledger)
  memoryFallback = normalized

  try {
    window.localStorage.setItem(autoPrintLedgerStorageKey, JSON.stringify(normalized))
  } catch {
    // Private browsing/storage restrictions: the in-memory fallback still
    // prevents duplicates until the page closes.
  }
}

/**
 * Persist the actual moment auto-print changes state. This replaces the old
 * component-mount "first scan" flag: a reload keeps the same cutoff instead of
 * silently adopting every currently visible order as handled.
 */
export function setAutoPrintEnabled(enabled: boolean, changedAt = new Date()): void {
  const ledger = readStoredLedger()
  ledger.enabledAt = enabled ? changedAt.toISOString() : null
  writeStoredLedger(ledger)
}

/**
 * Read the durable ledger. Existing installations that already had auto-print
 * enabled predate this ledger, so their one-time migration records the current
 * time as the enable cutoff. This preserves the historical-backlog protection
 * without reprinting active tickets that were produced before the ledger existed.
 */
export function readAutoPrintLedger(autoPrintEnabled: boolean, initializedAt = new Date()): AutoPrintLedger {
  const ledger = readStoredLedger()
  let enabledAt = parseTimestamp(ledger.enabledAt)

  // A short-lived buggy build used the Unix epoch for existing installations,
  // which selected the entire historical backlog. Treat that sentinel exactly
  // like a missing cutoff and migrate it once without discarding printed IDs.
  if (autoPrintEnabled && (enabledAt === null || enabledAt === 0)) {
    ledger.enabledAt = initializedAt.toISOString()
    enabledAt = initializedAt.getTime()
    writeStoredLedger(ledger)
  }

  return {
    enabledAt: autoPrintEnabled ? enabledAt : null,
    printedOrderIds: new Set(Object.keys(ledger.printedOrders)),
  }
}

export function markOrderPrinted(orderId: string, printedAt = new Date()): void {
  const normalizedOrderId = orderId.trim()
  if (!normalizedOrderId) return

  const ledger = readStoredLedger()
  ledger.printedOrders[normalizedOrderId] = printedAt.toISOString()
  writeStoredLedger(ledger)
}

export function shouldAutoPrintOrder(
  order: { id: string; createdAt: string },
  ledger: AutoPrintLedger,
): boolean {
  if (ledger.enabledAt === null || ledger.printedOrderIds.has(order.id)) return false

  const createdAt = Date.parse(order.createdAt)
  // If the server returned a malformed timestamp, do not silently discard the
  // ticket. Let the normal print path surface it and record the order ID.
  return !Number.isFinite(createdAt) || createdAt >= ledger.enabledAt
}

export function resetAutoPrintLedgerForTests(): void {
  memoryFallback = null
  try {
    window.localStorage.removeItem(autoPrintLedgerStorageKey)
  } catch {
    // Test helper remains safe when storage is unavailable.
  }
}
