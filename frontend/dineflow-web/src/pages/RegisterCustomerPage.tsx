import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Check, UserPlus, X } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import facebookLogo from '../assets/facebook-f.svg'
import googleLogo from '../assets/google-g.svg'
import { registerCustomer } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { fullNameSchema } from '../lib/nameFields'
import { evaluatePassword, passwordSchema } from '../lib/passwordPolicy'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { PasswordInput } from '../components/auth/PasswordInput'
import { cn } from '../lib/utils'
import { LEGAL_VERSIONS } from '../legal/legalConfig'

const googleRegistrationUrl = '/api/auth/google/login'
const facebookRegistrationUrl = '/api/auth/facebook/login'

const registerCustomerSchema = z
  .object({
    fullName: fullNameSchema(),
    email: z.email('Enter a valid email address.'),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
    acceptLegal: z.boolean().refine(Boolean, 'You must accept the Customer Terms and acknowledge the Privacy Policy.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })

type RegisterCustomerFormValues = z.infer<typeof registerCustomerSchema>

export function RegisterCustomerPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const form = useForm<RegisterCustomerFormValues>({
    resolver: zodResolver(registerCustomerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptLegal: false,
    },
  })
  const acceptLegal = useWatch({ control: form.control, name: 'acceptLegal' })

  if (token) {
    return <Navigate to="/me" replace />
  }

  const handleSubmit = async (values: RegisterCustomerFormValues) => {
    try {
      const response = await registerCustomer({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
        acceptedCustomerTermsVersion: LEGAL_VERSIONS.customerTerms,
        acknowledgedPrivacyPolicyVersion: LEGAL_VERSIONS.privacyPolicy,
      })

      toast.success('Account created', {
        description: response.confirmationEmailSent
          ? 'Check your inbox to confirm your email.'
          : 'Account created, but the confirmation email could not be sent.',
      })
      navigate('/check-email', {
        replace: true,
        state: {
          email: response.email ?? values.email.trim(),
          confirmationEmailSent: response.confirmationEmailSent,
          reason: 'registered',
        },
      })
    } catch (registerError) {
      toast.error('Could not create account', {
        description: registerError instanceof Error ? registerError.message : 'Registration failed',
      })
    }
  }

  const handleSocialRegistration = (provider: 'google' | 'facebook') => {
    if (!acceptLegal) return

    const registrationUrl = provider === 'google' ? googleRegistrationUrl : facebookRegistrationUrl
    const query = new URLSearchParams({
      customerTermsVersion: LEGAL_VERSIONS.customerTerms,
      privacyPolicyVersion: LEGAL_VERSIONS.privacyPolicy,
    })

    window.location.assign(`${registrationUrl}?${query.toString()}`)
  }

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    navigate('/login', { replace: true })
  }

  return (
    <main className="login-screen registration-screen">
      <Button type="button" variant="outline" className="registration-back-button" onClick={handleBack}>
        <ArrowLeft aria-hidden="true" />
        Back
      </Button>
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>Create customer account</h1></CardTitle>
          <CardDescription>Confirm your email before signing in.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="form-grid" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" placeholder="Jane Smith" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="jane@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => {
                  // Rules come from the shared policy so this meter can never disagree with what
                  // the form (or the server) will actually accept.
                  const rules = evaluatePassword(field.value)
                  const score = rules.filter((rule) => rule.met).length
                  return (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <PasswordInput autoComplete="new-password" placeholder="At least 8 characters" {...field} />
                      </FormControl>
                      {field.value.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex gap-1">
                            {rules.map((_, i) => (
                              <div
                                key={i}
                                className={cn(
                                  'h-1 flex-1 rounded-full transition-colors duration-300',
                                  i < score
                                    ? score <= 2
                                      ? 'bg-destructive'
                                      : score <= 3
                                        ? 'bg-yellow-500'
                                        : 'bg-green-500'
                                    : 'bg-muted',
                                )}
                              />
                            ))}
                          </div>
                          <ul className="space-y-0.5" aria-live="polite">
                            {rules.map((rule) => (
                              <li
                                key={rule.id}
                                className={cn(
                                  'flex items-center gap-1.5 text-xs transition-colors',
                                  rule.met ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
                                )}
                              >
                                {rule.met ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
                                {rule.label}
                                <span className="sr-only">{rule.met ? '— met' : '— still needed'}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" placeholder="At least 8 characters" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="border-t pt-4">
                <FormField
                  control={form.control}
                  name="acceptLegal"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-start gap-3 rounded-lg border p-3">
                        <FormControl><input type="checkbox" checked={field.value} onChange={(event) => field.onChange(event.target.checked)} aria-label="Accept legal terms" className="mt-1 size-4" /></FormControl>
                        <div className="text-sm leading-5">
                          I accept the <Link className="underline" to="/terms/customer" target="_blank">Customer Terms</Link> and acknowledge the <Link className="underline" to="/privacy" target="_blank">Privacy Policy</Link>.
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting || !acceptLegal}>
                <UserPlus size={18} />
                {form.formState.isSubmitting ? 'Creating account' : 'Create account'}
              </Button>
              <div className="auth-divider">
                <span />
                <strong>or</strong>
                <span />
              </div>
              <Button
                type="button"
                variant="outline"
                className="google-login-button"
                disabled={!acceptLegal}
                onClick={() => handleSocialRegistration('google')}
              >
                <img aria-hidden="true" className="google-mark" src={googleLogo} alt="" />
                Continue with Google
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!acceptLegal}
                onClick={() => handleSocialRegistration('facebook')}
              >
                <img aria-hidden="true" src={facebookLogo} alt="" width={18} height={18} />
                Continue with Facebook
              </Button>
            </form>
          </Form>
          <p className="auth-switch">
            Already confirmed? <Link to="/login">Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
