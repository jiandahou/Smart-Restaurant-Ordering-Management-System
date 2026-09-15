import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminMenuPage } from './AdminMenuPage'

const getRestaurants = vi.hoisted(() => vi.fn())
const getAdminMenuCategories = vi.hoisted(() => vi.fn())
const getAdminMenuItems = vi.hoisted(() => vi.fn())

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', roles: ['PlatformOwner'] } }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/auth')>()),
  getRestaurants,
  getAdminMenuCategories,
  getAdminMenuItems,
}))

const restaurantId = '11111111-1111-1111-1111-111111111111'
const restaurant = { id: restaurantId, name: 'The DineFlow Kitchen', currency: 'AUD', isActive: true }

/** Resolves when the test says so, so the order of the two requests can be controlled. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AdminMenuPage />
    </MemoryRouter>,
  )
}

const refreshButton = () => screen.getByRole('button', { name: /refresh/i })

beforeEach(() => {
  getAdminMenuCategories.mockResolvedValue([])
  getAdminMenuItems.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/**
 * A deep link already names the restaurant, so the id the restaurant list resolves to is the id the
 * page started with — the effect keyed on it never re-runs. The loading flag was switched on by the
 * restaurant request and off by that effect, so whichever finished last won: when the restaurants
 * came back second, the items had already arrived and nothing was left to clear the flag. The list
 * kept saying "Loading menu items" and Refresh stayed disabled with no way out.
 */
describe('opening the menu page from a deep link', () => {
  it('stops loading even when the restaurant list resolves after the menu', async () => {
    const restaurants = deferred<typeof restaurant[]>()
    getRestaurants.mockReturnValue(restaurants.promise)

    renderPage(`/admin/menu?restaurant=${restaurantId}`)

    // The menu arrives first; the restaurant list only afterwards.
    await waitFor(() => expect(getAdminMenuItems).toHaveBeenCalled())
    restaurants.resolve([restaurant])

    // Wait for the list to actually reach the page before judging the button. Asserting straight
    // after resolve() passes while React has not yet processed it, which makes the test vacuous —
    // the broken implementation passed it too.
    await waitFor(() => expect(screen.getAllByText(restaurant.name).length).toBeGreaterThan(0))
    expect(refreshButton()).toBeEnabled()
  })

  it('stops loading when the restaurant list resolves first', async () => {
    getRestaurants.mockResolvedValue([restaurant])

    renderPage(`/admin/menu?restaurant=${restaurantId}`)

    await waitFor(() => expect(refreshButton()).toBeEnabled())
  })

  it('stops loading when the menu request fails', async () => {
    // A spinner that outlives a failed request hides the error and disables the retry.
    getRestaurants.mockResolvedValue([restaurant])
    getAdminMenuItems.mockRejectedValue(new Error('Menu items unavailable.'))

    renderPage(`/admin/menu?restaurant=${restaurantId}`)

    await waitFor(() => expect(refreshButton()).toBeEnabled())
  })

  it('stops loading without a deep link, where the id does change', async () => {
    getRestaurants.mockResolvedValue([restaurant])

    renderPage('/admin/menu')

    await waitFor(() => expect(refreshButton()).toBeEnabled())
  })

  it('does not claim to be loading when there is no restaurant at all', async () => {
    getRestaurants.mockResolvedValue([])

    renderPage('/admin/menu')

    await waitFor(() => expect(getRestaurants).toHaveBeenCalled())
    expect(getAdminMenuItems).not.toHaveBeenCalled()
  })

  it('requests the menu once for the restaurant in the URL', async () => {
    getRestaurants.mockResolvedValue([restaurant])

    renderPage(`/admin/menu?restaurant=${restaurantId}`)

    await waitFor(() => expect(refreshButton()).toBeEnabled())
    expect(getAdminMenuItems).toHaveBeenCalledTimes(1)
    expect(getAdminMenuItems).toHaveBeenCalledWith(restaurantId)
  })
})

describe('the refresh button', () => {
  it('disables itself while refreshing and comes back', async () => {
    getRestaurants.mockResolvedValue([restaurant])
    const user = userEvent.setup()
    renderPage(`/admin/menu?restaurant=${restaurantId}`)
    await waitFor(() => expect(refreshButton()).toBeEnabled())

    const second = deferred<never[]>()
    getAdminMenuItems.mockReturnValue(second.promise)
    await user.click(refreshButton())

    expect(refreshButton()).toBeDisabled()
    second.resolve([])
    await waitFor(() => expect(refreshButton()).toBeEnabled())
  })
})
