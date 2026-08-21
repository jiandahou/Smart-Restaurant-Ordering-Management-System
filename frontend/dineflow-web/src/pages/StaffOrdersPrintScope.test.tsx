import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which restaurant this print station serves is a decision, not a side effect of looking around.
 *
 * <p>
 * The restaurant filter above the order list used to reassign the print station as well, so a
 * platform owner who filtered the list from The DineFlow Kitchen to Central Market Table moved where
 * tickets came out — silently, with nothing said and nothing asked. Two restaurants' tickets can end
 * up at the wrong pass that way, and the person browsing has no reason to suspect it.
 * </p>
 */

const setPlatformRestaurantId = vi.hoisted(() => vi.fn())
const setSettingsOpen = vi.hoisted(() => vi.fn())
const getStaffOrders = vi.hoisted(() => vi.fn())
const getAdminOrders = vi.hoisted(() => vi.fn())
const getRestaurants = vi.hoisted(() => vi.fn())

const kitchenId = '11111111-1111-1111-1111-111111111111'
const marketId = '22222222-2222-2222-2222-222222222222'

const emptyPage = {
  items: [],
  page: 1,
  pageSize: 100,
  totalItems: 0,
  totalPages: 0,
  hasPreviousPage: false,
  hasNextPage: false,
  queueCounts: {
    active: 0, new: 0, kitchen: 0, ready: 0, late: 0, payment: 0, carried: 0, closed: 0,
  },
}

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getStaffOrders,
  getAdminOrders,
  getRestaurants,
  transitionAdminOrder: vi.fn(),
  recordCounterPayment: vi.fn(),
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner', email: 'owner@dineflow.test', roles: ['PlatformOwner'] } }),
}))

vi.mock('@/printing/RestaurantPrintingContext', () => ({
  useRestaurantPrinting: () => ({
    settings: { mode: 'browser', autoPrintNewOrders: false },
    printingOrderId: null,
    printJobs: { failedCount: 0, deadLetterCount: 0, items: [] },
    printStationLeaseHeld: false,
    orderEventRevision: 0,
    printOrder: vi.fn(),
    setSettingsOpen,
    setPlatformRestaurantId,
    // This station serves the Kitchen. Nothing the list does may change that.
    activeRestaurantId: kitchenId,
    isPlatformOwner: true,
  }),
}))

vi.mock('@/components/orders/useOverdueAcceptanceAlert', () => ({
  useOverdueAcceptanceAlert: () => undefined,
}))

// jsdom implements no pointer capture and no scrolling, both of which the underlying Select uses.
// Without them the trigger throws before it ever opens, which says nothing about this page.
beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined

  getStaffOrders.mockResolvedValue(emptyPage)
  getAdminOrders.mockResolvedValue(emptyPage)
  getRestaurants.mockResolvedValue([
    { id: kitchenId, name: 'The DineFlow Kitchen' },
    { id: marketId, name: 'Central Market Table' },
  ])
})

afterEach(() => {
  vi.clearAllMocks()
})

async function openOrdersPage() {
  const { StaffOrdersPage } = await import('./StaffOrdersPage')
  render(<StaffOrdersPage />)
  await screen.findByRole('combobox', { name: /filter staff orders by restaurant/i })
}

describe('the restaurant filter on the staff orders list', () => {
  it('does not move the print station when the list is filtered elsewhere', async () => {
    const user = userEvent.setup()
    await openOrdersPage()

    await user.click(screen.getByRole('combobox', { name: /filter staff orders by restaurant/i }))
    await user.click(await screen.findByRole('option', { name: 'Central Market Table' }))

    await waitFor(() => {
      expect(getAdminOrders).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: marketId }),
      )
    })
    expect(setPlatformRestaurantId).not.toHaveBeenCalled()
  })

  /**
   * Decoupling the two makes a second thing possible: browsing one restaurant while another's
   * tickets print. That is correct, and worth saying, or the owner is left to work it out from which
   * tickets appear at the pass.
   */
  it('says which restaurant is still being printed for', async () => {
    const user = userEvent.setup()
    await openOrdersPage()

    await user.click(screen.getByRole('combobox', { name: /filter staff orders by restaurant/i }))
    await user.click(await screen.findByRole('option', { name: 'Central Market Table' }))

    expect(await screen.findByText(/still prints for The DineFlow Kitchen/i)).toBeInTheDocument()
  })

  it('says nothing when the list and the print station agree', async () => {
    const user = userEvent.setup()
    await openOrdersPage()

    await user.click(screen.getByRole('combobox', { name: /filter staff orders by restaurant/i }))
    await user.click(await screen.findByRole('option', { name: 'The DineFlow Kitchen' }))

    await waitFor(() => {
      expect(getAdminOrders).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: kitchenId }),
      )
    })
    expect(screen.queryByText(/still prints for/i)).not.toBeInTheDocument()
  })
})
