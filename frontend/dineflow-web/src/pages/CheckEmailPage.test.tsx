import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckEmailPage } from './CheckEmailPage'

const resend = vi.hoisted(() => vi.fn())
vi.mock('../api/auth', () => ({ resendConfirmationEmail: resend }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderPage(state: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/check-email', state }]}>
      <Routes>
        <Route path="/check-email" element={<CheckEmailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  resend.mockReset()
})

describe('confirmation dead end', () => {
  it('offers a resend, which is the entry point that did not exist before', async () => {
    resend.mockResolvedValue({ message: 'Sent.' })
    const user = userEvent.setup()
    renderPage({ email: 'diner@example.com' })

    await user.click(screen.getByRole('button', { name: /send the confirmation email again/i }))

    expect(resend).toHaveBeenCalledWith('diner@example.com')
  })

  it('rate-limits the button so a frustrated person cannot hammer the send limit', async () => {
    resend.mockResolvedValue({ message: 'Sent.' })
    const user = userEvent.setup()
    renderPage({ email: 'diner@example.com' })

    await user.click(screen.getByRole('button', { name: /send the confirmation email again/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /send again in \d+s/i })).toBeDisabled())
  })

  it('explains that a correct password is not the problem when arriving from sign-in', () => {
    renderPage({ email: 'diner@example.com', reason: 'not-confirmed' })

    expect(screen.getByText(/password was correct/i)).toBeInTheDocument()
  })

  it('always offers signing up again, because the account may already have been swept away', () => {
    renderPage({ email: 'diner@example.com' })

    expect(screen.getByRole('link', { name: /sign up again/i })).toHaveAttribute('href', '/register')
  })

  it('hides the resend when there is no address to send to', () => {
    renderPage({})

    expect(screen.queryByRole('button', { name: /send the confirmation email again/i })).not.toBeInTheDocument()
  })
})
