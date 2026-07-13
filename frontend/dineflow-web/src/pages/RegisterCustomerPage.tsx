import { zodResolver } from '@hookform/resolvers/zod'
import { Check, UserPlus, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { registerCustomer } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'

const registerCustomerSchema = z
  .object({
    fullName: z.string().min(1, 'Full name is required.'),
    email: z.email('Enter a valid email address.'),
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters.')
      .regex(/[0-9]/, 'Password must include a number.')
      .regex(/[a-z]/, 'Password must include a lowercase letter.')
      .regex(/[A-Z]/, 'Password must include an uppercase letter.')
      .regex(/[^a-zA-Z0-9]/, 'Password must include a symbol.'),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
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
    },
  })

  if (token) {
    return <Navigate to="/me" replace />
  }

  const handleSubmit = async (values: RegisterCustomerFormValues) => {
    try {
      const response = await registerCustomer({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
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
        },
      })
    } catch (registerError) {
      toast.error('Could not create account', {
        description: registerError instanceof Error ? registerError.message : 'Registration failed',
      })
    }
  }

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>Create customer account</CardTitle>
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
                  const rules = [
                    { label: 'At least 6 characters', met: field.value.length >= 6 },
                    { label: 'One number (0–9)', met: /[0-9]/.test(field.value) },
                    { label: 'One lowercase letter', met: /[a-z]/.test(field.value) },
                    { label: 'One uppercase letter', met: /[A-Z]/.test(field.value) },
                    { label: 'One symbol (!@#…)', met: /[^a-zA-Z0-9]/.test(field.value) },
                  ]
                  const score = rules.filter((r) => r.met).length
                  return (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" placeholder="ChangeMe123!" {...field} />
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
                          <ul className="space-y-0.5">
                            {rules.map((rule) => (
                              <li
                                key={rule.label}
                                className={cn(
                                  'flex items-center gap-1.5 text-xs transition-colors',
                                  rule.met ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
                                )}
                              >
                                {rule.met ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
                                {rule.label}
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
                      <Input type="password" autoComplete="new-password" placeholder="ChangeMe123!" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <UserPlus size={18} />
                {form.formState.isSubmitting ? 'Creating account' : 'Create account'}
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
