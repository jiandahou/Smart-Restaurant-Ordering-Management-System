import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Where a customer exercises a right the privacy policy already promised them.
 *
 * <p>
 * The endpoints existed and nothing reached them — no page, no route, no link. A right that can only
 * be exercised by finding an email address is a right most people never exercise, and the policy page
 * said they could ask while offering nowhere to ask.
 * </p>
 */

const createPrivacyRequest = vi.hoisted(() => vi.fn())
const getMyPrivacyRequests = vi.hoisted(() => vi.fn())

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  createPrivacyRequest,
  getMyPrivacyRequests,
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined

  getMyPrivacyRequests.mockResolvedValue([])
  createPrivacyRequest.mockResolvedValue({})
})

afterEach(() => vi.clearAllMocks())

async function open() {
  const { PrivacyRequestsPage } = await import('./PrivacyRequestsPage')
  render(<MemoryRouter><PrivacyRequestsPage /></MemoryRouter>)
  return userEvent.setup()
}

describe('the customer privacy request page', () => {
  it('sends the request the customer chose', async () => {
    const user = await open()

    await user.click(await screen.findByLabelText('Privacy request type'))
    await user.click(await screen.findByRole('option', { name: /delete my information/i }))
    await user.type(
      screen.getByLabelText(/tell us what you need/i),
      'Please delete my account and order history.',
    )
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await waitFor(() => expect(createPrivacyRequest).toHaveBeenCalledWith(
      'Deletion',
      'Please delete my account and order history.',
    ))
  })

  /** Too short to act on is not a request; the server refuses it and so should the form. */
  it('will not send something nobody could act on', async () => {
    const user = await open()

    await user.type(screen.getByLabelText(/tell us what you need/i), 'help')

    expect(screen.getByRole('button', { name: /send request/i })).toBeDisabled()
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument()
  })

  /**
   * The status list is the point. Someone who asked to be deleted is owed the knowledge that it
   * arrived, rather than asking again into the same silence.
   */
  it('shows what happened to requests already made', async () => {
    getMyPrivacyRequests.mockResolvedValue([{
      id: 'r1',
      requestType: 'Access',
      details: 'A copy of my orders please.',
      status: 'InProgress',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: null,
      completedAt: null,
    }])

    await open()

    expect(await screen.findByText('A copy of my orders please.')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('says how long an answer should take', async () => {
    await open()

    expect(await screen.findByText(/within 30 days/i)).toBeInTheDocument()
  })
})
