import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

type ProtectedRouteProps = {
  roles?: string[]
}

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { loading, token, hasAnyRole } = useAuth()
  const location = useLocation()

  if (loading) {
    return <main className="app-shell">Loading...</main>
  }

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (roles && !hasAnyRole(roles)) {
    return <Navigate to="/me" replace />
  }

  return <Outlet />
}
