import { Link, useLocation } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

/**
 * FS-018. Unknown addresses used to redirect to the profile page, which made a mistyped link
 * indistinguishable from a permission problem — both ended in the same silent bounce. Saying which
 * of the two happened is the whole point of separating them.
 */
export function NotFoundPage() {
  const location = useLocation()

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>Page not found</h1></CardTitle>
          <CardDescription>
            This address does not match anything in DineFlow. Check the link, or start again from
            your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className="confirm-status error">
            <Compass size={22} />
            <span>404 — no such page</span>
          </div>
          <p className="auth-note">
            Requested: <code>{location.pathname}</code>
          </p>
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
