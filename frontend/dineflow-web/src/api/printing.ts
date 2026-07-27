import { request, type AdminOrder } from '@/api/auth'

export type PrintJobState =
  | 'Pending'
  | 'Claimed'
  | 'Sending'
  | 'SpoolAccepted'
  | 'PrinterResponded'
  | 'Completed'
  | 'Failed'
  | 'DeadLetter'
  | 'Cancelled'

export type PrintStation = {
  id: string
  restaurantId: string
  stationKey: string
  name: string
  autoPrintEnabled: boolean
  autoPrintEnabledAt: string | null
  leaseHeldByAnotherClient: boolean
  leaseExpiresAt: string | null
  lastSeenAt: string | null
  qzStatus: string | null
  printerStatus: string | null
  printerName: string | null
  connectionType: string | null
  qzVersion: string | null
  lastError: string | null
  lastSuccessfulPrintAt: string | null
  updatedAt: string
}

export type PrintJob = {
  id: string
  orderId: string
  restaurantId: string
  ticketRevision: number
  trigger: 'Automatic' | 'Manual' | 'Reprint'
  state: PrintJobState
  attempts: number
  nextAttemptAt: string | null
  stationId: string | null
  leaseToken: string | null
  leaseExpiresAt: string | null
  lastError: string | null
  lastStatusDetail: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  order: AdminOrder
}

export type PrintJobList = {
  jobs: PrintJob[]
  pendingCount: number
  failedCount: number
  deadLetterCount: number
}

export type ClaimPrintJobsResult = {
  station: PrintStation
  jobs: PrintJob[]
  pendingCount: number
  failedCount: number
}

export type PrintStationHealth = {
  autoPrintEnabled: boolean
  restaurantId?: string
  clientInstanceId: string
  qzStatus?: string
  printerStatus?: string
  printerName?: string
  connectionType?: string
  qzVersion?: string
  lastError?: string
}

export function upsertPrintStation(
  stationKey: string,
  name: string,
  health: PrintStationHealth,
) {
  return request<PrintStation>(`/api/printing/stations/${encodeURIComponent(stationKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stationKey,
      name,
      ...health,
    }),
  })
}

export function claimPrintJobs(params: {
  stationKey: string
  clientInstanceId: string
  restaurantId?: string
  maxJobs?: number
}) {
  return request<ClaimPrintJobsResult>('/api/printing/jobs/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export function updatePrintJobStatus(
  jobId: string,
  leaseToken: string,
  status: Exclude<PrintJobState, 'Pending' | 'Claimed'>,
  details: { detail?: string; error?: string } = {},
) {
  return request<PrintJob>(`/api/printing/jobs/${jobId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaseToken, status, ...details }),
  })
}

export function getPrintJobs(params: { restaurantId?: string; state?: PrintJobState; take?: number } = {}) {
  const query = new URLSearchParams()
  if (params.restaurantId) query.set('restaurantId', params.restaurantId)
  if (params.state) query.set('state', params.state)
  if (params.take) query.set('take', String(params.take))
  const suffix = query.size > 0 ? `?${query}` : ''
  return request<PrintJobList>(`/api/printing/jobs${suffix}`)
}

export function retryPrintJob(jobId: string, reason?: string) {
  return request<PrintJob>(`/api/printing/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
}

export function requestOrderReprint(
  orderId: string,
  params: { stationKey: string; restaurantId?: string; reason?: string },
) {
  return request<PrintJob>(`/api/printing/orders/${orderId}/reprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}
