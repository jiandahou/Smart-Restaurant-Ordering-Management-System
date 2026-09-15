import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminOrder } from '@/api/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StaffOrdersPage } from './StaffOrdersPage'

/**
 * What a realtime order event is allowed to do to the person using the screen.
 *
 * <p>
 * Every event jumped the list back to Active — and everything counts as an event: an order updated
 * at another till, an order deleted, even the realtime connection reconnecting. Someone halfway
 * through a refund on Payment holds, or looking up an order a customer was asking about in Closed,
 * was thrown back to Active by something that had nothing to do with them. On a busy service that
 * happens repeatedly, and the person eventually stops trusting the screen to stay where they put it.
 * </p>
 */

const getStaffOrders = vi.hoisted(() => vi.fn())
const getRestaurants = vi.hoisted(() => vi.fn())
const transitionAdminOrder = vi.hoisted(() => vi.fn())
const printing = vi.hoisted(() => ({ orderEventRevision: 0 }))

const restaurantId = '11111111-1111-1111-1111-111111111111'

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'order-1',
    pendingRefundRequest: null,
    restaurantId,
    restaurantName: 'The DineFlow Kitchen',
    currency: 'AUD',
    tableId: null,
    tableNumber: null,
    customerId: null,
    customerName: 'Customer One',
    customerEmail: 'customer.one@dineflow.test',
    orderNumber: 'ORD-1',
    pickupDate: null,
    pickupNumber: 1,
    pickupCode: '#001',
    tableSessionId: null,
    orderType: 'Takeaway',
    status: 'Cancelled',
    paymentStatus: 'Cancelled',
    paymentMethod: 'Online',
    canProcess: false,
    availableActions: ['Reopen'],
    totalAmount: 24,
    customerNote: null,
    scheduledTime: null,
    createdAt: '2026-08-14T01:00:00.000Z',
    updatedAt: null,
    paymentAttempts: 1,
    latestPayment: null,
    items: [{
      id: 'item-1',
      menuItemId: 'menu-1',
      itemNameSnapshot: 'Garlic Bread',
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

function pageOf(items: AdminOrder[]) {
  return {
    items,
    page: 1,
    pageSize: 100,
    totalItems: items.length,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
    queueCounts: {
      active: 1, new: 1, kitchen: 0, ready: 0, late: 0, payment: 0, carried: 0, closed: 1,
    },
  }
}

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getStaffOrders,
  getAdminOrders: vi.fn(),
  getRestaurants,
  transitionAdminOrder,
  recordCounterPayment: vi.fn(),
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'staff', email: 'staff@dineflow.test', roles: ['RestaurantStaff'] } }),
}))

vi.mock('@/printing/RestaurantPrintingContext', () => ({
  useRestaurantPrinting: () => ({
    settings: { mode: 'browser', autoPrintNewOrders: false },
    printingOrderId: null,
    printJobs: { failedCount: 0, deadLetterCount: 0, items: [] },
    printStationLeaseHeld: false,
    // Read on every render, so a test can advance it and re-render to stand in for an order event
    // arriving over the wire.
    orderEventRevision: printing.orderEventRevision,
    printOrder: vi.fn(),
    setSettingsOpen: vi.fn(),
    setPlatformRestaurantId: vi.fn(),
    activeRestaurantId: restaurantId,
    isPlatformOwner: false,
  }),
}))

vi.mock('@/components/orders/useOverdueAcceptanceAlert', () => ({
  useOverdueAcceptanceAlert: () => undefined,
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined

  printing.orderEventRevision = 0
  getRestaurants.mockResolvedValue([{ id: restaurantId, name: 'The DineFlow Kitchen' }])
  getStaffOrders.mockImplementation(async (params: { queue?: string }) => pageOf(
    params.queue === 'closed'
      ? [order()]
      // Live work, so the kitchen board has lanes to draw rather than its empty state.
      : [order({
          id: 'order-live',
          orderNumber: 'ORD-LIVE',
          status: 'Preparing',
          paymentStatus: 'Paid',
          canProcess: true,
          availableActions: ['MarkReady', 'Cancel'],
          // Raised just now: an order left open for a day is carried over, and the board leaves
          // those out on purpose.
          createdAt: new Date().toISOString(),
        })],
  ))
})

afterEach(() => {
  vi.clearAllMocks()
})

/**
 * Which queues have been asked for since a given point.
 *
 * <p>
 * A load asks for two: the queue on screen, and the live work the kitchen board and the chime need
 * whatever tab is showing. So the question is which queues were fetched, not which was fetched last.
 * </p>
 */
function queuesAskedForSince(callCount: number) {
  const calls = getStaffOrders.mock.calls as [{ queue?: string }][]
  return calls.slice(callCount).map(([params]) => params.queue)
}

/**
 * The queue tabs, as opposed to the display toggle above them.
 *
 * <p>
 * These two lists used both to contain a tab called "Kitchen" — the toggle counting the whole board
 * and the queue counting only what was being made — which is why this helper had to exist at all.
 * The queue is called "Cooking" now, but the two lists are still distinct things and a test should
 * still say which one it means.
 * </p>
 */
function queueTab(name: RegExp) {
  const tabs = screen.getAllByRole('tablist')
    .find((list) => list.getAttribute('aria-label') !== 'Staff order display mode')!
  return within(tabs).getByRole('tab', { name })
}

describe('an order event arriving while someone is using the screen', () => {
  it('replaces a changed primary action and sends the status the operator actually saw', async () => {
    const user = userEvent.setup()
    let status: AdminOrder['status'] = 'Accepted'
    getStaffOrders.mockImplementation(async () => pageOf([order({
      id: 'order-live',
      orderNumber: 'ORD-LIVE',
      status,
      paymentStatus: 'Paid',
      canProcess: true,
      availableActions: status === 'Accepted' ? ['StartPreparing', 'Cancel'] : ['MarkReady', 'Cancel'],
      createdAt: new Date().toISOString(),
    })]))
    transitionAdminOrder.mockResolvedValue(order({ status: 'Ready' }))

    const { rerender } = render(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)
    const oldButton = await screen.findByRole('button', { name: 'Start preparing' })

    status = 'Preparing'
    printing.orderEventRevision = 1
    rerender(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)
    const newButton = await screen.findByRole('button', { name: 'Mark ready' })

    expect(newButton).not.toBe(oldButton)
    await user.click(newButton)
    await waitFor(() => expect(transitionAdminOrder).toHaveBeenCalledWith(
      'order-live',
      'MarkReady',
      undefined,
      'Preparing',
    ))
  })

  it('leaves them on the queue they chose', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)

    await screen.findAllByRole('tablist')
    await user.click(queueTab(/^Closed/))
    await screen.findByRole('article')

    const before = getStaffOrders.mock.calls.length
    printing.orderEventRevision = 1
    rerender(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)

    // The event still refreshes what is on screen — it just refreshes it where they are.
    await waitFor(() => expect(queuesAskedForSince(before)).toContain('closed'))
    expect(queueTab(/^Closed/)).toHaveAttribute('aria-selected', 'true')
    expect(queueTab(/^Active/)).toHaveAttribute('aria-selected', 'false')
  })

  it('leaves a search they were in the middle of alone', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)

    const search = await screen.findByPlaceholderText(/order, pickup, customer/i)
    await user.type(search, 'Customer One')

    printing.orderEventRevision = 1
    rerender(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)

    await waitFor(() => expect(getStaffOrders.mock.calls.length).toBeGreaterThan(1))
    expect(search).toHaveValue('Customer One')
  })

  it('leaves the kitchen board up when that is what they were watching', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)

    const viewTabs = await screen.findByRole('tablist', { name: 'Staff order display mode' })
    await user.click(within(viewTabs).getByRole('tab', { name: /Kitchen/ }))
    expect(await screen.findByLabelText('Kitchen order board')).toBeInTheDocument()

    printing.orderEventRevision = 1
    rerender(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)

    await waitFor(() => expect(getStaffOrders.mock.calls.length).toBeGreaterThan(1))
    expect(screen.getByLabelText('Kitchen order board')).toBeInTheDocument()
  })
})
