import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Restaurant } from '@/api/auth'
import { AdminMenuPage } from './AdminMenuPage'

const apiMocks = vi.hoisted(() => ({
  getRestaurants: vi.fn(),
  getAdminMenuCategories: vi.fn(),
  getAdminMenuItems: vi.fn(),
}))

vi.mock('@/api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/auth')>(),
  ...apiMocks,
}))

const restaurant = {
  id: 'restaurant-1',
  name: 'Test Restaurant',
  currency: 'AUD',
} as Restaurant

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/menu']}>
      <AdminMenuPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AdminMenuPage loading states', () => {
  it('finishes loading and shows a durable empty state when no restaurants are available', async () => {
    apiMocks.getRestaurants.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No restaurants available')).toBeInTheDocument()
    expect(screen.queryByText('Loading full menu...')).not.toBeInTheDocument()
  })

  it('keeps menu request failures visible with a retry action instead of showing an empty menu', async () => {
    apiMocks.getRestaurants.mockResolvedValue([restaurant])
    apiMocks.getAdminMenuCategories.mockRejectedValue(new Error('Category service unavailable'))
    apiMocks.getAdminMenuItems.mockRejectedValue(new Error('Item service unavailable'))

    renderPage()

    expect(await screen.findByText('Some menu data could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText(/Category service unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading full menu...')).not.toBeInTheDocument())
  })
})
