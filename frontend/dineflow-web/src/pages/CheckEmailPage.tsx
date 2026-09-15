import { useEffect, useState } from 'react'
import { Loader2, MailCheck, Send } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { resendConfirmationEmail } from '../api/auth'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

type CheckEmailState = {
  email?: string
  confirmationEmailSent?: boolean
  /** 'not-confirmed' when the person got here by trying to sign in, rather than by registering. */
  reason?: 'registered' | 'not-confirmed'
}

/** Long enough to stop a frustrated person hammering the button into the send-rate limit. */
const resendCooldownSeconds = 60

export function CheckEmailPage() {
  const location = useLocation()
  const state = (location.state ?? {}) as CheckEmailState
  const email = state.email
  const confirmationEmailSent = state.confirmationEmailSent ?? true
  const arrivedFromSignIn = state.reason === 'not-confirmed'

  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) {
      return
    }

    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1_000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const resend = async () => {
    if (!email) {
      return
    }

    setSending(true)
    try {
      const response = await resendConfirmationEmail(email)
      setCooldown(resendCooldownSeconds)
      toast.success('Confirmation email sent', { description: response.message })
    } catch (error) {
      toast.error('Could not send the confirmation email', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>Confirm your email</h1></CardTitle>
          <CardDescription>
            {arrivedFromSignIn
              ? 'Your password was correct, but this address has not been confirmed yet.'
              : confirmationEmailSent
                ? 'We sent a confirmation link. It expires in 24 hours.'
                : 'Your account was created, but the confirmation email could not be sent.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={confirmationEmailSent || arrivedFromSignIn ? 'confirm-status success' : 'confirm-status error'}>
            <MailCheck size={22} />
            <span>{email ? `Sent to ${email}` : 'Open your inbox to confirm your account'}</span>
          </div>

          {/* The entry point that was missing: without it, an expired link left the person with
              nothing to do but guess. */}
          {email ? (
            <Button type="button" variant="secondary" disabled={sending || cooldown > 0} onClick={() => void resend()}>
              {sending ? <Loader2 className="animate-spin" /> : <Send size={18} />}
              {sending
                ? 'Sending'
                : cooldown > 0
                  ? `Send again in ${cooldown}s`
                  : 'Send the confirmation email again'}
            </Button>
          ) : null}

          <p className="auth-note">
            Unconfirmed accounts are removed 24 hours after they are created. If the link has
            already expired, sign up again with the same address.
          </p>

          <Button asChild>
            <Link to="/login">Go to sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/register">Sign up again</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
