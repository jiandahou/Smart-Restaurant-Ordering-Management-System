import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RegisterCustomerPage } from './RegisterCustomerPage'

const registerCustomer = vi.hoisted(() => vi.fn())
vi.mock('../api/auth', () => ({ registerCustomer }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ token: null }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <RegisterCustomerPage />
    </MemoryRouter>,
  )
}

/** Everything a valid registration needs, leaving the caller to decide how to submit it. */
async function fillTheForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), 'Ada Lovelace')
  await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
  await user.type(screen.getByLabelText('Password'), 'Sunshine1!')
  await user.type(screen.getByLabelText(/confirm password/i), 'Sunshine1!')
  await user.click(screen.getByRole('checkbox'))
}

afterEach(() => {
  cleanup()
  registerCustomer.mockReset()
})

describe('submitting the registration form', () => {
  it('submits on Enter from the last field, not only by clicking the button', async () => {
    // Reported as Enter doing nothing. The form owns the submit handler and the button is a real
    // submit button, so implicit submission has to work — this is the guard on that staying true.
    registerCustomer.mockResolvedValue({ message: 'Check your email.' })
    const user = userEvent.setup()
    renderPage()
    await fillTheForm(user)

    await user.type(screen.getByLabelText(/confirm password/i), '{Enter}')

    await waitFor(() => expect(registerCustomer).toHaveBeenCalledTimes(1))
  })

  it('submits on Enter from the first field too', async () => {
    registerCustomer.mockResolvedValue({ message: 'Check your email.' })
    const user = userEvent.setup()
    renderPage()
    await fillTheForm(user)

    await user.type(screen.getByLabelText(/full name/i), '{Enter}')

    await waitFor(() => expect(registerCustomer).toHaveBeenCalledTimes(1))
  })

  it('still submits when the button is clicked', async () => {
    registerCustomer.mockResolvedValue({ message: 'Check your email.' })
    const user = userEvent.setup()
    renderPage()
    await fillTheForm(user)

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(registerCustomer).toHaveBeenCalledTimes(1))
  })
})

describe('what reaches the server', () => {
  it('sends the trimmed name, so three spaces never create an account', async () => {
    registerCustomer.mockResolvedValue({ message: 'Check your email.' })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText(/full name/i), '  Ada Lovelace  ')
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'Sunshine1!')
    await user.type(screen.getByLabelText(/confirm password/i), 'Sunshine1!')
    await user.click(screen.getByRole('checkbox'))

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(registerCustomer).toHaveBeenCalled())
    expect(registerCustomer.mock.calls[0][0]).toMatchObject({ fullName: 'Ada Lovelace' })
  })

  it('refuses a name of nothing but whitespace', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText(/full name/i), '   ')
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'Sunshine1!')
    await user.type(screen.getByLabelText(/confirm password/i), 'Sunshine1!')
    await user.click(screen.getByRole('checkbox'))

    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Full name is required.')).toBeInTheDocument()
    expect(registerCustomer).not.toHaveBeenCalled()
  })
})

describe('the password fields', () => {
  it('offers a visibility control on each one', async () => {
    const user = userEvent.setup()
    renderPage()

    const toggles = screen.getAllByRole('button', { name: 'Show password' })
    expect(toggles).toHaveLength(2)

    await user.type(screen.getByLabelText('Password'), 'Sunshine1!')
    await user.click(toggles[0])

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Password')).toHaveValue('Sunshine1!')
  })
})
