import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminOrder } from '@/api/auth'
// The order cards carry tooltips, which the app shell provides for them in the real page.
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * A finished order has to have a way back.
 *
 * <p>
 * The server offers <code>Reopen</code> on every terminal order — completed, cancelled and rejected
 * — and the screen rendered it on none of them: eighty-six closed cards, not one button, every card
 * reading "No action available." An order cancelled by mistake, or rejected before anyone noticed
 * the kitchen could take it after all, was finished as far as this screen was concerned.
 * </p>
 */

const getStaffOrders = vi.hoisted(() => vi.fn())
const getRestaurants = vi.hoisted(() => vi.fn())
const transitionAdminOrder = vi.hoisted(() => vi.fn())

const restaurantId = '11111111-1111-1111-1111-111111111111'

function closedOrder(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'order-closed',
    pendingRefundRequest: null,
    restaurantId,
    restaurantName: 'The DineFlow Kitchen',
    currency: 'AUD',
    tableId: null,
    tableNumber: null,
    customerId: null,
    customerName: 'Customer One',
    customerEmail: 'customer.one@dineflow.test',
    orderNumber: 'ORD-CLOSED-1',
    pickupDate: null,
    pickupNumber: 12,
    pickupCode: '#012',
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
      active: 0, new: 0, kitchen: 0, ready: 0, late: 0, payment: 0, carried: 0,
      closed: items.length,
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
    orderEventRevision: 0,
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

  getRestaurants.mockResolvedValue([{ id: restaurantId, name: 'The DineFlow Kitchen' }])
  transitionAdminOrder.mockResolvedValue(closedOrder({ status: 'Pending' }))
})

afterEach(() => {
  vi.clearAllMocks()
})

async function openClosedQueue(order: AdminOrder) {
  getStaffOrders.mockResolvedValue(pageOf([order]))
  const { StaffOrdersPage } = await import('./StaffOrdersPage')
  render(<TooltipProvider><StaffOrdersPage /></TooltipProvider>)

  const user = userEvent.setup()
  await user.click(await screen.findByRole('tab', { name: /^Closed/ }))
  await screen.findByRole('article')
  return user
}

describe('a closed order on the staff screen', () => {
  it.each(['Completed', 'Cancelled', 'Rejected'] as const)(
    'offers a way back on a %s order',
    async (status) => {
      await openClosedQueue(closedOrder({ status, availableActions: ['Reopen'] }))

      expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
      expect(screen.queryByText('No action available.')).not.toBeInTheDocument()
    },
  )

  /** Reopening is a correction, and corrections are recorded with a reason like the others. */
  it('asks why before reopening anything', async () => {
    const user = await openClosedQueue(closedOrder())

    await user.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(transitionAdminOrder).not.toHaveBeenCalled()
  })

  /**
   * Whether an order may be reopened is the server's decision — a completed order needs its payment
   * settled first, and the server withholds the action when it is not. The screen keeps no second
   * opinion.
   */
  it('offers nothing when the server withheld the action', async () => {
    await openClosedQueue(closedOrder({ status: 'Completed', availableActions: [] }))

    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument()
    expect(screen.getByText('No action available.')).toBeInTheDocument()
  })
})
