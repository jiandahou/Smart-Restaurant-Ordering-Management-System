import { zodResolver } from '@hookform/resolvers/zod'
import { Fingerprint, Link2, LogIn, Mail, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import facebookLogo from '../assets/facebook-f.svg'
import googleLogo from '../assets/google-g.svg'
import { requestMagicLink } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { passkeyLogin, verifyMfaLogin } from '../auth/authSlice'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useAppDispatch } from '../hooks'

const adminRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin']
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const googleLoginUrl = `${apiBaseUrl}/api/auth/google/login`
const facebookLoginUrl = `${apiBaseUrl}/api/auth/facebook/login`

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

export function LoginPage() {
  const { token, loginUser } = useAuth()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [signingInWithPasskey, setSigningInWithPasskey] = useState(false)
  const [mfaChallenge, setMfaChallenge] = useState<LoginMfaChallenge | null>(null)
  const [selectedMfaMethod, setSelectedMfaMethod] = useState('totp')
  const passwordForm = useForm<PasswordLoginFormValues>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: {
      email: 'owner@dineflow.com',
      password: 'ChangeMe123!',
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

  useEffect(() => {
    const oauthError = searchParams.get('oauthError')
    if (!oauthError) return
    const messages: Record<string, string> = {
      google_failed: 'Google sign-in failed. Please try again.',
      google_missing_profile: 'Google did not return your profile. Please try again.',
      google_create_failed: 'Could not create your account via Google. Please try again.',
      google_link_failed: 'Could not link your Google account. Please try again.',
      facebook_failed: 'Facebook sign-in failed. Please try again.',
      facebook_missing_profile: 'Facebook did not return your profile. Please try again.',
      facebook_create_failed: 'Could not create your account via Facebook. Please try again.',
      facebook_link_failed: 'Could not link your Facebook account. Please try again.',
    }
    toast.error('Sign-in failed', {
      description: messages[oauthError] ?? 'OAuth sign-in failed. Please try again.',
    })
  }, [searchParams])

  if (token) {
    return <Navigate to="/me" replace />
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

      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
      const destination = from || (response.user.roles.some((role) => adminRoles.includes(role)) ? '/admin/users' : '/me')
      toast.success('Signed in', {
        description: response.user.email ?? 'Welcome back.',
      })
      navigate(destination, { replace: true })
    } catch (loginError) {
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
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
      const destination = from || (response.user.roles.some((role) => adminRoles.includes(role)) ? '/admin/users' : '/me')

      toast.success('Signed in', {
        description: response.user.email ?? 'MFA verification successful.',
      })
      navigate(destination, { replace: true })
    } catch (mfaError) {
      const message = mfaError instanceof Error ? mfaError.message : 'MFA verification failed'
      toast.error('Verification failed', {
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

  const handleGoogleLogin = () => {
    window.location.assign(googleLoginUrl)
  }

  const handleFacebookLogin = () => {
    window.location.assign(facebookLoginUrl)
  }

  const handlePasskeyLogin = async () => {
    setSigningInWithPasskey(true)

    try {
      const response = await dispatch(passkeyLogin()).unwrap()
      const destination = response.user.roles.some((role) => adminRoles.includes(role)) ? '/admin/users' : '/me'

      toast.success('Signed in with passkey', {
        description: response.user.email ?? 'Welcome back.',
      })
      navigate(destination, { replace: true })
    } catch (passkeyError) {
      toast.error('Passkey sign-in failed', {
        description: passkeyError instanceof Error ? passkeyError.message : 'Could not sign in with passkey',
      })
    } finally {
      setSigningInWithPasskey(false)
    }
  }

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>Sign in</CardTitle>
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
                          <Input type="password" autoComplete="current-password" {...field} />
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
