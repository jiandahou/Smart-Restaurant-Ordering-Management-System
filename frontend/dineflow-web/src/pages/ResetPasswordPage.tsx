import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { resetPassword } from '../api/auth'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters.')
      .regex(/[0-9]/, 'Password must include a number.')
      .regex(/[a-z]/, 'Password must include a lowercase letter.')
      .regex(/[A-Z]/, 'Password must include an uppercase letter.')
      .regex(/[^a-zA-Z0-9]/, 'Password must include a symbol.'),
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const userId = searchParams.get('userId')
  const token = searchParams.get('token')
  const hasLinkData = Boolean(userId && token)
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  const handleSubmit = async (values: ResetPasswordFormValues) => {
    if (!userId || !token) {
      form.setError('root', { message: 'Password reset link is missing required information.' })
      return
    }

    try {
      const response = await resetPassword({
        userId,
        token,
        password: values.password,
      })

      toast.success('Password updated', {
        description: response.message,
      })
      navigate('/login', { replace: true })
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : 'Could not update password'
      toast.error('Could not update password', {
        description: message,
      })
      form.setError('root', { message })
    }
  }

  return (
    <main className="login-screen">
      <Card className="login-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>Set new password</CardTitle>
          <CardDescription>
            {hasLinkData ? 'Choose a new customer account password.' : 'Password reset link is invalid.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasLinkData ? (
            <Form {...form}>
              <form className="form-grid" onSubmit={form.handleSubmit(handleSubmit)}>
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" placeholder="ChangeMe123!" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.formState.errors.root && (
                  <p className="form-error">{form.formState.errors.root.message}</p>
                )}

                <Button type="submit" disabled={form.formState.isSubmitting}>
                  <KeyRound size={18} />
                  {form.formState.isSubmitting ? 'Updating password' : 'Update password'}
                </Button>
              </form>
            </Form>
          ) : (
            <div className="form-grid">
              <div className="confirm-status error">
                <KeyRound size={22} />
                <span>Needs attention</span>
              </div>
              <Button asChild>
                <Link to="/forgot-password">Request another link</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
