import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The queue where privacy requests are answered.
 *
 * <p>
 * Nobody was ever shown one. A request went into a table with no screen behind it and no way to move
 * it along, while a thirty-day deadline ran from the day the person asked.
 * </p>
 */

const getAllPrivacyRequests = vi.hoisted(() => vi.fn())
const updatePrivacyRequestStatus = vi.hoisted(() => vi.fn())

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getAllPrivacyRequests,
  updatePrivacyRequestStatus,
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    requestType: 'Deletion',
    details: 'Please delete my account.',
    status: 'Received',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: null,
    completedAt: null,
    requesterEmail: 'customer.one@dineflow.test',
    requesterName: 'Customer One',
    daysRemaining: 12,
    isOverdue: false,
    ...overrides,
  }
}

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined

  getAllPrivacyRequests.mockResolvedValue([request()])
  updatePrivacyRequestStatus.mockResolvedValue(request({ status: 'Completed' }))
})

afterEach(() => vi.clearAllMocks())

async function open() {
  const { AdminPrivacyRequestsPage } = await import('./AdminPrivacyRequestsPage')
  render(<MemoryRouter><AdminPrivacyRequestsPage /></MemoryRouter>)
  return userEvent.setup()
}

describe('the privacy request queue', () => {
  it('shows who asked and how long is left', async () => {
    await open()

    expect(await screen.findByText('Please delete my account.')).toBeInTheDocument()
    expect(screen.getByText('Customer One')).toBeInTheDocument()
    expect(screen.getByTestId('privacy-clock-req-1')).toHaveTextContent('12 days left')
  })

  /** The only question this screen answers at a glance is which one runs out of time next. */
  it('calls out a request that has run past the deadline', async () => {
    getAllPrivacyRequests.mockResolvedValue([request({ daysRemaining: -3, isOverdue: true })])

    await open()

    expect(await screen.findByTestId('privacy-clock-req-1')).toHaveTextContent('3 days overdue')
    expect(screen.getByText(/past the 30-day deadline/i)).toBeInTheDocument()
  })

  it('moves a request along', async () => {
    const user = await open()

    await user.click(await screen.findByRole('button', { name: /mark in progress/i }))
    await user.type(screen.getByLabelText('Note'), 'Locating the records.')
    await user.click(screen.getByRole('button', { name: /^confirm$/i }))

    await waitFor(() => expect(updatePrivacyRequestStatus)
      .toHaveBeenCalledWith('req-1', 'InProgress', 'Locating the records.'))
  })

  /**
   * Declining someone's request about their own information is the one move that must carry a
   * reason — it is what the person is owed, and the first thing an investigation asks for.
   */
  it('will not decline without a reason', async () => {
    const user = await open()

    await user.click(await screen.findByRole('button', { name: /mark declined/i }))

    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeDisabled()

    await user.type(screen.getByLabelText('Reason'), 'Required for seven years under tax law.')
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeEnabled()
  })

  /** An answered request offers nothing further: it is not reopened, it is asked again. */
  it('offers no further move on an answered request', async () => {
    getAllPrivacyRequests.mockResolvedValue([
      request({ status: 'Completed', daysRemaining: null, completedAt: '2026-08-05T00:00:00Z' }),
    ])

    await open()

    expect(await screen.findByTestId('privacy-clock-req-1')).toHaveTextContent('Answered')
    expect(screen.queryByRole('button', { name: /^mark /i })).not.toBeInTheDocument()
  })
})
