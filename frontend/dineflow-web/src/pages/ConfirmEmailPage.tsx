import { useEffect, useRef, useState } from 'react'
import { MailCheck } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { confirmEmail } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAppDispatch } from '../hooks'

type ConfirmState = 'checking' | 'success' | 'error'

export function ConfirmEmailPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const [state, setState] = useState<ConfirmState>('checking')
  const [message, setMessage] = useState('Confirming your email...')
  const confirmationStartedRef = useRef(false)

  useEffect(() => {
    if (confirmationStartedRef.current) {
      return
    }

    confirmationStartedRef.current = true
    const userId = searchParams.get('userId')
    const token = searchParams.get('token')

    if (!userId || !token) {
      setState('error')
      setMessage('Confirmation link is missing required information.')
      return
    }

    const confirmationPayload = { userId, token }

    async function run() {
      try {
        const response = await dispatch(confirmEmail(confirmationPayload)).unwrap()
        setState('success')
        setMessage(response.message)
        toast.success('Email confirmed', {
          description: response.token ? 'You are signed in now.' : response.message,
        })

        if (response.token) {
          navigate('/me', { replace: true })
        }
      } catch (confirmError) {
        const errorMessage = confirmError instanceof Error ? confirmError.message : 'Confirmation failed'
        setState('error')
        setMessage(errorMessage)
        toast.error('Could not confirm email', {
          description: errorMessage,
        })
      }
    }

    void run()
  }, [dispatch, navigate, searchParams])

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>Email confirmation</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={`confirm-status ${state}`}>
            <MailCheck size={22} />
            <span>{state === 'checking' ? 'Checking link' : state === 'success' ? 'Confirmed' : 'Needs attention'}</span>
          </div>
          <Button asChild disabled={state === 'checking'}>
            <Link to="/login">Go to sign in</Link>
          </Button>
          {state === 'error' && (
            <Button asChild variant="secondary">
              <Link to="/register">Request another email</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
