import { useEffect, useRef, useState } from 'react'
import { MailCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { confirmEmailChange } from '../api/auth'
import { logout } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAppDispatch } from '../hooks'

type ChangeEmailState = 'checking' | 'success' | 'error'

export function ChangeEmailPage() {
  const [searchParams] = useSearchParams()
  const dispatch = useAppDispatch()
  const [state, setState] = useState<ChangeEmailState>('checking')
  const [message, setMessage] = useState('Confirming your new email...')
  const confirmationStartedRef = useRef(false)

  useEffect(() => {
    if (confirmationStartedRef.current) {
      return
    }

    confirmationStartedRef.current = true
    const userId = searchParams.get('userId')
    const newEmail = searchParams.get('email')
    const token = searchParams.get('token')

    if (!userId || !newEmail || !token) {
      setState('error')
      setMessage('Email change link is missing required information.')
      return
    }

    const confirmationPayload = { userId, newEmail, token }

    async function run() {
      try {
        const response = await confirmEmailChange(confirmationPayload)
        dispatch(logout())
        setState('success')
        setMessage(response.message)
        toast.success('Email updated', {
          description: response.message,
        })
      } catch (changeError) {
        const errorMessage = changeError instanceof Error ? changeError.message : 'Email change failed'
        setState('error')
        setMessage(errorMessage)
        toast.error('Could not update email', {
          description: errorMessage,
        })
      }
    }

    void run()
  }, [dispatch, searchParams])

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>Email change</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={`confirm-status ${state}`}>
            <MailCheck size={22} />
            <span>{state === 'checking' ? 'Checking link' : state === 'success' ? 'Email updated' : 'Needs attention'}</span>
          </div>
          <Button asChild disabled={state === 'checking'}>
            <Link to="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
