import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProtectedRoute } from './ProtectedRoute'

const auth = vi.hoisted(() => ({
  loading: false,
  token: 'token' as string | null,
  roles: ['Staff'] as string[],
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    loading: auth.loading,
    token: auth.token,
    user: { roles: auth.roles },
    hasAnyRole: (roles: string[]) => roles.some((role) => auth.roles.includes(role)),
  }),
}))

function renderAt(path: string, roles?: string[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute roles={roles} />}>
          <Route path={path} element={<p>Protected payroll figures</p>} />
        </Route>
        <Route path="/login" element={<p>Sign in</p>} />
        <Route path="/me" element={<p>My account</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  auth.loading = false
  auth.token = 'token'
  auth.roles = ['Staff']
})

describe('unauthorised access', () => {
  it('explains the refusal instead of silently bouncing to the profile page', () => {
    renderAt('/admin/payments', ['Admin'])

    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(screen.getByText(/403/)).toBeInTheDocument()
    expect(screen.getByText(/contact your administrator/i)).toBeInTheDocument()
    // The old behaviour: redirected here with no explanation at all.
    expect(screen.queryByText('My account')).not.toBeInTheDocument()
  })

  it('never renders anything from the protected page', () => {
    renderAt('/admin/payments', ['Admin'])

    expect(screen.queryByText('Protected payroll figures')).not.toBeInTheDocument()
  })

  it('shows what the page needs and what the account has, so staff can self-diagnose', () => {
    renderAt('/admin/payments', ['Admin', 'PlatformOwner'])

    expect(screen.getByText('/admin/payments')).toBeInTheDocument()
    expect(screen.getByText('Admin, PlatformOwner')).toBeInTheDocument()
    expect(screen.getByText('Staff')).toBeInTheDocument()
  })

  it('says so plainly when the account has no roles at all', () => {
    auth.roles = []
    renderAt('/admin/payments', ['Admin'])

    expect(screen.getByText('No roles assigned')).toBeInTheDocument()
  })

  it('offers a way out', () => {
    renderAt('/admin/payments', ['Admin'])

    expect(screen.getByRole('link', { name: /back to my account/i })).toHaveAttribute('href', '/me')
  })
})

describe('permitted access', () => {
  it('renders the page when the account holds one of the required roles', () => {
    renderAt('/staff/orders', ['Admin', 'Staff'])

    expect(screen.getByText('Protected payroll figures')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Access denied' })).not.toBeInTheDocument()
  })

  it('renders the page when the route requires no particular role', () => {
    renderAt('/me')

    expect(screen.getByText('Protected payroll figures')).toBeInTheDocument()
  })
})

describe('signed out', () => {
  it('still goes to the sign-in page rather than showing a refusal', () => {
    // Not a permission problem — there is no session yet, and the login page can send them back.
    auth.token = null
    renderAt('/admin/payments', ['Admin'])

    expect(screen.getByText('Sign in')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Access denied' })).not.toBeInTheDocument()
  })
})
