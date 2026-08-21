import { Link, useLocation } from 'react-router-dom'
import { Home, ShieldOff } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

/**
 * FS-018. An unauthorised route used to bounce silently to the profile page, leaving the person
 * unable to tell a permission problem from a broken link or an outage — so they retry, or call
 * support, or assume their account is misconfigured.
 *
 * Rendered in place rather than redirected to: the address stays in the bar, so the person can see
 * and share exactly what they tried to open. No data from the protected page is loaded or shown —
 * this replaces that route's element entirely.
 */
export function AccessDeniedPage({ requiredRoles }: { requiredRoles?: string[] }) {
  const { user } = useAuth()
  const location = useLocation()
  const ownRoles = user?.roles ?? []

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>Access denied</h1></CardTitle>
          <CardDescription>
            You do not have permission to open this page. If you think that is wrong, contact your
            administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className="confirm-status error">
            <ShieldOff size={22} />
            <span>403 — not permitted for your account</span>
          </div>

          {/* Enough for staff to work out whether their own account is set up correctly, which is
              the question they otherwise have to raise a ticket to answer. Nothing here is
              sensitive: the route table and role names ship in the client bundle already. */}
          <dl className="access-denied-details">
            <div>
              <dt>Page</dt>
              <dd><code>{location.pathname}</code></dd>
            </div>
            {requiredRoles?.length ? (
              <div>
                <dt>Requires</dt>
                <dd>{requiredRoles.join(', ')}</dd>
              </div>
            ) : null}
            <div>
              <dt>Your access</dt>
              <dd>{ownRoles.length > 0 ? ownRoles.join(', ') : 'No roles assigned'}</dd>
            </div>
          </dl>

          <Button asChild>
            <Link to="/me">
              <Home size={18} />
              Back to my account
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
