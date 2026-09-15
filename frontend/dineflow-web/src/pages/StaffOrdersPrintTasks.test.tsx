import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrintJob } from '@/api/printing'
import { readStoredThermalPrinterSettings } from '@/lib/thermalPrinter'

/**
 * Answering the "print task needs attention" alert.
 *
 * <p>
 * Everything needed to recover was already built — order number, failure reason, attempt count and a
 * targeted Retry — and it sat inside a collapsed disclosure in the printer settings dialog. The
 * banner opened that dialog and nothing more, so the screen someone was sent to showed a "1 failed"
 * badge and a Refresh button, and read as though no recovery existed at all.
 * </p>
 */

const openPrintTasks = vi.hoisted(() => vi.fn())
const retryQueuedPrint = vi.hoisted(() => vi.fn())
const getStaffOrders = vi.hoisted(() => vi.fn())
const printing = vi.hoisted(() => ({ printTasksRequested: false }))

const restaurantId = '11111111-1111-1111-1111-111111111111'

function job(overrides: Partial<PrintJob> = {}): PrintJob {
  return {
    id: 'job-failed',
    orderId: 'order-1',
    restaurantId,
    ticketRevision: 1,
    trigger: 'Automatic',
    state: 'Failed',
    attempts: 3,
    nextAttemptAt: null,
    stationId: 'station-1',
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: 'The printer reported a paper out condition.',
    lastStatusDetail: null,
    createdAt: '2026-08-17T01:00:00.000Z',
    updatedAt: '2026-08-17T01:05:00.000Z',
    completedAt: null,
    stationName: 'Kitchen station',
    printerName: 'star',
    order: { orderNumber: 'ORD-FAILED' } as PrintJob['order'],
    ...overrides,
  }
}

const emptyPage = {
  items: [], page: 1, pageSize: 100, totalItems: 0, totalPages: 0,
  hasPreviousPage: false, hasNextPage: false,
  queueCounts: { active: 0, new: 0, kitchen: 0, ready: 0, late: 0, payment: 0, carried: 0, closed: 0 },
}

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getStaffOrders,
  getAdminOrders: vi.fn(),
  getRestaurants: vi.fn(async () => []),
  transitionAdminOrder: vi.fn(),
  recordCounterPayment: vi.fn(),
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'staff', email: 'staff@dineflow.test', roles: ['RestaurantStaff'] } }),
}))

vi.mock('@/printing/RestaurantPrintingContext', () => ({
  useRestaurantPrinting: () => ({
    settings: { mode: 'browser', autoPrintNewOrders: false },
    printingOrderId: null,
    printJobs: { jobs: [], failedCount: 1, deadLetterCount: 0, pendingCount: 0 },
    printStationLeaseHeld: false,
    orderEventRevision: 0,
    printOrder: vi.fn(),
    setSettingsOpen: vi.fn(),
    openPrintTasks,
    printTasksRequested: printing.printTasksRequested,
    acknowledgePrintTasksRequest: vi.fn(),
    setPlatformRestaurantId: vi.fn(),
    retryQueuedPrint,
    activeRestaurantId: restaurantId,
    isPlatformOwner: false,
  }),
}))

vi.mock('@/components/orders/useOverdueAcceptanceAlert', () => ({
  useOverdueAcceptanceAlert: () => undefined,
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => undefined
  getStaffOrders.mockResolvedValue(emptyPage)
})

afterEach(() => vi.clearAllMocks())

describe('the print attention banner', () => {
  it('sends people to the task list rather than just opening settings', async () => {
    const { StaffOrdersPage } = await import('./StaffOrdersPage')
    const user = userEvent.setup()
    render(<StaffOrdersPage />)

    await user.click(await screen.findByRole('button', { name: /open print tasks/i }))

    expect(openPrintTasks).toHaveBeenCalled()
  })
})

/**
 * The task list itself, which is where the identity and the recovery live.
 */
describe('the print task list', () => {
  async function showTasks(jobs: PrintJob[]) {
    const { PrinterSettingsDialog } = await import('./StaffOrdersPage')
    render(
      <PrinterSettingsDialog
        open
        kitchenSettings={{ ...readStoredThermalPrinterSettings(), mode: 'qz-tray' }}
        frontCounterSettings={readStoredThermalPrinterSettings()}
        onKitchenSettingsChange={() => undefined}
        onFrontCounterSettingsChange={() => undefined}
        onPrintTestTicket={() => undefined}
        printerReadiness={null}
        lastSuccessfulPrintAt={null}
        onCheckPrinterReadiness={async () => undefined}
        onOpenChange={() => undefined}
        printJobs={{
          jobs,
          failedCount: jobs.filter((item) => item.state === 'Failed').length,
          deadLetterCount: jobs.filter((item) => item.state === 'DeadLetter').length,
          pendingCount: 0,
        }}
        printJobsLoading={false}
        showPrintTasks={false}
        onPrintTasksShown={() => undefined}
        onRetryPrintJob={retryQueuedPrint}
        onRefreshPrintJobs={() => undefined}
      />,
    )
    return userEvent.setup()
  }

  it('identifies the failed task and offers a targeted retry', async () => {
    const user = await showTasks([job()])

    const row = (await screen.findByText('ORD-FAILED')).closest('div')!.parentElement!.parentElement!

    expect(within(row).getByText(/paper out/i)).toBeInTheDocument()
    // Which machine, and when — the two things that turn "a ticket failed" into an errand.
    expect(within(row).getByText(/star/)).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: /retry/i }))
    expect(retryQueuedPrint).toHaveBeenCalledWith('job-failed')
  })

  /** A failure buried under everything that printed fine since is a failure nobody answers. */
  it('puts what failed above what worked', async () => {
    await showTasks([
      job({ id: 'job-ok', state: 'Completed', order: { orderNumber: 'ORD-OK' } as PrintJob['order'], updatedAt: '2026-08-17T02:00:00.000Z' }),
      job(),
    ])

    const shown = (await screen.findAllByText(/ORD-/)).map((node) => node.textContent)
    expect(shown[0]).toBe('ORD-FAILED')
  })

  it('offers no retry for a task that printed', async () => {
    await showTasks([job({ state: 'Completed' })])

    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })
})
