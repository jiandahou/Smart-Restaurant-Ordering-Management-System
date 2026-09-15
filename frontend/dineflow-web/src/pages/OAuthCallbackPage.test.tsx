import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthCallbackPage } from './OAuthCallbackPage'

const unwrap = vi.hoisted(() => vi.fn())
const storeToken = vi.hoisted(() => vi.fn())

vi.mock('../hooks', () => ({ useAppDispatch: () => () => ({ unwrap }) }))
vi.mock('../auth/authSlice', () => ({ exchangeOAuthCode: (payload: unknown) => payload }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/auth')>()),
  storeToken,
}))

const mfaChallenge = {
  message: 'MFA verification is required.',
  mfaRequired: true,
  challengeId: 'challenge-1',
  methods: ['email'],
  preferredMethod: 'email',
}

const session = {
  message: 'Sign-in successful.',
  token: 'jwt',
  refreshToken: 'refresh',
  user: { email: 'diner@example.com', roles: ['Customer'] },
}

/** Reports where the router landed and what it was handed, without rendering the real page. */
function LandingProbe() {
  const location = useLocation()
  return (
    <div>
      <span data-testid="path">{location.pathname}</span>
      <span data-testid="state">{JSON.stringify(location.state)}</span>
    </div>
  )
}

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={['/oauth/callback?code=abc&provider=google']}>
      <Routes>
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="*" element={<LandingProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  unwrap.mockReset()
})

describe('finishing a social sign-in', () => {
  it('hands an MFA challenge to the login page instead of signing the person in', async () => {
    // The provider is only the first factor; the account asked for a second one at sign-in.
    unwrap.mockResolvedValue(mfaChallenge)
    renderCallback()

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/login'))
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
      mfaChallenge: { challengeId: 'challenge-1', methods: ['email'], preferredMethod: 'email' },
    })
  })

  it('goes straight in when the account asks for no second factor', async () => {
    unwrap.mockResolvedValue(session)
    renderCallback()

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/me'))
  })

  it('sends an admin to the dashboard rather than the profile', async () => {
    unwrap.mockResolvedValue({ ...session, user: { ...session.user, roles: ['RestaurantOwner'] } })
    renderCallback()

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin'))
  })

  it('stays put and explains itself when the exchange fails', async () => {
    unwrap.mockRejectedValue(new Error('OAuth sign-in code is invalid or expired.'))
    renderCallback()

    expect(await screen.findByText('OAuth sign-in code is invalid or expired.')).toBeInTheDocument()
    expect(screen.queryByTestId('path')).not.toBeInTheDocument()
  })
})

/** Like LandingProbe, but also reports the query — the return path carries one. */
function FullLandingProbe() {
  const location = useLocation()
  return (
    <div>
      <span data-testid="full-path">{location.pathname + location.search}</span>
      <span data-testid="full-state">{JSON.stringify(location.state)}</span>
    </div>
  )
}

function renderCallbackAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="*" element={<FullLandingProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const menuPath = '/r/restaurant-1/menu?orderType=Takeaway'

/**
 * A customer who taps "Sign in" from a restaurant menu is trying to keep ordering. Password and
 * passkey sign-in already came back to the menu; Google and Facebook dropped everyone on the
 * default landing page, because the return path was never carried through the provider at all.
 */
describe('coming back from a provider to where the customer started', () => {
  it('returns to the menu the customer signed in from', async () => {
    unwrap.mockResolvedValue(session)
    renderCallbackAt(`/oauth/callback?code=abc&provider=google&returnTo=${encodeURIComponent(menuPath)}`)

    await waitFor(() => expect(screen.getByTestId('full-path')).toHaveTextContent(menuPath))
  })

  it('returns to a table QR the same way', async () => {
    unwrap.mockResolvedValue(session)
    renderCallbackAt('/oauth/callback?code=abc&provider=google&returnTo=%2Ftable%2Ftoken-1')

    await waitFor(() => expect(screen.getByTestId('full-path')).toHaveTextContent('/table/token-1'))
  })

  it('still uses the role default when there is nothing to return to', async () => {
    unwrap.mockResolvedValue(session)
    renderCallbackAt('/oauth/callback?code=abc&provider=google')

    await waitFor(() => expect(screen.getByTestId('full-path')).toHaveTextContent('/me'))
  })

  /**
   * The value round-trips through Google, so it arrives as something outside this app has had a
   * chance to influence. Following it anywhere but a menu on this origin would make a "sign in to
   * keep ordering" link into an open redirect, or a way into an admin screen.
   */
  it('refuses a return path that points off site', async () => {
    unwrap.mockResolvedValue(session)
    renderCallbackAt('/oauth/callback?code=abc&provider=google&returnTo=https%3A%2F%2Fevil.example.com')

    await waitFor(() => expect(screen.getByTestId('full-path')).toHaveTextContent('/me'))
  })

  it('refuses a same-origin path that is not a menu', async () => {
    unwrap.mockResolvedValue(session)
    renderCallbackAt('/oauth/callback?code=abc&provider=google&returnTo=%2Fadmin%2Forders')

    await waitFor(() => expect(screen.getByTestId('full-path')).toHaveTextContent('/me'))
  })

  it('keeps the return path across a second factor', async () => {
    unwrap.mockResolvedValue(mfaChallenge)
    renderCallbackAt(`/oauth/callback?code=abc&provider=google&returnTo=${encodeURIComponent(menuPath)}`)

    // Finishing MFA must not be what loses the menu the customer came from.
    await waitFor(() =>
      expect(screen.getByTestId('full-path')).toHaveTextContent(
        `/login?returnTo=${encodeURIComponent(menuPath)}`,
      ),
    )
  })
})
