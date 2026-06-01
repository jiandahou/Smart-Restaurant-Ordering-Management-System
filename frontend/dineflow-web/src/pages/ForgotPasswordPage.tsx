import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { requestPasswordReset } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'

const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email address.'),
})

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

export function ForgotPasswordPage() {
  const { token } = useAuth()
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  })

  if (token) {
    return <Navigate to="/me" replace />
  }

  const handleSubmit = async (values: ForgotPasswordFormValues) => {
    try {
      const response = await requestPasswordReset({
        email: values.email.trim(),
      })

      toast.success('Reset link sent', {
        description: response.message,
      })
      form.reset(values)
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : 'Could not send password reset link'
      toast.error('Could not send reset link', {
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
          <CardTitle>Reset password</CardTitle>
          <CardDescription>Enter your customer account email and check your inbox.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="form-grid" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormField
                control={form.control}
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

              {form.formState.errors.root && (
                <p className="form-error">{form.formState.errors.root.message}</p>
              )}

              <Button type="submit" disabled={form.formState.isSubmitting}>
                <MailCheck size={18} />
                {form.formState.isSubmitting ? 'Sending link' : 'Send reset link'}
              </Button>
            </form>
          </Form>
          <p className="auth-switch">
            Remembered it? <Link to="/login">Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
