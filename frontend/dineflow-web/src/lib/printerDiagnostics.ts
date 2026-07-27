const printerDiagnosticsStorageKey = 'dineflow.printerDiagnostics.v1'
const maxDiagnosticEntries = 500

export type PrinterDiagnosticDetails = Record<string, string | number | boolean | null | undefined>

export type PrinterDiagnosticEntry = {
  at: string
  sessionId: string
  event: string
  details: PrinterDiagnosticDetails
}

const sessionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`

let memoryEntries: PrinterDiagnosticEntry[] = []

function readEntries(): PrinterDiagnosticEntry[] {
  try {
    const raw = window.localStorage.getItem(printerDiagnosticsStorageKey)
    if (!raw) return memoryEntries
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return memoryEntries
    return parsed.slice(-maxDiagnosticEntries) as PrinterDiagnosticEntry[]
  } catch {
    return memoryEntries
  }
}

export function recordPrinterDiagnostic(event: string, details: PrinterDiagnosticDetails = {}): void {
  const entry: PrinterDiagnosticEntry = {
    at: new Date().toISOString(),
    sessionId,
    event,
    details,
  }
  const entries = [...readEntries(), entry].slice(-maxDiagnosticEntries)
  memoryEntries = entries

  try {
    window.localStorage.setItem(printerDiagnosticsStorageKey, JSON.stringify(entries))
  } catch {
    // Keep the session copy when persistent storage is unavailable.
  }

  console.info(`[Printer diagnostic] ${event}`, details)
}

export function downloadPrinterDiagnostics(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    entries: readEntries(),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `dineflow-printer-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
