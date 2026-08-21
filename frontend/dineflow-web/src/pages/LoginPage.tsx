import { zodResolver } from '@hookform/resolvers/zod'
import { Fingerprint, Link2, LogIn, Mail, OctagonAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import facebookLogo from '../assets/facebook-f.svg'
import googleLogo from '../assets/google-g.svg'
import {
  describeError,
  describePasskeyFailure,
  errorCodeOf,
  isPasskeySupported,
  requestMagicLink,
  requestPasskeyLoginOptions,
  startPasskeyAssertion,
  type PasskeyAssertionAttempt,
  type PublicKeyCredentialRequestOptionsJson,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { demoLoginDefaults, isDemoLoginAutofilled } from '../auth/demoLogin'
import { resolvePostLoginDestination } from '../auth/postLoginDestination'
import { getSafeMenuReturnPath } from '../lib/customerMenuNavigation'
import { passkeyLogin, verifyMfaLogin } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { PasswordInput } from '../components/auth/PasswordInput'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useAppDispatch } from '../hooks'
import { LEGAL_VERSIONS } from '../legal/legalConfig'
import { describeOauthError } from '../lib/oauthErrors'

/** Comfortably inside the five-minute server-side lifetime of a challenge. */
const passkeyOptionsRefreshMs = 4 * 60 * 1000

const oauthErrorToastId = 'oauth-error'

const googleLoginUrl = '/api/auth/google/login'
const facebookLoginUrl = '/api/auth/facebook/login'

const passwordLoginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
})

const magicLinkSchema = z.object({
  email: z.email('Enter a valid email address.'),
})

const mfaLoginSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
})

type PasswordLoginFormValues = z.infer<typeof passwordLoginSchema>
type MagicLinkFormValues = z.infer<typeof magicLinkSchema>
type MfaLoginFormValues = z.infer<typeof mfaLoginSchema>

type LoginMfaChallenge = {
  challengeId: string
  methods: string[]
  preferredMethod: string
}

type LoginLocationState = {
  from?: { pathname?: string }
  mfaChallenge?: LoginMfaChallenge
}

export function LoginPage() {
  const { token, user, loginUser } = useAuth()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const locationState = location.state as LoginLocationState | null
  /**
   * Where to go after signing in, when the visitor came from a customer menu.
   *
   * <p>
   * A query parameter rather than router state, because state does not survive the round trip a
   * social sign-in makes through the provider — and validated, because a query parameter is
   * something anybody can write.
   * </p>
   */
  const menuReturnPath = useMemo(
    () => getSafeMenuReturnPath(searchParams.get('returnTo')),
    [searchParams],
  )
  const forwardedMfaChallenge = locationState?.mfaChallenge ?? null
  const [signingInWithPasskey, setSigningInWithPasskey] = useState(false)
  // Held ready so the click handler has nothing to await before opening the prompt. Server-side
  // the challenge lives five minutes and is single use, so it is refreshed well inside that.
  const passkeyOptionsRef = useRef<PublicKeyCredentialRequestOptionsJson | null>(null)

  const prefetchPasskeyOptions = useCallback(async () => {
    if (!isPasskeySupported()) {
      return
    }

    try {
      passkeyOptionsRef.current = await requestPasskeyLoginOptions()
    } catch {
      // Not worth surfacing: the click handler falls back to fetching a challenge itself.
      passkeyOptionsRef.current = null
    }
  }, [])

  useEffect(() => {
    void prefetchPasskeyOptions()
    const timer = window.setInterval(() => void prefetchPasskeyOptions(), passkeyOptionsRefreshMs)
    return () => window.clearInterval(timer)
  }, [prefetchPasskeyOptions])
  const [socialLegalAccepted, setSocialLegalAccepted] = useState(false)
  const [showSocialLegalError, setShowSocialLegalError] = useState(false)
  const [mfaChallenge, setMfaChallenge] = useState<LoginMfaChallenge | null>(forwardedMfaChallenge)
  const [selectedMfaMethod, setSelectedMfaMethod] = useState(
    forwardedMfaChallenge?.methods.includes(forwardedMfaChallenge.preferredMethod)
      ? forwardedMfaChallenge.preferredMethod
      : forwardedMfaChallenge?.methods[0] ?? 'totp',
  )
  const passwordForm = useForm<PasswordLoginFormValues>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: {
      email: demoLoginDefaults.email,
      password: demoLoginDefaults.password,
    },
  })
  const magicLinkForm = useForm<MagicLinkFormValues>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: {
      email: '',
    },
  })
  const mfaLoginForm = useForm<MfaLoginFormValues>({
    resolver: zodResolver(mfaLoginSchema),
    defaultValues: {
      code: '',
    },
  })

  // Read during render, not held in state: the provider redirects back here with the reason in the
  // URL, and a toast alone disappears after a few seconds — long before someone who looked away
  // during the redirect comes back to a login page that looks perfectly normal.
  const oauthErrorMessage = describeOauthError(searchParams.get('oauthError'))

  useEffect(() => {
    if (!oauthErrorMessage) return
    // A fixed id: React mounts effects twice in development, and two identical toasts stacked up.
    toast.error('Sign-in failed', { id: oauthErrorToastId, description: oauthErrorMessage })
  }, [oauthErrorMessage])

  if (token) {
    // A stored token with no profile yet means the reload is still fetching it; redirecting now
    // would send an owner to the customer profile purely because their roles had not arrived.
    if (!user) {
      return null
    }

    return <Navigate to={menuReturnPath ?? resolvePostLoginDestination(user.roles)} replace />
  }

  const handlePasswordSubmit = async (values: PasswordLoginFormValues) => {
    try {
      const response = await loginUser(values.email.trim(), values.password)

      if ('mfaRequired' in response) {
        const nextMethod = response.methods.includes(response.preferredMethod)
          ? response.preferredMethod
          : response.methods[0] ?? 'totp'

        setMfaChallenge({
          challengeId: response.challengeId,
          methods: response.methods,
          preferredMethod: response.preferredMethod,
        })
        setSelectedMfaMethod(nextMethod)
        mfaLoginForm.reset({ code: '' })
        toast.success('Verification required', {
          description: response.methods.includes('email')
            ? 'Enter your authenticator code or check your email.'
            : 'Enter your authenticator code.',
        })
        return
      }

      const from = menuReturnPath ?? locationState?.from?.pathname
      const destination = from || resolvePostLoginDestination(response.user.roles)
      toast.success('Signed in', {
        description: response.user.email ?? 'Welcome back.',
      })
      navigate(destination, { replace: true })
    } catch (loginError) {
      // A correct password on an unconfirmed account is not a failed sign-in, and telling the
      // person to "confirm your email" without giving them a way to get another one is a dead end.
      if (errorCodeOf(loginError) === 'email_not_confirmed') {
        navigate('/check-email', {
          replace: true,
          state: { email: values.email.trim(), reason: 'not-confirmed' },
        })
        return
      }

      const message = loginError instanceof Error ? loginError.message : 'Login failed'
      toast.error('Sign in failed', {
        description: message,
      })
      passwordForm.setError('root', { message })
    }
  }

  const handleMfaSubmit = async (values: MfaLoginFormValues) => {
    if (!mfaChallenge) {
      return
    }

    try {
      const response = await dispatch(verifyMfaLogin({
        challengeId: mfaChallenge.challengeId,
        method: selectedMfaMethod,
        code: values.code,
      })).unwrap()
      const from = menuReturnPath ?? locationState?.from?.pathname
      const destination = from || resolvePostLoginDestination(response.user.roles)

      toast.success('Signed in', {
        description: response.user.email ?? 'MFA verification successful.',
      })
      navigate(destination, { replace: true })
    } catch (mfaError) {
      // The thunk hands this back as a plain object, so `instanceof Error` is false and every
      // failure used to collapse into the same generic line — an expired step, a wrong code and a
      // locked account all looked identical, though only one of them means "try again".
      const { message } = describeError(mfaError, 'Verification failed')
      const code = errorCodeOf(mfaError)

      if (code === 'mfa_challenge_expired') {
        // Nothing here can be retyped into success; put them back where a new code comes from.
        setMfaChallenge(null)
        mfaLoginForm.reset({ code: '' })
      }

      toast.error(code === 'account_locked' ? 'Account locked' : 'Verification failed', {
        description: message,
      })
      mfaLoginForm.setError('root', { message })
    }
  }

  const handleBackToPassword = () => {
    setMfaChallenge(null)
    setSelectedMfaMethod('totp')
    mfaLoginForm.reset({ code: '' })
  }

  const handleMagicLinkSubmit = async (values: MagicLinkFormValues) => {
    try {
      const response = await requestMagicLink({
        email: values.email.trim(),
      })

      toast.success('Magic link sent', {
        description: response.message,
      })
      magicLinkForm.reset(values)
    } catch (magicLinkError) {
      const message = magicLinkError instanceof Error ? magicLinkError.message : 'Could not send magic link'
      toast.error('Could not send magic link', {
        description: message,
      })
      magicLinkForm.setError('root', { message })
    }
  }

  /**
   * The provider hand-off leaves the app entirely, so where to come back to has to travel with it.
   * Password and passkey sign-in read `menuReturnPath` straight off this page; an external provider
   * needs it round-tripped through the server, or the customer lands on the default page instead of
   * the restaurant menu they were ordering from.
   */
  const buildSocialLoginUrl = (loginUrl: string) => {
    const params = new URLSearchParams({
      customerTermsVersion: LEGAL_VERSIONS.customerTerms,
      privacyPolicyVersion: LEGAL_VERSIONS.privacyPolicy,
      ...(menuReturnPath ? { returnTo: menuReturnPath } : {}),
    })

    return `${loginUrl}?${params.toString()}`
  }

  const handleGoogleLogin = () => {
    if (!socialLegalAccepted) {
      setShowSocialLegalError(true)
      return
    }
    window.location.assign(buildSocialLoginUrl(googleLoginUrl))
  }

  const handleFacebookLogin = () => {
    if (!socialLegalAccepted) {
      setShowSocialLegalError(true)
      return
    }
    window.location.assign(buildSocialLoginUrl(facebookLoginUrl))
  }

  const handlePasskeyLogin = () => {
    // The prompt is opened first, synchronously, while the click still counts as user activation.
    // Fetching the challenge here instead would put a network round-trip in front of it, and the
    // browser then refuses to show the prompt at all — which is why it used to take two clicks.
    const prefetched = passkeyOptionsRef.current
    const attempt = prefetched && isPasskeySupported()
      ? startPasskeyAssertion(prefetched)
      : undefined

    // A challenge is single use, so the prefetched one is now spent either way.
    passkeyOptionsRef.current = null
    void completePasskeyLogin(attempt)
  }

  const completePasskeyLogin = async (attempt?: PasskeyAssertionAttempt) => {
    const startedAt = Date.now()
    setSigningInWithPasskey(true)

    try {
      const response = await dispatch(passkeyLogin(attempt)).unwrap()
      const destination = menuReturnPath ?? resolvePostLoginDestination(response.user.roles)

      toast.success('Signed in with passkey', {
        description: response.user.email ?? 'Welcome back.',
      })
      navigate(destination, { replace: true })
    } catch (passkeyError) {
      // The browser's error name is what distinguishes the causes — NotAllowedError is the
      // platform refusing or the person cancelling, InvalidStateError is a request already in
      // flight, SecurityError is an rpId mismatch. A generic message hides all of that, and the
      // thunk hands this back as a plain object rather than an Error.
      const { name, message } = describeError(passkeyError, 'Could not sign in with passkey')
      console.warn('[passkey] sign-in failed', {
        name,
        message,
        elapsed: Date.now() - startedAt,
        // Safari refuses an unfocused document. This says whether focus was the problem, and
        // whether waiting for it helped — the failure looks identical either way.
        // Settled by the time anything can fail: it is reported before the ceremony is invoked.
        focus: await attempt?.diagnostics,
      })

      toast.error('Passkey sign-in failed', { description: describePasskeyFailure(name, message) })
    } finally {
      setSigningInWithPasskey(false)
      void prefetchPasskeyOptions()
    }
  }

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>Sign in</h1></CardTitle>
          <CardDescription>Use your account to access the restaurant console.</CardDescription>
        </CardHeader>
        <CardContent>
          {mfaChallenge ? (
            <Form {...mfaLoginForm}>
              <form className="form-grid" onSubmit={mfaLoginForm.handleSubmit(handleMfaSubmit)}>
                <div className="auth-mfa-panel">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>Verify it is you</strong>
                    <span>
                      {selectedMfaMethod === 'email'
                        ? 'Enter the 6-digit code sent to your email.'
                        : 'Enter the 6-digit code from your authenticator app.'}
                    </span>
                  </div>
                </div>
                {mfaChallenge.methods.length > 1 && (
                  <div className="mfa-method-tabs" role="group" aria-label="MFA method">
                    {mfaChallenge.methods.map((method) => (
                      <Button
                        key={method}
                        type="button"
                        variant={selectedMfaMethod === method ? 'default' : 'secondary'}
                        onClick={() => {
                          setSelectedMfaMethod(method)
                          mfaLoginForm.reset({ code: '' })
                        }}
                      >
                        {method === 'email' ? <Mail size={16} /> : <ShieldCheck size={16} />}
                        {method === 'email' ? 'Email code' : 'Authenticator'}
                      </Button>
                    ))}
                  </div>
                )}
                <FormField
                  control={mfaLoginForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>6-digit code</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="123456"
                          {...field}
                          onChange={(event) => field.onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {mfaLoginForm.formState.errors.root && (
                  <p className="form-error">{mfaLoginForm.formState.errors.root.message}</p>
                )}
                <Button type="submit" disabled={mfaLoginForm.formState.isSubmitting}>
                  <ShieldCheck size={18} />
                  {mfaLoginForm.formState.isSubmitting ? 'Verifying' : 'Verify and sign in'}
                </Button>
                <Button type="button" variant="secondary" onClick={handleBackToPassword}>
                  Back to password
                </Button>
              </form>
            </Form>
          ) : (
            <Tabs defaultValue="password" className="auth-tabs">
            {oauthErrorMessage ? (
              <div className="confirm-status error" role="alert">
                <OctagonAlert size={22} />
                <span>{oauthErrorMessage}</span>
              </div>
            ) : null}
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="password">
                <LogIn size={16} />
                Password
              </TabsTrigger>
              <TabsTrigger value="magic-link">
                <Link2 size={16} />
                Email link
              </TabsTrigger>
            </TabsList>
            <TabsContent value="password">
              <Form {...passwordForm}>
                <form className="form-grid" onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)}>
                  {/* Only ever rendered in a development build — the branch is compiled out of
                      production along with the credentials themselves. */}
                  {isDemoLoginAutofilled ? (
                    <p className="auth-note">
                      Development build: prefilled with the seeded demo account. Set
                      {' '}<code>VITE_DEMO_LOGIN=off</code> to start from empty fields.
                    </p>
                  ) : null}
                  <FormField
                    control={passwordForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={passwordForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <PasswordInput autoComplete="current-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {passwordForm.formState.errors.root && (
                    <p className="form-error">{passwordForm.formState.errors.root.message}</p>
                  )}

                  <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                    <LogIn size={18} />
                    {passwordForm.formState.isSubmitting ? 'Signing in' : 'Sign in'}
                  </Button>
                  <div className="auth-divider">
                    <span />
                    <strong>or</strong>
                    <span />
                  </div>
                  <div className={showSocialLegalError && !socialLegalAccepted ? 'rounded-lg border border-destructive bg-destructive/5 p-2' : ''}>
                    <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><input type="checkbox" className="mt-1 size-4" checked={socialLegalAccepted} onChange={(event) => { setSocialLegalAccepted(event.target.checked); if (event.target.checked) setShowSocialLegalError(false) }} /><span>For first-time social registration, I accept the <Link className="underline" to="/terms/customer" target="_blank">Customer Terms</Link> and acknowledge the <Link className="underline" to="/privacy" target="_blank">Privacy Policy</Link>.</span></label>
                    {showSocialLegalError && !socialLegalAccepted ? <p className="mt-1 text-xs font-medium text-destructive">Tick this box before continuing with Google or Facebook.</p> : null}
                  </div>
                  <Button type="button" variant="outline" className="google-login-button" onClick={handleGoogleLogin}>
                    <img aria-hidden="true" className="google-mark" src={googleLogo} alt="" />
                    Continue with Google
                  </Button>
                  <Button type="button" variant="outline" onClick={handleFacebookLogin}>
                    <img aria-hidden="true" src={facebookLogo} alt="" width={18} height={18} />
                    Continue with Facebook
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePasskeyLogin}
                    disabled={signingInWithPasskey}
                  >
                    <Fingerprint size={18} />
                    {signingInWithPasskey ? 'Checking passkey' : 'Sign in with passkey'}
                  </Button>
                  <p className="auth-switch compact">
                    <Link to="/forgot-password">Forgot password?</Link>
                  </p>
                </form>
              </Form>
            </TabsContent>
            <TabsContent value="magic-link">
              <Form {...magicLinkForm}>
                <form className="form-grid" onSubmit={magicLinkForm.handleSubmit(handleMagicLinkSubmit)}>
                  <FormField
                    control={magicLinkForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {magicLinkForm.formState.errors.root && (
                    <p className="form-error">{magicLinkForm.formState.errors.root.message}</p>
                  )}

                  <Button type="submit" disabled={magicLinkForm.formState.isSubmitting}>
                    <Mail size={18} />
                    {magicLinkForm.formState.isSubmitting ? 'Sending link' : 'Send magic link'}
                  </Button>
                </form>
              </Form>
            </TabsContent>
            </Tabs>
          )}
          <p className="auth-switch">
            Need a customer account? <Link to="/register">Create one</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
