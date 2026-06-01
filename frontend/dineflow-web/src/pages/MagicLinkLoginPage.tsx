import { useEffect, useRef, useState } from 'react'
import { Link2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { magicLinkLogin } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAppDispatch } from '../hooks'

const adminRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin']

type MagicLinkState = 'checking' | 'success' | 'error'

export function MagicLinkLoginPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const [state, setState] = useState<MagicLinkState>('checking')
  const [message, setMessage] = useState('Signing you in...')
  const loginStartedRef = useRef(false)

  useEffect(() => {
    if (loginStartedRef.current) {
      return
    }

    loginStartedRef.current = true
    const userId = searchParams.get('userId')
    const token = searchParams.get('token')

    if (!userId || !token) {
      setState('error')
      setMessage('Sign-in link is missing required information.')
      return
    }

    const loginPayload = { userId, token }

    async function run() {
      try {
        const response = await dispatch(magicLinkLogin(loginPayload)).unwrap()
        const destination = response.user.roles.some((role) => adminRoles.includes(role)) ? '/admin/users' : '/me'

        setState('success')
        setMessage(response.message)
        toast.success('Signed in', {
          description: response.user.email ?? 'Welcome back.',
        })
        navigate(destination, { replace: true })
      } catch (loginError) {
        const errorMessage = loginError instanceof Error ? loginError.message : 'Magic link sign-in failed'
        setState('error')
        setMessage(errorMessage)
        toast.error('Magic link failed', {
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
          <CardTitle>Magic link sign-in</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={`confirm-status ${state}`}>
            <Link2 size={22} />
            <span>{state === 'checking' ? 'Checking link' : state === 'success' ? 'Signed in' : 'Needs attention'}</span>
          </div>
          <Button asChild disabled={state === 'checking'}>
            <Link to="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
