const stationKeyStorageKey = 'dineflow.printStationKey.v1'
const clientInstanceStorageKey = 'dineflow.printClientInstance.v1'
const fallbackLeasePrefix = 'dineflow.printLeader.v1.'
const acceptedJobsStorageKey = 'dineflow.printAcceptedJobs.v1'
const maximumAcceptedJobReceipts = 500

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readOrCreate(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key)
    if (existing) return existing
    const created = randomId()
    storage.setItem(key, created)
    return created
  } catch {
    return randomId()
  }
}

export function getPrintStationIdentity(): {
  stationKey: string
  clientInstanceId: string
  stationName: string
} {
  const stationKey = readOrCreate(window.localStorage, stationKeyStorageKey)
  const clientInstanceId = readOrCreate(window.sessionStorage, clientInstanceStorageKey)
  return {
    stationKey,
    clientInstanceId,
    stationName: `Kitchen station ${stationKey.slice(0, 6)}`,
  }
}

function readAcceptedJobReceipts(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(acceptedJobsStorageKey) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

/** Durable client-side handoff receipt. It closes the small gap between QZ
 * accepting a ticket and the API recording Completed: after a refresh/network
 * failure, the same station acknowledges the job instead of printing it twice. */
export function markPrintJobTransportAccepted(jobId: string): void {
  try {
    const receipts = readAcceptedJobReceipts()
    receipts[jobId] = new Date().toISOString()
    const trimmed = Object.fromEntries(
      Object.entries(receipts)
        .sort((first, second) => second[1].localeCompare(first[1]))
        .slice(0, maximumAcceptedJobReceipts),
    )
    window.localStorage.setItem(acceptedJobsStorageKey, JSON.stringify(trimmed))
  } catch {
    // Server leases/retries remain the fallback when storage is unavailable.
  }
}

export function hasPrintJobTransportReceipt(jobId: string): boolean {
  return Object.hasOwn(readAcceptedJobReceipts(), jobId)
}

type NavigatorWithLocks = Navigator & {
  locks?: {
    request<T>(
      name: string,
      options: { mode: 'exclusive'; ifAvailable: true },
      callback: (lock: unknown | null) => Promise<T | undefined>,
    ): Promise<T | undefined>
  }
}

/** Run one claim/print sweep at a time across tabs in this browser profile.
 * The server-side station lease remains authoritative across computers. */
export async function withPrintStationLeadership<T>(
  stationKey: string,
  clientInstanceId: string,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  const locks = (navigator as NavigatorWithLocks).locks
  if (locks) {
    return locks.request(
      `dineflow-print-${stationKey}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => lock ? operation() : undefined,
    )
  }

  const key = `${fallbackLeasePrefix}${stationKey}`
  const now = Date.now()
  try {
    const currentRaw = window.localStorage.getItem(key)
    const current = currentRaw ? JSON.parse(currentRaw) as { owner?: string; expiresAt?: number } : null
    if (current?.owner !== clientInstanceId && (current?.expiresAt ?? 0) > now) return undefined

    window.localStorage.setItem(key, JSON.stringify({ owner: clientInstanceId, expiresAt: now + 30_000 }))
    const verified = JSON.parse(window.localStorage.getItem(key) ?? '{}') as { owner?: string }
    if (verified.owner !== clientInstanceId) return undefined

    return await operation()
  } finally {
    try {
      const current = JSON.parse(window.localStorage.getItem(key) ?? '{}') as { owner?: string }
      if (current.owner === clientInstanceId) window.localStorage.removeItem(key)
    } catch {
      // The server lease still prevents another computer from claiming the job.
    }
  }
}
