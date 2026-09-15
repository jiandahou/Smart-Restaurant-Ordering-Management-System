import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const loginUser = vi.hoisted(() => vi.fn())
const verifyUnwrap = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

const authState = vi.hoisted(() => ({ token: null as string | null, user: null as { roles: string[] } | null }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ ...authState, loginUser }) }))
vi.mock('../hooks', () => ({ useAppDispatch: () => () => ({ unwrap: verifyUnwrap }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))
vi.mock('../api/auth', async (importOriginal) => ({
  // errorCodeOf and describePasskeyFailure are the logic under test here; only the network goes.
  ...(await importOriginal<typeof import('../api/auth')>()),
  requestMagicLink: vi.fn(),
  requestPasskeyLoginOptions: vi.fn().mockRejectedValue(new Error('no passkeys in jsdom')),
  isPasskeySupported: () => false,
}))

/**
 * Both sign-in tabs render at once and both have an Email field, and "Password" is a tab name as
 * well as a field label. Scoping to the password form is what makes these queries unambiguous.
 */
function passwordForm() {
  const submit = screen.getByRole('button', { name: /^sign in$/i })
  return within(submit.closest('form')!)
}

const emailField = () => passwordForm().getByLabelText('Email')
const passwordField = () => passwordForm().getByLabelText('Password')

/** Shows where the router ended up, so a redirect can be asserted without a real page. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="destination">{location.pathname}</div>
}

function renderPage(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  const email = emailField()
  const password = passwordField()
  await user.clear(email)
  await user.type(email, 'diner@example.com')
  await user.clear(password)
  await user.type(password, 'Sunshine1!')
  await user.click(screen.getByRole('button', { name: /^sign in$/i }))
}

afterEach(() => {
  cleanup()
  loginUser.mockReset()
  toastError.mockReset()
  verifyUnwrap.mockReset()
  authState.token = null
  authState.user = null
})

describe('signing in to an unconfirmed account', () => {
  /**
   * The server answers 403 with code `email_not_confirmed`, but the thunk hands the client a plain
   * serialised object rather than an ApiError. The `instanceof` test was therefore always false,
   * the code was dropped, and the person saw only "Login failed" with no way to get a new link.
   */
  it('takes the person to the resend page when the thunk serialises the failure', async () => {
    loginUser.mockRejectedValue({
      name: 'Error',
      message: 'Confirm your email address before signing in.',
      code: 'email_not_confirmed',
    })
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent('/check-email'))
  })

  it('still works when the failure arrives as a real Error instance', async () => {
    const error = Object.assign(new Error('Confirm your email address before signing in.'), {
      code: 'email_not_confirmed',
    })
    loginUser.mockRejectedValue(error)
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent('/check-email'))
  })

  it('leaves an ordinary wrong password on the login page with an error', async () => {
    loginUser.mockRejectedValue({ name: 'Error', message: 'Invalid credentials.' })
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument()
  })
})

describe('coming back from a failed provider sign-in', () => {
  it('leaves the reason on the page, not only in a toast that expires', async () => {
    // The toast lasts a few seconds; someone who looked away during the redirect returns to a
    // login page that looks perfectly normal and never learns why they are back on it.
    renderPage('/login?oauthError=google_failed')

    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in failed. Please try again.')
  })

  it('also raises it as a toast, once', async () => {
    renderPage('/login?oauthError=google_failed')

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    // React mounts effects twice in development; without a fixed id that stacked two toasts.
    expect(toastError.mock.calls.every(([, options]) => options?.id === 'oauth-error')).toBe(true)
  })

  it('says something useful for a code it does not recognise', async () => {
    renderPage('/login?oauthError=something_new')

    expect(await screen.findByRole('alert')).toHaveTextContent('OAuth sign-in failed. Please try again.')
  })

  it('shows nothing on an ordinary visit', () => {
    renderPage()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('the password field', () => {
  it('submits on Enter rather than only by clicking the button', async () => {
    loginUser.mockResolvedValue({ user: { email: 'diner@example.com', roles: ['Customer'] } })
    const user = userEvent.setup()
    renderPage()

    await user.clear(emailField())
    await user.type(emailField(), 'diner@example.com')
    await user.clear(passwordField())
    await user.type(passwordField(), 'Sunshine1!{Enter}')

    await waitFor(() => expect(loginUser).toHaveBeenCalledWith('diner@example.com', 'Sunshine1!'))
  })

  it('offers a visibility control', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Show password' }))

    expect(passwordField()).toHaveAttribute('type', 'text')
  })
})

describe('arriving at the login page with a session already stored', () => {
  /**
   * This guard, not the sign-in handler, is what decides in practice: storing the session
   * re-renders the page before the handler's own navigation runs. It used to send everyone to the
   * customer profile, which is how an owner signing in with a passkey ended up there.
   */
  it('sends an owner to the dashboard', () => {
    authState.token = 'jwt'
    authState.user = { roles: ['RestaurantOwner'] }
    renderPage()

    expect(screen.getByTestId('destination')).toHaveTextContent('/admin')
  })

  it('sends a customer to their profile', () => {
    authState.token = 'jwt'
    authState.user = { roles: ['Customer'] }
    renderPage()

    expect(screen.getByTestId('destination')).toHaveTextContent('/me')
  })

  it('waits rather than guessing while the profile is still loading', () => {
    // A reload has the token before it has the roles; redirecting now would strand an owner.
    authState.token = 'jwt'
    authState.user = null
    renderPage()

    expect(screen.queryByTestId('destination')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })
})

describe('verifying the code after a password sign-in', () => {
  const challenge = { challengeId: 'challenge-1', methods: ['email'], preferredMethod: 'email' }

  function renderChallenge() {
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { mfaChallenge: challenge } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  async function enterCode(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }))
  }

  /**
   * The thunk serialises the rejection, so `instanceof Error` was false and all three outcomes —
   * expired step, wrong code, locked account — collapsed into one generic line, though only one of
   * them means "try again".
   */
  it('says the code was wrong, in words that invite another try', async () => {
    verifyUnwrap.mockRejectedValue({
      name: 'Error',
      message: 'That code is not right. Check the latest code and try again.',
      code: 'mfa_code_invalid',
    })
    const user = userEvent.setup()
    renderChallenge()

    await enterCode(user)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Verification failed', {
      description: 'That code is not right. Check the latest code and try again.',
    }))
    // Still on the code form: there is something to retype.
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument()
  })

  it('sends an expired step back to sign-in, where a new code comes from', async () => {
    verifyUnwrap.mockRejectedValue({
      name: 'Error',
      message: 'This verification step expired. Sign in again to get a new code.',
      code: 'mfa_challenge_expired',
    })
    const user = userEvent.setup()
    renderChallenge()

    await enterCode(user)

    // Retyping the code cannot succeed, so the form that produces a new one is what is shown.
    await waitFor(() => expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument())
    expect(passwordField()).toBeInTheDocument()
  })

  it('names a lockout as a lockout rather than another failed attempt', async () => {
    verifyUnwrap.mockRejectedValue({
      name: 'Error',
      message: 'Too many incorrect codes. This account is locked for a while.',
      code: 'account_locked',
    })
    const user = userEvent.setup()
    renderChallenge()

    await enterCode(user)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Account locked', expect.anything()))
  })
})
