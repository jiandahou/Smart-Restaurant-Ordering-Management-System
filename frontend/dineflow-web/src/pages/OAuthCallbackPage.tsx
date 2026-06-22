import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { exchangeOAuthCode } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAppDispatch } from '../hooks'

const adminRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin']

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
}

type OAuthState = 'checking' | 'success' | 'error'

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const [state, setState] = useState<OAuthState>('checking')
  const exchangeStartedRef = useRef(false)

  const rawProvider = searchParams.get('provider') ?? 'google'
  const providerLabel = PROVIDER_LABELS[rawProvider] ?? rawProvider
  const [message, setMessage] = useState(`Finishing ${providerLabel} sign-in...`)

  useEffect(() => {
    if (exchangeStartedRef.current) {
      return
    }

    exchangeStartedRef.current = true
    const code = searchParams.get('code')

    if (!code) {
      setState('error')
      setMessage(`${providerLabel} sign-in is missing required information.`)
      return
    }

    const oauthCode = code

    async function run() {
      try {
        const response = await dispatch(exchangeOAuthCode({ code: oauthCode })).unwrap()
        const destination = response.user.roles.some((role) => adminRoles.includes(role)) ? '/admin/users' : '/me'

        setState('success')
        setMessage(response.message)
        toast.success(`Signed in with ${providerLabel}`, {
          description: response.user.email ?? 'Welcome back.',
        })
        navigate(destination, { replace: true })
      } catch (oauthError) {
        const errorMessage = oauthError instanceof Error ? oauthError.message : `${providerLabel} sign-in failed`
        setState('error')
        setMessage(errorMessage)
        toast.error(`${providerLabel} sign-in failed`, {
          description: errorMessage,
        })
      }
    }

    void run()
  }, [dispatch, navigate, providerLabel, searchParams])

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>{providerLabel} sign-in</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={`confirm-status ${state}`}>
            <KeyRound size={22} />
            <span>{state === 'checking' ? 'Checking code' : state === 'success' ? 'Signed in' : 'Needs attention'}</span>
          </div>
          <Button asChild disabled={state === 'checking'}>
            <Link to="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
