import { MailCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

type CheckEmailState = {
  email?: string
  confirmationEmailSent?: boolean
}

export function CheckEmailPage() {
  const location = useLocation()
  const state = (location.state ?? {}) as CheckEmailState
  const email = state.email
  const confirmationEmailSent = state.confirmationEmailSent ?? true

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            {confirmationEmailSent
              ? 'We sent a confirmation link. It expires in one hour.'
              : 'Your account was created, but the confirmation email could not be sent.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={confirmationEmailSent ? 'confirm-status success' : 'confirm-status error'}>
            <MailCheck size={22} />
            <span>{email ? `Confirmation sent to ${email}` : 'Open your inbox to confirm your account'}</span>
          </div>
          <p className="auth-note">
            Unconfirmed customer accounts are removed after one hour. Create the account again if the link expires.
          </p>
          <Button asChild>
            <Link to="/login">Go to sign in</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/register">Create another account</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
