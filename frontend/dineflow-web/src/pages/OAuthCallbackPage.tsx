import { useEffect, useRef, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { exchangeOAuthCode } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { resolvePostLoginDestination } from '../auth/postLoginDestination'
import { getSafeMenuReturnPath } from '../lib/customerMenuNavigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useAppDispatch } from '../hooks'

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
}

type OAuthState = 'checking' | 'success' | 'error'

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const exchangeStartedRef = useRef(false)

  const rawProvider = searchParams.get('provider') ?? 'google'
  const providerLabel = PROVIDER_LABELS[rawProvider] ?? rawProvider
  // Whether there is a code to exchange is fixed by the callback URL, so it is derived for the
  // first render rather than rendered as "checking" and then corrected by an effect.
  const oauthCode = searchParams.get('code')
  /**
   * Where the customer was before the provider took over the tab.
   *
   * <p>
   * Checked here rather than trusted: the value has been round-tripped through Google or Facebook,
   * so it arrives as something outside this app has had a chance to influence. `getSafeMenuReturnPath`
   * accepts only a menu path on this origin, which is also what keeps a "sign in to keep ordering"
   * link from becoming a way into an admin screen.
   * </p>
   */
  const menuReturnPath = getSafeMenuReturnPath(searchParams.get('returnTo'))
  const [state, setState] = useState<OAuthState>(oauthCode ? 'checking' : 'error')
  const [message, setMessage] = useState(
    oauthCode
      ? `Finishing ${providerLabel} sign-in...`
      : `${providerLabel} sign-in is missing required information.`,
  )

  useEffect(() => {
    if (exchangeStartedRef.current || !oauthCode) {
      return
    }

    exchangeStartedRef.current = true
    const code = oauthCode

    async function run() {
      try {
        const response = await dispatch(exchangeOAuthCode({ code })).unwrap()

        // The account asks for a second factor at sign-in, and the provider is only the first.
        // The login page already knows how to run the challenge, so it is handed over rather than
        // duplicated here.
        if ('mfaRequired' in response) {
          setState('success')
          setMessage('Extra verification is required to finish signing in.')
          // The return path goes in the query, not router state: the login page reads it from there,
          // and finishing a second factor must not be what loses the menu the customer came from.
          navigate(
            menuReturnPath ? `/login?returnTo=${encodeURIComponent(menuReturnPath)}` : '/login',
            {
              replace: true,
              state: {
                mfaChallenge: {
                  challengeId: response.challengeId,
                  methods: response.methods,
                  preferredMethod: response.preferredMethod,
                },
              },
            },
          )
          return
        }

        const destination = menuReturnPath ?? resolvePostLoginDestination(response.user.roles)

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
  }, [dispatch, menuReturnPath, navigate, oauthCode, providerLabel])

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>{providerLabel} sign-in</h1></CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={`confirm-status ${state}`}>
            {state === 'checking'
              ? <Loader2 size={22} className="animate-spin" />
              : <KeyRound size={22} />}
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
