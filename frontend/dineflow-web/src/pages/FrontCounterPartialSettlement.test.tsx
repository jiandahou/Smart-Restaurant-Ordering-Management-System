import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminOrder } from '@/api/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FrontCounterPage } from './FrontCounterPage'

/**
 * When the money goes through and the pickup does not.
 *
 * <p>
 * "Take payment &amp; complete" is two calls to the server, and the second one can fail by itself.
 * The failure was reported as a bare "Counter action failed" over a dialog still offering to take
 * payment — for an order that had just been paid for, with the cash already in the till and the
 * customer standing there. The obvious move is to press it again; the server refuses a second
 * payment, so that produces a second blank error and no way forward from the dialog.
 * </p>
 *
 * <p>
 * What the cashier needs is the one fact the screen was not telling them: the customer has paid.
 * </p>
 */

const getFrontCounterTakeaway = vi.hoisted(() => vi.fn())
const getFrontCounterTables = vi.hoisted(() => vi.fn())
const getFrontCounterTable = vi.hoisted(() => vi.fn())
const recordFrontCounterPayment = vi.hoisted(() => vi.fn())
const completeFrontCounterOrder = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

const restaurantId = '11111111-1111-1111-1111-111111111111'

/** Ready, owing money at the counter: the order that offers "Take payment & complete". */
function readyUnpaidOrder(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'order-counter',
    pendingRefundRequest: null,
    restaurantId,
    restaurantName: 'The DineFlow Kitchen',
    currency: 'AUD',
    tableId: null,
    tableNumber: null,
    customerId: null,
    customerName: 'Customer One',
    customerEmail: 'customer.one@dineflow.test',
    orderNumber: 'ORD-COUNTER-1',
    pickupDate: null,
    pickupNumber: 8,
    pickupCode: '#008',
    tableSessionId: null,
    orderType: 'Takeaway',
    status: 'Ready',
    paymentStatus: 'Unpaid',
    paymentMethod: 'PayAtCounter',
    canProcess: true,
    availableActions: ['Complete'],
    totalAmount: 24,
    customerNote: null,
    scheduledTime: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    paymentAttempts: 0,
    latestPayment: null,
    items: [{
      id: 'item-1',
      menuItemId: 'menu-1',
      itemNameSnapshot: 'Gulab Jamun',
      quantity: 1,
      basePriceSnapshot: 24,
      unitPrice: 24,
      totalPrice: 24,
      refundedAmountCents: 0,
      refundableAmountCents: 2400,
      refundedQuantity: 0,
      refundableQuantity: 1,
      note: null,
      selectedOptions: [],
    }],
    ...overrides,
  } as AdminOrder
}

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getFrontCounterTakeaway,
  getFrontCounterTables,
  getFrontCounterTable,
  getFrontCounterTableSessions: vi.fn(async () => ({ sessions: [] })),
  recordFrontCounterPayment,
  completeFrontCounterOrder,
  getRestaurants: vi.fn(async () => [{ id: restaurantId, name: 'The DineFlow Kitchen' }]),
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'staff', email: 'staff@dineflow.test', roles: ['RestaurantStaff'], restaurantId } }),
}))

vi.mock('@/printing/RestaurantPrintingContext', () => ({
  useRestaurantPrinting: () => ({
    settings: { mode: 'browser', autoPrintNewOrders: false },
    frontCounterSettings: { mode: 'browser', autoPrintNewOrders: false },
    printingOrderId: null,
    printJobs: { failedCount: 0, deadLetterCount: 0, items: [] },
    printStationLeaseHeld: false,
    orderEventRevision: 0,
    printOrder: vi.fn(),
    printFrontCounterReceipt: vi.fn(),
    setSettingsOpen: vi.fn(),
    setPlatformRestaurantId: vi.fn(),
    activeRestaurantId: restaurantId,
    isPlatformOwner: false,
  }),
}))

// jsdom has no SignalR server to talk to, and the counter's realtime feed is not what is under test.
vi.mock('@/realtime/orderConnection', () => ({
  createOrderRealtimeClient: () => ({
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  }),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: toastError, info: vi.fn(), warning: vi.fn() }),
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined

  getFrontCounterTakeaway.mockResolvedValue({
    orders: [readyUnpaidOrder()],
    businessDate: null,
    totalOrders: 1,
  })
  getFrontCounterTables.mockResolvedValue({ tables: [] })
  getFrontCounterTable.mockResolvedValue(null)

  // The money goes through...
  recordFrontCounterPayment.mockResolvedValue({
    order: readyUnpaidOrder({ paymentStatus: 'Paid' }),
    amountReceived: 24,
    changeDue: 0,
  })
  // ...and the pickup does not.
  completeFrontCounterOrder.mockRejectedValue(new Error('Order could not be completed.'))
})

afterEach(() => {
  vi.clearAllMocks()
})

async function takePaymentAndComplete() {
  const user = userEvent.setup()
  render(<TooltipProvider><FrontCounterPage /></TooltipProvider>)

  await user.click(await screen.findByRole('button', { name: /take payment & complete/i }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: /confirm/i }))

  return { user, dialog: await screen.findByRole('dialog') }
}

describe('a counter payment that goes through while the pickup completion fails', () => {
  it('tells the cashier the customer has paid', async () => {
    await takePaymentAndComplete()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const [title, options] = toastError.mock.calls[0] as [string, { description?: string }]
    expect(title).toMatch(/payment recorded/i)
    expect(options.description).toMatch(/do not take payment again/i)
  })

  /** The dialog that remains must not be able to charge anyone a second time. */
  it('replaces the dialog with one that can only finish the pickup', async () => {
    const { dialog } = await takePaymentAndComplete()

    await waitFor(() => expect(within(dialog).getByText(/payment already recorded/i)).toBeInTheDocument())
    expect(within(dialog).queryByLabelText('Counter payment tender')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Cash received')).not.toBeInTheDocument()
  })

  it('leaves the one remaining action reachable', async () => {
    const { user, dialog } = await takePaymentAndComplete()

    await waitFor(() => expect(within(dialog).getByText(/payment already recorded/i)).toBeInTheDocument())

    const confirm = within(dialog).getByRole('button', { name: /confirm/i })
    expect(confirm).toBeEnabled()

    completeFrontCounterOrder.mockResolvedValue({ order: readyUnpaidOrder({ paymentStatus: 'Paid', status: 'Completed' }) })
    recordFrontCounterPayment.mockClear()
    await user.click(confirm)

    await waitFor(() => expect(completeFrontCounterOrder).toHaveBeenCalled())
    // The retry finishes the pickup and nothing else — the till is not asked for money twice.
    expect(recordFrontCounterPayment).not.toHaveBeenCalled()
  })

  it('reloads the counter so the lists behind agree with the till', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><FrontCounterPage /></TooltipProvider>)

    await user.click(await screen.findByRole('button', { name: /take payment & complete/i }))
    const dialog = await screen.findByRole('dialog')

    // Counted from here: the page loads on mount too, and that load says nothing about whether the
    // failure path went back to the server for the truth.
    const beforeConfirm = getFrontCounterTakeaway.mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(getFrontCounterTakeaway.mock.calls.length).toBeGreaterThan(beforeConfirm))
  })

  /** A failure before any money moved is still just a failure; nothing to preserve, nothing to say. */
  it('says nothing about payment when no payment was taken', async () => {
    recordFrontCounterPayment.mockRejectedValue(new Error('Counter payment is not due.'))

    await takePaymentAndComplete()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toBe('Counter action failed')
    expect(screen.queryByText(/payment already recorded/i)).not.toBeInTheDocument()
  })

})
