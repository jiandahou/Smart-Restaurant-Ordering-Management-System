import { useEffect, useRef, useState } from 'react'
import { Link2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { magicLinkLogin } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { resolvePostLoginDestination } from '../auth/postLoginDestination'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAppDispatch } from '../hooks'

type MagicLinkState = 'checking' | 'success' | 'error'

export function MagicLinkLoginPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const userId = searchParams.get('userId')
  const token = searchParams.get('token')
  const hasRequiredParameters = Boolean(userId && token)
  const [state, setState] = useState<MagicLinkState>(hasRequiredParameters ? 'checking' : 'error')
  const [message, setMessage] = useState(
    hasRequiredParameters ? 'Signing you in...' : 'Sign-in link is missing required information.',
  )
  const loginStartedRef = useRef(false)

  useEffect(() => {
    if (loginStartedRef.current) {
      return
    }

    loginStartedRef.current = true
    if (!userId || !token) {
      return
    }

    const loginPayload = { userId, token }

    async function run() {
      try {
        const response = await dispatch(magicLinkLogin(loginPayload)).unwrap()

        if ('mfaRequired' in response) {
          toast.success('Verification required', {
            description: response.methods.includes('email')
              ? 'Enter your authenticator code or check your email.'
              : 'Enter your authenticator code.',
          })
          navigate('/login', {
            replace: true,
            state: {
              mfaChallenge: {
                challengeId: response.challengeId,
                methods: response.methods,
                preferredMethod: response.preferredMethod,
              },
            },
          })
          return
        }

        const destination = resolvePostLoginDestination(response.user.roles)

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
  }, [dispatch, navigate, token, userId])

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>Magic link sign-in</h1></CardTitle>
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
